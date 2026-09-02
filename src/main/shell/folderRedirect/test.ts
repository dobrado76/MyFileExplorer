import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import koffi from 'koffi'
import type { ShellRedirectTestResponse } from '@shared/schemas/shellRedirect'
import { countInvocationsBeforeTest, readShellRedirectInvocations } from './index'

const SE_ERR_THRESHOLD = 32

type ShellExecuteFn = (
  hwnd: null,
  operation: string,
  file: string,
  parameters: string | null,
  directory: string | null,
  showCmd: number
) => number | bigint

let shellExecuteW: ShellExecuteFn | null | undefined

function ensureShellExecute(): ShellExecuteFn | null {
  if (shellExecuteW !== undefined) return shellExecuteW
  if (process.platform !== 'win32') {
    shellExecuteW = null
    return null
  }
  try {
    const shell32 = koffi.load('shell32.dll')
    shellExecuteW = shell32.func(
      'intptr __stdcall ShellExecuteW(void *hwnd, str16 lpOperation, str16 lpFile, str16 lpParameters, str16 lpDirectory, int32 nShowCmd)'
    ) as ShellExecuteFn
  } catch {
    shellExecuteW = null
  }
  return shellExecuteW
}

function shellExecuteOk(code: number | bigint): boolean {
  const n = typeof code === 'bigint' ? Number(code) : code
  return Number.isFinite(n) && n > SE_ERR_THRESHOLD
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function testShellRedirect(): Promise<ShellRedirectTestResponse> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Shell redirect test is only available on Windows' }
  }

  const fn = ensureShellExecute()
  if (!fn) return { ok: false, message: 'ShellExecuteW is not available' }

  const before = countInvocationsBeforeTest()
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-redirect-test-'))

  try {
    const code = fn(null, 'open', tempDir, null, null, 1)
    if (!shellExecuteOk(code)) {
      return { ok: false, message: `ShellExecuteW failed (${String(code)})` }
    }

    await sleep(2500)
    const after = readShellRedirectInvocations(5)
    const newLine = after.find(
      (inv) =>
        inv.target.replace(/\\/g, '/').toLowerCase() === tempDir.replace(/\\/g, '/').toLowerCase()
    )
    if (!newLine && after.length <= before) {
      return {
        ok: false,
        message:
          'No launcher invocation logged — redirect may be inactive or this open path bypasses Directory verbs'
      }
    }
    return { ok: true, message: newLine ? `Logged action: ${newLine.action}` : 'Invocation logged' }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
