/**
 * LaMa ONNX inpainting (Carve lama_fp32, 512×512).
 * Runs in the renderer via onnxruntime-web (WASM).
 */

import * as ort from 'onnxruntime-web/wasm'
import { api, call } from './ipc'

const MODEL_SIZE = 512
/** Expand mask bbox so LaMa sees surrounding context. */
const BBOX_PAD = 64

let sessionPromise: Promise<ort.InferenceSession> | null = null
let sessionDevice: 'webgpu' | 'wasm' | null = null

export type LamaProgress = {
  phase: 'model' | 'infer' | 'done'
  message: string
}

function setWasmPaths(): void {
  // Electron CSP blocks CDN. Vite forbids dynamic import() of /public/*.mjs.
  // Serve ORT assets via privileged custom protocol from node_modules.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = 'mfe-ort://local/'
}

async function createSession(modelUrl: string): Promise<{
  session: ort.InferenceSession
  device: 'webgpu' | 'wasm'
}> {
  setWasmPaths()
  // LaMa’s FFC / FFT graph fails on ORT WebGPU (“Can't perform binary op on the given tensors”).
  // WASM is the reliable path for Carve lama_fp32.
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm']
  })
  return { session, device: 'wasm' }
}

export async function ensureLamaSession(
  onProgress?: (p: LamaProgress) => void
): Promise<{ device: 'webgpu' | 'wasm' }> {
  if (sessionPromise && sessionDevice) {
    await sessionPromise
    return { device: sessionDevice }
  }
  onProgress?.({ phase: 'model', message: 'Preparing remove model…' })
  const ensured = await call(api.fs.ensureLamaModel())
  onProgress?.({
    phase: 'model',
    message: ensured.downloaded
      ? 'Downloaded remove model — loading…'
      : 'Loading remove model…'
  })

  sessionPromise = (async () => {
    const { session, device } = await createSession(ensured.modelUrl)
    sessionDevice = device
    return session
  })()
  try {
    await sessionPromise
  } catch (e) {
    sessionPromise = null
    sessionDevice = null
    throw e
  }
  return { device: sessionDevice! }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image for remove'))
    img.src = src
  })
}

type BBox = { x0: number; y0: number; x1: number; y1: number }

function maskBBox(mask: Uint8ClampedArray, w: number, h: number): BBox | null {
  let x0 = w
  let y0 = h
  let x1 = 0
  let y1 = 0
  let found = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = mask[(y * w + x) * 4 + 3]!
      if (a > 16) {
        found = true
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (!found) return null
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

function expandSquareBBox(bbox: BBox, imgW: number, imgH: number, pad: number): BBox {
  let x0 = Math.max(0, bbox.x0 - pad)
  let y0 = Math.max(0, bbox.y0 - pad)
  let x1 = Math.min(imgW, bbox.x1 + pad)
  let y1 = Math.min(imgH, bbox.y1 + pad)
  const side = Math.max(x1 - x0, y1 - y0, 32)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  x0 = Math.round(cx - side / 2)
  y0 = Math.round(cy - side / 2)
  x1 = x0 + side
  y1 = y0 + side
  if (x0 < 0) {
    x1 -= x0
    x0 = 0
  }
  if (y0 < 0) {
    y1 -= y0
    y0 = 0
  }
  if (x1 > imgW) {
    x0 = Math.max(0, x0 - (x1 - imgW))
    x1 = imgW
  }
  if (y1 > imgH) {
    y0 = Math.max(0, y0 - (y1 - imgH))
    y1 = imgH
  }
  const s = Math.min(x1 - x0, y1 - y0)
  return { x0, y0, x1: x0 + s, y1: y0 + s }
}

function canvasToImageCHW(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const { data } = ctx.getImageData(0, 0, size, size)
  const out = new Float32Array(1 * 3 * size * size)
  const plane = size * size
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = data[i]! / 255
    out[plane + p] = data[i + 1]! / 255
    out[2 * plane + p] = data[i + 2]! / 255
  }
  return out
}

function canvasToMaskCHW(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const { data } = ctx.getImageData(0, 0, size, size)
  const out = new Float32Array(1 * 1 * size * size)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3]!
    const r = data[i]!
    out[p] = a > 16 || r > 16 ? 1 : 0
  }
  return out
}

function outputToImageData(output: ort.Tensor, size: number): ImageData {
  const data = output.data as Float32Array
  const rgba = new Uint8ClampedArray(size * size * 4)
  const plane = size * size
  let maxAbs = 0
  for (let i = 0; i < Math.min(plane, 4096); i++) {
    maxAbs = Math.max(maxAbs, Math.abs(data[i] ?? 0))
  }
  const scale = maxAbs <= 1.5 ? 255 : 1
  for (let p = 0; p < plane; p++) {
    const r = Math.min(255, Math.max(0, Math.round((data[p] ?? 0) * scale)))
    const g = Math.min(255, Math.max(0, Math.round((data[plane + p] ?? 0) * scale)))
    const b = Math.min(255, Math.max(0, Math.round((data[2 * plane + p] ?? 0) * scale)))
    const o = p * 4
    rgba[o] = r
    rgba[o + 1] = g
    rgba[o + 2] = b
    rgba[o + 3] = 255
  }
  return new ImageData(rgba, size, size)
}

