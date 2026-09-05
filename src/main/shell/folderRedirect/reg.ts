import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type ExecErr = {
  code?: number | string
  stdout?: string
  stderr?: string
  message?: string
}

function execText(e: unknown): string {
  const err = e as ExecErr
  return `${err.stderr ?? ''} ${err.stdout ?? ''} ${err.message ?? ''}`
}

/** reg.exe "key/value not found" — safe to treat as already gone. */
export function isRegNotFoundError(e: unknown): boolean {
  const text = execText(e)
  return (
    /unable to find the specified registry key or value/i.test(text) ||
    /The system was unable to find the specified registry key/i.test(text) ||
    /ERROR:\s*The system cannot find the file specified/i.test(text)
  )
}

async function runReg(args: string[], timeout = 15_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg.exe', args, {
      windowsHide: true,
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024
    })
    return typeof stdout === 'string' ? stdout : ''
  } catch (e: unknown) {
    const err = e as ExecErr
    const out = typeof err.stdout === 'string' ? err.stdout : ''
    // Soft-query callers use empty string; throw for mutating ops via wrappers.
    throw Object.assign(e instanceof Error ? e : new Error(execText(e) || 'reg.exe failed'), {
      stdout: out,
      stderr: typeof err.stderr === 'string' ? err.stderr : '',
      code: err.code
    })
  }
}

export async function regQuery(key: string, args: string[] = []): Promise<string> {
  try {
    return await runReg(['query', key, ...args], 12_000)
  } catch (e: unknown) {
    if (isRegNotFoundError(e)) return ''
    const err = e as ExecErr
    return typeof err.stdout === 'string' ? err.stdout : ''
  }
}

export function parseRegValues(stdout: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\(Default\)|[^\s]+)\s+REG_\w+\s+(.*)$/i.exec(line)
    if (!m) continue
    const name = m[1] === '(Default)' ? '' : m[1]!
    out[name] = (m[2] ?? '').trim()
  }
  return out
}

export async function regKeyExists(key: string): Promise<boolean> {
  const out = await regQuery(key)
  return /HKEY_|HKCU\\|HKCR\\/i.test(out)
}

export async function regValueExists(key: string, valueName: string): Promise<boolean> {
  try {
    const out = await runReg(['query', key, '/v', valueName], 12_000)
    return new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_`, 'im').test(out)
  } catch (e: unknown) {
    if (isRegNotFoundError(e)) return false
    // Soft-fail existence probes — treat unknown as present so verify stays strict.
    return true
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function regExport(key: string, outFile: string): Promise<void> {
  await runReg(['export', key, outFile, '/y'], 15_000)
}

export async function regImport(regFile: string): Promise<void> {
  await runReg(['import', regFile], 15_000)
}

export async function regDeleteTree(key: string): Promise<void> {
  try {
    await runReg(['delete', key, '/f'], 12_000)
  } catch (e: unknown) {
    if (isRegNotFoundError(e)) return
    throw e instanceof Error ? e : new Error(execText(e) || `reg delete failed: ${key}`)
  }
}

/** Delete a named value; ignore only "not found". */
export async function regDeleteValue(key: string, valueName: string): Promise<void> {
  try {
    await runReg(['delete', key, '/v', valueName, '/f'], 12_000)
  } catch (e: unknown) {
    if (isRegNotFoundError(e)) return
    throw e instanceof Error ? e : new Error(execText(e) || `reg delete value failed: ${key}\\${valueName}`)
  }
}

export async function regSetDefault(key: string, value: string): Promise<void> {
  await runReg(['add', key, '/ve', '/d', value, '/f'], 12_000)
}
