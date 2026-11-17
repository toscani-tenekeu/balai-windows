import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

const { join } = win32

export interface RunResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
export const system32 = join(systemRoot, 'System32')
const POWERSHELL = join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * Starts a program with an explicit argument list. Nothing goes through a
 * shell, so values from the interface are never read as commands.
 */
export function run(
  file: string,
  args: string[],
  opts: { timeout?: number; env?: Record<string, string> } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(file, args, {
        windowsHide: true,
        env: { ...process.env, ...opts.env },
        timeout: opts.timeout ?? 60_000,
      })
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) })
      return
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) => resolve({ ok: false, code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ ok: code === 0, code: code ?? -1, stdout, stderr }))
  })
}

export class CommandError extends Error {}

/**
 * Runs a PowerShell script and returns what it wrote as JSON. Values coming
 * from the interface are handed over as environment variables, never pasted
 * into the script text.
 */
export async function ps<T>(script: string, env: Record<string, string> = {}, timeout = 90_000): Promise<T> {
  const full = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'try {',
    script,
    '} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
  ].join('\n')
  const encoded = Buffer.from(full, 'utf16le').toString('base64')
  const result = await run(
    POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout, env },
  )
  if (!result.ok) throw new CommandError(reason(result, 'PowerShell failed.'))
  const text = result.stdout.trim()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new CommandError('PowerShell returned something unexpected.')
  }
}

export function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** Last meaningful line of a command's error output, for showing to the user. */
export function reason(result: RunResult, fallback: string): string {
  const all = lines(result.stderr).concat(lines(result.stdout))
  return all.at(-1) ?? (result.code === -1 ? 'The command could not start.' : fallback)
}

export const messageOf = (error: unknown, fallback = 'Something went wrong.') =>
  error instanceof Error ? error.message : fallback
