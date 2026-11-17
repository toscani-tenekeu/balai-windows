import { readdirSync } from 'node:fs'
import { win32 } from 'node:path'
import { systemRoot } from './sys'

const { dirname, join, parse, resolve } = win32

export const systemDrive = `${(process.env.SystemDrive ?? 'C:').toUpperCase()}\\`
export const usersDir = join(systemDrive, 'Users')
export const programData = process.env.ProgramData ?? join(systemDrive, 'ProgramData')

const lower = (path: string) => resolve(path).toLowerCase().replace(/\\+$/, '')

/** Every user profile folder on this computer. */
export function profiles(): string[] {
  const skip = new Set(['public', 'default', 'default user', 'all users', 'defaultapppool'])
  try {
    return readdirSync(usersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !skip.has(entry.name.toLowerCase()))
      .map((entry) => join(usersDir, entry.name))
  } catch {
    return []
  }
}

let extraProtected: string[] = []

/** The app's own install and data folders are never deleted from inside it. */
export function protectPaths(paths: string[]) {
  extraProtected = paths.map(lower)
}

const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}\\`)

function systemTrees(): string[] {
  const drive = systemDrive.toLowerCase().replace(/\\$/, '')
  return [
    systemRoot,
    process.env.ProgramFiles ?? `${drive}\\Program Files`,
    process.env['ProgramFiles(x86)'] ?? `${drive}\\Program Files (x86)`,
    process.env.ProgramW6432 ?? `${drive}\\Program Files`,
    join(programData, 'Microsoft'),
    `${drive}\\Recovery`,
    `${drive}\\Boot`,
    `${drive}\\EFI`,
    `${drive}\\$WinREAgent`,
    `${drive}\\$Windows.~BT`,
    `${drive}\\$Windows.~WS`,
  ].map(lower)
}

const SYSTEM_FILES = /^(pagefile|hiberfil|swapfile)\.sys$|^bootmgr$|^bootnxt$|^dumpstack\.log(\.tmp)?$/i
const HIVES = /^(ntuser|usrclass)\.(dat|ini|pol)/i
const SPECIAL = /\\(system volume information|\$recycle\.bin)(\\|$)/i

/** True for files Balai refuses to delete. */
export function isSystemPath(input: string): boolean {
  const path = lower(input)
  const name = parse(path).base
  if (SPECIAL.test(path)) return true
  if (/^[a-z]:\\[^\\]+$/.test(path) && SYSTEM_FILES.test(name)) return true
  if (HIVES.test(name)) return true
  return [...systemTrees(), ...extraProtected].some((tree) => within(path, tree))
}

const KEEP_IN_PROFILE = [
  'appdata', 'appdata\\local', 'appdata\\roaming', 'appdata\\locallow', 'desktop', 'documents', 'downloads',
  'pictures', 'music', 'videos', 'onedrive', 'favorites', 'contacts', 'links', 'saved games', 'searches',
  '3d objects', 'appdata\\local\\temp', 'appdata\\local\\microsoft', 'appdata\\roaming\\microsoft',
]

/** True for folders Balai refuses to delete. */
export function isKeptFolder(input: string): boolean {
  const path = lower(input)
  if (isSystemPath(path)) return true
  if (/^[a-z]:$/.test(path)) return true
  const users = lower(usersDir)
  if (path === users || dirname(path).toLowerCase() === users) return true
  if (within(path, users)) {
    const rest = path.slice(users.length + 1).split('\\').slice(1).join('\\')
    if (KEEP_IN_PROFILE.includes(rest)) return true
  }
  if (path === lower(programData)) return true
  // A folder that holds something protected cannot go either.
  return [...systemTrees(), ...extraProtected].some((tree) => within(tree, path))
}
