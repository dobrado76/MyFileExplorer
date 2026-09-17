import { ADS_VALUE_PREVIEW_MAX_BYTES, buildStreamPath } from '@shared/ads/paths'
import fsp from 'node:fs/promises'
import { listStreams, readStreamText, streamExists } from '../fs/adsWin32'
import {
  queryHasStreamFilter,
  type AdsStreamClause,
  type StructuredQuery
} from './everythingQuery'

export type AdsStreamSearchFilter = {
  hasStream: boolean
  excludeHasStream: boolean
  clauses: AdsStreamClause[]
  excludeNames: string[]
}

export function adsStreamFilterFromQuery(q: StructuredQuery): AdsStreamSearchFilter | null {
  if (!queryHasStreamFilter(q)) return null
  return {
    hasStream: q.hasStream,
    excludeHasStream: q.excludeHasStream,
    clauses: q.streamClauses,
    excludeNames: q.excludeStreamNames
  }
}

function namedStreams(filePath: string): string[] {
  try {
    return listStreams(filePath).map((s) => s.name)
  } catch {
    return []
  }
}

async function streamTextMatches(
  filePath: string,
  streamName: string,
  needle: string
): Promise<boolean> {
  try {
    if (!streamExists(filePath, streamName)) return false
    const streamPath = buildStreamPath(filePath, streamName)
    const st = await fsp.stat(streamPath)
    if (st.size > ADS_VALUE_PREVIEW_MAX_BYTES) {
      // Too large for a text needle search — treat as non-match for value queries.
      return false
    }
    const text = await readStreamText(filePath, streamName)
    return text.toLowerCase().includes(needle.toLowerCase())
  } catch {
    return false
  }
}

async function clauseMatches(filePath: string, clause: AdsStreamClause): Promise<boolean> {
  const names = namedStreams(filePath)
  const hit = names.find((n) => n.toLowerCase() === clause.name.toLowerCase())
  if (!hit) return false
  if (clause.value == null || clause.value === '') return true
  return streamTextMatches(filePath, hit, clause.value)
}

/** Read-only ADS check. Does not write streams or change host $DATA times. */
export async function pathMatchesAdsStreamFilter(
  filePath: string,
  q: StructuredQuery
): Promise<boolean> {
  const f = adsStreamFilterFromQuery(q)
  if (!f) return true
  if (process.platform !== 'win32') return false

  const names = namedStreams(filePath)
  const hasAny = names.length > 0

  if (f.excludeHasStream && hasAny) return false
  if (f.hasStream && !hasAny) return false

  for (const ex of f.excludeNames) {
    if (names.some((n) => n.toLowerCase() === ex.toLowerCase())) return false
  }

  for (const clause of f.clauses) {
    if (!(await clauseMatches(filePath, clause))) return false
  }
  return true
}

export async function filterItemsByAdsStream<T extends { path: string }>(
  items: T[],
  q: StructuredQuery
): Promise<T[]> {
  if (!adsStreamFilterFromQuery(q)) return items
  const out: T[] = []
  for (const it of items) {
    if (await pathMatchesAdsStreamFilter(it.path, q)) out.push(it)
  }
  return out
}
