import { isCameraLookControlName } from '@shared/cameraLook'
import {
  CAMERA_LOOK_PLAIN_BODY,
  cameraLookFragmentBody,
  cameraLookFragmentSource
} from './cameraLookShaders'

/**
 * One textured quad. No readback. Programs compile once per shader id.
 * Framebuffer long edge is capped so a 20 fps slideshow stays a single cheap pass.
 */

const MAX_TEXTURE_EDGE = 2048
const MAX_FRAME_EDGE = 2560
const MAX_DPR = 1.5

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const PARAM_SLOTS = 6
const PLAIN_ID = '__plain__'

type Prog = {
  program: WebGLProgram
  uTexel: WebGLUniformLocation | null
  uFit: WebGLUniformLocation | null
  uSeed: WebGLUniformLocation | null
  uP: (WebGLUniformLocation | null)[]
  named: Map<string, WebGLUniformLocation | null>
  key: string
}

type Surface = {
  gl: WebGLRenderingContext
  tex: WebGLTexture
  buf: WebGLBuffer
  programs: Map<string, Prog>
}

const surfaces = new WeakMap<HTMLCanvasElement, Surface>()

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | string {
  const shader = gl.createShader(type)
  if (!shader) return 'Could not create shader'
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'compile failed'
    gl.deleteShader(shader)
    return log
  }
  return shader
}

export function cameraLookCompileError(body: string, uniformNames: readonly string[] = []): string | null {
  if (typeof document === 'undefined') return 'No document'
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    failIfMajorPerformanceCaveat: false
  })
  if (!gl) return 'WebGL unavailable'
  const frag = compile(gl, gl.FRAGMENT_SHADER, cameraLookFragmentSource(body, uniformNames))
  const vert = compile(gl, gl.VERTEX_SHADER, VERT)
  if (typeof frag === 'string') {
    if (typeof vert !== 'string') gl.deleteShader(vert)
    return frag
  }
  if (typeof vert === 'string') {
    gl.deleteShader(frag)
    return vert
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(frag)
    gl.deleteShader(vert)
    return 'Could not create program'
  }
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS)
  const log = linked ? null : gl.getProgramInfoLog(program) || 'link failed'
  gl.deleteProgram(program)
  gl.deleteShader(frag)
  gl.deleteShader(vert)
  return log
}

function surfaceFor(canvas: HTMLCanvasElement): Surface | null {
  const existing = surfaces.get(canvas)
  if (existing && !existing.gl.isContextLost()) return existing
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false
  })
  if (!gl) return null
  const tex = gl.createTexture()
  const buf = gl.createBuffer()
  if (!tex || !buf) return null
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const surface: Surface = { gl, tex, buf, programs: new Map() }
  surfaces.set(canvas, surface)
  return surface
}

function programFor(
  surface: Surface,
  shaderId: string,
  body: string,
  uniformNames: readonly string[] = []
): Prog | string {
  const key = `${shaderId}:${hashBody(body)}:${uniformNames.join(',')}`
  const cached = surface.programs.get(shaderId)
  if (cached && cached.key === key) return cached
  if (cached) {
    surface.gl.deleteProgram(cached.program)
    surface.programs.delete(shaderId)
  }
  const gl = surface.gl
  const frag = compile(gl, gl.FRAGMENT_SHADER, cameraLookFragmentSource(body, uniformNames))
  const vert = compile(gl, gl.VERTEX_SHADER, VERT)
  if (typeof frag === 'string') {
    if (typeof vert !== 'string') gl.deleteShader(vert)
    return frag
  }
  if (typeof vert === 'string') {
    gl.deleteShader(frag)
    return vert
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(frag)
    gl.deleteShader(vert)
    return 'Could not create program'
  }
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  gl.deleteShader(frag)
  gl.deleteShader(vert)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'link failed'
    gl.deleteProgram(program)
    return log
  }
  const named = new Map<string, WebGLUniformLocation | null>()
  for (const name of uniformNames) {
    if (!isCameraLookControlName(name)) continue
    named.set(name, gl.getUniformLocation(program, name))
  }
  const prog: Prog = {
    program,
    uTexel: gl.getUniformLocation(program, 'uTexel'),
    uFit: gl.getUniformLocation(program, 'uFit'),
    uSeed: gl.getUniformLocation(program, 'uSeed'),
    uP: Array.from({ length: PARAM_SLOTS }, (_, i) => gl.getUniformLocation(program, `uP${i}`)),
    named,
    key
  }
  surface.programs.set(shaderId, prog)
  return prog
}

function hashBody(body: string): number {
  let h = 2166136261
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function frameSize(canvas: HTMLCanvasElement): { w: number; h: number } | null {
  const rect = canvas.getBoundingClientRect()
  let width = rect.width
  let height = rect.height
  if (width < 2 || height < 2) {
    const parent = canvas.parentElement
    if (parent) {
      width = parent.clientWidth
      height = parent.clientHeight
    }
  }
  if (width < 2 || height < 2) return null
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  let w = Math.max(1, Math.round(width * dpr))
  let h = Math.max(1, Math.round(height * dpr))
  const down = Math.min(1, MAX_FRAME_EDGE / Math.max(w, h))
  w = Math.max(1, Math.round(w * down))
  h = Math.max(1, Math.round(h * down))
  return { w, h }
}

async function uploadSource(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number
): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (sourceW <= MAX_TEXTURE_EDGE && sourceH <= MAX_TEXTURE_EDGE) {
    return { src: source, w: sourceW, h: sourceH, close: () => {} }
  }
  const scale = MAX_TEXTURE_EDGE / Math.max(sourceW, sourceH)
  const w = Math.max(1, Math.round(sourceW * scale))
  const h = Math.max(1, Math.round(sourceH * scale))
  try {
    const bmp = await createImageBitmap(source, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'low'
    })
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
  } catch {
    return { src: source, w: sourceW, h: sourceH, close: () => {} }
  }
}

