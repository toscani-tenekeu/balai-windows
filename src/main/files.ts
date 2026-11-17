import { shell } from 'electron'
import { lstat, readdir, rm, stat, unlink } from 'node:fs/promises'
import { win32 } from 'node:path'
import { logActivity } from './db'
import { isKeptFolder, isSystemPath } from './paths'
import { sizeOf, walk } from './walk'

const { basename, dirname, join, resolve } = win32

function clean(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 4000 || input.includes('\0')) return null
  if (!/^[a-zA-Z]:[\\/]/.test(input)) return null
  return resolve(input).replace(/\\+$/, '') || null
}

/** Folders a search never enters: Windows' own stores and other volumes' snapshots. */
const SKIP = /\\(system volume information|\$recycle\.bin|winsxs|\$winreagent|\$windows\.~bt)$/i

// ---- Disk browser -------------------------------------------------------------

export interface Entry {
  path: string
  name: string
  size: number
  directory: boolean
  locked: boolean
}

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index]!)
      }
    }),
  )
  return results
}

export async function usage(input: string) {
  const path = clean(input)
  if (!path) return null
  const root = /^[a-zA-Z]:$/.test(path) ? `${path}\\` : path
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }

  const measured = await pool(
    entries.filter((entry) => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile())),
    6,
    async (entry): Promise<Entry> => {
      const full = join(root, entry.name)
      const directory = entry.isDirectory()
      let size = 0
      if (directory) {
        if (!SKIP.test(full)) size = await sizeOf([full])
      } else {
        size = await stat(full).then((info) => info.size, () => 0)
      }
      return {
        path: full,
        name: entry.name,
        size,
        directory,
        locked: directory ? isKeptFolder(full) : isSystemPath(full),
      }
    },
  )

  measured.sort((a, b) => b.size - a.size)
  const parent = dirname(root)
  return {
    path: root,
    parent: parent === root ? null : parent,
    total: measured.reduce((total, entry) => total + entry.size, 0),
    entries: measured.slice(0, 300),
  }
}

// ---- Search -------------------------------------------------------------------

const EXTENSION = /^[a-z0-9][a-z0-9.+_-]{0,19}$/i
const MAX_RESULTS = 1000

export async function searchFiles(input: { path: string; extensions: string[]; minBytes: number; olderThanDays: number }) {
  const extensions = [...new Set(input.extensions.map((item) => item.trim().replace(/^[*.]+/, '').toLowerCase()))].filter(Boolean)
  if (extensions.length > 20 || extensions.some((item) => !EXTENSION.test(item))) {
    return { ok: false as const, message: 'Extensions can only contain letters, digits, dots and dashes.' }
  }
  const minBytes = Math.max(0, Math.floor(input.minBytes) || 0)
  const days = Math.max(0, Math.floor(input.olderThanDays) || 0)
  if (!extensions.length && !minBytes) return { ok: false as const, message: 'Give at least one extension or a minimum size.' }

  const cleaned = clean(input.path)
  const root = cleaned && /^[a-zA-Z]:$/.test(cleaned) ? `${cleaned}\\` : cleaned
  if (!root || !(await stat(root).then((info) => info.isDirectory(), () => false))) {
    return { ok: false as const, message: 'That folder does not exist.' }
  }

  const limit = days ? Date.now() - days * 86_400_000 : Infinity
  const suffixes = extensions.map((item) => `.${item}`)
  const files: { path: string; size: number; modified: number; locked: boolean }[] = []
  let total = 0
  await walk(
    [root],
    (file) => {
      if (file.size < minBytes || file.modified >= limit) return
      const name = file.path.toLowerCase()
      if (suffixes.length && !suffixes.some((suffix) => name.endsWith(suffix))) return
      total += file.size
      files.push({ ...file, locked: isSystemPath(file.path) })
    },
    (dir) => SKIP.test(dir),
  )
  files.sort((a, b) => b.size - a.size)
  return {
    ok: true as const,
    path: root,
    extensions,
    count: files.length,
    total,
    truncated: files.length > MAX_RESULTS,
    files: files.slice(0, MAX_RESULTS),
  }
}

// ---- Deleting -----------------------------------------------------------------

function errorText(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'Already gone.'
  if (code === 'EBUSY') return 'Open in a program.'
  if (code === 'EACCES' || code === 'EPERM') return 'Access denied, or open in a program.'
  return error instanceof Error ? error.message : 'Could not be deleted.'
}

/** Files go to the Recycle Bin unless the user asks for them to be removed for good. */
export async function deleteFiles(input: unknown[], permanent: boolean) {
  const failed: { path: string; message: string }[] = []
  const deleted: string[] = []
  let freed = 0

  for (const raw of input.slice(0, 5000)) {
    const path = clean(raw)
    if (!path) continue
    try {
      const info = await lstat(path)
      if (!info.isFile()) throw new Error('Not a file.')
      if (isSystemPath(path)) throw new Error('Windows needs this file. It was left in place.')
      if (permanent) await unlink(path)
      else await shell.trashItem(path)
      deleted.push(path)
      if (permanent) freed += info.size
    } catch (error) {
      failed.push({ path, message: errorText(error) })
    }
  }

  if (deleted.length) {
    const where = permanent ? 'Deleted' : 'Moved to the Recycle Bin'
    logActivity({
      area: 'files',
      action: deleted.length === 1 ? `${where}: 1 file` : `${where}: ${deleted.length} files`,
      target: deleted.length === 1 ? deleted[0] : dirname(deleted[0]!),
      detail: deleted.length === 1 ? '' : deleted.join('\n'),
      freed,
    })
  }
  return { ok: failed.length === 0, deleted: deleted.length, freed, failed: failed.slice(0, 50) }
}

export async function deleteFolder(input: unknown, permanent: boolean) {
  const path = clean(input)
  if (!path) return { ok: false, message: 'Invalid path.', freed: 0 }
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) return { ok: false, message: 'Not a folder.', freed: 0 }
  } catch {
    return { ok: false, message: 'That folder does not exist.', freed: 0 }
  }
  if (isKeptFolder(path)) return { ok: false, message: 'Windows or your profile needs this folder. It was left in place.', freed: 0 }

  const size = await sizeOf([path])
  try {
    if (permanent) await rm(path, { recursive: true, force: true, maxRetries: 2 })
    else await shell.trashItem(path)
    logActivity({
      area: 'files',
      action: permanent ? 'Deleted folder' : 'Moved folder to the Recycle Bin',
      target: path,
      freed: permanent ? size : 0,
    })
    return { ok: true, message: `${basename(path)} ${permanent ? 'deleted' : 'moved to the Recycle Bin'}.`, freed: permanent ? size : 0 }
  } catch (error) {
    const message = errorText(error)
    logActivity({ area: 'files', action: 'Delete failed', target: path, detail: message, ok: false })
    return { ok: false, message: `Some files could not be removed: ${message}`, freed: 0 }
  }
}
