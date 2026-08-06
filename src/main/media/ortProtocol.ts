import { protocol, app } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { logMain } from '../logging'

export const ORT_SCHEME = 'mfe-ort'

const ALLOWED = new Set([
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs'
])

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript'
}

function ortDistDir(): string {
  // Dev: repo node_modules. Packaged: app.asar/node_modules (dependency).
  return join(app.getAppPath(), 'node_modules', 'onnxruntime-web', 'dist')
}

/** Serve onnxruntime-web WASM/MJS from node_modules (avoids Vite /public import trap). */
export function registerOrtProtocolHandler(): void {
  protocol.handle(ORT_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const name = basename(url.pathname)
      if (!ALLOWED.has(name)) {
        return new Response('Not found', { status: 404 })
      }
      const full = join(ortDistDir(), name)
      if (!existsSync(full)) {
        logMain('warn', `ORT asset missing: ${full}`)
        return new Response('Not found', { status: 404 })
      }
      const data = await readFile(full)
      const mime = MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch (err) {
      logMain('warn', `ort protocol error: ${err instanceof Error ? err.message : String(err)}`)
      return new Response('ORT asset unavailable', { status: 500 })
    }
  })
}

/** Prefix for `ort.env.wasm.wasmPaths` (ORT appends filenames). */
export function ortWasmPathsPrefix(): string {
  return `${ORT_SCHEME}://local/`
}
