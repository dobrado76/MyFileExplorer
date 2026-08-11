import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { AppError } from '@shared/result'
import type { SlideshowListRequest } from '@shared/schemas/slideshow'
import { isSlideshowImagePath, SLIDESHOW_IMAGE_LIST_CAP } from '@shared/slideshow/constants'
import { requireAbsolute, pathExists } from '../fs/list'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'

const LIST_CAP = SLIDESHOW_IMAGE_LIST_CAP

type ImageEntry = { path: string; name: string; size: number; width: number; height: number }

let listCancelled = false

export function cancelSlideshowList(): void {
  listCancelled = true
}

async function walkImages(root: string, out: ImageEntry[]): Promise<void> {
  if (listCancelled || out.length >= LIST_CAP) return
  let dirents
  try {
    dirents = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of dirents) {
    if (listCancelled || out.length >= LIST_CAP) return
    const full = path.join(root, d.name)
    if (d.isDirectory()) {
      await walkImages(full, out)
      continue
    }
    if (!d.isFile() || !isSlideshowImagePath(full)) continue
    let size = 0
    try {
      size = (await fsp.stat(full)).size
    } catch {
      continue
    }
    out.push({ path: full, name: d.name, size, width: 0, height: 0 })
    if (out.length % 200 === 0) {
      broadcast({
        type: 'slideshow-list-progress',
        payload: { found: out.length, current: full }
      })
    }
  }
}

async function fillDimensions(entries: ImageEntry[]): Promise<void> {
  const CONCURRENCY = 8
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    if (listCancelled) return
    const batch = entries.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (e) => {
        try {
          const meta = await sharp(e.path).metadata()
          e.width = meta.width ?? 0
          e.height = meta.height ?? 0
        } catch {
          /* leave 0 */
        }
      })
    )
    if (i % 64 === 0) {
      broadcast({
        type: 'slideshow-list-progress',
        payload: { found: entries.length, current: `dimensions ${i}/${entries.length}` }
      })
    }
  }
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]!
    arr[i] = arr[j]!
    arr[j] = t
  }
}

export async function listSlideshowImages(
  req: SlideshowListRequest
): Promise<{ paths: string[]; truncated: boolean }> {
  listCancelled = false
  const roots = req.roots.map((r) => requireAbsolute(r))
  for (const r of roots) {
    if (!(await pathExists(r))) {
      throw new AppError('not-found', `Folder not found: ${r}`)
    }
  }

  const entries: ImageEntry[] = []
  for (const root of roots) {
    await walkImages(root, entries)
  }
  const truncated = entries.length >= LIST_CAP

  if (req.order === 'dimensions') {
    await fillDimensions(entries)
  }

  if (listCancelled) {
    throw new AppError('cancelled', 'Slideshow list cancelled')
  }

  if (req.order === 'random') {
    shuffleInPlace(entries)
  } else {
    const dir = req.ascending ? 1 : -1
    entries.sort((a, b) => {
      let cmp = 0
      if (req.order === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      } else if (req.order === 'size') {
        cmp = a.size - b.size
      } else {
        const aa = a.width * a.height
        const bb = b.width * b.height
        cmp = aa - bb
        if (cmp === 0) {
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        }
      }
      return cmp * dir
    })
  }

  logMain('info', `Slideshow list: ${entries.length} images from ${roots.length} root(s)`)
  return { paths: entries.map((e) => e.path), truncated }
}
