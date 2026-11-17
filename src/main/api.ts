import { appJob, appUpdates, listApps, uninstallApp, updateApps } from './apps'
import { listCleanup, runCleanup } from './cleanup'
import { activity } from './db'
import { deleteFiles, deleteFolder, searchFiles, usage } from './files'
import { health } from './health'
import { drives, history, overview } from './metrics'
import { listListeners } from './ports'
import { listProcesses, signalProcess } from './processes'
import { listServices, serviceAction } from './services'
import { listStartup, setStartup } from './startup'
import { checkForUpdate, downloadUpdate, installUpdate, setAutoUpdate, updateState } from './updater'

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const fail = (message: string, status = 400) => json({ ok: false, message }, status)
const result = (value: { ok: boolean }, failStatus = 400) => json(value, value.ok ? 200 : failStatus)

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text()
    if (text.length > 2_000_000) return {}
    const parsed: unknown = JSON.parse(text || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function api(req: Request, ownPids: () => number[]): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.slice('/api'.length)
  const route = `${req.method} ${path}`
  const query = url.searchParams

  switch (route) {
    case 'GET /overview':
      return json(await overview())
    case 'GET /drives':
      return json(await drives(true))
    case 'GET /health':
      return json(await health())
    case 'GET /history':
      return json(history(Math.min(168, Math.max(1, Number(query.get('hours')) || 24))))
    case 'GET /processes':
      return json(await listProcesses())
    case 'GET /services':
      return json(await listServices())
    case 'GET /startup':
      return json(await listStartup())
    case 'POST /startup': {
      const data = await body(req)
      if (typeof data.id !== 'string') return fail('Nothing selected.')
      return result(await setStartup(data.id, data.enabled === true))
    }
    case 'GET /cleanup':
      return json(await listCleanup())
    case 'POST /cleanup': {
      const data = await body(req)
      const ids = Array.isArray(data.ids) ? data.ids.filter((id): id is string => typeof id === 'string') : []
      if (!ids.length) return fail('Nothing selected.')
      const outcome = await runCleanup(ids)
      return json(outcome, outcome.message ? 409 : 200)
    }
    case 'GET /disk': {
      const value = await usage(query.get('path') ?? `${process.env.SystemDrive ?? 'C:'}\\`)
      return value ? json(value) : fail('That folder cannot be read.', 404)
    }
    case 'GET /files': {
      const value = await searchFiles({
        path: query.get('path') ?? '',
        extensions: (query.get('ext') ?? '').split(/[\s,;]+/),
        minBytes: Number(query.get('min')) || 0,
        olderThanDays: Number(query.get('days')) || 0,
      })
      return result(value)
    }
    case 'POST /files/delete': {
      const data = await body(req)
      if (!Array.isArray(data.paths) || !data.paths.length) return fail('Nothing selected.')
      return json(await deleteFiles(data.paths, data.permanent === true))
    }
    case 'POST /files/delete-folder': {
      const data = await body(req)
      return result(await deleteFolder(data.path, data.permanent === true))
    }
    case 'GET /apps':
      return json(await listApps())
    case 'POST /apps/uninstall': {
      const data = await body(req)
      if (typeof data.id !== 'string') return fail('Nothing selected.')
      return result(await uninstallApp(data.id))
    }
    case 'GET /apps/updates':
      return json(await appUpdates(query.has('fresh')))
    case 'GET /apps/job':
      return json({ job: appJob() })
    case 'POST /apps/update': {
      const data = await body(req)
      return result(updateApps(typeof data.id === 'string' ? data.id : null), 409)
    }
    case 'GET /ports':
      return json(await listListeners())
    case 'GET /activity':
      return json(activity())
    case 'GET /update':
      return json(updateState())
    case 'POST /update/check':
      return json(await checkForUpdate())
    case 'POST /update/download':
      return json(await downloadUpdate())
    case 'POST /update/install':
      return result(installUpdate(), 409)
    case 'POST /update/auto':
      return json(setAutoUpdate((await body(req)).enabled === true))
  }

  const signal = path.match(/^\/processes\/(\d+)\/(stop|kill)$/)
  if (req.method === 'POST' && signal) {
    return result(await signalProcess(Number(signal[1]), signal[2]!, ownPids()))
  }

  const service = path.match(/^\/services\/([^/]+)\/(\w+)$/)
  if (req.method === 'POST' && service) {
    return result(await serviceAction(decodeURIComponent(service[1]!), service[2]!))
  }

  return fail('Not found.', 404)
}
