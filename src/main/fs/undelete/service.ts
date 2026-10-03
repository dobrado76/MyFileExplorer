import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { UndeleteRecoverResponse, UndeleteScanResponse } from '@shared/schemas/undelete'
import {
  undeleteRecoverRequestSchema,
  undeleteRecoverResponseSchema,
  undeleteScanRequestSchema,
  undeleteScanResponseSchema
} from '@shared/schemas/undelete'
import { AppError } from '@shared/result'
import { broadcast } from '../../ipc/events'
import {
  closeHandle,
  openVolumeForUndelete,
  recoverTokensOnHandle,
  recoverTokensOnHandleSync,
  type RecoverSessionState
} from './recover'
import { scanDeletedOnHandleSync, scanDeletedVolume } from './scan'

export const UNDELETE_SCAN_CLI_FLAG = '--undelete-scan'
export const UNDELETE_RECOVER_CLI_FLAG = '--undelete-recover'

let scanAbort: AbortController | null = null
let recoverAbort: AbortController | null = null

type LocalRecoverSession = {
  handle: unknown
  volume: string
  destDir: string
  state: RecoverSessionState | null
}

/** Accumulate tokens when volume open needs UAC, then run one elevated pass. */
type ElevatedBuffer = {
  volume: string
  destDir: string
  tokens: string[]
  progressTotal: number
}

let localSession: LocalRecoverSession | null = null
let elevatedBuffer: ElevatedBuffer | null = null

function emitScanProgress(
  done: number,
  total: number,
  found: number,
  elevated?: boolean
): void {
  broadcast({
    type: 'undelete-progress',
    payload: { phase: 'scan', done, total, found, elevated }
  })
}

function emitRecoverProgress(
  done: number,
  total: number,
  current: string,
  elevated?: boolean
): void {
  broadcast({
    type: 'undelete-progress',
    payload: { phase: 'recover', done, total, current, elevated }
  })
}

function closeLocalSession(): void {
  if (localSession?.handle) {
    try {
      closeHandle(localSession.handle)
    } catch {
      /* ignore */
    }
  }
  localSession = null
}

function runElevatedCli(args: string[]): Promise<void> {
  const exe = process.execPath.replace(/'/g, "''")
  const cwd = (app.isPackaged ? path.dirname(process.execPath) : process.cwd()).replace(/'/g, "''")
  const fullArgs = app.isPackaged ? args : [path.resolve(process.argv[1] ?? '.'), ...args]
  const argList = fullArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const ps = `$p = Start-Process -FilePath '${exe}' -ArgumentList @(${argList}) -WorkingDirectory '${cwd}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru; if ($null -eq $p) { exit 1 }; exit $p.ExitCode`
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {
      windowsHide: true
    })
    child.on('error', (e) => {
      reject(
        new AppError('io', e instanceof Error ? e.message : String(e), 'Retry as administrator')
      )
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new AppError(
            'not-allowed',
            code == null
              ? 'Administrator undelete failed or was cancelled'
              : `Administrator undelete failed or was cancelled (exit ${code})`,
            'Retry as administrator'
          )
        )
      }
    })
  })
}

async function tempJsonPath(prefix: string): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'undelete-scratch')
  await fsp.mkdir(dir, { recursive: true })
  return path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

export function cancelUndeleteOps(): void {
  scanAbort?.abort()
  recoverAbort?.abort()
  closeLocalSession()
  elevatedBuffer = null
}

