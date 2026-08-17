/** Turn a Plex thumb/art field (relative, absolute, or metadata://) into a fetchable URL. */

export function appendPlexToken(href: string, token: string): string {
  if (!token) return href
  if (/[?&]X-Plex-Token=/.test(href)) return href
  return `${href}${href.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(token)}`
}

function isPlexServerHost(imageHref: string, baseUrl: string): boolean {
  try {
    const img = new URL(imageHref)
    const plex = new URL(baseUrl)
    const hosts = new Set([plex.hostname, '127.0.0.1', 'localhost', '::1'])
    return hosts.has(img.hostname)
  } catch {
    return false
  }
}

export function plexPhotoTranscodePath(libraryThumbPath: string): string {
  return `/photo/:/transcode?url=${encodeURIComponent(libraryThumbPath)}&width=2000&height=3000&minSize=1&upscale=0`
}

export function resolvePlexImageUrl(baseUrl: string, token: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  const root = baseUrl.replace(/\/+$/, '')
  let href: string
  if (/^https?:\/\//i.test(s)) {
    href = s
    return isPlexServerHost(href, root) ? appendPlexToken(href, token) : href
  }
  if (s.startsWith('/')) {
    href = `${root}${s}`
  } else {
    href = `${root}${plexPhotoTranscodePath(s)}`
  }
  return appendPlexToken(href, token)
}

function xmlAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)
  return m?.[1]
}

function xmlTagList(inner: string, el: string): { tag: string }[] {
  const re = new RegExp(`<${el}\\s[^>]*\\btag="([^"]*)"`, 'g')
  const out: { tag: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) out.push({ tag: m[1] ?? '' })
  return out.filter((x) => x.tag)
}

/** First Video/Directory/Photo in a Plex XML MediaContainer. */
export function firstMetadataFromXml(xml: string): Record<string, unknown> | null {
  const m = /<(Video|Directory|Photo)(\s[^>]*)?>/.exec(xml)
  if (!m) return null
  const tag = m[1] ?? 'Video'
  const attrs = m[2] ?? ''
  const start = (m.index ?? 0) + m[0].length
  const end = xml.indexOf(`</${tag}>`, start)
  const inner = end >= 0 ? xml.slice(start, end) : ''
  const type = xmlAttr(attrs, 'type') ?? (tag === 'Directory' ? 'show' : 'movie')
  return {
    type,
    ratingKey: xmlAttr(attrs, 'ratingKey'),
    parentRatingKey: xmlAttr(attrs, 'parentRatingKey'),
    grandparentRatingKey: xmlAttr(attrs, 'grandparentRatingKey'),
    title: xmlAttr(attrs, 'title'),
    grandparentTitle: xmlAttr(attrs, 'grandparentTitle'),
    parentTitle: xmlAttr(attrs, 'parentTitle'),
    year: xmlAttr(attrs, 'year'),
    originallyAvailableAt: xmlAttr(attrs, 'originallyAvailableAt'),
    summary: xmlAttr(attrs, 'summary'),
    thumb: xmlAttr(attrs, 'thumb'),
    parentThumb: xmlAttr(attrs, 'parentThumb'),
    grandparentThumb: xmlAttr(attrs, 'grandparentThumb'),
    art: xmlAttr(attrs, 'art'),
    rating: xmlAttr(attrs, 'rating'),
    audienceRating: xmlAttr(attrs, 'audienceRating'),
    index: xmlAttr(attrs, 'index'),
    parentIndex: xmlAttr(attrs, 'parentIndex'),
    Genre: xmlTagList(inner, 'Genre'),
    Director: xmlTagList(inner, 'Director'),
    Role: xmlTagList(inner, 'Role'),
    Country: xmlTagList(inner, 'Country')
  }
}

/** Ordered cover URLs: Plex's own thumb field, photo transcode, then /thumb. */
export function plexCoverUrlsFromItem(
  baseUrl: string,
  token: string,
  item: Record<string, unknown>
): string[] {
  const type = String(item.type ?? '')
  const ratingKey = String(item.ratingKey ?? '').trim()
  const gpKey = String(item.grandparentRatingKey ?? '').trim()
  const parentKey = String(item.parentRatingKey ?? '').trim()
  const coverKey = type === 'episode' && gpKey ? gpKey : ratingKey
  const constructed: unknown[] =
    type === 'episode'
      ? [
          item.grandparentThumb,
          item.thumb,
          item.parentThumb,
          gpKey && `/library/metadata/${gpKey}/thumb`,
          ratingKey && `/library/metadata/${ratingKey}/thumb`,
          parentKey && `/library/metadata/${parentKey}/thumb`,
          coverKey && plexPhotoTranscodePath(`/library/metadata/${coverKey}/thumb`)
        ]
      : [
          item.thumb,
          item.parentThumb,
          item.grandparentThumb,
          ratingKey && `/library/metadata/${ratingKey}/thumb`,
          ratingKey && plexPhotoTranscodePath(`/library/metadata/${ratingKey}/thumb`),
          item.art
        ]
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of constructed) {
    const u = resolvePlexImageUrl(baseUrl, token, c)
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}
