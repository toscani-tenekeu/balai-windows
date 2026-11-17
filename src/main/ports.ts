import { ps } from './sys'

export interface Listener {
  protocol: 'tcp' | 'udp'
  address: string
  port: number
  pid: number
  process: string
  services: string[]
  public: boolean
}

export async function listListeners(): Promise<Listener[]> {
  const raw = await ps<Omit<Listener, 'public'>[]>(`
    $svc = @{}
    Get-CimInstance Win32_Service -Filter "State='Running'" | ForEach-Object {
      $id = [int]$_.ProcessId
      if ($id) { if (-not $svc.ContainsKey($id)) { $svc[$id] = @() }; $svc[$id] += [string]$_.Name }
    }
    $names = @{}
    Get-Process | ForEach-Object { $names[$_.Id] = [string]$_.ProcessName }
    function Row($proto, $e) {
      $id = [int]$e.OwningProcess
      [pscustomobject]@{
        protocol = $proto; address = [string]$e.LocalAddress; port = [int]$e.LocalPort; pid = $id
        process = [string]$names[$id]; services = @(if ($svc.ContainsKey($id)) { $svc[$id] })
      }
    }
    $rows = @()
    $rows += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Row 'tcp' $_ })
    $rows += @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object { Row 'udp' $_ })
    ConvertTo-Json -InputObject @($rows) -Compress -Depth 3
  `)

  const seen = new Set<string>()
  const list: Listener[] = []
  for (const item of raw ?? []) {
    const key = `${item.protocol}|${item.address}|${item.port}`
    if (seen.has(key)) continue
    seen.add(key)
    const local = item.address.startsWith('127.') || item.address === '::1'
    list.push({ ...item, services: item.services ?? [], public: !local })
  }
  return list.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol))
}
