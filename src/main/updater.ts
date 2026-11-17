import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getSetting, logActivity, setSetting } from './db'

interface State {
  managed: boolean
  version: string
  latestVersion: string | null
  available: boolean
  downloading: boolean
  progress: number
  downloaded: boolean
  checkedAt: number | null
  error: string | null
  auto: boolean
  notes: string | null
}

const state: State = {
  managed: false,
  version: app.getVersion(),
  latestVersion: null,
  available: false,
  downloading: false,
  progress: 0,
  downloaded: false,
  checkedAt: null,
  error: null,
  auto: true,
  notes: null,
}

export const updateState = () => ({ ...state, auto: getSetting('auto_update') !== '0' })

function notesOf(value: unknown): string | null {
  if (typeof value === 'string') return value.replace(/<[^>]+>/g, '').trim() || null
  if (Array.isArray(value)) return value.map((item) => notesOf(item?.note)).filter(Boolean).join('\n') || null
  return null
}

export function setupUpdates() {
  // Only an installed copy can replace itself.
  state.managed = app.isPackaged
  state.checkedAt = Number(getSetting('update_checked_at')) || null
  if (!state.managed) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => {
    state.available = true
    state.latestVersion = info.version
    state.notes = notesOf(info.releaseNotes)
  })
  autoUpdater.on('update-not-available', () => {
    state.available = false
    state.latestVersion = null
  })
  autoUpdater.on('download-progress', (progress) => {
    state.downloading = true
    state.progress = Math.round(progress.percent)
  })
  autoUpdater.on('update-downloaded', (info) => {
    state.downloading = false
    state.downloaded = true
    state.progress = 100
    logActivity({ area: 'update', action: 'Update downloaded', target: info.version })
  })
  autoUpdater.on('error', (error) => {
    state.downloading = false
    state.error = error?.message?.split('\n')[0] ?? 'The update failed.'
  })

  const scheduled = async () => {
    await checkForUpdate()
    if (state.available && !state.downloaded && updateState().auto) await downloadUpdate()
  }
  setTimeout(() => void scheduled(), 30_000)
  setInterval(() => void scheduled(), 6 * 3_600_000)
}

export async function checkForUpdate() {
  if (!state.managed) return updateState()
  state.error = null
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    state.error = error instanceof Error ? error.message.split('\n')[0]! : 'Could not reach the update server.'
  }
  state.checkedAt = Date.now()
  setSetting('update_checked_at', String(state.checkedAt))
  return updateState()
}

export async function downloadUpdate() {
  if (!state.managed || !state.available || state.downloading || state.downloaded) return updateState()
  state.downloading = true
  state.error = null
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    state.downloading = false
    state.error = error instanceof Error ? error.message.split('\n')[0]! : 'The download failed.'
  }
  return updateState()
}

/** Closes Balai, runs the new installer and opens the new version. */
export function installUpdate() {
  if (!state.downloaded) return { ok: false, message: 'The update has not been downloaded yet.' }
  logActivity({ area: 'update', action: 'Installed update', target: `${state.version} → ${state.latestVersion}` })
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 500)
  return { ok: true, message: 'Installing. Balai restarts in a moment.' }
}

export function setAutoUpdate(enabled: boolean) {
  setSetting('auto_update', enabled ? '1' : '0')
  return updateState()
}
