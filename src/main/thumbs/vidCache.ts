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
      const st = await fsp.stat(frame)
      if (!st.isFile() || st.size <= 0) break
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

/**
 * After a video rename / same-volume move, rename matching `!VIDTHUMB_CACHE`
 * strip frames so they stay tied to the new basename (and folder). Soft-fail:
 * never throws for missing cache / individual frame errors.
 */
export async function relocateVidThumbCacheFrames(
  oldVideoPath: string,
  newVideoPath: string
): Promise<number> {
  try {
    const oldFile = requireAbsolute(oldVideoPath)
    const newFile = requireAbsolute(newVideoPath)
    const oldExt = path.extname(oldFile).slice(1)
    if (!isVidThumbVideoExt(oldExt)) return 0

    const oldParent = path.dirname(oldFile)
    const newParent = path.dirname(newFile)
    const oldBase = path.basename(oldFile)
    const newBase = path.basename(newFile)
    if (oldBase === newBase && pathEqual(oldParent, newParent)) return 0

    const oldCache = path.join(oldParent, VID_THUMB_CACHE_DIR)
    const newCache = path.join(newParent, VID_THUMB_CACHE_DIR)
    let moved = 0
    let ensuredNewCache = pathEqual(oldParent, newParent)

    for (let i = 1; i <= VID_THUMB_FRAME_COUNT; i++) {
      const from = path.join(oldCache, vidThumbFrameFileName(oldBase, i))
      const to = path.join(newCache, vidThumbFrameFileName(newBase, i))
      try {
        const st = await fsp.stat(from)
        if (!st.isFile() || st.size <= 0) continue
      } catch {
        continue
      }
      if (pathEqual(from, to)) continue
      try {
        if (!ensuredNewCache) {
          await fsp.mkdir(newCache, { recursive: true })
          ensuredNewCache = true
        }
        await renameFrameFile(from, to)
        moved++
      } catch {
        /* best-effort — video rename already succeeded */
      }
    }
    return moved
  } catch {
    return 0
  }
}

function pathEqual(a: string, b: string): boolean {
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

async function renameFrameFile(from: string, to: string): Promise<void> {
  if (pathEqual(from, to) && from !== to) {
    // Windows case-only rename needs a temp hop.
    const tmp = `${to}.__mfe_ren__`
    await fsp.rename(from, tmp)
    await fsp.rename(tmp, to)
    return
  }
  try {
    await fsp.rename(from, to)
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'EEXIST' || code === 'EPERM') {
      await fsp.rm(to, { force: true })
      await fsp.rename(from, to)
      return
    }
    throw e
  }
}
