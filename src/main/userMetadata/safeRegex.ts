/**
 * Timeout-protected whole-value regex match for D70.
 * Must not block Electron main/renderer on catastrophic backtracking.
 */

import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import {
  compileWholeValuePattern,
  testWholeValueSync,
  type TextValidateResult
} from '@shared/userMetadataValidate'
import type { UserMetadataTextValidation } from '@shared/schemas/userMetadata'
import { MAX_TEXT_VALUE_LEN } from '@shared/schemas/userMetadata'

const REGEX_TIMEOUT_MS = 40

function regexWorkerScriptPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'out', 'main', 'regexMatchWorker.js'),
    path.join(
      path.dirname(process.execPath),
      'resources',
      'app.asar',
      'out',
      'main',
      'regexMatchWorker.js'
    ),
    path.join(__dirname, 'regexMatchWorker.js'),
    path.join(__dirname, '..', 'regexMatchWorker.js')
  ]
  for (const c of candidates) {
    try {
      fs.accessSync(c)
      return c
    } catch {
      /* try next */
    }
  }
  return candidates[2]!
}

/**
 * Run `^(?:pattern)$` against value in a worker; kill if it exceeds the timeout.
 */
export async function testWholeValueProtected(
  value: string,
  validation: UserMetadataTextValidation | undefined,
  limits?: { minLength?: number; maxLength?: number }
): Promise<TextValidateResult> {
  if (!value) return { ok: true }
  if (value.length > MAX_TEXT_VALUE_LEN) {
    return { ok: false, message: `Text cannot exceed ${MAX_TEXT_VALUE_LEN} characters` }
  }
  if (limits?.maxLength != null && value.length > limits.maxLength) {
    return { ok: false, message: `Must be at most ${limits.maxLength} characters` }
  }
  if (limits?.minLength != null && value.length < limits.minLength) {
    return { ok: false, message: `Must be at least ${limits.minLength} characters` }
  }
  if (!validation) return { ok: true }

  const compiled = compileWholeValuePattern(validation)
  if (!compiled.ok) return compiled

  return await new Promise<TextValidateResult>((resolve) => {
    let settled = false
    const finish = (r: TextValidateResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let worker: Worker
    try {
      worker = new Worker(regexWorkerScriptPath(), {
        workerData: {
          pattern: compiled.source,
          flags: compiled.flags,
          value
        }
      })
    } catch {
      finish({
        ok: false,
        message: 'Could not start regex safety worker'
      })
      return
    }
    const timer = setTimeout(() => {
      void worker.terminate().catch(() => {})
      finish({
        ok: false,
        message: 'Pattern took too long to evaluate (possible catastrophic backtracking)'
      })
    }, REGEX_TIMEOUT_MS)
    worker.on('message', (msg: { ok?: boolean; match?: boolean; error?: string }) => {
      clearTimeout(timer)
      void worker.terminate().catch(() => {})
      if (msg.error) {
        finish({ ok: false, message: msg.error })
        return
      }
      if (msg.match) finish({ ok: true })
      else {
        finish({
          ok: false,
          message: validation.message?.trim() || 'Value does not match the required pattern'
        })
      }
    })
    worker.on('error', () => {
      clearTimeout(timer)
      finish({ ok: false, message: 'Regex worker failed' })
    })
    worker.on('exit', (code) => {
      clearTimeout(timer)
      if (!settled && code !== 0) {
        finish({ ok: false, message: 'Regex worker exited unexpectedly' })
      }
    })
  })
}

/** Settings: ensure pattern compiles and is not an obvious ReDoS shape (sync). */
export function assertPatternSafeForSettings(
  validation: UserMetadataTextValidation
): TextValidateResult {
  const r = compileWholeValuePattern(validation)
  return r.ok ? { ok: true } : r
}

/** Soft renderer preview — still bounded; main remains authoritative. */
export function previewValidateText(
  value: string,
  validation: UserMetadataTextValidation | undefined,
  limits?: { minLength?: number; maxLength?: number }
): TextValidateResult {
  return testWholeValueSync(value, validation, limits)
}
