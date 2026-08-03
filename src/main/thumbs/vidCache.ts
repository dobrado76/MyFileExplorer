import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  VID_THUMB_CACHE_DIR,
  VID_THUMB_FRAME_COUNT,
  isVidThumbVideoExt,
  vidThumbFrameFileName
} from '@shared/vidThumbCache'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute } from '../fs/list'

/**
 * Resolve strip frames for a video from a sibling `!VIDTHUMB_CACHE` folder.
 * Frames are `{basename}.thumb_1.jpg` … `thumb_20.jpg`; stop at the first gap.
 */
export async function resolveVidThumbFrames(rawPath: string): Promise<string[]> {
  const file = requireAbsolute(rawPath)
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!isVidThumbVideoExt(ext)) return []

  const parent = path.dirname(file)
  const cacheDir = path.join(parent, VID_THUMB_CACHE_DIR)
  const base = path.basename(file)
  const absFrames: string[] = []

  for (let i = 1; i <= VID_THUMB_FRAME_COUNT; i++) {
    const frame = path.join(cacheDir, vidThumbFrameFileName(base, i))
    try {
      await fsp.access(frame)
      absFrames.push(frame)
    } catch {
      break
    }
  }

  if (absFrames.length === 0) return []

  // Media protocol only allows files whose immediate parent dir is listed.
  protocolAllowlist.allowDir(cacheDir)
  return absFrames.map((p) => mediaUrlFor(p))
}
