import { describe, expect, it } from 'vitest'
import {
  patchFilerobotCropSource,
  patchFilerobotResizeSource
} from '../../scripts/filerobotPatches.mjs'

const CROP_FIXTURE = [
  'r=useRef(),s=useRef(),t=useRef(),u=useRef(),v=p',
  'useEffect(function(){return e&&s.current&&r.current&&(t.current&&t.current.cache(),s.current.nodes([r.current])),function(){t.current&&t.current.clearCache()}},[e,f,g])',
  'useEffect(function(){if(g&&(u.current=g,"undefined"!=typeof g.x&&g.width)){var a,b;F(1)}},[A,g,w])',
  'var L=G,M=L.x,N=void 0===M?0:M,x=L.y,O=void 0===x?0:x,y=L.width,P=L.height,Q={x:N,y:O,ref:r,fill:"#FFFFFF",scaleX:1,scaleY:1,globalCompositeOperation:"destination-out",onDragEnd:z?void 0:I,onDragMove:z?void 0:function b(a){var c=a.target;c.setAttrs(boundDragging(c.attrs,u.current))},onTransformEnd:z?void 0:I,draggable:!z}',
  'nodes:r.current?[r.current]:[],keepRatio:!B||!C,shiftBehavior:B||C?"none":"default"'
].join('')

describe('patchFilerobotCropSource', () => {
  it('keeps the live crop box while a handle drag is in progress', () => {
    const out = patchFilerobotCropSource(CROP_FIXTURE)
    expect(out).toContain('cropGesture=useRef(!1)')
    expect(out).toContain('if(cropGesture.current)return')
    expect(out).toContain('!cropGesture.current&&')
    expect(out).toContain('nodes:nodesHold.current')
    expect(out).toContain('scaleX:cropScaleX,scaleY:cropScaleY')
    expect(out).toContain('onTransformStart:')
    expect(out).not.toContain('nodes:r.current?[r.current]:[]')
    expect(patchFilerobotCropSource(out)).toBe(out)
  })
})

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
