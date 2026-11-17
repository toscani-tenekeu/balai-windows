import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appUpdates, listApps, parseUpgrades, uninstallCommand } from './apps'
import { listCleanup } from './cleanup'
import { activity, database } from './db'
import { deleteFiles, deleteFolder, searchFiles, usage } from './files'
import { health } from './health'
import { history, overview } from './metrics'
import { isKeptFolder, isSystemPath } from './paths'
import { listListeners } from './ports'
import { listProcesses, signalProcess } from './processes'
import { listServices, serviceAction } from './services'
import { listStartup, setStartup } from './startup'
import { ps } from './sys'

/**
 * Runs every collector and the safe actions on a real Windows machine and
 * writes what came back, so a release is never built from code that was
 * only ever run on Linux.
 */
export async function selfTest(output: string): Promise<number> {
  const report: Record<string, { ok: boolean; ms: number; sample?: unknown; error?: string }> = {}
  const fixtures: Record<string, unknown> = {}

  async function check(name: string, work: () => Promise<unknown>, keep?: string) {
    const start = Date.now()
    try {
      const value = await work()
      report[name] = { ok: true, ms: Date.now() - start, sample: JSON.stringify(value)?.slice(0, 600) }
      if (keep) fixtures[keep] = value
    } catch (error) {
      report[name] = { ok: false, ms: Date.now() - start, error: error instanceof Error ? error.stack ?? error.message : String(error) }
    }
  }

  const expect = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message)
  }

  await check('sqlite', async () => database().prepare('SELECT sqlite_version() AS v').get())
  await check('overview', async () => {
    const value = await overview()
    expect(value.drives.length > 0, 'no drives')
    return value
  }, 'overview')
  await check('health', health, 'health')
  await check('history', async () => history(24), 'history')
  await check('processes', async () => {
    const list = await listProcesses()
    expect(list.length > 10, 'too few processes')
    expect(list.some((item) => item.memory > 0), 'no memory figures')
    return list.slice(0, 40)
  }, 'processes')
  await check('services', async () => {
    const list = await listServices()
    expect(list.some((item) => item.name === 'EventLog'), 'EventLog missing')
    return list.slice(0, 60)
  }, 'services')
  await check('services-protected', async () => {
    const value = await serviceAction('EventLog', 'stop')
    expect(!value.ok, 'stopping EventLog was not refused')
    return value
  })
  await check('startup', listStartup, 'startup')
  await check('ports', async () => {
    const list = await listListeners()
    expect(list.some((item) => item.protocol === 'tcp'), 'no TCP listener')
    return list
  }, 'ports')
  await check('apps', async () => {
    const list = await listApps()
    expect(list.length > 0, 'no installed programs')
    return list.slice(0, 60)
  }, 'apps')
  await check('app-updates', () => appUpdates(true), 'appUpdates')
  await check('cleanup', listCleanup, 'cleanup')
  await check('disk', async () => {
    const value = await usage(join(process.env.SystemRoot ?? 'C:\\Windows', '..', 'Users'))
    expect(value && value.entries.length > 0, 'empty listing')
    return value
  }, 'disk')

  await check('guards', async () => {
    const drive = process.env.SystemDrive ?? 'C:'
    expect(isSystemPath(`${drive}\\Windows\\System32\\kernel32.dll`), 'system32 not protected')
    expect(isSystemPath(`${drive}\\pagefile.sys`), 'pagefile not protected')
    expect(isSystemPath(`${drive}\\Program Files\\x\\a.exe`), 'Program Files not protected')
    expect(!isSystemPath(`${drive}\\Users\\someone\\Downloads\\a.zip`), 'downloads protected')
    expect(isKeptFolder(`${drive}\\`), 'drive root deletable')
    expect(isKeptFolder(`${drive}\\Users`), 'Users deletable')
    expect(isKeptFolder(`${drive}\\Users\\someone`), 'profile deletable')
    expect(isKeptFolder(`${drive}\\Users\\someone\\Downloads`), 'Downloads deletable')
    expect(!isKeptFolder(`${drive}\\Users\\someone\\Downloads\\old`), 'subfolder of Downloads protected')
    return 'ok'
  })

  await check('winget-parser', async () => {
    const sample = [
      '   - ',
      '   \\ ',
      'Nom                      ID                      Version   Disponible Source',
      '----------------------------------------------------------------------------',
      'Mozilla Firefox (x64 fr) Mozilla.Firefox.fr      128.0     129.0      winget',
      'Notepad++                Notepad++.Notepad++     8.6.1     8.6.9      winget',
      '2 mises à niveau disponibles.',
    ].join('\r\n')
    const parsed = parseUpgrades(sample)
    expect(parsed.length === 2, `parsed ${parsed.length}`)
    expect(parsed[1]!.id === 'Notepad++.Notepad++' && parsed[1]!.next === '8.6.9', 'wrong columns')
    expect(uninstallCommand('C:\\Program Files\\App\\unins000.exe /S') === '"C:\\Program Files\\App\\unins000.exe" /S', 'quoting')
    expect(uninstallCommand('MsiExec.exe /I{ABC}') === 'MsiExec.exe /X{ABC}', 'msi')
    return parsed
  })

  await check('files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'balai-test-'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'a.zip'), Buffer.alloc(4096))
    writeFileSync(join(dir, 'sub', 'b.ZIP'), Buffer.alloc(1024))
    writeFileSync(join(dir, 'c.txt'), 'x')
    const found = await searchFiles({ path: dir, extensions: ['zip'], minBytes: 0, olderThanDays: 0 })
    expect(found.ok && found.count === 2, `found ${JSON.stringify(found).slice(0, 200)}`)
    const removed = await deleteFiles([join(dir, 'a.zip'), 'C:\\Windows\\win.ini'], true)
    expect(removed.deleted === 1 && removed.failed.length === 1, `delete ${JSON.stringify(removed)}`)
    expect(existsSync('C:\\Windows\\win.ini'), 'win.ini was deleted')
    const trashed = await deleteFiles([join(dir, 'sub', 'b.ZIP')], false)
    expect(trashed.deleted === 1, `trash ${JSON.stringify(trashed)}`)
    const folder = await deleteFolder(dir, true)
    expect(folder.ok && !existsSync(dir), `folder ${JSON.stringify(folder)}`)
    const refused = await deleteFolder('C:\\Windows', true)
    expect(!refused.ok, 'C:\\Windows was not refused')
    return { found: found.count, removed, folder }
  })

  await check('startup-toggle', async () => {
    await ps(`New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'BalaiSelfTest' -Value 'C:\\Windows\\notepad.exe' -Force | Out-Null`)
    try {
      const entry = (await listStartup()).find((item) => item.name === 'BalaiSelfTest')
      expect(entry?.enabled, 'test entry missing or off')
      expect((await setStartup(entry!.id, false)).ok, 'turning off failed')
      expect((await listStartup()).find((item) => item.name === 'BalaiSelfTest')?.enabled === false, 'still on')
      expect((await setStartup(entry!.id, true)).ok, 'turning on failed')
      expect((await listStartup()).find((item) => item.name === 'BalaiSelfTest')?.enabled === true, 'still off')
      return 'ok'
    } finally {
      await ps(`
        Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'BalaiSelfTest' -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' -Name 'BalaiSelfTest' -ErrorAction SilentlyContinue
      `)
    }
  })

  await check('process-kill', async () => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 120'], { windowsHide: true })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const refused = await signalProcess(4, 'kill', [])
    expect(!refused.ok, 'System was not refused')
    const value = await signalProcess(child.pid!, 'kill', [])
    expect(value.ok, `kill failed: ${value.message}`)
    return value
  })

  await check('activity', async () => activity(), 'activity')

  const failed = Object.entries(report).filter(([, value]) => !value.ok)
  writeFileSync(output, JSON.stringify({ failed: failed.map(([name]) => name), report, fixtures }, null, 2))
  return failed.length ? 1 : 0
}