export async function undeleteScan(raw: unknown): Promise<UndeleteScanResponse> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'NTFS Undelete is only available on Windows')
  }
  const req = undeleteScanRequestSchema.parse(raw)
  scanAbort?.abort()
  scanAbort = new AbortController()
  const signal = scanAbort.signal

  emitScanProgress(0, 0, 0)
  const local = await scanDeletedVolume(req.volume, {
    signal,
    onProgress: (done, total, found) => emitScanProgress(done, total, found)
  })
  if (!local.needsElevation && local.err === 0) {
    const { records: _r, ...rest } = local.result
    emitScanProgress(rest.scannedRecords, rest.scannedRecords, rest.items.length)
    return undeleteScanResponseSchema.parse({ ...rest, elevated: false })
  }
  if (!local.needsElevation) {
    throw new AppError('io', `Could not open volume ${req.volume} (Windows error ${local.err})`)
  }

  emitScanProgress(0, 0, 0, true)
  const outFile = await tempJsonPath('scan')
  try {
    await runElevatedCli([UNDELETE_SCAN_CLI_FLAG, req.volume, outFile])
    const text = await fsp.readFile(outFile, 'utf8')
    const parsed = JSON.parse(text) as UndeleteScanResponse & { ok?: boolean; error?: string }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      const items = parsed.items
      const scanned = parsed.scannedRecords ?? 0
      emitScanProgress(scanned, scanned, items.length, true)
      return undeleteScanResponseSchema.parse({
        volume: parsed.volume ?? req.volume,
        items,
        scannedRecords: scanned,
        elevated: true
      })
    }
    throw new AppError('io', parsed?.error ?? 'Elevated scan failed')
  } finally {
    await fsp.rm(outFile, { force: true }).catch(() => undefined)
  }
}

async function runElevatedRecoverBuffered(buf: ElevatedBuffer): Promise<UndeleteRecoverResponse> {
  emitRecoverProgress(0, buf.progressTotal, 'Waiting for administrator…', true)
  const reqFile = await tempJsonPath('recover-req')
  const outFile = await tempJsonPath('recover-out')
  try {
    await fsp.writeFile(
      reqFile,
      JSON.stringify({
        volume: buf.volume,
        tokens: buf.tokens,
        destDir: buf.destDir
      }),
      'utf8'
    )
    emitRecoverProgress(0, buf.progressTotal, 'Recovering as administrator…', true)
    await runElevatedCli([UNDELETE_RECOVER_CLI_FLAG, reqFile, outFile])
    const text = await fsp.readFile(outFile, 'utf8')
    const parsed = JSON.parse(text) as UndeleteRecoverResponse & { error?: string }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.recovered)) {
      emitRecoverProgress(buf.progressTotal, buf.progressTotal, '', true)
      return undeleteRecoverResponseSchema.parse({
        recovered: parsed.recovered,
        failed: parsed.failed ?? [],
        elevated: true
      })
    }
    throw new AppError('io', parsed?.error ?? 'Elevated recover failed')
  } finally {
    await fsp.rm(reqFile, { force: true }).catch(() => undefined)
    await fsp.rm(outFile, { force: true }).catch(() => undefined)
  }
}

export async function undeleteRecover(raw: unknown): Promise<UndeleteRecoverResponse> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'NTFS Undelete is only available on Windows')
  }
  const req = undeleteRecoverRequestSchema.parse(raw)
  const offset = req.progressOffset ?? 0
  const total = req.progressTotal ?? req.tokens.length
  const keepOpen = req.keepOpen === true

  // New job (first chunk) — reset abort + drop stale sessions.
  if (offset === 0) {
    recoverAbort?.abort()
    recoverAbort = new AbortController()
    closeLocalSession()
    elevatedBuffer = null
  }
  const signal = recoverAbort?.signal ?? new AbortController().signal

  emitRecoverProgress(offset, total, offset === 0 ? 'Opening volume…' : '')

  // Elevated buffering path (volume open denied).
  if (elevatedBuffer) {
    if (elevatedBuffer.volume !== req.volume || elevatedBuffer.destDir !== req.destDir) {
      elevatedBuffer = null
    }
  }

  // Reuse local session when chunking the same job.
  if (
    localSession &&
    (localSession.volume !== req.volume || localSession.destDir !== req.destDir)
  ) {
    closeLocalSession()
  }

  if (!localSession && !elevatedBuffer) {
    const opened = openVolumeForUndelete(req.volume)
    if (opened.handle) {
      localSession = {
        handle: opened.handle,
        volume: req.volume,
        destDir: req.destDir,
        state: null
      }
    } else if (opened.needsElevation) {
      elevatedBuffer = {
        volume: req.volume,
        destDir: req.destDir,
        tokens: [],
        progressTotal: total
      }
    } else {
      throw new AppError('io', `Could not open volume ${req.volume} (Windows error ${opened.err})`)
    }
  }

  if (elevatedBuffer) {
    elevatedBuffer.tokens.push(...req.tokens)
    elevatedBuffer.progressTotal = total
    // Queuing only — not writing files yet (must not look like recover progress).
    emitRecoverProgress(
      Math.min(offset + req.tokens.length, total),
      total,
      'Queuing for administrator (not writing yet)…'
    )
    if (keepOpen) {
      return undeleteRecoverResponseSchema.parse({
        recovered: [],
        failed: [],
        elevated: false
      })
    }
    const buf = elevatedBuffer
    elevatedBuffer = null
    return runElevatedRecoverBuffered(buf)
  }

  if (!localSession?.handle) {
    throw new AppError('io', `Could not open volume ${req.volume}`)
  }

  try {
    const res = await recoverTokensOnHandle(
      localSession.handle,
      req.volume,
      req.tokens,
      req.destDir,
      {
        signal,
        session: localSession.state ?? undefined,
        progressOffset: offset,
        progressTotal: total,
        onProgress: (done, tot, currentName) => emitRecoverProgress(done, tot, currentName)
      }
    )
    localSession.state = res.session
    if (!keepOpen) {
      closeLocalSession()
      emitRecoverProgress(total, total, '')
    }
    return undeleteRecoverResponseSchema.parse({
      recovered: res.recovered,
      failed: res.failed,
      elevated: false
    })
  } catch (e) {
    closeLocalSession()
    throw e
  }
}

