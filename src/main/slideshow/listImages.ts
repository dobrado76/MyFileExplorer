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

/** Bumped on cancel and on each new list so a stale walk cannot finish as “success”. */
let listGen = 0

export function cancelSlideshowList(): void {
  listGen += 1
}

export function beginSlideshowListGen(): number {
  listGen += 1
  return listGen
}

export function isSlideshowListStale(gen: number): boolean {
  return gen !== listGen
}

function throwIfListStale(gen: number): void {
  if (isSlideshowListStale(gen)) {
    throw new AppError('cancelled', 'Slideshow list cancelled')
  }
}

let lastProgressMs = 0

function emitListProgress(found: number, current: string, force = false): void {
  const now = Date.now()
  if (!force && now - lastProgressMs < 100) return
  lastProgressMs = now
  broadcast({
    type: 'slideshow-list-progress',
    payload: { found, current }
  })
}

async function walkImages(
  root: string,
  out: ImageEntry[],
  gen: number,
  needSize: boolean
): Promise<void> {
  if (isSlideshowListStale(gen) || out.length >= LIST_CAP) return
  let dirents
  try {
    dirents = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  const dirs: string[] = []
  for (const d of dirents) {
    if (isSlideshowListStale(gen) || out.length >= LIST_CAP) return
    const full = path.join(root, d.name)
    if (d.isDirectory()) {
      dirs.push(full)
      continue
    }
    if (!d.isFile() || !isSlideshowImagePath(full)) continue
    let size = 0
    if (needSize) {
      try {
        size = (await fsp.stat(full)).size
      } catch {
        continue
      }
    }
    out.push({ path: full, name: d.name, size, width: 0, height: 0 })
    emitListProgress(out.length, full)
  }
  const CONC = 8
  for (let i = 0; i < dirs.length; i += CONC) {
    if (isSlideshowListStale(gen) || out.length >= LIST_CAP) return
    const batch = dirs.slice(i, i + CONC)
    await Promise.all(batch.map((dir) => walkImages(dir, out, gen, needSize)))
  }
}

async function fillDimensions(entries: ImageEntry[], gen: number): Promise<void> {
  const CONCURRENCY = 8
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    if (isSlideshowListStale(gen)) return
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

function sortImageEntries(
  entries: ImageEntry[],
  order: SlideshowListRequest['order'],
  ascending: boolean
): void {
  if (order === 'random') {
    shuffleInPlace(entries)
    return
  }
  const dir = ascending ? 1 : -1
  entries.sort((a, b) => {
    let cmp: number
    if (order === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    } else if (order === 'size') {
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

/**
 * Apply Settings → Slideshow order to an already-built path list
 * (e.g. compiled expand). Used so ±/# rebuilds reshuffle/resort on the spot.
 */
export async function sortSlideshowImagePaths(
  paths: string[],
  order: SlideshowListRequest['order'],
  ascending: boolean
): Promise<string[]> {
  if (paths.length <= 1) return [...paths]

  const gen = listGen
  const entries: ImageEntry[] = paths.map((p) => ({
    path: p,
    name: path.basename(p),
    size: 0,
    width: 0,
    height: 0
  }))

  if (order === 'size' || order === 'dimensions') {
    await Promise.all(
      entries.map(async (e) => {
        if (isSlideshowListStale(gen)) return
        try {
          e.size = (await fsp.stat(e.path)).size
        } catch {
          /* leave 0 */
        }
      })
    )
  }
  if (order === 'dimensions') {
    await fillDimensions(entries, gen)
  }

  throwIfListStale(gen)
  sortImageEntries(entries, order, ascending)
  return entries.map((e) => e.path)
}

export async function listSlideshowImages(
  req: SlideshowListRequest
): Promise<{ paths: string[]; truncated: boolean }> {
  const gen = beginSlideshowListGen()
  const roots = req.roots.map((r) => requireAbsolute(r))
  for (const r of roots) {
    throwIfListStale(gen)
    if (!(await pathExists(r))) {
      throw new AppError('not-found', `Folder not found: ${r}`)
    }
  }

  const entries: ImageEntry[] = []
  lastProgressMs = 0
  const needSize = req.order === 'size'
  for (const root of roots) {
    throwIfListStale(gen)
    await walkImages(root, entries, gen, needSize)
  }
  const truncated = entries.length >= LIST_CAP

  if (req.order === 'dimensions') {
    await fillDimensions(entries, gen)
  }

  throwIfListStale(gen)

  sortImageEntries(entries, req.order, req.ascending)

  logMain('info', `Slideshow list: ${entries.length} images from ${roots.length} root(s)`)
  return { paths: entries.map((e) => e.path), truncated }
}
