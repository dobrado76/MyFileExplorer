import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SearchResultItem } from '@shared/schemas/search'
import { broadcast } from '../ipc/events'
import {
  isBasicNameQuery,
  parseEverythingQuery,
  queryHasNoteFilter,
  rowMatchesStructured,
  type ParseOptions,
  type StructuredQuery
} from './everythingQuery'
import { pathMatchesNoteFilter } from './noteFilter'
import { compilePathPatterns } from '@shared/pathPatterns'
import { isHiddenSearchHit } from '@shared/searchHidden'
import { VID_THUMB_CACHE_DIR } from '@shared/vidThumbCache'
import { pathIsHidden } from '../fs/winAttrs'
import { nameMatches } from './queryBuilder'
import { isSkippedBySearchExclude } from './searchExclude'

export type CancelToken = { cancelled: boolean }

function yieldMain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Best-effort recursive walk (D15: progress + cancel, never pretend indexed
 * speed). Emits `search-progress` events while scanning.
 * Yields the main thread often so preview/icon IPC is not starved.
 */
export async function liveWalkSearch(
  rootDir: string,
  query: string,
  excludePatterns: string[],
  limit: number,
  token: CancelToken,
  parseOpts: ParseOptions = {},
  gen = 0,
  showHiddenPref = false
): Promise<{ items: SearchResultItem[]; partial: boolean; contentSlow?: boolean }> {
  const basic = isBasicNameQuery(query)
  const q = basic ? null : parseEverythingQuery(query, parseOpts)
  const excluded = compilePathPatterns(excludePatterns)
  const showHidden = showHiddenPref || q?.attrib?.hidden === true
  const items: SearchResultItem[] = []
  const stack: string[] = [rootDir]
  let scanned = 0
  let partial = false
  const effectiveLimit = q?.countLimit != null ? Math.min(limit, q.countLimit) : limit

  let lastEmitMs = 0
  let lastYieldMs = Date.now()
  const emitProgress = (dir: string, force = false): void => {
    const now = Date.now()
    // Never stream on every hit — that floods IPC and delays preview:get.
    if (!force && now - lastEmitMs < 250) return
    lastEmitMs = now
    broadcast({
      type: 'search-progress',
      payload: {
        phase: 'walking',
        current: scanned,
        message: dir,
        items: items.length ? [...items] : undefined,
        gen
      }
    })
  }

  emitProgress(rootDir, true)

  while (stack.length > 0) {
    if (token.cancelled || items.length >= effectiveLimit) {
      partial = true
      break
    }
    const dir = stack.pop()!
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirents) {
      if (token.cancelled || items.length >= effectiveLimit) {
        partial = true
        break
      }
      const full = path.join(dir, d.name)
      const isDir = d.isDirectory()
      if (isSkippedBySearchExclude(full, excluded, query, q, basic)) continue
      const hidden =
        d.name.toLowerCase() === VID_THUMB_CACHE_DIR.toLowerCase() ||
        pathIsHidden(full) ||
        isHiddenSearchHit({ path: full })

      const nameHit = basic ? nameMatches(d.name, query) : null
      // Search “Show hidden” is the gate — no name-hit exception (that made the toggle useless).
      if (!showHidden && hidden) {
        scanned++
        emitProgress(dir)
        continue
      }

      // Basic name search: skip stat on misses so the walk does not monopolize main.
      let size = 0
      let mtimeMs = 0
      const needStat = !basic || nameHit
      if (needStat) {
        try {
          const st = await fsp.stat(full)
          size = isDir ? 0 : st.size
          mtimeMs = st.mtimeMs
        } catch {
          /* zeros */
        }
      }

      const hit = basic
        ? Boolean(nameHit)
        : rowMatchesStructured(
            { path: full, name: d.name, size, mtimeMs, isDir, attrs: null },
            q!,
            { rootPrefix: rootDir, childCount: isDir ? dirents.length : undefined }
          )

      if (hit) {
        if (q && queryHasNoteFilter(q) && !(await pathMatchesNoteFilter(full, q))) {
          /* ADS read-only; host $DATA times unchanged */
        } else {
          items.push({ path: full, name: d.name, size, mtimeMs, isDir, isHidden: hidden })
        }
      }
      if (isDir) stack.push(full)
      scanned++
      emitProgress(dir)
      const now = Date.now()
      if (now - lastYieldMs >= 12) {
        lastYieldMs = now
        await yieldMain()
      }
    }
  }
  broadcast({
    type: 'search-progress',
    payload: { phase: 'done', current: scanned, message: rootDir, items: [...items], gen }
  })

  let contentSlow = false
  if (q?.content && items.length) {
    contentSlow = true
    // Light content filter in walk path
    const { queryIndexStructured } = await import('./executeQuery')
    void queryIndexStructured
    const needle = q.content.toLowerCase()
    const kept: SearchResultItem[] = []
    for (const it of items) {
      if (it.isDir) continue
      try {
        const buf = await fsp.readFile(it.path)
        if (buf.length > 512 * 1024) continue
        const text = buf.toString('utf8')
        if (text.toLowerCase().includes(needle)) kept.push(it)
      } catch {
        /* skip */
      }
      if (kept.length >= effectiveLimit) break
    }
    return { items: kept, partial, contentSlow }
  }

  return { items, partial, contentSlow }
}

export type { StructuredQuery }
