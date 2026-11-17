import { existsSync, readdirSync } from 'node:fs'
import { win32 } from 'node:path'
import { logActivity } from './db'
import { programData, profiles } from './paths'
import { messageOf, ps, reason, run, system32, systemRoot } from './sys'
import { collect, removeEmptyFolders, removeFiles, sizeOf, sum, type Found } from './walk'

const { join } = win32

interface Measure {
  bytes: number | null
  note?: string
}

interface Task {
  id: string
  title: string
  description: string
  /** Ticked by default: safe to run at any time with nothing to lose. */
  recommended: boolean
  kind: 'disk' | 'memory' | 'network'
  available?: () => boolean
  measure: () => Promise<Measure>
  clean: () => Promise<{ ok: boolean; message?: string }>
}

const DAY = 86_400_000

const existing = (paths: string[]) => paths.filter((path) => existsSync(path))
const inProfiles = (relative: string) => existing(profiles().map((profile) => join(profile, relative)))

/** Files older than the given age, in folders whose whole content may go. */
function olderFiles(dirs: () => string[], days: number) {
  const files = () => {
    const limit = Date.now() - days * DAY
    return collect(existing(dirs()), (file) => file.modified < limit)
  }
  return {
    measure: async () => ({ bytes: sum(await files()) }),
    clean: async () => {
      await removeFiles(await files())
      for (const dir of existing(dirs())) await removeEmptyFolders(dir)
      return { ok: true }
    },
  }
}

/** Every file in the folders, whatever its age. */
function allFiles(dirs: () => string[], keep: (file: Found) => boolean = () => true) {
  const files = () => collect(existing(dirs()), keep)
  return {
    measure: async () => ({ bytes: sum(await files()) }),
    clean: async () => {
      await removeFiles(await files())
      for (const dir of existing(dirs())) await removeEmptyFolders(dir)
      return { ok: true }
    },
  }
}

function browserCaches(): string[] {
  const dirs: string[] = []
  const chromium = ['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser', 'Vivaldi', 'Chromium']
  for (const profile of profiles()) {
    const local = join(profile, 'AppData', 'Local')
    for (const browser of chromium) {
      const data = join(local, browser, 'User Data')
      let names: string[] = []
      try {
        names = readdirSync(data)
      } catch {
        continue
      }
      for (const name of names) {
        for (const cache of ['Cache', 'Code Cache', 'GPUCache', 'Service Worker\\CacheStorage']) {
          dirs.push(join(data, name, cache))
        }
      }
    }
    const firefox = join(local, 'Mozilla', 'Firefox', 'Profiles')
    try {
      for (const name of readdirSync(firefox)) dirs.push(join(firefox, name, 'cache2'))
    } catch {
      // No Firefox for this user.
    }
  }
  return existing(dirs)
}

const DEV_CACHES = [
  'AppData\\Local\\npm-cache', 'AppData\\Local\\pip\\Cache', 'AppData\\Local\\Yarn\\Cache',
  'AppData\\Local\\pnpm-cache', 'AppData\\Local\\NuGet\\v3-cache', 'AppData\\Local\\go-build',
  'AppData\\Local\\composer', '.gradle\\caches', '.cargo\\registry\\cache', '.bun\\install\\cache',
]

const windowsUpdate = (action: 'Stop' | 'Start') =>
  ps(`foreach ($n in 'wuauserv', 'bits') { try { ${action}-Service -Name $n ${action === 'Stop' ? '-Force' : ''} } catch {} }`)

