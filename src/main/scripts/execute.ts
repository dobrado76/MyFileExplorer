import path from 'node:path'
import { AppError } from '@shared/result'
import { scriptFileExtension, type ScriptLanguage, type ScriptRunRequest } from '@shared/schemas/scripts'
import { coerceParamValue } from '@shared/scriptCli'
import { requireAbsolute } from '../fs/list'
import {
  getScript,
  readScriptSource,
  resolveScriptFile
} from './library'
import { cancelScriptRun, runScriptProcess, writeTempScript } from './runner'
import { interpreterOverridesFromSettings } from './runtimes'
import fs from 'node:fs'

export async function executeScriptRun(req: ScriptRunRequest): Promise<{
  runId: string
  exitCode: number | null
  cancelled: boolean
  elapsedMs: number
  output: string
}> {
  let language: ScriptLanguage
  let scriptPath: string
  let tempFile: string | null = null
  let cwd: string

  if (req.scriptId) {
    const script = getScript(req.scriptId)
    language = req.language ?? script.language
    if (!req.interpreter) req = { ...req, interpreter: script.interpreter }
    scriptPath = resolveScriptFile(script)
    if (!fs.existsSync(scriptPath)) {
      throw new AppError('not-found', 'Script file is missing')
    }
    if (script.parameters.length > 0) {
      const params: Record<string, string | number | boolean> = { ...(req.params ?? {}) }
      for (const p of script.parameters) {
        const raw = params[p.name] ?? p.defaultValue
        if (raw === undefined || raw === '') {
          if (p.required) throw new AppError('validation', `Parameter “${p.label || p.name}” is required`)
          continue
        }
        params[p.name] = coerceParamValue(p.type, raw) as string | number | boolean
      }
      req = { ...req, params }
    }
  } else if (req.source != null && req.language) {
    language = req.language
    tempFile = await writeTempScript(req.source, scriptFileExtension(language))
    scriptPath = tempFile
  } else {
    throw new AppError('validation', 'Provide a saved script or source + language')
  }

  if (req.mode === 'folder') {
    if (!req.root) throw new AppError('validation', 'Folder scripts need a current folder')
    cwd = requireAbsolute(req.root)
  } else {
    const first = req.paths?.[0]
    cwd = first ? path.dirname(requireAbsolute(first)) : process.cwd()
  }

  try {
    return await runScriptProcess({
      req,
      language,
      scriptPath,
      cwd,
      overrides: interpreterOverridesFromSettings()
    })
  } finally {
    if (tempFile) {
      try {
        fs.unlinkSync(tempFile)
      } catch {
        /* ignore */
      }
    }
  }
}

export { cancelScriptRun }

export async function previewScriptSource(scriptId: string): Promise<string> {
  return readScriptSource(getScript(scriptId))
}
