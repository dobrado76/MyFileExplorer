/**
 * Pure string transforms for Filerobot patches (also used by unit tests).
 */

export function patchFilerobotCropSource(src) {
  let out = src
  out = out.replace(/keepRatio:!B\d*\s*\|\|\s*!C\d*/g, 'keepRatio:!1')
  out = out.replace(/keepRatio:!\(\s*B\d*\s*\|\|\s*C\d*\s*\)/g, 'keepRatio:!1')
  out = out.replace(/!\(\s*B\d*\s*\|\|\s*C\d*\s*\)\s*&&\s*D\(\)/g, '!1')
  out = out.replace(
    /shiftBehavior:\s*B\d*\s*\|\|\s*C\d*\s*\?\s*"none"\s*:\s*"default"/g,
    'shiftBehavior:"none"'
  )
  if (out.includes('keepRatio:!1') && !out.includes('shiftBehavior:"none"')) {
    out = out.replace(/keepRatio:!1,/, 'keepRatio:!1,shiftBehavior:"none",')
  }
  out = out.replace(
    /\(\s*B\d*\s*\|\|\s*C\d*\s*\?\s*void 0\s*:\s*\["top-left","bottom-left","top-right","bottom-right"\]\s*\)/g,
    'void 0'
  )
  // A parent re-render mid-drag used to reattach the transformer and write the
  // last saved box back over the live Konva node, so handles jumped to where
  // the gesture started. Hold the live node until mouseup.
  if (!out.includes('cropGesture=useRef(!1)')) {
    out = out.replace(
      'r=useRef(),s=useRef(),t=useRef(),u=useRef()',
      'r=useRef(),s=useRef(),t=useRef(),u=useRef(),cropGesture=useRef(!1),nodesHold=useRef([])'
    )
    out = out.replace(
      'return e&&s.current&&r.current&&',
      'return e&&s.current&&r.current&&!cropGesture.current&&'
    )
    out = out.replace(
      'useEffect(function(){if(g&&(u.current=g,"undefined"!=typeof g.x&&g.width))',
      'useEffect(function(){if(cropGesture.current)return;if(g&&(u.current=g,"undefined"!=typeof g.x&&g.width))'
    )
    out = out.replace(
      'var L=G,M=L.x,N=void 0===M?0:M,x=L.y,O=void 0===x?0:x,y=L.width,P=L.height,Q={',
      'var L=G,M=L.x,N=void 0===M?0:M,x=L.y,O=void 0===x?0:x,y=L.width,P=L.height;if(r.current&&nodesHold.current[0]!==r.current)nodesHold.current=[r.current];var liveCrop=cropGesture.current&&r.current?r.current:null,cropScaleX=liveCrop?liveCrop.scaleX():1,cropScaleY=liveCrop?liveCrop.scaleY():1;if(liveCrop){N=liveCrop.x();O=liveCrop.y();if(!C){y=liveCrop.width();P=liveCrop.height()}}var Q={'
    )
    out = out.replace('scaleX:1,scaleY:1', 'scaleX:cropScaleX,scaleY:cropScaleY')
    out = out.replace(
      'onDragEnd:z?void 0:I,',
      'onDragStart:z?void 0:function(){cropGesture.current=!0},onDragEnd:z?void 0:function(a){cropGesture.current=!1;I(a)},'
    )
    out = out.replace(
      'onTransformEnd:z?void 0:I,',
      'onTransformStart:z?void 0:function(){cropGesture.current=!0},onTransformEnd:z?void 0:function(a){var n=a.target;if(n){var bw=n.width()*n.scaleX(),bh=n.height()*n.scaleY();n.scaleX(1);n.scaleY(1);n.width(bw);n.height(bh)}cropGesture.current=!1;I(a)},'
    )
    out = out.replace('nodes:r.current?[r.current]:[]', 'nodes:nodesHold.current')
  }
  // Already-patched files split `var …,Q={` into a bare `Q=` (implicit global).
  // Vite’s prebundle is strict, so that throws and the crop canvas never mounts.
  out = out.replace('}Q={', '}var Q={')
  // Konva's crop dim is a full-window Blur+Brighten, and those filters re-run
  // (getImageData) whenever brightness is set. Dim with opacity instead.
  out = out.replace(
    'customFilters:[Konva.Filters.Blur,Konva.Filters.Brighten],customFinetuneProps:{blurRadius:10,brightness:-.15}',
    'customFilters:[],customFinetuneProps:{opacity:.45}'
  )
  return out
}

/**
 * Replace original-file ratio (`getSizeAfterRotation(original…)`) with the
 * dimensions already shown in the Width/Height fields (`s`).
 */
