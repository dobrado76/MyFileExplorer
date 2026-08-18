import os from 'node:os'
import type { AiGenerateRequest, GeneratedScript } from '@shared/schemas/ai'
import type { ScriptLanguage } from '@shared/schemas/scripts'
import { redactPathsInText } from '@shared/scriptDestructive'
import {
  SCRIPT_CLI_CONTRACT,
  buildScriptSystemPrompt,
  extractGeneratedScript
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
    'Remember: do not request or invent user file paths. Use only --root / --input-list at runtime.',
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
  providerId?: string
  model?: string
}): Promise<GeneratedScript> {
  const system = [
    'You modify an existing local file-manager script. Output JSON only with keys:',
    'name, description, language, destructive, dryRunSupported, dependencies, source.',
    'Keep the argv contract: --root / --input-list / --recursive / --dry-run / named --params.',
    'Do not add network calls that upload user files. Do not ask for paths.',
    SCRIPT_CLI_CONTRACT
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
  providerId?: string
  model?: string
}): Promise<GeneratedScript> {
  const stderr = input.redactPaths ? redactPathsInText(input.stderr) : input.stderr
  const stdout = input.redactPaths ? redactPathsInText(input.stdout ?? '') : (input.stdout ?? '')
  const system = [
    'You fix a failed local script. Output JSON only with keys:',
    'name, description, language, destructive, dryRunSupported, dependencies, source.',
    'Keep the argv contract. Do not request user files or paths.',
    SCRIPT_CLI_CONTRACT
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
