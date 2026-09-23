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
