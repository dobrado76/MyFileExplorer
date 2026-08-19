import { describe, expect, it } from 'vitest'
import {
  adjustChatCompletionBodyFromError,
  allowsCustomTemperature,
  chatCompletionEmptyError,
  extractChatCompletionText,
  preferChatModelIds,
  usesMaxCompletionTokens
} from '../shared/schemas/ai'

describe('preferChatModelIds', () => {
  it('drops OpenAI embeddings, audio, and image models', () => {
    expect(
      preferChatModelIds('openai', 'https://api.openai.com/v1', [
        'gpt-4.1',
        'gpt-4.1-mini',
        'text-embedding-3-small',
        'whisper-1',
        'tts-1',
        'dall-e-3',
        'gpt-image-1'
      ])
    ).toEqual(['gpt-4.1', 'gpt-4.1-mini'])
  })

  it('keeps the full catalog for LM Studio / OpenRouter', () => {
    const ids = ['local-qwen', 'text-embedding-nomic']
    expect(preferChatModelIds('lmstudio', 'http://127.0.0.1:1234/v1', ids)).toEqual(ids)
    expect(preferChatModelIds('openrouter', 'https://openrouter.ai/api/v1', ids)).toEqual(ids)
  })

  it('treats an OpenAI host as chat-filtered even when type is custom', () => {
    expect(
      preferChatModelIds('custom', 'https://api.openai.com/v1', [
        'gpt-4o',
        'text-embedding-3-large'
      ])
    ).toEqual(['gpt-4o'])
  })
})

describe('chat completion param compatibility', () => {
  it('uses max_completion_tokens for GPT-5 and o-series (including OpenRouter ids)', () => {
    expect(usesMaxCompletionTokens('gpt-5')).toBe(true)
    expect(usesMaxCompletionTokens('gpt-5-mini')).toBe(true)
    expect(usesMaxCompletionTokens('openai/gpt-5-mini')).toBe(true)
    expect(usesMaxCompletionTokens('o3-mini')).toBe(true)
    expect(usesMaxCompletionTokens('gpt-4o')).toBe(false)
    expect(usesMaxCompletionTokens('gpt-4.1-mini')).toBe(false)
  })

  it('omits custom temperature only for o-series', () => {
    expect(allowsCustomTemperature('o3-mini')).toBe(false)
    expect(allowsCustomTemperature('gpt-5-mini')).toBe(true)
    expect(allowsCustomTemperature('gpt-4o')).toBe(true)
  })

  it('retries max_tokens 400s with max_completion_tokens', () => {
    const next = adjustChatCompletionBodyFromError(
      { model: 'gpt-5-mini', max_tokens: 4096, temperature: 0.2 },
      `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`
    )
    expect(next).toEqual({
      model: 'gpt-5-mini',
      max_completion_tokens: 4096,
      temperature: 0.2
    })
  })

  it('does not ping-pong when the error still mentions both field names', () => {
    const err = `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`
    const next = adjustChatCompletionBodyFromError({ model: 'x', max_completion_tokens: 4096 }, err)
    expect(next).toBeNull()
  })
})

describe('extractChatCompletionText', () => {
  it('reads string message content', () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: '{"name":"X"}' }, finish_reason: 'stop' }]
      }).text
    ).toBe('{"name":"X"}')
  })

  it('joins array content parts', () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: [{ type: 'text', text: '{"a":' }, { text: '1}' }] } }]
      }).text
    ).toBe('{"a":1}')
  })

  it('explains empty completions', () => {
    expect(
      chatCompletionEmptyError({
        text: '',
        finishReason: 'length',
        usedReasoning: true
      })
    ).toMatch(/token limit/i)
    expect(chatCompletionEmptyError({ text: '{"ok":true}' })).toBeNull()
  })
})
