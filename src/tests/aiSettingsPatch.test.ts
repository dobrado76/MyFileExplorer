import { describe, expect, it } from 'vitest'
import { defaultSettings, settingsPatchSchema } from '../shared/schemas/settings'

describe('AI settings patch', () => {
  it('does not invent an empty providers list when patching other AI prefs', () => {
    const parsed = settingsPatchSchema.parse({
      ai: { enabled: true, defaultModel: 'gpt-4.1-mini' }
    })
    expect(parsed.ai?.enabled).toBe(true)
    expect(parsed.ai?.defaultModel).toBe('gpt-4.1-mini')
    expect(parsed.ai?.providers).toBeUndefined()
  })

  it('keeps a supplied provider list', () => {
    const parsed = settingsPatchSchema.parse({
      ai: {
        providers: [
          {
            id: 'aip_1',
            name: 'OpenAI',
            type: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o',
            local: false,
            timeoutSec: 60
          }
        ]
      }
    })
    expect(parsed.ai?.providers).toHaveLength(1)
    expect(parsed.ai?.providers?.[0]?.id).toBe('aip_1')
  })

  it('default settings start with no providers', () => {
    expect(defaultSettings.ai.providers).toEqual([])
  })
})
