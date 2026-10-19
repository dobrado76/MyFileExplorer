import { describe, expect, it } from 'vitest'
import {
  CAMERA_LOOKS,
  cameraLookDustCount,
  cameraLookIndexRng,
  cameraLookParamValues,
  cameraLookPathMatches,
  cameraLookRollPool,
  cameraLookSeedForIndex,
  cameraLookTemperature,
  defaultCameraLookCustomControl,
  defaultCameraLookSettings,
  normalizeCameraLookEnabled,
  replaceCameraLookControls,
  rollCameraLook
} from '../shared/cameraLook'
import { defaultSettings, settingsSchema } from '../shared/schemas/settings'
import { CAMERA_LOOK_BODIES, cameraLookFragmentSource } from '../renderer/lib/cameraLookShaders'
import { buildSettingsExportDocument, parseSettingsImport } from '../shared/schemas/settingsExport'

describe('camera look roll', () => {
  it('stays off at 0% and when nothing is enabled', () => {
    expect(rollCameraLook(['dslr-natural'], 0, () => 0)).toBeNull()
    expect(rollCameraLook([], 100, () => 0)).toBeNull()
  })

  it('always picks an enabled look at 100%', () => {
    const ids = ['fine-grain', 'high-iso']
    expect(rollCameraLook(ids, 100, () => 0)).toBe('fine-grain')
    expect(rollCameraLook(ids, 100, () => 0.99)).toBe('high-iso')
  })

  it('skips the pass when the frequency roll misses', () => {
    let n = 0
    const rng = (): number => {
      n += 1
      return n === 1 ? 0.9 : 0
    }
    expect(rollCameraLook(['dslr-natural'], 35, rng)).toBeNull()
    n = 0
    const hit = (): number => {
      n += 1
      return n === 1 ? 0.1 : 0
    }
    expect(rollCameraLook(['dslr-natural', 'polaroid'], 35, hit)).toBe('dslr-natural')
  })

  it('repeats the same look and seed for a list index', () => {
    const ids = CAMERA_LOOKS.map((look) => look.id)
    const once = rollCameraLook(ids, 35, cameraLookIndexRng(12))
    const twice = rollCameraLook(ids, 35, cameraLookIndexRng(12))
    expect(twice).toBe(once)
    expect(cameraLookSeedForIndex(12)).toBe(cameraLookSeedForIndex(12))
    expect(cameraLookSeedForIndex(12)).not.toBe(cameraLookSeedForIndex(13))
    const seen = new Set<string | null>()
    for (let i = 0; i < 40; i++) seen.add(rollCameraLook(ids, 100, cameraLookIndexRng(i)))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('drops unknown ids and keeps a custom id', () => {
    expect(normalizeCameraLookEnabled(['nope', 'dslr-natural', 'c_mine01'])).toEqual([
      'dslr-natural',
      'c_mine01'
    ])
    expect(normalizeCameraLookEnabled(undefined)).toEqual(CAMERA_LOOKS.map((look) => look.id))
  })

  it('leaves a custom out of the pool until it defines apply()', () => {
    const settings = {
      ...defaultCameraLookSettings,
      enabledIds: ['dslr-natural', 'c_mine01'],
      customs: [{ id: 'c_mine01', name: 'Mine', fragment: '', controls: [] }]
    }
    expect(cameraLookRollPool(settings)).toEqual(['dslr-natural'])
    expect(
      cameraLookRollPool({
        ...settings,
        customs: [
          {
            id: 'c_mine01',
            name: 'Mine',
            fragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col; }',
            controls: []
          }
        ]
      })
    ).toEqual(['dslr-natural', 'c_mine01'])
  })

  it('migrates the old single custom slot', () => {
    const parsed = settingsSchema.parse({
      slideshow: {
        cameraLook: {
          enabledIds: ['dslr-natural', 'custom'],
          customFragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col; }'
        }
      }
    })
    expect(parsed.slideshow.cameraLook.customs).toEqual([
      {
        id: 'c_legacy',
        name: 'Custom',
        fragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col; }',
        controls: [defaultCameraLookCustomControl()]
      }
    ])
    expect(parsed.slideshow.cameraLook.enabledIds).toContain('c_legacy')
    expect(cameraLookRollPool(parsed.slideshow.cameraLook)).toContain('c_legacy')
  })

  it('has a fragment body for every catalog look', () => {
    for (const look of CAMERA_LOOKS) {
      const body = CAMERA_LOOK_BODIES[look.id]
      expect(body, look.id).toContain('vec3 apply')
      const source = cameraLookFragmentSource(body)
      expect(source).toContain('gl_FragColor')
      expect(source).not.toContain('readPixels')
    }
  })

  it('round-trips cameraLook through settings export', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        slideshow: {
          ...defaultSettings.slideshow,
          cameraLook: {
            enabled: true,
            frequencyPct: 35,
            enabledIds: ['high-iso', 'polaroid'],
            customFragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col; }',
            customs: [],
            params: {},
            pathFilter: ''
          }
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.slideshow.cameraLook).toEqual({
      enabled: true,
      frequencyPct: 35,
      enabledIds: ['high-iso', 'polaroid'],
      customFragment: '',
      customs: [
        {
          id: 'c_legacy',
          name: 'Custom',
          fragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col; }',
          controls: [defaultCameraLookCustomControl()]
        }
      ],
      params: {},
      pathFilter: ''
    })
  })

  it('resolves per-look controls and drops unknown overrides', () => {
    expect(cameraLookParamValues('handshake', {}).slice(0, 3)).toEqual([2.2, 0.25, 0])
    expect(
      cameraLookParamValues('dusty-lens', {
        'dusty-lens': { minCount: 0, maxCount: 4, minSize: 12, nope: 9 }
      }).slice(0, 4)
    ).toEqual([0, 4, 12, 48])
    const parsed = settingsSchema.parse({
      slideshow: {
        cameraLook: {
          params: { handshake: { length: 3.5, direction: 1 }, missing: { length: 9 } }
        }
      }
    })
    expect(parsed.slideshow.cameraLook.params).toEqual({
      handshake: { length: 3.5, direction: 1 }
    })
    expect(settingsSchema.parse({}).slideshow.cameraLook.frequencyPct).toBe(0)
    expect(settingsSchema.parse({}).slideshow.cameraLook.enabled).toBe(false)
    expect(settingsSchema.parse({}).slideshow.cameraLook.pathFilter).toBe('')
    expect(
      settingsSchema.parse({ slideshow: { cameraLook: { enabled: false, frequencyPct: 80 } } }).slideshow
        .cameraLook.enabled
    ).toBe(false)
  })

  it('rolls a dusty-lens count between min and max for a slide index', () => {
    const seed = cameraLookSeedForIndex(0)
    expect(cameraLookDustCount(seed, 1, 1)).toBe(1)
    expect(cameraLookDustCount(seed, 4, 1)).toBe(cameraLookDustCount(seed, 1, 4))
    const low = cameraLookDustCount(seed, 1, 8)
    expect(low).toBeGreaterThan(1)
    expect(low).toBeLessThanOrEqual(8)
    const high = cameraLookDustCount(seed, 1, 32)
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThanOrEqual(32)
  })

  it('matches a path keyword, and backslashes pin a folder name', () => {
    const aiFolder = 'D:\\Photos\\AI\\set\\image.png'
    const aiLetters = 'D:\\Photos\\email\\image.png'
    const aiFile = 'D:\\Photos\\keep\\AI.png'
    expect(cameraLookPathMatches('', aiLetters)).toBe(true)
    expect(cameraLookPathMatches('  ', aiLetters)).toBe(true)
    expect(cameraLookPathMatches('AI', aiFolder)).toBe(true)
    expect(cameraLookPathMatches('ai', aiLetters)).toBe(true)
    expect(cameraLookPathMatches('\\AI\\', aiFolder)).toBe(true)
    expect(cameraLookPathMatches('/AI/', 'D:/Photos/AI/nested/image.png')).toBe(true)
    expect(cameraLookPathMatches('\\AI\\', 'D:\\AI\\image.png')).toBe(true)
    expect(cameraLookPathMatches('\\AI\\', aiLetters)).toBe(false)
    expect(cameraLookPathMatches('\\AI\\', 'D:\\Photos\\AIart\\image.png')).toBe(false)
    expect(cameraLookPathMatches('\\AI\\', aiFile)).toBe(false)
    const parsed = settingsSchema.parse({
      slideshow: { cameraLook: { pathFilter: '  \\AI\\  ' } }
    })
    expect(parsed.slideshow.cameraLook.pathFilter).toBe('\\AI\\')
  })

  it('rolls temperature between the coldest and warmest limits', () => {
    const seed = cameraLookSeedForIndex(0)
    const wide = cameraLookTemperature(seed, -1, 1)
    expect(wide).toBeGreaterThanOrEqual(-1)
    expect(wide).toBeLessThanOrEqual(1)
    expect(Math.abs(wide)).toBeGreaterThan(0.05)
    expect(cameraLookTemperature(seed, 0, 0)).toBe(0)
    expect(cameraLookTemperature(seed, 0.4, -0.2)).toBeCloseTo(cameraLookTemperature(seed, -0.2, 0.4), 5)
  })

  it('gives a new custom one slider and keeps the ones an old shader already uses', () => {
    const fresh = settingsSchema.parse({
      slideshow: {
        cameraLook: {
          customs: [{ id: 'c_mine01', name: 'Mine', fragment: '' }]
        }
      }
    })
    expect(fresh.slideshow.cameraLook.customs[0]?.controls).toEqual([defaultCameraLookCustomControl()])

    const legacy = settingsSchema.parse({
      slideshow: {
        cameraLook: {
          customs: [
            {
              id: 'c_mine01',
              name: 'Mine',
              fragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col * uP0 + uP2; }'
            }
          ],
          params: { c_mine01: { p0: 1.25, p1: 0.5 } }
        }
      }
    })
    expect(legacy.slideshow.cameraLook.customs[0]?.controls).toEqual([
      { name: 'uP0', min: 0, max: 2, default: 0 },
      { name: 'uP2', min: 0, max: 2, default: 0 }
    ])
    expect(legacy.slideshow.cameraLook.params).toEqual({ c_mine01: { uP0: 1.25 } })
    expect(cameraLookParamValues('c_mine01', legacy.slideshow.cameraLook.params, legacy.slideshow.cameraLook.customs)).toEqual([
      1.25,
      0
    ])
  })

  it('stores a custom slider name, range, and default', () => {
    const parsed = settingsSchema.parse({
      slideshow: {
        cameraLook: {
          customs: [
            {
              id: 'c_mine01',
              name: 'Mine',
              fragment: 'vec3 apply(vec2 p, vec3 col, float seed) { return col; }',
              controls: [
                { name: 'warmth', min: 1, max: -1, default: 5 },
                { name: 'float', min: 0, max: 1, default: 0 },
                { name: 'warmth', min: 0, max: 1, default: 0 },
                ...Array.from({ length: 8 }, (_, i) => ({
                  name: `v${i}`,
                  min: 0,
                  max: 10,
                  default: 0
                }))
              ]
            }
          ],
          params: { c_mine01: { warmth: 3 } }
        }
      }
    })
    const controls = parsed.slideshow.cameraLook.customs[0]?.controls ?? []
    expect(controls).toHaveLength(8)
    expect(controls[0]).toEqual({ name: 'warmth', min: -1, max: 1, default: 1 })
    expect(controls.map((control) => control.name)).not.toContain('float')
    expect(parsed.slideshow.cameraLook.params).toEqual({})
    const renamed = replaceCameraLookControls(
      parsed.slideshow.cameraLook,
      'c_mine01',
      controls.map((control, index) => (index === 0 ? { ...control, name: 'temp', default: 0 } : control)),
      { from: 'warmth', to: 'temp' }
    )
    renamed.params = { c_mine01: { warmth: 0.25 } }
    const moved = replaceCameraLookControls(renamed, 'c_mine01', renamed.customs[0]!.controls, {
      from: 'warmth',
      to: 'temp'
    })
    expect(moved.params.c_mine01).toEqual({ temp: 0.25 })
    const source = cameraLookFragmentSource('vec3 apply(vec2 p, vec3 col, float seed) { return col; }', [
      'temp',
      'uP0'
    ])
    expect(source).toContain('uniform float temp;')
    expect(source.match(/uniform float uP0;/g)).toHaveLength(1)
  })
})