export function runUndeleteScanCli(volume: string, outFile: string): number {
  const write = (obj: unknown): void => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify(obj), 'utf8')
  }
  try {
    const opened = openVolumeForUndelete(volume)
    if (!opened.handle) {
      write({
        volume,
        items: [],
        scannedRecords: 0,
        elevated: true,
        error: `Could not open volume (err ${opened.err})`
      })
      return 1
    }
    try {
      const result = scanDeletedOnHandleSync(opened.handle, volume)
      const { records: _r, ...rest } = result
      write({ ...rest, elevated: true })
      return 0
    } finally {
      closeHandle(opened.handle)
    }
  } catch (e) {
    write({
      volume,
      items: [],
      scannedRecords: 0,
      elevated: true,
      error: e instanceof Error ? e.message : String(e)
    })
    return 1
  }
}

export function runUndeleteRecoverCli(reqFile: string, outFile: string): number {
  const write = (obj: unknown): void => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify(obj), 'utf8')
  }
  try {
    const req = undeleteRecoverRequestSchema.parse(JSON.parse(fs.readFileSync(reqFile, 'utf8')))
    const opened = openVolumeForUndelete(req.volume)
    if (!opened.handle) {
      write({
        recovered: [],
        failed: req.tokens.map((token) => ({
          token,
          message: `Could not open volume (err ${opened.err})`
        })),
        elevated: true
      })
      return 1
    }
    try {
      const res = recoverTokensOnHandleSync(opened.handle, req.volume, req.tokens, req.destDir)
      write({ ...res, elevated: true })
      return res.failed.length && !res.recovered.length ? 1 : 0
    } finally {
      closeHandle(opened.handle)
    }
  } catch (e) {
    write({
      recovered: [],
      failed: [],
      elevated: true,
      error: e instanceof Error ? e.message : String(e)
    })
    return 1
  }
}

export function parseUndeleteScanCli(
  argv: string[]
): { volume: string; outFile: string } | null {
  const i = argv.indexOf(UNDELETE_SCAN_CLI_FLAG)
  if (i < 0) return null
  const volume = argv[i + 1]?.trim() ?? ''
  const outFile = argv[i + 2]?.trim() ?? ''
  if (!/^[A-Za-z]:$/.test(volume) || !outFile || !path.isAbsolute(outFile)) return null
  return { volume: volume.toUpperCase(), outFile }
}

export function parseUndeleteRecoverCli(
  argv: string[]
): { reqFile: string; outFile: string } | null {
  const i = argv.indexOf(UNDELETE_RECOVER_CLI_FLAG)
  if (i < 0) return null
  const reqFile = argv[i + 1]?.trim() ?? ''
  const outFile = argv[i + 2]?.trim() ?? ''
  if (!reqFile || !outFile || !path.isAbsolute(reqFile) || !path.isAbsolute(outFile)) return null
  return { reqFile, outFile }
}
