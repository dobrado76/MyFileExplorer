import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  parseMediaSearchAs,
  type MediaMetadata,
  type MediaMetadataRating,
  type MediaQueryKind
} from '@shared/mediaMetadata'
import { logMain } from '../logging'
import { getSettings } from '../settings/store'
import {
  plexBundleRelDir,
  plexMediaUriToRelPath,
  plexMetadataUriPosterName,
  plexPosterSubdirs,
  normalizePlexBaseUrl
} from './plexLocal'
import {
  appendPlexToken,
  allPhotosFromXml,
  firstMetadataFromXml,
  plexCoverUrlsFromItem,
  resolvePlexImageUrl
} from './plexUrls'

export type PlexProbe = {
  installed: boolean
  running: boolean
  dataDir: string | null
  tokenFound: boolean
  url: string
}

type PlexResolved = {
  url: string
  token: string
  dataDir: string | null
}

type PlexHit = {
  meta: MediaMetadata
  thumbUrl: string | null
  thumbUrls?: string[]
  thumbBytes?: Buffer | null
}

function plexClientHeaders(token: string, accept = 'application/json'): Record<string, string> {
  return {
    Accept: accept,
    'X-Plex-Product': 'MyFileExplorer',
    'X-Plex-Client-Identifier': 'myfileexplorer-media-metadata',
    ...(token ? { 'X-Plex-Token': token } : {})
  }
}

function hitFromItem(resolved: PlexResolved, item: Record<string, unknown>): PlexHit {
  const id = String(item.ratingKey ?? '')
  const urls = plexCoverUrlsFromItem(resolved.url, resolved.token, item)
  return { meta: metaFromPlexItem(item, id), thumbUrl: urls[0] ?? null, thumbUrls: urls }
}

function plexPrefs(): { plexUrl: string; plexToken: string; plexDataDir: string } {
  const s = getSettings().mediaMetadata
  return {
    plexUrl: normalizePlexBaseUrl(s.plexUrl || 'http://127.0.0.1:32400'),
    plexToken: s.plexToken.trim(),
    plexDataDir: s.plexDataDir.trim()
  }
}

function defaultDataDirs(): string[] {
  const local = process.env.LOCALAPPDATA
  const out: string[] = []
  if (local) out.push(path.join(local, 'Plex Media Server'))
  return out
}

function defaultInstallDirs(): string[] {
  const pf = process.env.ProgramFiles
  const pf86 = process.env['ProgramFiles(x86)']
  const out: string[] = []
  if (pf) out.push(path.join(pf, 'Plex', 'Plex Media Server'))
  if (pf86) out.push(path.join(pf86, 'Plex', 'Plex Media Server'))
  return out
}

function parsePrefsXml(xml: string): { token: string | null; dataDir: string | null } {
  const token = /PlexOnlineToken="([^"]+)"/.exec(xml)?.[1] ?? null
  const dataDir = /LocalAppDataPath="([^"]+)"/.exec(xml)?.[1] ?? null
  return { token, dataDir }
}

async function readPrefsFile(dataDir: string): Promise<{ token: string | null; dataDir: string | null }> {
  const prefs = path.join(dataDir, 'Preferences.xml')
  try {
    const xml = await fsp.readFile(prefs, 'utf8')
    return parsePrefsXml(xml)
  } catch {
    return { token: null, dataDir: null }
  }
}

const PLEX_CACHE_MS = 30_000
const PLEX_HTTP_MS = 4000
let plexResolveCache: { at: number; value: PlexResolved; sections?: string[] } | null = null

export async function resolvePlex(): Promise<PlexResolved> {
  if (plexResolveCache && Date.now() - plexResolveCache.at < PLEX_CACHE_MS) {
    return plexResolveCache.value
  }
  const cfg = plexPrefs()
  let dataDir = cfg.plexDataDir || null
  if (dataDir && !existsSync(dataDir)) dataDir = null
  if (!dataDir) {
    for (const d of defaultDataDirs()) {
      if (existsSync(d)) {
        dataDir = d
        break
      }
    }
  }
  let token = cfg.plexToken
  if (dataDir) {
    const prefs = await readPrefsFile(dataDir)
    if (!token && prefs.token) token = prefs.token
    if (prefs.dataDir && existsSync(prefs.dataDir)) dataDir = prefs.dataDir
  }
  if (!dataDir) {
    for (const d of defaultDataDirs()) {
      if (existsSync(d)) {
        dataDir = d
        break
      }
    }
  }
  const value = { url: normalizePlexBaseUrl(cfg.plexUrl), token, dataDir }
  plexResolveCache = { at: Date.now(), value }
  return value
}

