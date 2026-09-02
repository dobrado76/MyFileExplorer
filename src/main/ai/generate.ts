import os from 'node:os'
import type { AiGenerateRequest, GeneratedScript } from '@shared/schemas/ai'
import type { ScriptLanguage } from '@shared/schemas/scripts'
import { redactPathsInText } from '@shared/scriptDestructive'
import {
  buildScriptSystemPrompt,
  extractGeneratedScript,
  scriptCliContract,
  SCRIPT_UNICODE_PATH_RULES
} from '@shared/scriptGenerate'
import { detectRuntimes } from '../scripts/runtimes'
import { completeChat } from './provider'

export { buildScriptSystemPrompt, extractGeneratedScript }

function runtimeLabels(): string[] {
  return detectRuntimes()
    .filter((r) => r.available)
    .map((r) => r.kind)
}

export async function generateScript(req: AiGenerateRequest): Promise<GeneratedScript> {
  const system = buildScriptSystemPrompt({
    os: `${os.platform()} ${os.release()}`,
    runtimes: runtimeLabels(),
    target: req.target,
    language: req.language,
    recursive: req.recursive
  })
  const user = [
    `Task:\n${req.task.trim()}`,
    req.target === 'global'
      ? 'Remember: this is a global script. Do not request or invent user file paths. Do not use --root or --input-list.'
      : 'Remember: do not request or invent user file paths. Use only --root / --input-list at runtime.',
    'Respond with the JSON object only.'
  ].join('\n\n')
  const raw = await completeChat({
    providerId: req.providerId,
    model: req.model,
    system,
    user
  })
  return extractGeneratedScript(raw)
}

export async function modifyScript(input: {
  source: string
  instruction: string
  language?: ScriptLanguage
  target?: 'folder' | 'selection' | 'global'
  providerId?: string
  model?: string
}): Promise<GeneratedScript> {
  const target = input.target ?? 'folder'
  const system = [
    'You modify an existing local file-manager script. Output JSON only with keys:',
    'name, description, language, destructive, dryRunSupported, dependencies, source.',
    'name is a Title Case display label with spaces (keep the current name unless asked to rename).',
    target === 'global'
      ? 'Keep the global argv contract: optional --dry-run and named --params only. Do not add --root or --input-list.'
      : 'Keep the argv contract: --root / --input-list / --recursive / --dry-run / named --params.',
    'Do not add network calls that upload user files. Do not ask for paths.',
    'Always include the full revised source. Do not return an empty source field.',
    scriptCliContract(target),
    SCRIPT_UNICODE_PATH_RULES
  ].join('\n')
  const user = [
    input.language ? `Language: ${input.language}` : '',
    `Instruction:\n${input.instruction.trim()}`,
    `Current source:\n${input.source}`
  ]
    .filter(Boolean)
    .join('\n\n')
  const raw = await completeChat({
    providerId: input.providerId,
    model: input.model,
    system,
    user
  })
  return extractGeneratedScript(raw)
}

export async function fixScript(input: {
  source: string
  exitCode: number
  stderr: string
  stdout?: string
  os?: string
  runtime?: string
  redactPaths: boolean
  target?: 'folder' | 'selection' | 'global'
  providerId?: string
  model?: string
}): Promise<GeneratedScript> {
  const stderr = input.redactPaths ? redactPathsInText(input.stderr) : input.stderr
  const stdout = input.redactPaths ? redactPathsInText(input.stdout ?? '') : (input.stdout ?? '')
  const target = input.target ?? 'folder'
  const system = [
    'You fix a failed local script. Output JSON only with keys:',
    'name, description, language, destructive, dryRunSupported, dependencies, source.',
    target === 'global'
      ? 'Keep the global argv contract (no --root / --input-list). Do not request user files or paths.'
      : 'Keep the argv contract. Do not request user files or paths.',
    scriptCliContract(target),
    SCRIPT_UNICODE_PATH_RULES,
    'If stderr shows \\uXXXX in paths, the script mishandled UTF-8 — decode manifest lines as UTF-8 and use pathlib/-LiteralPath.'
  ].join('\n')
  const user = [
    `OS: ${input.os || `${os.platform()} ${os.release()}`}`,
    `Runtime: ${input.runtime || 'unknown'}`,
    `Exit code: ${input.exitCode}`,
    stdout ? `Stdout (may be truncated):\n${stdout.slice(0, 4000)}` : '',
    `Stderr:\n${stderr.slice(0, 12000)}`,
    `Source:\n${input.source}`
  ]
    .filter(Boolean)
    .join('\n\n')
  const raw = await completeChat({
    providerId: input.providerId,
    model: input.model,
    system,
    user
  })
  return extractGeneratedScript(raw)
}
