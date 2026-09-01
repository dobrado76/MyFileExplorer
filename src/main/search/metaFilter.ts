import { USER_METADATA_STREAM, parseUserMetadataDoc } from '@shared/schemas/userMetadata'
import {
  metaFilterActive,
  metaRecordMatches,
  type MetaSearchFilter
} from '@shared/metaSearch'
import { readStreamText, streamExists } from '../fs/adsWin32'
import type { StructuredQuery } from './everythingQuery'

export function metaFilterFromQuery(q: StructuredQuery): MetaSearchFilter | null {
  const f: MetaSearchFilter = {
    hasMeta: q.hasMeta,
    excludeHasMeta: q.excludeHasMeta,
    fieldPresent: q.metaFieldPresent,
    excludeFieldPresent: q.excludeMetaFieldPresent,
    clauses: q.metaClauses
  }
  return metaFilterActive(f) ? f : null
}

/** Read-only ADS check. Does not write streams or change host $DATA times. */
export async function pathMatchesMetaFilter(
  filePath: string,
  q: StructuredQuery
): Promise<boolean> {
  const f = metaFilterFromQuery(q)
  if (!f) return true
  if (process.platform !== 'win32') return false
  const catalog = q.userMetadataFields ?? []
  try {
    if (!streamExists(filePath, USER_METADATA_STREAM)) {
      return metaRecordMatches(null, f, catalog)
    }
    const doc = parseUserMetadataDoc(await readStreamText(filePath, USER_METADATA_STREAM))
    return metaRecordMatches(doc, f, catalog)
  } catch {
    return metaRecordMatches(null, f, catalog)
  }
}

export async function filterItemsByMeta<T extends { path: string }>(
  items: T[],
  q: StructuredQuery
): Promise<T[]> {
  if (!metaFilterFromQuery(q)) return items
  const out: T[] = []
  for (const it of items) {
    if (await pathMatchesMetaFilter(it.path, q)) out.push(it)
  }
  return out
}
