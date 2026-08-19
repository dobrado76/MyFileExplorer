import { spawn, type ChildProcess } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/result'
import {
  buildScriptCliArgs,
  buildSpawnPlan,
  type InterpreterOverrides
} from '@shared/scriptCli'
import type { ScriptLanguage, ScriptRunRequest } from '@shared/schemas/scripts'
import { requireAbsolute } from '../fs/list'
import { broadcast } from '../ipc/events'
import { availableRuntimeMap, detectRuntimes, interpreterOverridesFromSettings } from './runtimes'
import { cleanupManifestFile, writeInputManifestFile } from './manifest'

const MAX_OUTPUT_CHARS = 400_000
const CHUNK = 8_192

type ActiveRun = {
  child: ChildProcess
  startedAt: number
  manifestPath: string | null
  tempScript: string | null
  cancelled: boolean
  buffer: string
}

const runs = new Map<string, ActiveRun>()

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    return
  }
  child.kill('SIGKILL')
}

function appendBounded(run: ActiveRun, text: string): string {
  run.buffer += text
  if (run.buffer.length > MAX_OUTPUT_CHARS) {
    run.buffer = run.buffer.slice(run.buffer.length - MAX_OUTPUT_CHARS)
  }
  return text
}

function emitOutput(runId: string, stream: 'stdout' | 'stderr', text: string): void {
  if (!text) return
  broadcast({ type: 'script-output', payload: { runId, stream, text } })
}

export type ScriptRunResult = {
  runId: string
  exitCode: number | null
  cancelled: boolean
  elapsedMs: number
  output: string
}

export async function runScriptProcess(input: {
  req: ScriptRunRequest
  language: ScriptLanguage
  scriptPath: string
  cwd: string
  overrides?: InterpreterOverrides
}): Promise<ScriptRunResult> {
  const { req } = input
  if (runs.has(req.runId)) {
    throw new AppError('busy', 'A script with this run id is already running')
  }

  let manifestPath: string | null = null
  if (req.mode === 'selection') {
    const paths = (req.paths ?? []).map((p) => requireAbsolute(p))
    if (paths.length === 0) throw new AppError('validation', 'Select at least one file or folder')
    manifestPath = writeInputManifestFile(paths, os.tmpdir())
  } else if (req.root) {
    requireAbsolute(req.root)
  }

  const cliArgs = buildScriptCliArgs({
    mode: req.mode,
    root: req.root,
    manifestPath: manifestPath ?? undefined,
    recursive: req.recursive,
    dryRun: req.dryRun,
    params: req.params
  })

  const detected = detectRuntimes(input.overrides)
  const available = availableRuntimeMap(detected)
  let plan
  try {
    plan = buildSpawnPlan({
      language: input.language,
      scriptPath: input.scriptPath,
      cliArgs,
      available,
      overrides: input.overrides ?? interpreterOverridesFromSettings(),
      preferredInterpreter: req.interpreter
    })
  } catch (e) {
    cleanupManifestFile(manifestPath)
    throw new AppError('not-found', e instanceof Error ? e.message : String(e))
  }

  return await new Promise<ScriptRunResult>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(plan.executable, plan.args, {
        cwd: input.cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      cleanupManifestFile(manifestPath)
      reject(new AppError('io', e instanceof Error ? e.message : String(e)))
      return
    }

    const run: ActiveRun = {
      child,
      startedAt: Date.now(),
      manifestPath,
      tempScript: null,
      cancelled: false,
      buffer: ''
    }
    runs.set(req.runId, run)

    const finish = (exitCode: number | null): void => {
      runs.delete(req.runId)
      cleanupManifestFile(run.manifestPath)
      if (run.tempScript) cleanupManifestFile(run.tempScript)
      const elapsedMs = Date.now() - run.startedAt
      broadcast({
        type: 'script-ended',
        payload: {
          runId: req.runId,
          exitCode,
          cancelled: run.cancelled,
          elapsedMs,
          dryRun: req.dryRun === true
        }
      })
      resolve({
        runId: req.runId,
        exitCode,
        cancelled: run.cancelled,
        elapsedMs,
        output: run.buffer
      })
    }

    child.stdout?.on('data', (buf: Buffer) => {
      emitOutput(req.runId, 'stdout', appendBounded(run, buf.toString('utf8').slice(0, CHUNK * 8)))
    })
    child.stderr?.on('data', (buf: Buffer) => {
      emitOutput(req.runId, 'stderr', appendBounded(run, buf.toString('utf8').slice(0, CHUNK * 8)))
    })
    child.on('error', (err) => {
      runs.delete(req.runId)
      cleanupManifestFile(run.manifestPath)
      reject(new AppError('io', err.message))
    })
    child.on('close', (code) => finish(code))
  })
}

export function cancelScriptRun(runId: string): { cancelled: boolean } {
  const run = runs.get(runId)
  if (!run) return { cancelled: false }
  run.cancelled = true
  killProcessTree(run.child)
  return { cancelled: true }
}

export async function writeTempScript(source: string, ext: string): Promise<string> {
  const dir = os.tmpdir()
  const file = path.join(dir, `mfe-script-${randomUUID()}${ext}`)
  await fsp.writeFile(file, source, 'utf8')
  return file
}

export function attachTempScript(runId: string, file: string): void {
  const run = runs.get(runId)
  if (run) run.tempScript = file
}

export function isScriptRunActive(runId: string): boolean {
  return runs.has(runId)
}

export { MAX_OUTPUT_CHARS }
