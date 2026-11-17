import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let db: DatabaseSync

export function openDatabase(dir: string) {
  mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(join(dir, 'balai.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS samples (
      at INTEGER NOT NULL, cpu REAL NOT NULL, mem REAL NOT NULL, disk REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS samples_at ON samples (at);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      area TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      ok INTEGER NOT NULL DEFAULT 1,
      freed INTEGER NOT NULL DEFAULT 0
    );
  `)
  return db
}

export const database = () => db

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export interface ActivityEntry {
  area: 'cleanup' | 'process' | 'service' | 'startup' | 'apps' | 'files' | 'update'
  action: string
  target?: string
  detail?: string
  ok?: boolean
  freed?: number
}

export function logActivity(entry: ActivityEntry) {
  db.prepare('INSERT INTO activity (at, area, action, target, detail, ok, freed) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    Date.now(),
    entry.area,
    entry.action,
    entry.target ?? '',
    (entry.detail ?? '').slice(0, 4000),
    entry.ok === false ? 0 : 1,
    Math.max(0, Math.round(entry.freed ?? 0)),
  )
}

export function activity() {
  const rows = db
    .prepare('SELECT id, at, area, action, target, detail, ok, freed FROM activity ORDER BY id DESC LIMIT 300')
    .all()
  const total = db.prepare('SELECT SUM(freed) AS freed FROM activity').get() as { freed: number | null }
  return { rows, freed: total.freed ?? 0 }
}

export function prune() {
  const day = 86_400_000
  db.prepare('DELETE FROM samples WHERE at < ?').run(Date.now() - 7 * day)
  db.prepare('DELETE FROM activity WHERE at < ?').run(Date.now() - 90 * day)
}
