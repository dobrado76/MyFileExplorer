import { createHash } from 'node:crypto'

/** Opaque recover token: volume + record index + sequence (HMAC-free, local only). */
export function encodeUndeleteToken(volume: string, recordIndex: number, sequence: number): string {
  const letter = volume.replace(/:\\?$/, '').toUpperCase()
  const payload = `${letter}|${recordIndex}|${sequence}`
  return Buffer.from(payload, 'utf8').toString('base64url')
}

export function decodeUndeleteToken(
  token: string
): { letter: string; recordIndex: number; sequence: number } | null {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8')
    const [letter, idx, seq] = raw.split('|')
    if (!letter || !/^[A-Z]$/.test(letter)) return null
    const recordIndex = Number(idx)
    const sequence = Number(seq)
    if (!Number.isFinite(recordIndex) || !Number.isFinite(sequence)) return null
    if (recordIndex < 0 || sequence < 0) return null
    return { letter, recordIndex, sequence }
  } catch {
    return null
  }
}

/** Stable id for progress UI. */
export function tokenShortId(token: string): string {
  return createHash('sha1').update(token).digest('hex').slice(0, 8)
}