/**
 * Inpaint masked regions of `imageSrc` (data URL).
 * `maskCanvas` must match natural image pixel size.
 */
export async function runLamaInpaint(opts: {
  imageSrc: string
  maskCanvas: HTMLCanvasElement
  onProgress?: (p: LamaProgress) => void
}): Promise<string> {
  const { imageSrc, maskCanvas, onProgress } = opts
  const { device } = await ensureLamaSession(onProgress)
  onProgress?.({
    phase: 'infer',
    message: `Removing… (${device === 'webgpu' ? 'GPU' : 'CPU'})`
  })

  const session = await sessionPromise!
  const img = await loadImage(imageSrc)
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    throw new Error('Mask size does not match image')
  }

  const maskCtx = maskCanvas.getContext('2d')
  if (!maskCtx) throw new Error('No mask context')
  const maskData = maskCtx.getImageData(0, 0, w, h)
  const bbox = maskBBox(maskData.data, w, h)
  if (!bbox) throw new Error('Paint over the area to remove first')

  const crop = expandSquareBBox(bbox, w, h, BBOX_PAD)
  const cw = crop.x1 - crop.x0
  const ch = crop.y1 - crop.y0

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = MODEL_SIZE
  cropCanvas.height = MODEL_SIZE
  const cropCtx = cropCanvas.getContext('2d')!
  cropCtx.imageSmoothingEnabled = true
  cropCtx.imageSmoothingQuality = 'high'
  cropCtx.drawImage(img, crop.x0, crop.y0, cw, ch, 0, 0, MODEL_SIZE, MODEL_SIZE)

  const maskCrop = document.createElement('canvas')
  maskCrop.width = MODEL_SIZE
  maskCrop.height = MODEL_SIZE
  const maskCropCtx = maskCrop.getContext('2d')!
  maskCropCtx.imageSmoothingEnabled = false
  maskCropCtx.drawImage(maskCanvas, crop.x0, crop.y0, cw, ch, 0, 0, MODEL_SIZE, MODEL_SIZE)

  const imageTensor = new ort.Tensor('float32', canvasToImageCHW(cropCtx, MODEL_SIZE), [
    1,
    3,
    MODEL_SIZE,
    MODEL_SIZE
  ])
  const maskTensor = new ort.Tensor('float32', canvasToMaskCHW(maskCropCtx, MODEL_SIZE), [
    1,
    1,
    MODEL_SIZE,
    MODEL_SIZE
  ])

  const results = await session.run({ image: imageTensor, mask: maskTensor })
  const outName = session.outputNames[0] ?? Object.keys(results)[0]!
  const outTensor = results[outName]!
  const outImage = outputToImageData(outTensor, MODEL_SIZE)

  const outCrop = document.createElement('canvas')
  outCrop.width = MODEL_SIZE
  outCrop.height = MODEL_SIZE
  outCrop.getContext('2d')!.putImageData(outImage, 0, 0)

  const full = document.createElement('canvas')
  full.width = w
  full.height = h
  const fullCtx = full.getContext('2d')!
  fullCtx.drawImage(img, 0, 0)

  const scaled = document.createElement('canvas')
  scaled.width = cw
  scaled.height = ch
  const scaledCtx = scaled.getContext('2d')!
  scaledCtx.imageSmoothingEnabled = true
  scaledCtx.imageSmoothingQuality = 'high'
  scaledCtx.drawImage(outCrop, 0, 0, MODEL_SIZE, MODEL_SIZE, 0, 0, cw, ch)

  // Paste inpainted pixels only where the user masked — use a *binary* alpha.
  // The on-screen mask is semi-transparent (so you can see the photo); if we
  // destination-in with that alpha, ~15% of the original bleeds through.
  const alpha = document.createElement('canvas')
  alpha.width = cw
  alpha.height = ch
  const alphaCtx = alpha.getContext('2d')!
  alphaCtx.drawImage(maskCanvas, crop.x0, crop.y0, cw, ch, 0, 0, cw, ch)
  const alphaImg = alphaCtx.getImageData(0, 0, cw, ch)
  const px = alphaImg.data
  for (let i = 0; i < px.length; i += 4) {
    const on = px[i + 3]! > 16 || px[i]! > 16 ? 255 : 0
    px[i] = 255
    px[i + 1] = 255
    px[i + 2] = 255
    px[i + 3] = on
  }
  alphaCtx.putImageData(alphaImg, 0, 0)

  const patch = document.createElement('canvas')
  patch.width = cw
  patch.height = ch
  const patchCtx = patch.getContext('2d')!
  patchCtx.drawImage(scaled, 0, 0)
  patchCtx.globalCompositeOperation = 'destination-in'
  patchCtx.drawImage(alpha, 0, 0)

  fullCtx.drawImage(patch, crop.x0, crop.y0)

  onProgress?.({ phase: 'done', message: 'Remove applied' })
  return full.toDataURL('image/png')
}
