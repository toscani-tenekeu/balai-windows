import { spawn } from 'node:child_process'
import { logActivity } from './db'
import { messageOf, ps, run } from './sys'

export interface InstalledApp {
  id: string
  name: string
  version: string
  publisher: string
  size: number
  installed: string
  scope: 'All users' | 'Current user'
  canUninstall: boolean
}

interface RawApp {
  key: string
  name: string
  version: string
  publisher: string
  size: number
  date: string
  uninstall: string
  hive: string
}

async function rawApps(): Promise<RawApp[]> {
  return (
    (await ps<RawApp[]>(`
      $keys = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
              'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
              'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
      $out = foreach ($root in $keys) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($k in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
          $name = [string]$k.GetValue('DisplayName')
          if (-not $name) { continue }
          if ($k.GetValue('SystemComponent') -eq 1) { continue }
          if ($k.GetValue('ParentKeyName')) { continue }
          if ([string]$k.GetValue('ReleaseType') -match 'Update|Hotfix') { continue }
          [pscustomobject]@{
            key = $k.Name; name = $name; version = [string]$k.GetValue('DisplayVersion')
            publisher = [string]$k.GetValue('Publisher'); size = [int64]$k.GetValue('EstimatedSize', 0) * 1024
            date = [string]$k.GetValue('InstallDate'); uninstall = [string]$k.GetValue('UninstallString')
            hive = $root.Substring(0, 4)
          }
        }
      }
      ConvertTo-Json -InputObject @($out) -Compress
    `)) ?? []
  )
}

const dateOf = (value: string) =>
  /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : ''

export async function listApps(): Promise<InstalledApp[]> {
  const seen = new Set<string>()
  const list: InstalledApp[] = []
  for (const app of await rawApps()) {
    const dedupe = `${app.name}|${app.version}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    list.push({
      id: app.key,
      name: app.name,
      version: app.version,
      publisher: app.publisher,
      size: app.size,
      installed: dateOf(app.date),
      scope: app.hive === 'HKCU' ? 'Current user' : 'All users',
      canUninstall: app.uninstall.trim() !== '',
    })
  }
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Uninstall commands in the registry are often unquoted paths with spaces.
 * Quote the program path so cmd.exe does not split it, and turn an MSI
 * "repair" command into a removal.
 */
export function uninstallCommand(raw: string): string {
  let command = raw.trim()
  if (/^msiexec(\.exe)?\s/i.test(command)) return command.replace(/\s\/I\s*\{/i, ' /X{')
  if (!command.startsWith('"')) {
    const exe = command.match(/^(.+?\.exe)(\s.*)?$/i)
    if (exe && exe[1]!.includes(' ')) command = `"${exe[1]}"${exe[2] ?? ''}`
  }
  return command
}

/** Opens the program's own uninstaller, which asks its own questions. */
export async function uninstallApp(id: string) {
  const app = (await rawApps()).find((item) => item.key === id)
  if (!app) return { ok: false, message: 'That program is no longer installed.' }
  if (!app.uninstall.trim()) return { ok: false, message: 'This program does not provide an uninstaller.' }

  try {
    const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${uninstallCommand(app.uninstall)}"`], {
      windowsVerbatimArguments: true,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    logActivity({ area: 'apps', action: 'Opened uninstaller', target: app.name })
    return { ok: true, message: `The uninstaller for ${app.name} is open. Follow its steps to finish.` }
  } catch (error) {
    const message = messageOf(error)
    logActivity({ area: 'apps', action: 'Uninstall failed', target: app.name, detail: message, ok: false })
    return { ok: false, message }
  }
}

// ---- Updates through winget -----------------------------------------------------

export interface AppUpdate {
  name: string
  id: string
  current: string
  next: string
  source: string
}

const WINGET_ID = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/

/** Lines of winget output with the progress spinner and bars taken out. */
function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\r').at(-1) ?? '')
    .map((line) => line.replace(/[█▒░]+/g, '').replace(/\s+$/, ''))
    .filter((line) => line.trim() && !/^\s*[-\\|/]\s*$/.test(line))
}

