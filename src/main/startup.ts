import { logActivity } from './db'
import { messageOf, ps } from './sys'

export interface StartupItem {
  id: string
  name: string
  command: string
  scope: 'All users' | 'Current user'
  kind: 'registry' | 'folder'
  enabled: boolean
}

const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved'

/** Where programs register to start, and where Windows records whether each one is turned off. */
const SOURCES = [
  { key: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKLM:\\${APPROVED}\\Run`, scope: 'All users' },
  { key: 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKLM:\\${APPROVED}\\Run32`, scope: 'All users' },
  { key: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKCU:\\${APPROVED}\\Run`, scope: 'Current user' },
] as const

const FOLDERS = [
  { folder: 'Startup', approved: `HKCU:\\${APPROVED}\\StartupFolder`, scope: 'Current user' },
  { folder: 'CommonStartup', approved: `HKLM:\\${APPROVED}\\StartupFolder`, scope: 'All users' },
] as const

interface Raw {
  source: number
  value: string
  name: string
  command: string
  approved: number
}

const LIST = `
  $sources = $env:BALAI_SOURCES | ConvertFrom-Json
  $folders = $env:BALAI_FOLDERS | ConvertFrom-Json
  function Approved($path, $value) {
    if (-not (Test-Path -LiteralPath $path)) { return 2 }
    $b = (Get-Item -LiteralPath $path).GetValue($value)
    if ($b -is [byte[]] -and $b.Length -gt 0) { return [int]$b[0] }
    return 2
  }
  $out = @()
  for ($i = 0; $i -lt $sources.Count; $i++) {
    $s = $sources[$i]
    if (-not (Test-Path -LiteralPath $s.key)) { continue }
    $k = Get-Item -LiteralPath $s.key
    foreach ($n in $k.GetValueNames()) {
      if (-not $n) { continue }
      $out += [pscustomobject]@{ source = $i; value = $n; name = $n; command = [string]$k.GetValue($n); approved = (Approved $s.approved $n) }
    }
  }
  $shell = New-Object -ComObject WScript.Shell
  for ($i = 0; $i -lt $folders.Count; $i++) {
    $f = $folders[$i]
    $dir = [Environment]::GetFolderPath($f.folder)
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue) {
      if ($file.Name -ieq 'desktop.ini') { continue }
      $target = $file.FullName
      if ($file.Extension -ieq '.lnk') { try { $t = $shell.CreateShortcut($file.FullName).TargetPath; if ($t) { $target = $t } } catch {} }
      $out += [pscustomobject]@{ source = 100 + $i; value = $file.Name; name = $file.BaseName; command = [string]$target; approved = (Approved $f.approved $file.Name) }
    }
  }
  ConvertTo-Json -InputObject @($out) -Compress
`

async function raw(): Promise<Raw[]> {
  return (
    (await ps<Raw[]>(LIST, {
      BALAI_SOURCES: JSON.stringify(SOURCES),
      BALAI_FOLDERS: JSON.stringify(FOLDERS),
    })) ?? []
  )
}

const idOf = (item: Raw) => `${item.source}:${item.value}`

export async function listStartup(): Promise<StartupItem[]> {
  return (await raw())
    .map((item) => {
      const folder = item.source >= 100
      const source = folder ? FOLDERS[item.source - 100] : SOURCES[item.source]
      return {
        id: idOf(item),
        name: item.name,
        command: item.command,
        scope: source?.scope ?? 'All users',
        kind: folder ? ('folder' as const) : ('registry' as const),
        // Windows marks a turned-off entry with an odd first byte.
        enabled: item.approved % 2 === 0,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Turns an entry on or off the same way Task Manager does, so the change can
 * be undone here or there and nothing is deleted.
 */
export async function setStartup(id: string, enabled: boolean) {
  const item = (await raw()).find((entry) => idOf(entry) === id)
  if (!item) return { ok: false, message: 'That startup entry no longer exists.' }
  const source = item.source >= 100 ? FOLDERS[item.source - 100] : SOURCES[item.source]
  if (!source) return { ok: false, message: 'That startup entry no longer exists.' }

  try {
    await ps(
      `
      if (-not (Test-Path -LiteralPath $env:BALAI_KEY)) { New-Item -Path $env:BALAI_KEY -Force | Out-Null }
      $bytes = [byte[]](@([int]$env:BALAI_STATE) + @(0) * 11)
      New-ItemProperty -LiteralPath $env:BALAI_KEY -Name $env:BALAI_VALUE -Value $bytes -PropertyType Binary -Force | Out-Null
    `,
      { BALAI_KEY: source.approved, BALAI_VALUE: item.value, BALAI_STATE: enabled ? '2' : '3' },
    )
    logActivity({ area: 'startup', action: enabled ? 'Turned on at sign-in' : 'Turned off at sign-in', target: item.name })
    return { ok: true, message: `${item.name} ${enabled ? 'will start' : 'will no longer start'} when you sign in.` }
  } catch (error) {
    const message = messageOf(error)
    logActivity({ area: 'startup', action: 'Change failed', target: item.name, detail: message, ok: false })
    return { ok: false, message }
  }
}
