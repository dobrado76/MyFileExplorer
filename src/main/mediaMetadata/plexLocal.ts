import path from 'node:path'

export function plexMetadataKindDir(metadataType: number): string {
  if (metadataType === 1) return 'Movies'
  if (metadataType === 2 || metadataType === 3 || metadataType === 4) return 'TV Shows'
  if (metadataType === 8) return 'Artists'
  if (metadataType === 9) return 'Albums'
  return 'Movies'
}

/** `{Metadata}/{Movies|TV Shows}/{h[0]}/{hash}.bundle` */
export function plexBundleRelDir(hash: string, metadataType: number): string {
  const h = hash.trim().toLowerCase()
  if (h.length < 2) return ''
  return path.join('Metadata', plexMetadataKindDir(metadataType), h[0]!, `${h}.bundle`)
}

/**
 * Map Plex `media://` / `upload://` artwork URIs to a path under the data dir.
 * `media://c/abc.bundle/Contents/Thumbnails/thumb1.jpg`
 * `upload://posters/abcdef...`
 */
export function plexMediaUriToRelPath(uri: string): string | null {
  const s = uri.trim()
  const media = /^media:\/\/(.+)$/i.exec(s)
  if (media?.[1]) {
    return path.join('Media', 'localhost', media[1].replace(/[/\\]+/g, path.sep))
  }
  const upload = /^upload:\/\/(?:posters|art)\/([a-f0-9]+)$/i.exec(s)
  if (upload?.[1]) {
    const h = upload[1].toLowerCase()
    return path.join('Media', 'localhost', h[0]!, `${h.slice(1)}.bundle`)
  }
  return null
}

export function plexPosterSubdirs(bundleRoot: string): string[] {
  return [
    path.join(bundleRoot, 'Contents', '_combined', 'posters'),
    path.join(bundleRoot, 'Contents', '_stored', 'posters'),
    path.join(bundleRoot, 'Contents', 'Uploads', 'posters')
  ]
}

export function normalizePlexBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '') || 'http://127.0.0.1:32400'
  try {
    const u = new URL(trimmed)
    if (u.hostname === 'localhost' || u.hostname === '[::1]' || u.hostname === '::1') {
      u.hostname = '127.0.0.1'
    }
    return u.origin
  } catch {
    return trimmed
  }
}
