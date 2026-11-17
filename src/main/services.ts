import { logActivity } from './db'
import { messageOf, ps } from './sys'

export interface ServiceInfo {
  name: string
  display: string
  description: string
  state: string
  start: string
  delayed: boolean
  pid: number
}

export async function listServices(): Promise<ServiceInfo[]> {
  const list = await ps<ServiceInfo[]>(`
    $s = Get-CimInstance Win32_Service | ForEach-Object {
      [pscustomobject]@{
        name = [string]$_.Name; display = [string]$_.DisplayName; description = [string]$_.Description
        state = [string]$_.State; start = [string]$_.StartMode; delayed = [bool]$_.DelayedAutoStart; pid = [int]$_.ProcessId
      }
    }
    ConvertTo-Json -InputObject @($s) -Compress
  `)
  const rank = (service: ServiceInfo) => (service.state === 'Running' ? 0 : 1)
  return (list ?? []).sort((a, b) => rank(a) - rank(b) || a.display.localeCompare(b.display))
}

/** Windows cannot work without these. */
const ESSENTIAL = new Set(
  [
    'RpcSs', 'RpcEptMapper', 'DcomLaunch', 'LSM', 'SamSs', 'EventLog', 'PlugPlay', 'Power', 'BrokerInfrastructure',
    'CoreMessagingRegistrar', 'SystemEventsBroker', 'Schedule', 'ProfSvc', 'gpsvc', 'Winmgmt', 'UserManager',
    'AudioEndpointBuilder', 'BFE', 'mpssvc', 'WinDefend', 'TrustedInstaller', 'StateRepository', 'camsvc',
  ].map((name) => name.toLowerCase()),
)

const ACTIONS: Record<string, { past: string; script: string; changes: boolean }> = {
  start: { past: 'Started', script: 'Start-Service -Name $env:BALAI_NAME', changes: false },
  stop: { past: 'Stopped', script: 'Stop-Service -Name $env:BALAI_NAME -Force', changes: true },
  restart: { past: 'Restarted', script: 'Restart-Service -Name $env:BALAI_NAME -Force', changes: false },
  automatic: { past: 'Set to start automatically', script: 'Set-Service -Name $env:BALAI_NAME -StartupType Automatic', changes: false },
  manual: { past: 'Set to start manually', script: 'Set-Service -Name $env:BALAI_NAME -StartupType Manual', changes: false },
  disabled: { past: 'Disabled', script: 'Set-Service -Name $env:BALAI_NAME -StartupType Disabled', changes: true },
}

export async function serviceAction(name: string, action: string) {
  const spec = ACTIONS[action]
  if (!spec) return { ok: false, message: 'Unknown action.' }
  const service = (await listServices()).find((item) => item.name.toLowerCase() === name.toLowerCase())
  if (!service) return { ok: false, message: 'That service does not exist.' }
  if (spec.changes && ESSENTIAL.has(service.name.toLowerCase())) {
    return { ok: false, message: `Windows needs ${service.display}. It was left as it is.` }
  }

  try {
    await ps(spec.script, { BALAI_NAME: service.name }, 120_000)
    logActivity({ area: 'service', action: spec.past, target: service.display })
    return { ok: true, message: `${spec.past}: ${service.display}` }
  } catch (error) {
    const message = messageOf(error, 'The service did not respond.')
    logActivity({ area: 'service', action: `${action} failed`, target: service.display, detail: message, ok: false })
    return { ok: false, message }
  }
}
