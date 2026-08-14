import { describe, expect, it } from 'vitest'
import { resolveModel3dMediaUrl } from '../renderer/lib/model3dUrl'

describe('resolveModel3dMediaUrl', () => {
  const model = 'D:\\Assets\\Hero.fbx'

  it('keeps mfe-media query path (does not 403 as mfe-media://local/)', () => {
    const url = `mfe-media://local/?p=${encodeURIComponent(model)}&v=1`
    expect(resolveModel3dMediaUrl(model, url)).toBe(url)
  })

  it('maps a relative texture next to the model', () => {
    const out = resolveModel3dMediaUrl(model, 'Hero.png')
    expect(out).toBe(`mfe-media://local/?p=${encodeURIComponent('D:\\Assets\\Hero.png')}`)
  })

  it('maps three.js base+name leftovers under mfe-media://local/foo.png', () => {
    const out = resolveModel3dMediaUrl(model, 'mfe-media://local/Hero.png')
    expect(out).toBe(`mfe-media://local/?p=${encodeURIComponent('D:\\Assets\\Hero.png')}`)
  })
})
