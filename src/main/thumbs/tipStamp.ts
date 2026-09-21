import crypto from 'node:crypto'
import fsp from 'node:fs/promises'

/** Bytes sampled from tip head/tail when stamping ADS tip content for the cache key. */
const TIP_STAMP_SAMPLE = 8192

/**
 * Cheap tip stamp so overwriting `VER_n` with the same byte length still busts
 * the disk cache (D27 leaves `$DATA` mtime/size unchanged).
 */
export async function tipContentStamp(openPath: string, tipSize: number): Promise<string> {
  if (!(tipSize > 0)) return '0'
  let fh: fsp.FileHandle | null = null
  try {
    fh = await fsp.open(openPath, 'r')
    const headLen = Math.min(TIP_STAMP_SAMPLE, tipSize)
    const head = Buffer.alloc(headLen)
    await fh.read(head, 0, headLen, 0)
    const hash = crypto.createHash('sha1').update(head)
    if (tipSize > headLen) {
      const tailLen = Math.min(TIP_STAMP_SAMPLE, tipSize - headLen)
      const tail = Buffer.alloc(tailLen)
      await fh.read(tail, 0, tailLen, tipSize - tailLen)
      hash.update(tail)
    }
    return hash.update(String(tipSize)).digest('hex').slice(0, 16)
  } catch {
    return `s${tipSize}`
  } finally {
    if (fh) await fh.close().catch(() => undefined)
  }
}