/**
 * Draw one look into `canvas`. Returns false when WebGL or the shader is unavailable
 * so the caller can keep the plain image.
 */
export async function drawCameraLook(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  shaderId: string,
  seed: number,
  customFragment: string,
  params: readonly number[] = [],
  isCurrent: () => boolean = () => true,
  /** Set for a custom look. Values line up with these uniform names. Omit for a built-in. */
  uniformNames?: readonly string[]
): Promise<boolean> {
  if (sourceW < 1 || sourceH < 1) return false
  const requested = cameraLookFragmentBody(shaderId, customFragment)
  const body = requested ?? CAMERA_LOOK_PLAIN_BODY
  const programId = requested ? shaderId : PLAIN_ID
  const size = frameSize(canvas)
  if (!size) return false
  const surface = surfaceFor(canvas)
  if (!surface) return false
  let plain = !requested
  let prog = programFor(surface, programId, body, requested ? (uniformNames ?? []) : [])
  if (typeof prog === 'string') {
    if (!requested) return false
    plain = true
    prog = programFor(surface, PLAIN_ID, CAMERA_LOOK_PLAIN_BODY, [])
    if (typeof prog === 'string') return false
  }

  let uploaded: { src: CanvasImageSource; w: number; h: number; close: () => void } | null = null
  try {
    uploaded = await uploadSource(source, sourceW, sourceH)
    if (!isCurrent()) return false
    const gl = surface.gl
    if (gl.isContextLost()) return false
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w
      canvas.height = size.h
    }
    gl.viewport(0, 0, size.w, size.h)
    gl.useProgram(prog.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, surface.buf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, surface.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const texSrc = toTexImageSource(uploaded.src)
    if (!texSrc) return false
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texSrc)
    const fit = containFit(size.w, size.h, uploaded.w, uploaded.h)
    gl.uniform1i(gl.getUniformLocation(prog.program, 'uTex'), 0)
    gl.uniform2f(prog.uTexel, 1 / uploaded.w, 1 / uploaded.h)
    gl.uniform4f(prog.uFit, fit.sx, fit.sy, fit.ox, fit.oy)
    gl.uniform1f(prog.uSeed, seed)
    if (!plain && uniformNames) {
      for (let i = 0; i < uniformNames.length; i++) {
        const loc = prog.named.get(uniformNames[i]!)
        if (loc) gl.uniform1f(loc, params[i] ?? 0)
      }
    } else if (!plain) {
      for (let i = 0; i < prog.uP.length; i++) {
        const loc = prog.uP[i]
        if (loc) gl.uniform1f(loc, params[i] ?? 0)
      }
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  } catch {
    return false
  } finally {
    uploaded?.close()
  }
}

function toTexImageSource(src: CanvasImageSource): TexImageSource | null {
  if (typeof SVGImageElement !== 'undefined' && src instanceof SVGImageElement) return null
  return src as TexImageSource
}

export function cameraLookSourceSize(source: CanvasImageSource): { w: number; h: number } | null {
  if (source instanceof HTMLImageElement) {
    if (source.naturalWidth < 1 || source.naturalHeight < 1) return null
    return { w: source.naturalWidth, h: source.naturalHeight }
  }
  if (source instanceof HTMLCanvasElement || source instanceof ImageBitmap) {
    if (source.width < 1 || source.height < 1) return null
    return { w: source.width, h: source.height }
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    if (source.width < 1 || source.height < 1) return null
    return { w: source.width, h: source.height }
  }
  return null
}

/** Origin-clean bitmap for the media protocol. Display <img> tags stay untouched. */
export async function loadCameraLookSource(url: string): Promise<CanvasImageSource | null> {
  if (!url) return null
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await decodeHtmlImage(img)
      return img.naturalWidth > 0 ? img : null
    } catch {
      return null
    }
  }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.src = url
    await decodeHtmlImage(img)
    if (img.naturalWidth > 0) return img
  } catch {
    /* fall through to fetch */
  }
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob())
    if (bmp.width < 1 || bmp.height < 1) {
      bmp.close()
      return null
    }
    return bmp
  } catch {
    return null
  }
}

function decodeHtmlImage(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === 'function') return img.decode()
  return new Promise((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('load'))
  })
}

export function releaseCameraLookSource(source: CanvasImageSource | null): void {
  if (source instanceof ImageBitmap) {
    try {
      source.close()
    } catch {
      /* already closed */
    }
  }
}

/** Compile enabled looks once so the first image that uses one does not pay link time. */
export function warmCameraLookPrograms(
  canvas: HTMLCanvasElement,
  ids: readonly string[],
  fragmentFor: (id: string) => string,
  uniformsFor?: (id: string) => readonly string[]
): void {
  const surface = surfaceFor(canvas)
  if (!surface) return
  for (const id of ids) {
    const body = cameraLookFragmentBody(id, fragmentFor(id))
    if (!body) continue
    programFor(surface, id, body, uniformsFor?.(id) ?? [])
  }
}

function containFit(
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number
): { sx: number; sy: number; ox: number; oy: number } {
  const s = Math.min(canvasW / imgW, canvasH / imgH)
  const dw = imgW * s
  const dh = imgH * s
  return {
    sx: dw / canvasW,
    sy: dh / canvasH,
    ox: (canvasW - dw) / 2 / canvasW,
    oy: (canvasH - dh) / 2 / canvasH
  }
}