export function plexLooksInstalled(dataDir: string | null): boolean {
  if (dataDir && existsSync(dataDir)) return true
  return defaultInstallDirs().some((d) => existsSync(path.join(d, 'Plex Media Server.exe')))
}

async function plexGet(url: string, token: string, pathname: string): Promise<unknown> {
  const sep = pathname.includes('?') ? '&' : '?'
  const href = `${url}${pathname}${token ? `${sep}X-Plex-Token=${encodeURIComponent(token)}` : ''}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), PLEX_HTTP_MS)
  try {
    const res = await fetch(href, {
      signal: ac.signal,
      headers: plexClientHeaders(token)
    })
    if (!res.ok) throw new Error(`Plex HTTP ${res.status}`)
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('json')) return (await res.json()) as unknown
    const text = await res.text()
    if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
      return JSON.parse(text) as unknown
    }
    return { __xml: text }
  } finally {
    clearTimeout(t)
  }
}

export async function probePlex(): Promise<PlexProbe> {
  const resolved = await resolvePlex()
  const installed = plexLooksInstalled(resolved.dataDir)
  let running = false
  try {
    await plexGet(resolved.url, resolved.token, '/identity')
    running = true
  } catch {
    /* not running */
  }
  return {
    installed,
    running,
    dataDir: resolved.dataDir,
    tokenFound: resolved.token.length > 0,
    url: resolved.url
  }
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function tagList(v: unknown): string[] {
  return asArray(v as { tag?: string } | { tag?: string }[])
    .map((x) => (x && typeof x === 'object' ? String((x as { tag?: string }).tag ?? '') : ''))
    .filter(Boolean)
}

function ratingsFromPlex(item: Record<string, unknown>): MediaMetadataRating[] {
  const out: MediaMetadataRating[] = []
  const rating = Number(item.rating)
  if (Number.isFinite(rating) && rating > 0) out.push({ source: 'Plex', value: rating, max: 10 })
  const audience = Number(item.audienceRating)
  if (Number.isFinite(audience) && audience > 0) {
    out.push({ source: 'Plex audience', value: audience, max: 10 })
  }
  return out
}

function plexIndex(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function metaFromPlexItem(item: Record<string, unknown>, sourceId: string): MediaMetadata {
  const type = String(item.type ?? '')
  const kind: MediaMetadata['kind'] =
    type === 'episode' ? 'episode' : type === 'show' ? 'show' : 'movie'
  const yearRaw = item.year ?? (typeof item.originallyAvailableAt === 'string'
    ? Number(String(item.originallyAvailableAt).slice(0, 4))
    : undefined)
  const year = Number(yearRaw)
  return {
    version: 1,
    source: 'plex',
    sourceId,
    kind,
    title: String(item.title ?? '').trim() || 'Untitled',
    year: Number.isFinite(year) && year > 1800 ? year : undefined,
    country: tagList(item.Country),
    genres: tagList(item.Genre),
    synopsis: typeof item.summary === 'string' ? item.summary : undefined,
    directors: tagList(item.Director),
    actors: tagList(item.Role).slice(0, 20),
    ratings: ratingsFromPlex(item),
    season: kind === 'episode' ? plexIndex(item.parentIndex) : undefined,
    episode: kind === 'episode' ? plexIndex(item.index) : undefined,
    showTitle:
      kind === 'episode'
        ? String(item.grandparentTitle ?? item.parentTitle ?? '').trim() || undefined
        : undefined,
    fetchedAt: new Date().toISOString()
  }
}

function asRecordList(v: unknown): Record<string, unknown>[] {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : [v]
  return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
}

function firstMetadata(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as { MediaContainer?: { Metadata?: unknown; Directory?: unknown; Video?: unknown }; __xml?: string }
  if (typeof root.__xml === 'string') return firstMetadataFromXml(root.__xml)
  return (
    asRecordList(root.MediaContainer?.Metadata)[0] ??
    asRecordList(root.MediaContainer?.Video)[0] ??
    asRecordList(root.MediaContainer?.Directory)[0] ??
    null
  )
}

function metadataList(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as { MediaContainer?: { Metadata?: unknown; Directory?: unknown }; __xml?: string }
  if (typeof root.__xml === 'string') {
    const one = firstMetadataFromXml(root.__xml)
    return one ? [one] : []
  }
  const meta = asRecordList(root.MediaContainer?.Metadata)
  if (meta.length) return meta
  return asRecordList(root.MediaContainer?.Directory)
}

function normalizeWin(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

async function librarySectionKeys(resolved: PlexResolved): Promise<string[]> {
  if (
    plexResolveCache &&
    plexResolveCache.value === resolved &&
    plexResolveCache.sections
  ) {
    return plexResolveCache.sections
  }
  try {
    const payload = await plexGet(resolved.url, resolved.token, '/library/sections')
    const keys = metadataList(payload)
      .map((d) => String(d.key ?? ''))
      .filter(Boolean)
    if (plexResolveCache && plexResolveCache.value === resolved) {
      plexResolveCache.sections = keys
    }
    return keys
  } catch {
    return []
  }
}

async function lookupByRatingKey(resolved: PlexResolved, id: string | number): Promise<PlexHit | null> {
  const key = String(id).trim()
  if (!key) return null
  try {
    const payload = await plexGet(resolved.url, resolved.token, `/library/metadata/${key}`)
    const item = firstMetadata(payload)
    if (!item) return null
    return hitFromItem(resolved, item)
  } catch {
    return null
  }
}

async function tryFileLookups(resolved: PlexResolved, pathnames: string[]): Promise<PlexHit | null> {
  for (const pathname of pathnames) {
    try {
      const payload = await plexGet(resolved.url, resolved.token, pathname)
      const item = firstMetadata(payload)
      if (!item) continue
      return hitFromItem(resolved, item)
    } catch {
      /* try next */
    }
  }
  return null
}

async function lookupByFile(resolved: PlexResolved, filePath: string): Promise<PlexHit | null> {
  const variants = [filePath, filePath.replace(/\\/g, '/')]
  const sectionKeys = await librarySectionKeys(resolved)
  const pathnames: string[] = []
  for (const key of sectionKeys) {
    for (const v of variants) {
      pathnames.push(`/library/sections/${key}/all?file=${encodeURIComponent(v)}`)
    }
  }
  if (pathnames.length === 0) {
    for (const v of variants) pathnames.push(`/library/all?file=${encodeURIComponent(v)}`)
  }
  return tryFileLookups(resolved, pathnames)
}

async function lookupShowByTitle(
  resolved: PlexResolved,
  title: string,
  prefer?: MediaQueryKind
): Promise<PlexHit | null> {
  try {
    const parsed = parseMediaSearchAs(title)
    const query = parsed.title || title
    const payload = await plexGet(
      resolved.url,
      resolved.token,
      `/search?query=${encodeURIComponent(query)}`
    )
    const list = metadataList(payload)
    const movies = list.filter((x) => String(x.type) === 'movie')
    const shows = list.filter((x) => String(x.type) === 'show')
    const pool = prefer === 'movie' ? [...movies, ...shows] : [...shows, ...movies]
    const want = query.toLowerCase()
    const exact = pool.find((x) => String(x.title ?? '').trim().toLowerCase() === want)
    if (exact) return hitFromItem(resolved, exact)
    if (parsed.year != null) {
      const yearHit = pool.find((x) => Number(x.year) === parsed.year)
      if (yearHit) return hitFromItem(resolved, yearHit)
    }
    const hit = pool[0]
    if (!hit) return null
    return hitFromItem(resolved, hit)
  } catch {
    return null
  }
}

type SqliteMetaRow = {
  id: number
  metadataType: number
  title: string
  year: number | null
  summary: string | null
  rating: number | null
  index: number | null
  parentId: number | null
  userThumbUrl: string | null
  hash: string | null
  guid: string | null
}

async function queryPlexSqlite(dataDir: string, filePath: string): Promise<SqliteMetaRow | null> {
  const dbPath = path.join(dataDir, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db')
  if (!existsSync(dbPath)) return null
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const want = normalizeWin(filePath)
      const sql = (extra: string): string =>
        `SELECT mi.id, mi.metadata_type AS metadataType, mi.title, mi.year, mi.summary, mi.rating,
                mi."index" AS idx, mi.parent_id AS parentId${extra},
                mp.file AS file
         FROM media_parts mp
         JOIN media_items m ON m.id = mp.media_item_id
         JOIN metadata_items mi ON mi.id = m.metadata_item_id
         WHERE lower(replace(mp.file, '/', '\\')) = ?`
      type SqliteRow = {
        id: number
        metadataType: number
        title: string
        year: number | null
        summary: string | null
        rating: number | null
        idx: number | null
        parentId: number | null
        userThumbUrl?: string | null
        hash?: string | null
        guid?: string | null
      }
      let row: SqliteRow | undefined
      const extras = [
        ', mi.user_thumb_url AS userThumbUrl, mi.hash AS hash, mi.guid AS guid',
        ', mi.user_thumb_url AS userThumbUrl',
        ''
      ]
      for (const extra of extras) {
        try {
          row = db.prepare(sql(extra)).get(want) as SqliteRow | undefined
          break
        } catch {
          row = undefined
        }
      }
      if (!row) return null
      return {
        id: row.id,
        metadataType: row.metadataType,
        title: row.title,
        year: row.year,
        summary: row.summary,
        rating: row.rating,
        index: row.idx,
        parentId: row.parentId,
        userThumbUrl: row.userThumbUrl ?? null,
        hash: row.hash ?? null,
        guid: row.guid ?? null
      }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

async function sqliteItemArt(
  dataDir: string,
  metadataId: string | number
): Promise<{
  metadataType: number
  hash: string | null
  guid: string | null
  userThumbUrl: string | null
  parentId: number | null
} | null> {
  const dbPath = path.join(dataDir, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db')
  if (!existsSync(dbPath)) return null
  const id = Number(metadataId)
  if (!Number.isFinite(id)) return null
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const extras = [
        'hash, guid, user_thumb_url AS userThumbUrl, parent_id AS parentId, metadata_type AS metadataType',
        'user_thumb_url AS userThumbUrl, parent_id AS parentId, metadata_type AS metadataType',
        'parent_id AS parentId, metadata_type AS metadataType'
      ]
      for (const cols of extras) {
        try {
          const row = db.prepare(`SELECT ${cols} FROM metadata_items WHERE id = ?`).get(id) as
            | {
                metadataType: number
                hash?: string | null
                guid?: string | null
                userThumbUrl?: string | null
                parentId: number | null
              }
            | undefined
          if (!row) return null
          return {
            metadataType: row.metadataType,
            hash: row.hash ?? null,
            guid: row.guid ?? null,
            userThumbUrl: row.userThumbUrl ?? null,
            parentId: row.parentId
          }
        } catch {
          /* older schema */
        }
      }
      return null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

async function seasonContextFromSqlite(
  dataDir: string,
  parentId: number | null
): Promise<{ season?: number; showTitle?: string }> {
  if (parentId == null) return {}
  const dbPath = path.join(dataDir, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db')
  if (!existsSync(dbPath)) return {}
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const parent = db
        .prepare(
          `SELECT title, "index" AS idx, parent_id AS parentId, metadata_type AS metadataType
           FROM metadata_items WHERE id = ?`
        )
        .get(parentId) as
        | { title: string; idx: number | null; parentId: number | null; metadataType: number }
        | undefined
      if (!parent) return {}
      if (parent.metadataType === 2) return { showTitle: parent.title || undefined }
      const season = parent.idx != null && Number.isFinite(parent.idx) ? parent.idx : undefined
      let showTitle: string | undefined
      if (parent.parentId != null) {
        const show = db
          .prepare(`SELECT title FROM metadata_items WHERE id = ?`)
          .get(parent.parentId) as { title: string } | undefined
        showTitle = show?.title || undefined
      }
      return { season, showTitle }
    } finally {
      db.close()
    }
  } catch {
    return {}
  }
}

async function showIdFromSqlite(dataDir: string, startId: number): Promise<number | null> {
  const dbPath = path.join(dataDir, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db')
  if (!existsSync(dbPath)) return null
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      let id: number | null = startId
      for (let i = 0; i < 4 && id != null; i++) {
        const row = db
          .prepare(`SELECT id, parent_id AS parentId, metadata_type AS metadataType FROM metadata_items WHERE id = ?`)
          .get(id) as { id: number; parentId: number | null; metadataType: number } | undefined
        if (!row) return null
        if (row.metadataType === 2) return row.id
        id = row.parentId
      }
      return null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

async function tagsFromSqlite(
  dataDir: string,
  metadataId: number
): Promise<{ genres: string[]; directors: string[]; actors: string[]; country: string[] }> {
  const empty = { genres: [], directors: [], actors: [], country: [] }
  const dbPath = path.join(dataDir, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db')
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT t.tag, t.tag_type AS tagType
           FROM taggings tg
           JOIN tags t ON t.id = tg.tag_id
           WHERE tg.metadata_item_id = ?`
        )
        .all(metadataId) as { tag: string; tagType: number }[]
      const genres: string[] = []
      const directors: string[] = []
      const actors: string[] = []
      const country: string[] = []
      for (const r of rows) {
        if (!r.tag) continue
        if (r.tagType === 1) genres.push(r.tag)
        else if (r.tagType === 2) directors.push(r.tag)
        else if (r.tagType === 4) actors.push(r.tag)
        else if (r.tagType === 8) country.push(r.tag)
      }
      return { genres, directors, actors: actors.slice(0, 20), country }
    } finally {
      db.close()
    }
  } catch {
    return empty
  }
}