/**
 * Reads winget's table by the position of its header words, which works
 * whatever the language of Windows.
 */
export function parseUpgrades(text: string): AppUpdate[] {
  const rows = cleanLines(text)
  const rule = rows.findIndex((line) => /^-{10,}$/.test(line.trim()))
  if (rule < 1) return []
  const header = rows[rule - 1]!
  const starts = [...header.matchAll(/\S+/g)].map((match) => match.index!)
  if (starts.length < 4) return []

  const list: AppUpdate[] = []
  for (const line of rows.slice(rule + 1)) {
    if (/^-{10,}$/.test(line.trim())) break
    // Names can contain spaces and are cut to the column; the other columns never do,
    // except for versions winget prints as "< 1.2".
    const tokens = line.slice(starts[1]).trim().split(/\s+/)
    const cells: string[] = []
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!
      if ((token === '<' || token === '>') && tokens[index + 1]) cells.push(`${token} ${tokens[++index]}`)
      else cells.push(token)
    }
    const [id = '', current = '', next = '', source = ''] = cells
    if (!WINGET_ID.test(id) || !next) break
    list.push({ name: line.slice(0, starts[1]).trim(), id, current, next, source })
  }
  return list
}

const WINGET_COMMON = ['--accept-source-agreements', '--disable-interactivity']

let updatesCache: { at: number; state: { available: boolean; updates: AppUpdate[]; error: string | null } } | null = null

export async function appUpdates(fresh = false) {
  if (updatesCache && !fresh && Date.now() - updatesCache.at < 600_000) return updatesCache.state
  const result = await run('winget', ['upgrade', ...WINGET_COMMON], { timeout: 180_000 })
  let state
  if (result.code === -1) {
    state = { available: false, updates: [], error: 'winget is not installed. Install App Installer from the Microsoft Store to update programs from here.' }
  } else {
    const updates = parseUpgrades(result.stdout)
    state = { available: true, updates, error: updates.length || result.ok ? null : cleanLines(result.stdout).at(-1) ?? null }
  }
  updatesCache = { at: Date.now(), state }
  return state
}

export interface Job {
  id: number
  title: string
  running: boolean
  ok: boolean | null
  output: string[]
  startedAt: number
  finishedAt: number | null
}

let job: Job | null = null
let jobs = 0

export const appJob = () => job

export function updateApps(id: string | null) {
  if (job?.running) return { ok: false, message: 'Another update is still running.' }
  if (id !== null && !WINGET_ID.test(id)) return { ok: false, message: 'Invalid program id.' }

  const args =
    id === null
      ? ['upgrade', '--all', '--silent', '--accept-package-agreements', ...WINGET_COMMON]
      : ['upgrade', '--id', id, '--exact', '--silent', '--accept-package-agreements', ...WINGET_COMMON]
  const name = id === null ? null : updatesCache?.state.updates.find((item) => item.id === id)?.name ?? id
  const current: Job = {
    id: ++jobs,
    title: name ? `Updating ${name}` : 'Updating every program',
    running: true,
    ok: null,
    output: [],
    startedAt: Date.now(),
    finishedAt: null,
  }
  job = current

  const child = spawn('winget', args, { windowsHide: true })
  const take = (chunk: Buffer) => {
    current.output.push(...cleanLines(chunk.toString('utf8')))
    if (current.output.length > 400) current.output.splice(0, current.output.length - 400)
  }
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  const finish = (ok: boolean, note?: string) => {
    if (!current.running) return
    if (note) current.output.push(note)
    current.running = false
    current.ok = ok
    current.finishedAt = Date.now()
    updatesCache = null
    logActivity({
      area: 'apps',
      action: ok ? (name ? 'Updated program' : 'Updated every program') : 'Update failed',
      target: name ?? '',
      detail: ok ? '' : current.output.slice(-8).join('\n'),
      ok,
    })
  }
  child.on('error', (error) => finish(false, error.message))
  child.on('close', (code) => finish(code === 0))
  return { ok: true, message: `${current.title} started.` }
}