const tasks: Task[] = [
  {
    id: 'user-temp',
    title: 'Temporary files',
    description: 'Files programs left in each user’s Temp folder and that nothing has touched for a day.',
    recommended: true,
    kind: 'disk',
    ...olderFiles(() => inProfiles('AppData\\Local\\Temp'), 1),
  },
  {
    id: 'windows-temp',
    title: 'Windows temporary files',
    description: 'Files in the Windows Temp folder that nothing has touched for a day.',
    recommended: true,
    kind: 'disk',
    ...olderFiles(() => [join(systemRoot, 'Temp')], 1),
  },
  {
    id: 'crash-dumps',
    title: 'Crash dumps',
    description: 'Memory dumps saved when a program or Windows crashed. Only useful to someone investigating that crash.',
    recommended: true,
    kind: 'disk',
    ...allFiles(
      () => [...inProfiles('AppData\\Local\\CrashDumps'), join(systemRoot, 'Minidump'), join(systemRoot, 'LiveKernelReports')],
      (file) => /\.(dmp|hdmp|mdmp)$/i.test(file.path),
    ),
  },
  {
    id: 'error-reports',
    title: 'Error reports',
    description: 'Reports Windows kept about programs that stopped working.',
    recommended: true,
    kind: 'disk',
    ...allFiles(() => [
      join(programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
      join(programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      join(programData, 'Microsoft', 'Windows', 'WER', 'Temp'),
      ...inProfiles('AppData\\Local\\Microsoft\\Windows\\WER'),
    ]),
  },
  {
    id: 'windows-logs',
    title: 'Old Windows logs',
    description: 'Setup and servicing logs in the Windows Logs folder that are older than 30 days.',
    recommended: true,
    kind: 'disk',
    ...(() => {
      const dirs = () => [join(systemRoot, 'Logs')]
      const keep = (file: Found) => file.modified < Date.now() - 30 * DAY && /\.(log|cab|etl|txt|old|bak)$/i.test(file.path)
      return allFiles(dirs, keep)
    })(),
  },
  {
    id: 'delivery-optimization',
    title: 'Delivery Optimization cache',
    description: 'Update pieces Windows keeps to share with other computers. Windows downloads them again if needed.',
    recommended: true,
    kind: 'disk',
    measure: async () => ({
      bytes: await sizeOf(
        existing([join(systemRoot, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache')]),
      ),
    }),
    clean: async () => {
      try {
        await ps('Delete-DeliveryOptimizationCache -Force', {}, 300_000)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: messageOf(error) }
      }
    },
  },
  {
    id: 'recycle-bin',
    title: 'Recycle Bin',
    description: 'Files you deleted and that are still waiting in the Recycle Bin. They cannot be restored afterwards.',
    recommended: false,
    kind: 'disk',
    measure: async () => {
      try {
        const bytes = await ps<number>(`
          $total = [int64]0
          $bin = (New-Object -ComObject Shell.Application).NameSpace(10)
          foreach ($item in $bin.Items()) { try { $total += [int64]$item.ExtendedProperty('Size') } catch {} }
          $total
        `)
        return { bytes: bytes ?? 0 }
      } catch {
        return { bytes: null, note: 'unknown' }
      }
    },
    clean: async () => {
      try {
        await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', {}, 300_000)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: messageOf(error) }
      }
    },
  },
  {
    id: 'update-cache',
    title: 'Windows Update downloads',
    description:
      'Update files Windows has already installed. Do not run this while Windows is installing updates; it pauses Windows Update for a moment.',
    recommended: false,
    kind: 'disk',
    measure: async () => ({ bytes: await sizeOf(existing([join(systemRoot, 'SoftwareDistribution', 'Download')])) }),
    clean: async () => {
      const folder = join(systemRoot, 'SoftwareDistribution', 'Download')
      await windowsUpdate('Stop')
      try {
        await removeFiles(await collect(existing([folder])))
        await removeEmptyFolders(folder)
      } finally {
        await windowsUpdate('Start')
      }
      return { ok: true }
    },
  },
  {
    id: 'browser-cache',
    title: 'Browser caches',
    description:
      'Pages and images saved by Chrome, Edge, Brave, Vivaldi and Firefox. Close the browsers first; sites load a bit slower the next time.',
    recommended: false,
    kind: 'disk',
    ...allFiles(browserCaches),
  },
  {
    id: 'dev-cache',
    title: 'Developer tool caches',
    description: 'Downloads kept by npm, pip, Yarn, pnpm, NuGet, Go, Composer, Gradle, Cargo and Bun. They are fetched again when needed.',
    recommended: false,
    kind: 'disk',
    ...allFiles(() => DEV_CACHES.flatMap((relative) => inProfiles(relative))),
  },
  {
    id: 'component-store',
    title: 'Superseded Windows components',
    description:
      'Asks Windows to remove old versions of system components replaced by updates. Updates installed so far can no longer be uninstalled. Takes several minutes.',
    recommended: false,
    kind: 'disk',
    measure: async () => ({ bytes: null, note: 'measured by Windows' }),
    clean: async () => {
      const result = await run(join(system32, 'Dism.exe'), ['/Online', '/Cleanup-Image', '/StartComponentCleanup'], {
        timeout: 2 * 3_600_000,
      })
      return { ok: result.ok, message: result.ok ? undefined : reason(result, 'DISM failed.') }
    },
  },
  {
    id: 'dns-cache',
    title: 'DNS cache',
    description: 'Forgets remembered website addresses. Useful when a site moved and still does not open. Frees no disk space.',
    recommended: false,
    kind: 'network',
    measure: async () => ({ bytes: null, note: 'network' }),
    clean: async () => {
      try {
        await ps('Clear-DnsClientCache')
        return { ok: true }
      } catch (error) {
        return { ok: false, message: messageOf(error) }
      }
    },
  },
]

const active = () => tasks.filter((task) => task.available?.() ?? true)

export async function listCleanup() {
  return Promise.all(
    active().map(async (task) => {
      let measured: Measure
      try {
        measured = await task.measure()
      } catch {
        measured = { bytes: null, note: 'unknown' }
      }
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        recommended: task.recommended,
        kind: task.kind,
        bytes: measured.bytes,
        note: measured.note ?? null,
      }
    }),
  )
}

let running = false

export async function runCleanup(ids: string[]) {
  if (running) return { ok: false, message: 'A cleanup is already running.', results: [], freed: 0 }
  running = true
  try {
    const results = []
    for (const task of active().filter((candidate) => ids.includes(candidate.id))) {
      const before = await task.measure().catch(() => ({ bytes: null }) as Measure)
      let outcome: { ok: boolean; message?: string }
      try {
        outcome = await task.clean()
      } catch (error) {
        outcome = { ok: false, message: messageOf(error, 'Cleanup failed.') }
      }
      const after = await task.measure().catch(() => ({ bytes: null }) as Measure)
      const freed =
        task.kind === 'disk' && before.bytes !== null && after.bytes !== null ? Math.max(0, before.bytes - after.bytes) : 0
      logActivity({
        area: 'cleanup',
        action: outcome.ok ? 'Cleaned' : 'Cleanup failed',
        target: task.title,
        detail: outcome.message ?? '',
        ok: outcome.ok,
        freed,
      })
      results.push({ id: task.id, title: task.title, ok: outcome.ok, message: outcome.message ?? null, freed })
    }
    return {
      ok: results.every((result) => result.ok),
      message: '',
      results,
      freed: results.reduce((total, result) => total + result.freed, 0),
    }
  } finally {
    running = false
  }
}