function kindFromPlexType(metadataType: number): MediaMetadata['kind'] {
  if (metadataType === 4) return 'episode'
  if (metadataType === 2) return 'show'
  return 'movie'
}

function hashFromGuid(guid: string | null): string | null {
  if (!guid?.trim()) return null
  return createHash('sha1').update(guid.trim()).digest('hex')
}

async function pickLargestImage(dir: string): Promise<Buffer | null> {
  if (!existsSync(dir)) return null
  const { isPortraitCoverBuffer } = await import('./coverImage')
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return null
  }
  const portraits: { buf: Buffer; size: number }[] = []
  const others: { buf: Buffer; size: number }[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    try {
      const st = await fsp.stat(full)
      if (!st.isFile() || st.size < 32) continue
      const buf = await fsp.readFile(full)
      if (!looksLikeImage(buf)) continue
      const slot = (await isPortraitCoverBuffer(buf)) ? portraits : others
      slot.push({ buf, size: st.size })
    } catch {
      /* skip */
    }
  }
  const pool = portraits.length > 0 ? portraits : others
  pool.sort((a, b) => b.size - a.size)
  return pool[0]?.buf ?? null
}

async function readPosterForArtItem(
  dataDir: string,
  item: {
    metadataType: number
    hash: string | null
    guid: string | null
    userThumbUrl: string | null
  }
): Promise<Buffer | null> {
  if (item.userThumbUrl) {
    const rel = plexMediaUriToRelPath(item.userThumbUrl)
    if (rel) {
      const abs = path.join(dataDir, rel)
      try {
        const st = await fsp.stat(abs)
        if (st.isFile()) {
          const buf = await fsp.readFile(abs)
          if (looksLikeImage(buf)) return buf
        } else if (st.isDirectory()) {
          for (const d of plexPosterSubdirs(abs)) {
            const img = await pickLargestImage(d)
            if (img) return img
          }
        }
      } catch {
        /* try hash bundle */
      }
    }
  }
  const hash = (item.hash && item.hash.length >= 2 ? item.hash : null) ?? hashFromGuid(item.guid)
  if (!hash) return null
  const bundle = path.join(dataDir, plexBundleRelDir(hash, item.metadataType))
  const wanted = item.userThumbUrl ? plexMetadataUriPosterName(item.userThumbUrl) : null
  if (wanted) {
    const named = await readNamedPoster(bundle, wanted)
    if (named) return named
  }
  for (const d of plexPosterSubdirs(bundle)) {
    const img = await pickLargestImage(d)
    if (img) return img
  }
  const contents = path.join(bundle, 'Contents')
  if (existsSync(contents)) {
    try {
      for (const name of await fsp.readdir(contents)) {
        if (name.startsWith('.')) continue
        const img = await pickLargestImage(path.join(contents, name, 'posters'))
        if (img) return img
      }
    } catch {
      /* skip */
    }
  }
  return null
}

