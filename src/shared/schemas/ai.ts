import { z } from 'zod'
import { SCRIPT_LANGUAGES } from './scripts'

export const AI_PROVIDER_TYPES = ['openai', 'openrouter', 'lmstudio', 'custom'] as const
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number]

export const aiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES)

export const DEFAULT_AI_BASE_URLS: Record<AiProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  custom: 'http://127.0.0.1:1234/v1'
}

export const aiProviderProfileSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  type: aiProviderTypeSchema,
  baseUrl: z.string().min(1).max(500),
  model: z.string().max(200).catch(''),
  local: z.boolean().catch(false),
  timeoutSec: z.number().int().min(5).max(600).catch(60),
  /** Last successful GET /models list (no secrets). */
  cachedModels: z.array(z.string().min(1).max(200)).max(500).catch([])
})

export type AiProviderProfile = z.infer<typeof aiProviderProfileSchema>

export const aiSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  defaultProviderId: z.string().max(80).catch(''),
  defaultModel: z.string().max(200).catch(''),
  preferredScriptLanguage: z.enum(['auto', ...SCRIPT_LANGUAGES]).catch('auto'),
  temperature: z.number().min(0).max(2).catch(0.2),
  maxOutputTokens: z.number().int().min(256).max(32_768).catch(4096),
  requestTimeoutSec: z.number().int().min(5).max(600).catch(90),
  /** Architectural defaults — never send paths, listings, or file bytes. */
  neverSendPaths: z.literal(true).catch(true),
  neverSendListings: z.literal(true).catch(true),
  neverSendFileContents: z.literal(true).catch(true),
  /** User ack that cloud generate may send the task text + script source (not files). */
  acknowledgedCloudGenerate: z.boolean().catch(false),
  providers: z.array(aiProviderProfileSchema).max(20).catch([])
})

export type AiSettings = z.infer<typeof aiSettingsSchema>

export const defaultAiSettings: AiSettings = aiSettingsSchema.parse({})

export const scriptsSettingsSchema = z.object({
  /** Master switch (D51). Off by default — hide Script Manager / context Scripts. */
  enabled: z.boolean().catch(false),
  /** First-run warning: scripts run as the signed-in user and can delete files. */
  acknowledgedRisk: z.boolean().catch(false),
  interpreterOverrides: z
    .object({
      powershell: z.string().max(500).catch(''),
      pwsh: z.string().max(500).catch(''),
      python: z.string().max(500).catch(''),
      cmd: z.string().max(500).catch(''),
      bash: z.string().max(500).catch('')
    })
    .catch({ powershell: '', pwsh: '', python: '', cmd: '', bash: '' })
})

export type ScriptsSettings = z.infer<typeof scriptsSettingsSchema>

export const defaultScriptsSettings: ScriptsSettings = scriptsSettingsSchema.parse({})

export const aiProviderUpsertSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80),
  type: aiProviderTypeSchema,
  baseUrl: z.string().min(1).max(500),
  model: z.string().max(200).catch(''),
  local: z.boolean().catch(false),
  timeoutSec: z.number().int().min(5).max(600).catch(60),
  /** Pass empty string to clear. Omit to leave unchanged. */
  apiKey: z.string().max(4000).nullable().optional()
})

export const aiProviderIdSchema = z.object({
  id: z.string().min(1).max(80)
})

export const aiGenerateRequestSchema = z.object({
  task: z.string().min(1).max(20_000),
  language: z.enum(['auto', ...SCRIPT_LANGUAGES]).catch('auto'),
  target: z.enum(['folder', 'selection', 'global']).catch('folder'),
  recursive: z.boolean().catch(false),
  providerId: z.string().max(80).optional(),
  model: z.string().max(200).optional()
})

export type AiGenerateRequest = z.infer<typeof aiGenerateRequestSchema>

export const aiModifyRequestSchema = z.object({
  source: z.string().min(1).max(2_000_000),
  instruction: z.string().min(1).max(20_000),
  language: z.enum(SCRIPT_LANGUAGES).optional(),
  target: z.enum(['folder', 'selection', 'global']).optional(),
  providerId: z.string().max(80).optional(),
  model: z.string().max(200).optional()
})

export const aiFixRequestSchema = z.object({
  source: z.string().min(1).max(2_000_000),
  exitCode: z.number().int(),
  stderr: z.string().max(200_000).catch(''),
  stdout: z.string().max(50_000).catch(''),
  os: z.string().max(80).optional(),
  runtime: z.string().max(200).optional(),
  redactPaths: z.boolean().catch(true),
  target: z.enum(['folder', 'selection', 'global']).optional(),
  providerId: z.string().max(80).optional(),
  model: z.string().max(200).optional()
})

export const generatedScriptSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).catch(''),
  language: z.enum(SCRIPT_LANGUAGES),
  destructive: z.boolean().catch(false),
  dryRunSupported: z.boolean().catch(false),
  dependencies: z.array(z.string()).max(40).catch([]),
  source: z.string().min(1).max(2_000_000)
})

export type GeneratedScript = z.infer<typeof generatedScriptSchema>

