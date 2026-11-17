import os from 'node:os'
import { database, prune } from './db'
import { ps } from './sys'

export interface Drive {
  letter: string
  label: string
  fileSystem: string
  size: number
  free: number
  used: number
  percent: number
}

let drivesCache: { at: number; list: Drive[] } | null = null

export async function drives(fresh = false): Promise<Drive[]> {
  if (drivesCache && !fresh && Date.now() - drivesCache.at < 20_000) return drivesCache.list
  const raw = await ps<{ letter: string; label: string | null; fs: string | null; size: number; free: number }[]>(`
    $d = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
      [pscustomobject]@{ letter = [string]$_.DeviceID; label = [string]$_.VolumeName; fs = [string]$_.FileSystem
        size = [int64]$_.Size; free = [int64]$_.FreeSpace }
    }
    ConvertTo-Json -InputObject @($d) -Compress
  `)
  const list = (raw ?? [])
    .filter((item) => item.size > 0)
    .map((item) => ({
      letter: item.letter,
      label: item.label ?? '',
      fileSystem: item.fs ?? '',
      size: item.size,
      free: item.free,
      used: item.size - item.free,
      percent: ((item.size - item.free) / item.size) * 100,
    }))
  drivesCache = { at: Date.now(), list }
  return list
}

function cpuTimes() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { idle, total }
}

let last = cpuTimes()
let cpuPercent = 0

function sampleCpu() {
  const now = cpuTimes()
  const total = now.total - last.total
  if (total > 0) cpuPercent = Math.min(100, Math.max(0, (1 - (now.idle - last.idle) / total) * 100))
  last = now
}

export function memory() {
  const total = os.totalmem()
  const free = os.freemem()
  return { total, available: free, used: total - free, percent: ((total - free) / total) * 100 }
}

let osName: string | null = null

async function windowsName(): Promise<string> {
  if (osName) return osName
  try {
    const info = await ps<{ caption: string; build: string; version: string }>(`
      $o = Get-CimInstance Win32_OperatingSystem
      $v = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
      [pscustomobject]@{ caption = [string]$o.Caption; build = [string]$o.BuildNumber; version = [string]$v.DisplayVersion } | ConvertTo-Json -Compress
    `)
    osName = `${info.caption.replace(/^Microsoft\s+/, '')}${info.version ? ` ${info.version}` : ''} (build ${info.build})`
  } catch {
    osName = `Windows ${os.release()}`
  }
  return osName
}

export async function overview() {
  return {
    host: { name: os.hostname(), os: await windowsName(), arch: os.arch(), uptime: os.uptime() },
    cpu: { model: os.cpus()[0]?.model.trim() ?? '', cores: os.cpus().length, percent: cpuPercent },
    memory: memory(),
    drives: await drives(),
  }
}

export function history(hours: number) {
  const since = Date.now() - hours * 3_600_000
  const rows = database()
    .prepare('SELECT at, cpu, mem, disk FROM samples WHERE at >= ? ORDER BY at')
    .all(since) as { at: number; cpu: number; mem: number; disk: number }[]
  // Keep at most ~240 points so the chart stays light.
  const step = Math.max(1, Math.ceil(rows.length / 240))
  return rows.filter((_, index) => index % step === 0)
}

async function store() {
  const list = await drives(true).catch(() => [])
  const system = list.find((drive) => drive.letter.toUpperCase() === (process.env.SystemDrive ?? 'C:').toUpperCase())
  database()
    .prepare('INSERT INTO samples (at, cpu, mem, disk) VALUES (?, ?, ?, ?)')
    .run(Date.now(), cpuPercent, memory().percent, system?.percent ?? 0)
}

export function startSampling() {
  setInterval(sampleCpu, 5_000)
  setTimeout(() => void store(), 10_000)
  setInterval(() => void store(), 60_000)
  setInterval(prune, 3_600_000)
}