async function readNamedPoster(bundle: string, fileName: string): Promise<Buffer | null> {
  const contents = path.join(bundle, 'Contents')
  if (!existsSync(contents)) return null
  const dirs = [...plexPosterSubdirs(bundle)]
  try {
    for (const name of await fsp.readdir(contents)) {
      if (name.startsWith('.')) continue
      dirs.push(path.join(contents, name, 'posters'))
    }
  } catch {
    /* skip */
  }
  for (const dir of dirs) {
    const full = path.join(dir, fileName)
    try {
      const buf = await fsp.readFile(full)
      if (looksLikeImage(buf)) return buf
    } catch {
      /* try next folder */
    }
  }
  return null
}

export async function listPlexLocalPosterFiles(
  dataDir: string,
  metadataId: string
): Promise<{ absPath: string; fileName: string; selected: boolean }[]> {
  const info = await sqliteItemArt(dataDir, metadataId)
  if (!info) return []
  const order = [info]
  if (info.metadataType === 4 && info.parentId) {
    const showId = await showIdFromSqlite(dataDir, info.parentId)
    if (showId != null) {
      const show = await sqliteItemArt(dataDir, showId)
      if (show) order.unshift(show)
    }
  }
  const wanted = info.userThumbUrl ? plexMetadataUriPosterName(info.userThumbUrl) : null
  const out: { absPath: string; fileName: string; selected: boolean }[] = []
  const seen = new Set<string>()
  for (const item of order) {
    const hash = (item.hash && item.hash.length >= 2 ? item.hash : null) ?? hashFromGuid(item.guid)
    if (!hash) continue
    const bundle = path.join(dataDir, plexBundleRelDir(hash, item.metadataType))
    const dirs = [...plexPosterSubdirs(bundle)]
    const contents = path.join(bundle, 'Contents')
    if (existsSync(contents)) {
      try {
        for (const name of await fsp.readdir(contents)) {
          if (name.startsWith('.')) continue
          dirs.push(path.join(contents, name, 'posters'))
        }
      } catch {
        /* skip */
      }
    }
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      let names: string[]
      try {
        names = await fsp.readdir(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (name.startsWith('.')) continue
        const abs = path.join(dir, name)
        const key = abs.toLowerCase()
        if (seen.has(key)) continue
        try {
          const st = await fsp.stat(abs)
          if (!st.isFile() || st.size < 32) continue
        } catch {
          continue
        }
        seen.add(key)
        out.push({
          absPath: abs,
          fileName: name,
          selected: wanted != null && name.toLowerCase() === wanted
        })
      }
    }
  }
  return out
}

function positiveInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export async function listPlexHttpPosters(
  ratingKey: string
): Promise<{ href: string; previewHref: string; selected: boolean; width: number; height: number }[]> {
  const resolved = await resolvePlex()
  const key = ratingKey.trim()
  if (!key) return []
  try {
    const payload = await plexGet(resolved.url, resolved.token, `/library/metadata/${key}/posters`)
    const items =
      payload && typeof payload === 'object' && typeof (payload as { __xml?: string }).__xml === 'string'
        ? allPhotosFromXml((payload as { __xml: string }).__xml)
        : [
            ...asRecordList((payload as { MediaContainer?: { Metadata?: unknown; Photo?: unknown } }).MediaContainer?.Metadata),
            ...asRecordList((payload as { MediaContainer?: { Photo?: unknown } }).MediaContainer?.Photo)
          ]
    const out: { href: string; previewHref: string; selected: boolean; width: number; height: number }[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const rawKey = typeof item.key === 'string' ? item.key : ''
      const rawThumb = typeof item.thumb === 'string' ? item.thumb : rawKey
      const href = resolvePlexImageUrl(resolved.url, resolved.token, rawKey || rawThumb)
      if (!href || seen.has(href)) continue
      seen.add(href)
      const previewHref = resolvePlexImageUrl(resolved.url, resolved.token, rawThumb) ?? href
      const selected = item.selected === true || item.selected === 1 || item.selected === '1'
      out.push({
        href,
        previewHref,
        selected,
        width: positiveInt(item.width),
        height: positiveInt(item.height)
      })
    }
    out.sort((a, b) => b.width * b.height - a.width * a.height)
    return out
  } catch {
    return []
  }
}

