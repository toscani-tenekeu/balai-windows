import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { win32 } from 'node:path'

const { join } = win32

export interface Found {
  path: string
  size: number
  modified: number
}

/**
 * Visits every file under the given folders. Links and junctions are not
 * followed, so a walk never leaves the folders it was given.
 */
export async function walk(
  roots: string[],
  visit: (file: Found) => void,
  skip?: (dir: string) => boolean,
): Promise<void> {
  const queue = [...roots]
  let active = 0

  await new Promise<void>((done) => {
    const pump = () => {
      if (!queue.length && !active) return done()
      while (active < 12 && queue.length) {
        const dir = queue.pop()!
        active += 1
        readdir(dir, { withFileTypes: true })
          .then(async (entries) => {
            const files: string[] = []
            for (const entry of entries) {
              const path = join(dir, entry.name)
              if (entry.isSymbolicLink()) continue
              if (entry.isDirectory()) {
                if (!skip?.(path)) queue.push(path)
              } else if (entry.isFile()) files.push(path)
            }
            for (let index = 0; index < files.length; index += 64) {
              await Promise.all(
                files.slice(index, index + 64).map((path) =>
                  lstat(path).then(
                    (stat) => visit({ path, size: stat.size, modified: Math.max(stat.mtimeMs, stat.birthtimeMs) }),
                    () => undefined,
                  ),
                ),
              )
            }
          })
          .catch(() => undefined)
          .finally(() => {
            active -= 1
            pump()
          })
      }
    }
    pump()
  })
}

export async function collect(roots: string[], keep: (file: Found) => boolean = () => true): Promise<Found[]> {
  const found: Found[] = []
  await walk(roots, (file) => {
    if (keep(file)) found.push(file)
  })
  return found
}

export async function sizeOf(roots: string[]): Promise<number> {
  let total = 0
  await walk(roots, (file) => (total += file.size))
  return total
}

export const sum = (files: { size: number }[]) => files.reduce((total, file) => total + file.size, 0)

/** Deletes the files it can. Files that are open in a program are skipped. */
export async function removeFiles(files: { path: string }[]): Promise<number> {
  let removed = 0
  for (const file of files) {
    try {
      await unlink(file.path)
      removed += 1
    } catch {
      // In use or already gone.
    }
  }
  return removed
}

/** Removes folders left empty under a root, without removing the root itself. */
export async function removeEmptyFolders(root: string): Promise<void> {
  async function visit(dir: string): Promise<boolean> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    let empty = true
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const path = join(dir, entry.name)
        if (await visit(path)) {
          try {
            await rmdir(path)
            continue
          } catch {
            // Still in use.
          }
        }
      }
      empty = false
    }
    return empty
  }
  await visit(root)
}
