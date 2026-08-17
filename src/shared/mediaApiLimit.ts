/** Detect TMDB / OMDb quota and burst-limit responses. */

export function mediaApiLimitMessage(service: 'TMDB' | 'OMDb' | 'Internet'): string {
  return (
    `${service} request limit reached. Download stopped. ` +
    'Free keys are capped (OMDb about 1,000/day; TMDB also has a short burst limit). ' +
    'Wait and try again, or continue tomorrow.'
  )
}

export function isMediaApiLimitPayload(status: number, bodyText: string, data: unknown): boolean {
  if (status === 429) return true
  const text = bodyText.toLowerCase()
  if (status === 403 && /limit|quota|too many requests/.test(text)) return true
  if (/request limit reached|over the allowed limit/.test(text)) return true
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (o.status_code === 25) return true
    if (typeof o.Error === 'string' && /limit/i.test(o.Error)) return true
    if (typeof o.status_message === 'string' && /limit|quota/i.test(o.status_message)) return true
  }
  return false
}

export function isMediaApiLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /request limit reached/i.test(msg)
}