export async function readLocalPlexPoster(dataDir: string, metadataId: string): Promise<Buffer | null> {
  const info = await sqliteItemArt(dataDir, metadataId)
  if (!info) return null
  const order = [info]
  if (info.metadataType === 4 && info.parentId) {
    const showId = await showIdFromSqlite(dataDir, info.parentId)
    if (showId != null) {
      const show = await sqliteItemArt(dataDir, showId)
      if (show) order.unshift(show)
    }
  }
  for (const item of order) {
    const buf = await readPosterForArtItem(dataDir, item)
    if (buf) return buf
  }
  return null
}

async function resolvePlexPoster(resolved: PlexResolved, hit: PlexHit): Promise<Buffer | null> {
  const { pickBestCover } = await import('./coverImage')
  const bufs: Buffer[] = []
  const id = hit.meta.sourceId?.trim()
  if (resolved.dataDir && id) {
    const files = await listPlexLocalPosterFiles(resolved.dataDir, id)
    for (const f of files) {
      try {
        const buf = await fsp.readFile(f.absPath)
        if (buf.length >= 32 && looksLikeImage(buf)) bufs.push(buf)
      } catch {
        /* skip unreadable */
      }
    }
  }
  if (bufs.length === 0 && id) {
    const http = await listPlexHttpPosters(id)
    for (const p of http.slice(0, 8)) {
      const buf = await downloadPlexThumb(p.href)
      if (buf && buf.length >= 32) bufs.push(buf)
    }
  }
  if (bufs.length === 0) {
    const urls = [...new Set([...(hit.thumbUrls ?? []), ...(hit.thumbUrl ? [hit.thumbUrl] : [])])]
    for (const url of urls) {
      const buf = await downloadPlexThumb(url)
      if (buf && buf.length >= 32) bufs.push(buf)
    }
  }
  return pickBestCover(bufs)
}

