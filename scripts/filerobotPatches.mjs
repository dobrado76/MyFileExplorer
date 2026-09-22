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
  // A parent re-render mid-drag (app store, new Crop config) used to reattach the
  // transformer and write the last saved box back over the live Konva node, so
  // handles jumped to where the gesture started. Hold the live node until mouseup.
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
      'var L=G,M=L.x,N=void 0===M?0:M,x=L.y,O=void 0===x?0:x,y=L.width,P=L.height;if(r.current&&nodesHold.current[0]!==r.current)nodesHold.current=[r.current];var liveCrop=cropGesture.current&&r.current?r.current:null,cropScaleX=liveCrop?liveCrop.scaleX():1,cropScaleY=liveCrop?liveCrop.scaleY():1;if(liveCrop){N=liveCrop.x();O=liveCrop.y();if(!C){y=liveCrop.width();P=liveCrop.height()}}Q={'
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
