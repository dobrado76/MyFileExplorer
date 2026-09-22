import { describe, expect, it } from 'vitest'
import { patchFilerobotResizeSource } from '../../scripts/filerobotPatches.mjs'

describe('patchFilerobotResizeSource', () => {
  it('locks ratio to current dimensions (s), not original file (m)', () => {
    const src =
      'var h=Math.min(10*j.width,10*j.height),m=getSizeAfterRotation(j.width,j.height,p),o="height"===f,q=o?"width":"height",r=_defineProperty(_defineProperty({},f,g?restrictNumber(g,0,h):g),q,s[q]),t=k.ratioUnlocked;if(!t){var u=m.width/m.height;r[q]=o?Math.round(r[f]*u):Math.round(r[f]/u)}'
    const out = patchFilerobotResizeSource(src)
    expect(out).toContain('s.width/s.height')
    expect(out).not.toContain('m.width/m.height')
    expect(out).not.toContain('getSizeAfterRotation(j.width,j.height,p)')
    expect(out).toContain('Number(r[f])')
  })
})