async function withPoster(resolved: PlexResolved, hit: PlexHit): Promise<PlexHit> {
  const thumbBytes = await resolvePlexPoster(resolved, hit)
  if (!thumbBytes) {
    logMain(
      'warn',
      `Plex cover not retrieved for “${hit.meta.title}”${hit.meta.sourceId ? ` (id ${hit.meta.sourceId})` : ''}`
    )
  }
  return { ...hit, thumbBytes }
}

async function hitFromSqliteRow(resolved: PlexResolved, row: SqliteMetaRow): Promise<PlexHit> {
  const showId =
    kindFromPlexType(row.metadataType) === 'episode' && row.parentId
      ? await showIdFromSqlite(resolved.dataDir!, row.parentId)
      : null
  const coverKey = showId ?? row.id
  const urls = [
    ...plexCoverUrlsFromItem(resolved.url, resolved.token, {
      type: kindFromPlexType(row.metadataType),
      ratingKey: String(row.id),
      grandparentRatingKey: showId != null ? String(showId) : undefined,
      thumb: `/library/metadata/${coverKey}/thumb`
    }),
    resolvePlexImageUrl(resolved.url, resolved.token, row.userThumbUrl)
  ].filter((u): u is string => !!u)
  const tags = await tagsFromSqlite(resolved.dataDir!, row.id)
  const kind = kindFromPlexType(row.metadataType)
  const ctx =
    kind === 'episode' ? await seasonContextFromSqlite(resolved.dataDir!, row.parentId) : {}
  const meta: MediaMetadata = {
    version: 1,
    source: 'plex',
    sourceId: String(row.id),
    kind,
    title: row.title || 'Untitled',
    year: row.year ?? undefined,
    country: tags.country,
    genres: tags.genres,
    synopsis: row.summary ?? undefined,
    directors: tags.directors,
    actors: tags.actors,
    ratings:
      row.rating != null && Number.isFinite(row.rating)
        ? [{ source: 'Plex', value: row.rating, max: 10 }]
        : undefined,
    season: kind === 'episode' ? ctx.season : undefined,
    episode: kind === 'episode' ? row.index ?? undefined : undefined,
    showTitle: kind === 'episode' ? ctx.showTitle : undefined,
    fetchedAt: new Date().toISOString()
  }
  return { meta, thumbUrl: urls[0] ?? null, thumbUrls: urls }
}

