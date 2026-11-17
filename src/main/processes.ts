import { join } from 'node:path'
import { logActivity } from './db'
import { messageOf, ps, reason, run, system32 } from './sys'

export interface ProcessInfo {
  pid: number
  name: string
  user: string
  cpu: number
  memory: number
  started: number | null
  path: string
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const list = await ps<ProcessInfo[]>(`
    $n = [Environment]::ProcessorCount
    $before = @{}
    foreach ($p in Get-Process) { try { $before[$p.Id] = $p.TotalProcessorTime.TotalMilliseconds } catch {} }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Milliseconds 800
    try { $now = Get-Process -IncludeUserName -ErrorAction Stop } catch { $now = Get-Process }
    $ms = $clock.Elapsed.TotalMilliseconds
    $out = foreach ($p in $now) {
      if ($p.Id -eq 0) { continue }
      $cpu = 0
      try { if ($before.ContainsKey($p.Id)) { $cpu = ($p.TotalProcessorTime.TotalMilliseconds - $before[$p.Id]) / $ms / $n * 100 } } catch {}
      $started = $null
      try { $started = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() } catch {}
      [pscustomobject]@{
        pid = $p.Id; name = [string]$p.ProcessName; user = [string]$p.UserName
        cpu = [math]::Round([math]::Max(0, $cpu), 1); memory = [int64]$p.WorkingSet64
        started = $started; path = [string]$p.Path
      }
    }
    ConvertTo-Json -InputObject @($out) -Compress
  `)
  return (list ?? []).sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
}

/** Ending one of these crashes or restarts Windows. */
const CRITICAL = new Set([
  'system', 'registry', 'idle', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso',
  'svchost', 'memory compression', 'secure system', 'fontdrvhost', 'sihost', 'msmpeng',
])

export async function signalProcess(pid: number, action: string, ownPids: number[]) {
  if (action !== 'stop' && action !== 'kill') return { ok: false, message: 'Unknown action.' }
  if (!Number.isInteger(pid) || pid <= 4) return { ok: false, message: 'This process belongs to Windows itself.' }
  if (ownPids.includes(pid)) return { ok: false, message: 'This is Balai itself.' }

  let name = ''
  try {
    name = (await ps<string | null>('(Get-Process -Id ([int]$env:BALAI_PID)).ProcessName | ConvertTo-Json', {
      BALAI_PID: String(pid),
    })) ?? ''
  } catch {
    return { ok: false, message: 'The process has already exited.' }
  }
  if (CRITICAL.has(name.toLowerCase())) {
    return { ok: false, message: `${name} is part of Windows. Ending it would crash or restart the computer.` }
  }

  // Without /F Windows asks the program to close, the way the close button does.
  const args = action === 'kill' ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid)]
  const result = await run(join(system32, 'taskkill.exe'), args, { timeout: 30_000 })
  const verb = action === 'kill' ? 'Ended' : 'Asked to close'
  const message = result.ok ? `${verb}: ${name}` : reason(result, 'The process could not be ended.')
  logActivity({
    area: 'process',
    action: result.ok ? verb : 'End failed',
    target: `${name} (${pid})`,
    detail: result.ok ? '' : message,
    ok: result.ok,
  })
  return { ok: result.ok, message: result.ok ? message : messageOf(new Error(message)) }
}
