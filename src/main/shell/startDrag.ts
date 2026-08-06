import fs from 'node:fs'
import { app, nativeImage, type NativeImage, type WebContents } from 'electron'
import { requireAbsolute } from '../fs/list'
import { logMain } from '../logging'

/** Valid 1×1 PNG — resized before use. Electron silently no-ops startDrag if icon is empty. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let dragIcon: NativeImage = nativeImage.createEmpty()

function ensureDragIcon(): NativeImage {
  if (!dragIcon.isEmpty()) return dragIcon
  const base = nativeImage.createFromBuffer(PIXEL_PNG)
  dragIcon = base.isEmpty() ? base : base.resize({ width: 32, height: 32 })
  return dragIcon
}

function warmIcon(samplePath: string): void {
  void app
    .getFileIcon(samplePath, { size: 'normal' })
    .then((img) => {
      if (!img.isEmpty()) dragIcon = img
    })
    .catch(() => {
      /* keep previous */
    })
}

/**
 * Begin an OS-level file drag (CF_HDROP on Windows) so other apps can accept
 * the paths — Photoshop, mail compose, chat attach, Explorer, etc.
 * Blocks the calling thread until the drag gesture ends.
 */
export function startOsFileDrag(sender: WebContents, paths: string[]): boolean {
  const existing: string[] = []
  for (const raw of paths) {
    try {
      const p = requireAbsolute(raw)
      if (fs.existsSync(p)) existing.push(p)
    } catch {
      /* skip invalid */
    }
  }
  if (existing.length === 0) {
    logMain('warn', 'shell:startDrag: no existing paths')
    return false
  }

  const icon = ensureDragIcon()
  if (icon.isEmpty()) {
    logMain('warn', 'shell:startDrag: icon empty — Electron will no-op')
    return false
  }

  warmIcon(existing[0]!)

  try {
    logMain('info', `shell:startDrag: ${existing.length} item(s) — ${existing[0]}`)
    // Single-file form is the most reliable on Windows; multi uses `files`.
    if (existing.length === 1) {
      sender.startDrag({ file: existing[0]!, icon })
    } else {
      sender.startDrag({ file: existing[0]!, files: existing, icon })
    }
    return true
  } catch (e) {
    logMain(
      'warn',
      `shell:startDrag failed: ${e instanceof Error ? e.message : String(e)}`
    )
    return false
  }
}