export async function extractFromPlex(
  filePath: string,
  hintTitle?: string,
  opts?: { skipPoster?: boolean; prefer?: MediaQueryKind }
): Promise<PlexHit> {
  const resolved = await resolvePlex()
  if (!plexLooksInstalled(resolved.dataDir) && !resolved.token) {
    throw new Error('Plex Media Server was not found on this PC')
  }
  const finish = (hit: PlexHit): Promise<PlexHit> | PlexHit =>
    hit.meta.kind === 'episode' || opts?.skipPoster ? hit : withPoster(resolved, hit)

  let isDir = false
  try {
    isDir = (await fsp.stat(filePath)).isDirectory()
  } catch {
    /* treat as file lookup */
  }
  if (isDir) {
    if (hintTitle) {
      const showHit = await lookupShowByTitle(resolved, hintTitle, opts?.prefer)
      if (showHit) return finish(showHit)
    }
    throw new Error(
      `No Plex match for ${path.basename(filePath)}${resolved.token ? '' : ' (no Plex token; is the server signed in?)'}`
    )
  }

  if (resolved.dataDir) {
    const row = await queryPlexSqlite(resolved.dataDir, filePath)
    if (row) {
      const byKey = await lookupByRatingKey(resolved, row.id)
      if (byKey) return finish(byKey)
      return finish(await hitFromSqliteRow(resolved, row))
    }
  }

  const httpHit = await lookupByFile(resolved, filePath)
  if (httpHit) return finish(httpHit)

  if (hintTitle) {
    const showHit = await lookupShowByTitle(resolved, hintTitle, opts?.prefer)
    if (showHit) return finish(showHit)
  }

  throw new Error(
    `No Plex match for ${path.basename(filePath)}${resolved.token ? '' : ' (no Plex token; is the server signed in?)'}`
  )
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 16) return false
  if (buf[0] === 0xff && buf[1] === 0xd8) return true
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
  if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true
  return false
}

async function plexHttpGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Buffer | null> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    let res: Response
    try {
      const { net } = await import('electron')
      res = await net.fetch(url, { headers, signal: ac.signal, redirect: 'follow' })
    } catch {
      res = await fetch(url, { headers, signal: ac.signal, redirect: 'follow' })
    }
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    if (looksLikeImage(buf)) return buf
    if (ct.startsWith('image/') && buf.length > 32) return buf
    return null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function thumbFetchVariants(url: string): { href: string; token: string }[] {
  const out: { href: string; token: string }[] = []
  const seen = new Set<string>()
  const add = (href: string, token: string): void => {
    const key = `${href}\0${token}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ href, token })
  }
  let token = ''
  let stripped = url
  try {
    const u = new URL(url)
    token = u.searchParams.get('X-Plex-Token') ?? ''
    u.searchParams.delete('X-Plex-Token')
    stripped = u.toString()
    if (u.hostname === 'localhost' || u.hostname === '[::1]') {
      u.hostname = '127.0.0.1'
      add(appendPlexToken(u.toString(), token), token)
      u.searchParams.delete('X-Plex-Token')
      add(u.toString(), '')
    }
  } catch {
    /* keep raw */
  }
  add(url, token)
  add(stripped, token)
  add(stripped, '')
  return out
}

export async function downloadPlexThumb(url: string): Promise<Buffer | null> {
  const variants = thumbFetchVariants(url)
  const local = variants.find((v) => {
    try {
      const host = new URL(v.href).hostname
      return host === '127.0.0.1' || host === 'localhost'
    } catch {
      return false
    }
  })
  const list = local ? [local] : variants.slice(0, 2)
  for (const { href, token } of list) {
    const headers = token
      ? plexClientHeaders(token, '*/*')
      : { Accept: '*/*', 'X-Plex-Product': 'MyFileExplorer', 'X-Plex-Client-Identifier': 'myfileexplorer-media-metadata' }
    const buf = await plexHttpGet(href, headers, PLEX_HTTP_MS)
    if (buf) return buf
  }
  return null
}
