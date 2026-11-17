export type Status = 'ok' | 'warning' | 'critical'

export interface Drive {
  letter: string
  label: string
  fileSystem: string
  size: number
  free: number
  used: number
  percent: number
}

export interface Overview {
  host: { name: string; os: string; arch: string; uptime: number }
  cpu: { model: string; cores: number; percent: number }
  memory: { total: number; available: number; used: number; percent: number }
  drives: Drive[]
}

export interface Check {
  id: string
  title: string
  status: Status
  detail: string
  link: string | null
}

export interface Health {
  status: Status
  checks: Check[]
}

export interface Sample {
  at: number
  cpu: number
  mem: number
  disk: number
}

export interface ProcessInfo {
  pid: number
  name: string
  user: string
  cpu: number
  memory: number
  started: number | null
  path: string
}

export interface ServiceInfo {
  name: string
  display: string
  description: string
  state: string
  start: string
  delayed: boolean
  pid: number
}

export interface StartupItem {
  id: string
  name: string
  command: string
  scope: string
  kind: 'registry' | 'folder'
  enabled: boolean
}

export interface CleanupItem {
  id: string
  title: string
  description: string
  recommended: boolean
  kind: 'disk' | 'memory' | 'network'
  bytes: number | null
  note: string | null
}

export interface CleanupResult {
  ok: boolean
  message: string
  freed: number
  results: { id: string; title: string; ok: boolean; message: string | null; freed: number }[]
}

export interface DiskUsage {
  path: string
  parent: string | null
  total: number
  entries: { path: string; name: string; size: number; directory: boolean; locked: boolean }[]
}

export interface FoundFile {
  path: string
  size: number
  modified: number
  locked: boolean
}

export interface FileSearch {
  ok: boolean
  path: string
  extensions: string[]
  count: number
  total: number
  truncated: boolean
  files: FoundFile[]
}

export interface DeleteResult {
  ok: boolean
  deleted: number
  freed: number
  failed: { path: string; message: string }[]
}

export interface InstalledApp {
  id: string
  name: string
  version: string
  publisher: string
  size: number
  installed: string
  scope: string
  canUninstall: boolean
}

export interface AppUpdate {
  name: string
  id: string
  current: string
  next: string
  source: string
}

export interface AppUpdates {
  available: boolean
  updates: AppUpdate[]
  error: string | null
}

export interface Job {
  id: number
  title: string
  running: boolean
  ok: boolean | null
  output: string[]
  startedAt: number
  finishedAt: number | null
}

export interface Listener {
  protocol: 'tcp' | 'udp'
  address: string
  port: number
  pid: number
  process: string
  services: string[]
  public: boolean
}

export interface ActivityRow {
  id: number
  at: number
  area: string
  action: string
  target: string
  detail: string
  ok: number
  freed: number
}

export interface UpdateState {
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

export interface ActionResult {
  ok: boolean
  message: string
}
