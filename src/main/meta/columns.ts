import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { DetailsColumnId, EntryColumnValues } from '@shared/schemas/columns'
import { filterMetaFetchColumns, isDirectoryMetaColumn } from '@shared/schemas/columns'
import { requireAbsolute } from '../fs/list'
import { extractColumnValues } from './extract'

let metaDir: string | null = null
/** pathLower → { cacheFileKey, values } */
const memory = new Map<string, { key: string; values: EntryColumnValues }>()
const inFlight = new Map<string, Promise<EntryColumnValues>>()
const MAX_MEMORY = 4000

function cacheDir(): string {
  if (!metaDir) metaDir = path.join(app.getPath('userData'), 'column-meta')
  return metaDir
}

/** Stable prefix so we can invalidate all cached extracts for a path. */
function pathPrefix(file: string): string {
  return crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 16)
}

function cacheKey(file: string, mtimeMs: number, size: number, columns: DetailsColumnId[]): string {
  const cols = filterMetaFetchColumns(columns).sort().join(',')
  const body = crypto
    .createHash('sha1')
    .update(`v2|${file.toLowerCase()}|${mtimeMs}|${size}|${cols}`)
    .digest('hex')
  return `${pathPrefix(file)}_${body}`
}

async function readDisk(key: string): Promise<EntryColumnValues | null> {
  try {
    const raw = await fsp.readFile(path.join(cacheDir(), `${key}.json`), 'utf8')
    const parsed = JSON.parse(raw) as EntryColumnValues
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function writeDisk(key: string, values: EntryColumnValues): Promise<void> {
  try {
    await fsp.mkdir(cacheDir(), { recursive: true })
    const file = path.join(cacheDir(), `${key}.json`)
    const tmp = file + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(values))
    await fsp.rename(tmp, file)
  } catch {
    // cache is best-effort
  }
}

async function loadOne(rawPath: string, columns: DetailsColumnId[]): Promise<EntryColumnValues> {
  const fetchCols = filterMetaFetchColumns(columns)
  if (fetchCols.length === 0) return {}

  const file = requireAbsolute(rawPath)
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return {}
  }

  if (st.isDirectory()) {
    if (!fetchCols.some(isDirectoryMetaColumn)) return {}
  } else if (!st.isFile()) {
    return {}
  }

  const key = cacheKey(file, st.mtimeMs, st.size, fetchCols)
  const pathKey = file.toLowerCase()
  const mem = memory.get(pathKey)
  if (mem && mem.key === key) return mem.values

  const disk = await readDisk(key)
  if (disk) {
    if (memory.size > MAX_MEMORY) memory.clear()
    memory.set(pathKey, { key, values: disk })
    return disk
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const job = (async (): Promise<EntryColumnValues> => {
    try {
      const values = await extractColumnValues(file, fetchCols)
      if (memory.size > MAX_MEMORY) memory.clear()
      memory.set(pathKey, { key, values })
      void writeDisk(key, values)
      return values
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, job)
  return job
}

/** Bounded concurrency for a folder of rows. */
export async function getColumnMetaMany(
  paths: string[],
  columns: DetailsColumnId[]
): Promise<Record<string, EntryColumnValues>> {
  const fetchCols = filterMetaFetchColumns(columns)
  const out: Record<string, EntryColumnValues> = {}
  if (fetchCols.length === 0 || paths.length === 0) return out

  const concurrency = 4
  let i = 0
  async function worker(): Promise<void> {
    while (i < paths.length) {
      const idx = i++
      const p = paths[idx]!
      try {
        out[p] = await loadOne(p, fetchCols)
      } catch {
        out[p] = {}
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()))
  return out
}

/** Drop in-memory column meta for one path (disk cache flushed separately). */
export function dropColumnMetaMemoryPath(rawPath: string): void {
  try {
    memory.delete(requireAbsolute(rawPath).toLowerCase())
  } catch {
    /* skip invalid */
  }
}

export async function clearColumnMetaCache(): Promise<void> {
  memory.clear()
  inFlight.clear()
  await fsp.rm(cacheDir(), { recursive: true, force: true })
  await fsp.mkdir(cacheDir(), { recursive: true })
}

/** Drop cached extracts for paths (e.g. after ADS mutations). */
export async function invalidateColumnMetaPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const prefixes = new Set<string>()
  for (const raw of paths) {
    try {
      const file = requireAbsolute(raw)
      const pathKey = file.toLowerCase()
      memory.delete(pathKey)
      prefixes.add(pathPrefix(file))
    } catch {
      /* skip invalid */
    }
  }
  // Drop in-flight jobs whose keys match invalidated prefixes
  for (const k of [...inFlight.keys()]) {
    const pref = k.slice(0, 16)
    if (prefixes.has(pref)) inFlight.delete(k)
  }
  try {
    const dir = cacheDir()
    const files = await fsp.readdir(dir)
    await Promise.all(
      files
        .filter((f) => {
          const pref = f.slice(0, 16)
          return prefixes.has(pref)
        })
        .map((f) => fsp.unlink(path.join(dir, f)).catch(() => undefined))
    )
  } catch {
    /* best-effort */
  }
}
