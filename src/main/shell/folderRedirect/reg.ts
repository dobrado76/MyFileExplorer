import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function regQuery(key: string, args: string[] = []): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 12_000,
      maxBuffer: 8 * 1024 * 1024
    })
    return typeof stdout === 'string' ? stdout : ''
  } catch (e: unknown) {
    const err = e as { stdout?: string }
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

export async function regExport(key: string, outFile: string): Promise<void> {
  await execFileAsync('reg.exe', ['export', key, outFile, '/y'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15_000
  })
}

export async function regImport(regFile: string): Promise<void> {
  await execFileAsync('reg.exe', ['import', regFile], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15_000
  })
}

export async function regDeleteTree(key: string): Promise<void> {
  try {
    await execFileAsync('reg.exe', ['delete', key, '/f'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 12_000
    })
  } catch {
    // already gone
  }
}

export async function regSetDefault(key: string, value: string): Promise<void> {
  await execFileAsync('reg.exe', ['add', key, '/ve', '/d', value, '/f'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 12_000
  })
}
