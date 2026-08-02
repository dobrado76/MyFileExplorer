import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { protocolAllowlist } from '../security/paths'

export const MEDIA_SCHEME = 'mfe-media'

/** Must run before app ready. */
export function registerMediaSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** Extract the requested absolute path from a mfe-media URL, or null. */
export function mediaPathFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:`) return null
    const p = url.searchParams.get('p')
    if (!p) return null
    return p
  } catch {
    return null
  }
}

export function mediaUrlFor(absPath: string): string {
  return `${MEDIA_SCHEME}://local/?p=${encodeURIComponent(absPath)}`
}

/** Must run after app ready. Serves only allowlisted paths. */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const requested = mediaPathFromUrl(request.url)
    if (!requested || !protocolAllowlist.isFileAllowed(requested)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      return await net.fetch(pathToFileURL(requested).toString(), {
        bypassCustomProtocolHandlers: true
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
