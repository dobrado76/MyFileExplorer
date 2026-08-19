import { AppError } from '@shared/result'
import {
  adjustChatCompletionBodyFromError,
  allowsCustomTemperature,
  defaultBaseUrlForType,
  newAiProviderId,
  preferChatModelIds,
  providerLooksLocal,
  usesMaxCompletionTokens,
  type AiProviderProfile,
  type AiProviderType
} from '@shared/schemas/ai'
import { getSettings, patchSettings } from '../settings/store'
import { deleteAiApiKey, getAiApiKey, hasAiApiKey, setAiApiKey } from './secrets'

export type AiProviderPublic = AiProviderProfile & { hasApiKey: boolean }

function assertAiEnabled(): void {
  if (!getSettings().scripts.enabled) {
    throw new AppError(
      'not-allowed',
      'Scripting is disabled. Enable it in Settings → Scripting and AI.'
    )
  }
  if (!getSettings().ai.enabled) {
    throw new AppError(
      'not-allowed',
      'AI is disabled. Enable it in Settings → Scripting and AI.'
    )
  }
}

export function listAiProviders(): AiProviderPublic[] {
  return getSettings().ai.providers.map((p) => ({
    ...p,
    hasApiKey: hasAiApiKey(p.id)
  }))
}

export function getAiProvider(id: string): AiProviderProfile {
  const found = getSettings().ai.providers.find((p) => p.id === id)
  if (!found) throw new AppError('not-found', 'AI provider not found')
  return found
}

export function upsertAiProvider(input: {
  id?: string
  name: string
  type: AiProviderType
  baseUrl: string
  model: string
  local?: boolean
  timeoutSec?: number
  apiKey?: string | null
}): AiProviderPublic {
  const id = input.id?.trim() || newAiProviderId()
  const existing = getSettings().ai.providers.find((p) => p.id === id)
  const baseUrl = input.baseUrl.trim() || defaultBaseUrlForType(input.type)
  const next: AiProviderProfile = {
    id,
    name: input.name.trim() || 'Provider',
    type: input.type,
    baseUrl,
    model: input.model.trim(),
    local: input.local ?? providerLooksLocal(input.type, baseUrl),
    timeoutSec: input.timeoutSec ?? existing?.timeoutSec ?? 60,
    cachedModels: existing?.cachedModels ?? []
  }
  const providers = getSettings().ai.providers.filter((p) => p.id !== id)
  providers.push(next)
  const ai = getSettings().ai
  patchSettings({
    ai: {
      ...ai,
      providers,
      defaultProviderId: ai.defaultProviderId || next.id
    }
  })
  if (input.apiKey !== undefined) {
    setAiApiKey(id, input.apiKey && input.apiKey.trim() ? input.apiKey.trim() : null)
  }
  return { ...next, hasApiKey: hasAiApiKey(id) }
}

export function deleteAiProvider(id: string): void {
  deleteAiApiKey(id)
  const ai = getSettings().ai
  const providers = ai.providers.filter((p) => p.id !== id)
  patchSettings({
    ai: {
      ...ai,
      providers,
      defaultProviderId: ai.defaultProviderId === id ? (providers[0]?.id ?? '') : ai.defaultProviderId
    }
  })
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

async function aiFetch(
  provider: AiProviderProfile,
  pathname: string,
  init?: RequestInit
): Promise<Response> {
  assertAiEnabled()
  const key = getAiApiKey(provider.id)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  if (key) headers.Authorization = `Bearer ${key}`
  const timeoutMs = (provider.timeoutSec || getSettings().ai.requestTimeoutSec || 60) * 1000
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(`${normalizeBaseUrl(provider.baseUrl)}${pathname}`, {
      ...init,
      headers,
      signal: ac.signal
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `AI request failed: ${msg}`)
  } finally {
    clearTimeout(t)
  }
}

export async function testAiConnection(id: string): Promise<{
  ok: true
  modelCount: number
  message: string
}> {
  const provider = getAiProvider(id)
  const res = await aiFetch(provider, '/models', { method: 'GET' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AppError(
      'io',
      `Provider returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
    )
  }
  const json = (await res.json()) as { data?: { id?: string }[] }
  const raw = uniqueSortedModelIds(json)
  cacheProviderModels(id, preferChatModelIds(provider.type, provider.baseUrl, raw))
  const count = raw.length
  return { ok: true, modelCount: count, message: `Connected — ${count} model${count === 1 ? '' : 's'}` }
}

export function cacheProviderModels(id: string, ids: string[]): void {
  const ai = getSettings().ai
  const providers = ai.providers.map((p) => (p.id === id ? { ...p, cachedModels: ids } : p))
  if (providers.some((p) => p.id === id)) {
    patchSettings({ ai: { providers } })
  }
}

function uniqueSortedModelIds(json: { data?: { id?: string }[] }): string[] {
  return [
    ...new Set(
      (json.data ?? [])
        .map((m) => m.id)
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
    )
  ].sort((a, b) => a.localeCompare(b))
}

export async function listAiModels(id: string): Promise<{ id: string }[]> {
  const provider = getAiProvider(id)
  const res = await aiFetch(provider, '/models', { method: 'GET' })
  if (!res.ok) {
    throw new AppError('io', `Could not list models (${res.status})`)
  }
  const json = (await res.json()) as { data?: { id?: string }[] }
  const ids = preferChatModelIds(provider.type, provider.baseUrl, uniqueSortedModelIds(json))
  cacheProviderModels(id, ids)
  return ids.map((mid) => ({ id: mid }))
}

export async function completeChat(input: {
  providerId?: string
  model?: string
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  assertAiEnabled()
  const ai = getSettings().ai
  const providerId = input.providerId || ai.defaultProviderId
  if (!providerId) throw new AppError('validation', 'No AI provider configured')
  const provider = getAiProvider(providerId)
  const model = input.model || ai.defaultModel || provider.model
  if (!model) throw new AppError('validation', 'No model selected')

  const maxTokens = input.maxTokens ?? ai.maxOutputTokens
  const request: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user }
    ]
  }
  if (allowsCustomTemperature(model)) {
    request.temperature = input.temperature ?? ai.temperature
  }
  if (usesMaxCompletionTokens(model)) request.max_completion_tokens = maxTokens
  else request.max_tokens = maxTokens

  let lastStatus = 0
  let lastText = ''
  let body = request
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await aiFetch(provider, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.ok) {
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const text = json.choices?.[0]?.message?.content
      if (!text) throw new AppError('io', 'Provider returned an empty completion')
      return text
    }
    lastStatus = res.status
    lastText = await res.text().catch(() => '')
    const next = res.status === 400 ? adjustChatCompletionBodyFromError(body, lastText) : null
    if (!next) break
    body = next
  }
  throw new AppError(
    'io',
    `Completion failed (${lastStatus})${lastText ? `: ${lastText.slice(0, 240)}` : ''}`
  )
}

export function resolveProviderForUi(providerId?: string): AiProviderPublic | null {
  const ai = getSettings().ai
  const id = providerId || ai.defaultProviderId
  if (!id) return null
  const p = ai.providers.find((x) => x.id === id)
  if (!p) return null
  return { ...p, hasApiKey: hasAiApiKey(p.id) }
}