export function newAiProviderId(): string {
  return `aip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function defaultBaseUrlForType(type: AiProviderType): string {
  return DEFAULT_AI_BASE_URLS[type]
}

/** Drop embeddings / TTS / image models from official OpenAI-style catalogs. */
export function preferChatModelIds(type: AiProviderType, baseUrl: string, ids: string[]): string[] {
  const openaiish = type === 'openai' || /api\.openai\.com/i.test(baseUrl)
  if (!openaiish) return ids
  const skip =
    /^(text-embedding|whisper-|tts-|dall-e|omni-moderation|chatgpt-image|babbage-|davinci-|curie-|ada-|gpt-image|sora-)/i
  const chat = ids.filter(
    (id) =>
      !skip.test(id) &&
      !id.includes('embedding') &&
      !id.includes('transcribe') &&
      !id.includes('tts')
  )
  return chat.length > 0 ? chat : ids
}

function openaiModelLeaf(model: string): string {
  const id = model.trim().toLowerCase()
  const slash = id.lastIndexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

function contentPartText(part: unknown): string {
  if (typeof part === 'string') return part
  if (!part || typeof part !== 'object') return ''
  const o = part as Record<string, unknown>
  if (typeof o.text === 'string') return o.text
  if (typeof o.content === 'string') return o.content
  return ''
}

function messageText(message: Record<string, unknown> | undefined): string {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(contentPartText).join('')
  if (typeof message.refusal === 'string' && message.refusal.trim()) return ''
  return ''
}

export function extractChatCompletionText(json: unknown): {
  text: string
  finishReason?: string
  refusal?: string
  usedReasoning?: boolean
} {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
  const choices = Array.isArray(root.choices) ? root.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>) : {}
  const message =
    first.message && typeof first.message === 'object'
      ? (first.message as Record<string, unknown>)
      : undefined
  const text =
    messageText(message) ||
    (typeof first.text === 'string' ? first.text : '') ||
    (typeof root.output_text === 'string' ? root.output_text : '')
  const refusal = typeof message?.refusal === 'string' ? message.refusal.trim() : ''
  const finishReason = typeof first.finish_reason === 'string' ? first.finish_reason : undefined
  const usedReasoning = Boolean(
    (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) ||
      (typeof message?.reasoning === 'string' && message.reasoning.trim())
  )
  return { text, finishReason, refusal: refusal || undefined, usedReasoning }
}

export function chatCompletionEmptyError(extracted: {
  text: string
  finishReason?: string
  refusal?: string
  usedReasoning?: boolean
}): string | null {
  if (extracted.refusal) return `Provider refused: ${extracted.refusal}`
  if (extracted.text.trim()) return null
  if (extracted.finishReason === 'content_filter') {
    return 'Provider blocked the completion (content filter).'
  }
  if (extracted.finishReason === 'length' || extracted.usedReasoning) {
    return 'Model hit the output token limit before writing the script. Increase Max tokens under Settings → Scripting and AI, or pick a model that returns text (not only reasoning).'
  }
  return 'Provider returned an empty completion. Try again, raise Max tokens, or switch model.'
}

/** GPT-5 / o-series chat completions use max_completion_tokens, not max_tokens. */
export function usesMaxCompletionTokens(model: string): boolean {
  const leaf = openaiModelLeaf(model)
  return /^(o[1-9][\w.-]*|gpt-5[\w.-]*)$/.test(leaf)
}

/** o-series typically rejects a custom temperature. */
export function allowsCustomTemperature(model: string): boolean {
  return !/^o[1-9]/.test(openaiModelLeaf(model))
}

/**
 * If the provider 400s on max_tokens vs max_completion_tokens or temperature,
 * return a body to retry; otherwise null.
 */
export function adjustChatCompletionBodyFromError(
  body: Record<string, unknown>,
  errorText: string
): Record<string, unknown> | null {
  const t = errorText.toLowerCase()
  const next = { ...body }
  let changed = false
  const wantsCompletionTokens =
    /use ['"]?max_completion_tokens/.test(t) ||
    (t.includes('max_tokens') && t.includes('not support') && t.includes('max_completion_tokens'))
  const wantsMaxTokens =
    /use ['"]?max_tokens/.test(t) ||
    ((t.includes('unknown') || t.includes('unrecognized')) && t.includes('max_completion_tokens'))
  if (wantsCompletionTokens && 'max_tokens' in next) {
    next.max_completion_tokens = next.max_tokens
    delete next.max_tokens
    changed = true
  } else if (wantsMaxTokens && 'max_completion_tokens' in next) {
    next.max_tokens = next.max_completion_tokens
    delete next.max_completion_tokens
    changed = true
  }
  if (
    'temperature' in next &&
    t.includes('temperature') &&
    (t.includes('unsupported') || t.includes('not support') || t.includes('invalid'))
  ) {
    delete next.temperature
    changed = true
  }
  return changed ? next : null
}

export function providerLooksLocal(type: AiProviderType, baseUrl: string): boolean {
  if (type === 'lmstudio') return true
  try {
    const u = new URL(baseUrl)
    return (
      u.hostname === '127.0.0.1' ||
      u.hostname === 'localhost' ||
      u.hostname === '::1' ||
      u.hostname === '[::1]'
    )
  } catch {
    return false
  }
}
