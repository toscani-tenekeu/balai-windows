import os from 'node:os'
import { drives, memory } from './metrics'
import { ps } from './sys'

export type Status = 'ok' | 'warning' | 'critical'

export interface Check {
  id: string
  title: string
  status: Status
  detail: string
  link: string | null
}

interface Probe {
  reboot: boolean
  defender: { enabled: boolean; realtime: boolean; age: number } | null
  firewall: { name: string; enabled: boolean }[]
  disks: { name: string; health: string }[]
  shutdowns: number
  appCrashes: number
  pagefile: { used: number; size: number } | null
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const PROBE = `
  $r = [ordered]@{}
  $r.reboot = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') -or
    (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired')
  try {
    $m = Get-MpComputerStatus -ErrorAction Stop
    $r.defender = [ordered]@{ enabled = [bool]$m.AntivirusEnabled; realtime = [bool]$m.RealTimeProtectionEnabled; age = [int]$m.AntivirusSignatureAge }
  } catch { $r.defender = $null }
  try {
    $r.firewall = @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { [ordered]@{ name = [string]$_.Name; enabled = ("$($_.Enabled)" -eq 'True') } })
  } catch { $r.firewall = @() }
  try {
    $r.disks = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { [ordered]@{ name = [string]$_.FriendlyName; health = [string]$_.HealthStatus } })
  } catch { $r.disks = @() }
  $since = (Get-Date).AddDays(-7)
  $r.shutdowns = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41, 6008; StartTime = $since } -ErrorAction SilentlyContinue).Count
  $r.appCrashes = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000; StartTime = $since } -ErrorAction SilentlyContinue).Count
  try {
    $p = @(Get-CimInstance Win32_PageFileUsage -ErrorAction Stop)
    $r.pagefile = if ($p.Count) { [ordered]@{ used = [int](($p | Measure-Object CurrentUsage -Sum).Sum); size = [int](($p | Measure-Object AllocatedBaseSize -Sum).Sum) } } else { $null }
  } catch { $r.pagefile = $null }
  $r | ConvertTo-Json -Compress -Depth 4
`

export async function health() {
  const checks: Check[] = []

  for (const drive of await drives(true)) {
    const percent = Math.round(drive.percent)
    checks.push({
      id: `drive:${drive.letter}`,
      title: `Free space on ${drive.letter}`,
      status: percent >= 95 || drive.free < 2 * 1024 ** 3 ? 'critical' : percent >= 85 ? 'warning' : 'ok',
      detail: `${percent}% used, ${gb(drive.free)} free`,
      link: '/cleanup',
    })
  }

  const mem = memory()
  checks.push({
    id: 'memory',
    title: 'Memory',
    status: mem.percent >= 95 ? 'critical' : mem.percent >= 85 ? 'warning' : 'ok',
    detail: `${Math.round(mem.percent)}% in use, ${gb(mem.available)} available`,
    link: '/processes',
  })

  const days = Math.floor(os.uptime() / 86_400)
  checks.push({
    id: 'uptime',
    title: 'Time since last restart',
    status: days >= 30 ? 'warning' : 'ok',
    detail: days >= 30 ? `${days} days. A restart finishes updates and frees resources.` : `${plural(days, 'day')}`,
    link: null,
  })

  let probe: Probe | null = null
  try {
    probe = await ps<Probe>(PROBE)
  } catch {
    // Each check below is skipped when the probe could not run.
  }

  if (probe) {
    checks.push({
      id: 'reboot',
      title: 'Pending restart',
      status: probe.reboot ? 'warning' : 'ok',
      detail: probe.reboot ? 'Windows needs a restart to finish installing updates' : 'None',
      link: null,
    })

    if (probe.defender) {
      const { enabled, realtime, age } = probe.defender
      checks.push({
        id: 'defender',
        title: 'Microsoft Defender',
        status: !enabled || !realtime ? 'critical' : age > 7 ? 'warning' : 'ok',
        detail: !enabled
          ? 'Antivirus is turned off'
          : !realtime
            ? 'Real-time protection is turned off'
            : age > 7
              ? `Virus definitions are ${age} days old`
              : 'On, definitions up to date',
        link: '/services',
      })
    }

    if (probe.firewall.length) {
      const off = probe.firewall.filter((profile) => !profile.enabled).map((profile) => profile.name)
      checks.push({
        id: 'firewall',
        title: 'Firewall',
        status: off.length ? 'critical' : 'ok',
        detail: off.length ? `Off for the ${off.join(', ')} ${off.length === 1 ? 'profile' : 'profiles'}` : 'On for every profile',
        link: '/ports',
      })
    }

    for (const disk of probe.disks) {
      if (disk.health === 'Healthy') continue
      checks.push({
        id: `disk:${disk.name}`,
        title: `Disk ${disk.name}`,
        status: disk.health === 'Unhealthy' ? 'critical' : 'warning',
        detail: `Windows reports its health as ${disk.health.toLowerCase()}. Back up your files.`,
        link: null,
      })
    }
    if (probe.disks.length && probe.disks.every((disk) => disk.health === 'Healthy')) {
      checks.push({ id: 'disks', title: 'Disk health', status: 'ok', detail: 'Every disk reports healthy', link: null })
    }

    checks.push({
      id: 'shutdowns',
      title: 'Unexpected shutdowns',
      status: probe.shutdowns >= 3 ? 'critical' : probe.shutdowns ? 'warning' : 'ok',
      detail: probe.shutdowns
        ? `${plural(probe.shutdowns, 'time')} in the last 7 days the computer stopped without shutting down properly`
        : 'None in the last 7 days',
      link: null,
    })

    checks.push({
      id: 'app-crashes',
      title: 'Program crashes',
      status: probe.appCrashes >= 10 ? 'warning' : 'ok',
      detail: probe.appCrashes ? `${probe.appCrashes} ${probe.appCrashes === 1 ? 'crash' : 'crashes'} in the last 7 days` : 'None in the last 7 days',
      link: '/apps',
    })

    if (probe.pagefile && probe.pagefile.size > 0) {
      const percent = Math.round((probe.pagefile.used / probe.pagefile.size) * 100)
      checks.push({
        id: 'pagefile',
        title: 'Page file',
        status: percent >= 80 ? 'warning' : 'ok',
        detail: `${percent}% of ${probe.pagefile.size} MB in use`,
        link: '/processes',
      })
    }
  }

  const order: Record<Status, number> = { critical: 0, warning: 1, ok: 2 }
  checks.sort((a, b) => order[a.status] - order[b.status])
  const status: Status = checks.some((check) => check.status === 'critical')
    ? 'critical'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ok'
  return { status, checks }
}
