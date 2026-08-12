/**
 * Worker thread: SHGetFileInfo + PNG encode off the Electron UI thread.
 * Used for Dropbox / OneDrive / mapped-drive icons that can hang for seconds.
 *
 * Messages in:  { id, file, px }
 * Messages out: { id, ok: true, png: Uint8Array } | { id, ok: false, error?: string }
 */
import { parentPort } from 'node:worker_threads'

parentPort?.on('message', (msg: unknown) => {
  if (!msg || typeof msg !== 'object') return
  const m = msg as { id?: number; file?: string; px?: number }
  if (typeof m.id !== 'number' || typeof m.file !== 'string' || typeof m.px !== 'number') return
  const id = m.id
  const file = m.file
  const px = m.px <= 20 ? 16 : 32

  void (async () => {
    try {
      const { extractShellIconRgba } = await import('./shellWin32')
      const rgba = extractShellIconRgba(file, px)
      if (!rgba) {
        parentPort?.postMessage({ id, ok: false })
        return
      }
      const side = Math.round(Math.sqrt(rgba.length / 4))
      const { default: sharp } = await import('sharp')
      const png = await sharp(rgba, {
        raw: { width: side > 0 ? side : px, height: side > 0 ? side : px, channels: 4 }
      })
        .png()
        .toBuffer()
      parentPort?.postMessage({ id, ok: true, png })
    } catch (e) {
      parentPort?.postMessage({
        id,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  })()
})
