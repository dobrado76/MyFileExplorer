import { describe, expect, it } from 'vitest'
import {
  patchFilerobotCropSource,
  patchFilerobotResizeSource,
  patchFilerobotTextBoxSizeSource,
  patchFilerobotTextEditorFocusSource,
  patchFilerobotTextNodeSizeSource,
  restoreFilerobotTextSelectionSource
} from '../../scripts/filerobotPatches.mjs'

describe('patchFilerobotCropSource', () => {
  it('forces free-form crop (keepRatio off, all anchors)', () => {
    const src =
      'keepRatio:!B||!C,shiftBehavior:B||C?"none":"default",enabledAnchors:(B||C?void 0:["top-left","bottom-left","top-right","bottom-right"])'
    const out = patchFilerobotCropSource(src)
    expect(out).toContain('keepRatio:!1')
    expect(out).toContain('shiftBehavior:"none"')
    expect(out).toContain('enabledAnchors:void 0')
    expect(out).not.toContain('keepRatio:!B||!C')
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

describe('patchFilerobotTextBoxSizeSource', () => {
  it('keeps the dragged text box size and rectangle handles', () => {
    const src =
      'm=function c(){var e,f;if(j(),latest){NO_WIDTH_HEIGHT_ANNOTATIONS.includes(b.name)||(s.width=q,s.height=r),d(s,!0)}}'
    const out = patchFilerobotTextBoxSizeSource(src)
    expect(out.indexOf('textBox=textAnnotationWrappedRect')).toBeLessThan(out.indexOf('if(j()'))
    expect(out).toContain('s.autoWidth=!1,s.autoHeight=!1')
    expect(out).not.toContain('s.strokeWidth=2')
    expect(patchFilerobotTextBoxSizeSource(out)).toBe(out)
  })

  it('stops reading the preview rect after it is destroyed', () => {
    const src =
      'm=function c(){var e,f;if(j(),x){b.name===TOOLS_IDS.TEXT&&textAnnotationWrappedRect&&(s.x=textAnnotationWrappedRect.x(),s.y=textAnnotationWrappedRect.y(),s.width=Math.abs(textAnnotationWrappedRect.width()),s.height=Math.abs(textAnnotationWrappedRect.height()),s.autoWidth=!1,s.autoHeight=!1,s.strokeWidth=2)}}'
    const out = patchFilerobotTextBoxSizeSource(src)
    expect(out).toContain('textBox.width')
    expect(out.indexOf('textAnnotationWrappedRect.width()')).toBeLessThan(out.indexOf('if(j()'))
    expect(out.slice(out.indexOf('if(j()'))).not.toContain('textAnnotationWrappedRect')
    expect(out).not.toContain('strokeWidth=2')
    expect(patchFilerobotTextBoxSizeSource(out)).toBe(out)
  })
})

describe('patchFilerobotTextNodeSizeSource', () => {
  it('does not turn a missing text size into a zero box', () => {
    const src = 'o=a.width,p=void 0===o?0:o,q=a.height,r=void 0===q?0:q'
    const out = patchFilerobotTextNodeSizeSource(src)
    expect(out).toContain('p=null!=o&&0!==o?o:void 0')
    expect(out).toContain('r=null!=q&&0!==q?q:void 0')
    expect(patchFilerobotTextNodeSizeSource(out)).toBe(out)
  })
})

describe('restoreFilerobotTextSelectionSource', () => {
  it('keeps a new text box selected so the move handles stay', () => {
    const opened =
      'selectionsIds:l&&"Text"===o.name&&g?[]:void 0!==g&&g?[o.id]:a.selectionsIds,textIdOfEditableContent:l&&"Text"===o.name&&g?o.id:a.textIdOfEditableContent'
    const out = restoreFilerobotTextSelectionSource(`return {${opened}}`)
    expect(out).toContain('selectionsIds:void 0!==g&&g?[o.id]:a.selectionsIds')
    expect(out).not.toContain('textIdOfEditableContent:l&&"Text"===o.name')
    expect(restoreFilerobotTextSelectionSource(out)).toBe(out)
  })

  it('leaves a package that already keeps the selection unchanged', () => {
    const src = 'selectionsIds:void 0!==g&&g?[o.id]:a.selectionsIds'
    expect(restoreFilerobotTextSelectionSource(src)).toBe(src)
  })
})

describe('patchFilerobotTextEditorFocusSource', () => {
  it('focuses the annotation text box when it mounts', () => {
    const src =
      'C=useCallback(function(a){if(p.current=a,p.current){var b=document.createRange(),c=window.getSelection();b.selectNodeContents(p.current),b.collapse(!1),c.removeAllRanges(),c.addRange(b),q.current=p.current.innerText}},[])'
    const out = patchFilerobotTextEditorFocusSource(src)
    expect(out).toContain('p.current.focus()')
    expect(out).not.toContain('preventScroll')
    expect(patchFilerobotTextEditorFocusSource(out)).toBe(out)
  })

  it('replaces a focus call that blocked scrolling', () => {
    const src =
      'C=useCallback(function(a){if(p.current=a,p.current){p.current.focus({preventScroll:!0});var b=document.createRange()}}'
    const out = patchFilerobotTextEditorFocusSource(src)
    expect(out).toContain('p.current.focus();')
    expect(out).not.toContain('preventScroll')
  })
})