export function patchFilerobotResizeSource(src) {
  let out = src
  out = out.replace(
    /var h=Math\.min\(10\*j\.width,10\*j\.height\),m=getSizeAfterRotation\(j\.width,j\.height,p\),o="height"===f/,
    'var h=Math.min(10*j.width,10*j.height),o="height"===f'
  )
  out = out.replace(
    /if\(!t\)\{var u=m\.width\/m\.height;r\[q\]=o\?Math\.round\(r\[f\]\*u\):Math\.round\(r\[f\]\/u\)\}/g,
    'if(!t&&s.height){var u=s.width/s.height;r[q]=o?Math.round(Number(r[f])*u):Math.round(Number(r[f])/u)}'
  )
  return out
}

/**
 * Undo the short-lived change that opened a new text box for typing.
 * That mode clears the selection, so the move and resize handles never appear.
 * A new text box stays selected, same as a rectangle.
 */
export function restoreFilerobotTextSelectionSource(src) {
  const opened =
    'selectionsIds:l&&"Text"===o.name&&g?[]:void 0!==g&&g?[o.id]:a.selectionsIds,textIdOfEditableContent:l&&"Text"===o.name&&g?o.id:a.textIdOfEditableContent'
  if (!src.includes(opened)) return src
  return src.replace(opened, 'selectionsIds:void 0!==g&&g?[o.id]:a.selectionsIds')
}

/**
 * The drag outline is a preview rect. Measure it before the preview is destroyed,
 * and save that rectangle with the same move/resize handles as a rectangle.
 * Stroke stays off — a stroke on this node outlines the letters, not the box.
 */
export function patchFilerobotTextBoxSizeSource(src) {
  const captured =
    'textBox=textAnnotationWrappedRect&&{x:textAnnotationWrappedRect.x(),y:textAnnotationWrappedRect.y(),width:Math.abs(textAnnotationWrappedRect.width())||0,height:Math.abs(textAnnotationWrappedRect.height())||0}'
  const save =
    'b.name===TOOLS_IDS.TEXT&&textBox&&textBox.width>=MIN_PIXELS&&textBox.height>=MIN_PIXELS&&(s.x=textBox.x,s.y=textBox.y,s.width=textBox.width,s.height=textBox.height,s.autoWidth=!1,s.autoHeight=!1)'
  let out = src
  if (!out.includes(captured)) {
    const needle = 'm=function c(){var e,f;if(j(),'
    if (!out.includes(needle)) return src
    out = out.replace(needle, `m=function c(){var e,f,${captured};if(j(),`)
  }
  const afterDestroy =
    'b.name===TOOLS_IDS.TEXT&&textAnnotationWrappedRect&&(s.x=textAnnotationWrappedRect.x(),s.y=textAnnotationWrappedRect.y(),s.width=Math.abs(textAnnotationWrappedRect.width()),s.height=Math.abs(textAnnotationWrappedRect.height()),s.autoWidth=!1,s.autoHeight=!1,s.strokeWidth=2)'
  if (out.includes(afterDestroy)) out = out.replace(afterDestroy, save)
  const original = 'NO_WIDTH_HEIGHT_ANNOTATIONS.includes(b.name)||(s.width=q,s.height=r),d(s,!0)'
  if (out.includes(original) && !out.includes(save)) {
    out = out.replace(
      original,
      `NO_WIDTH_HEIGHT_ANNOTATIONS.includes(b.name)||(s.width=q,s.height=r),${save},d(s,!0)`
    )
  }
  return out
}

/** Height 0 makes FormattedText draw no glyphs. Missing size stays auto. */
export function patchFilerobotTextNodeSizeSource(src) {
  const applied = 'p=null!=o&&0!==o?o:void 0'
  if (src.includes(applied)) return src
  const needle = 'o=a.width,p=void 0===o?0:o,q=a.height,r=void 0===q?0:q'
  if (!src.includes(needle)) return src
  return src.replace(
    needle,
    'o=a.width,p=null!=o&&0!==o?o:void 0,q=a.height,r=null!=q&&0!==q?q:void 0'
  )
}

/** The annotation text box is mounted without being focused. */
export function patchFilerobotTextEditorFocusSource(src) {
  const migrated = src.replaceAll('p.current.focus({preventScroll:!0});', '')
  if (migrated.includes('p.current.focus()')) return migrated
  const needle =
    'C=useCallback(function(a){if(p.current=a,p.current){var b=document.createRange()'
  if (!migrated.includes(needle)) return migrated
  return migrated.replace(
    needle,
    'C=useCallback(function(a){if(p.current=a,p.current){p.current.focus();var b=document.createRange()'
  )
}
