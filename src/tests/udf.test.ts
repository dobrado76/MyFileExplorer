import { describe, expect, it } from 'vitest'
import { tryListUdf } from '../main/preview/udf'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('tryListUdf', () => {
  it('returns null when no AVDP is present', async () => {
    const tmp = path.join(os.tmpdir(), `mfe-udf-empty-${Date.now()}.img`)
    await fsp.writeFile(tmp, Buffer.alloc(512 * 2048, 0))
    try {
      const fh = await fsp.open(tmp, 'r')
      try {
        await expect(tryListUdf(fh)).resolves.toBeNull()
      } finally {
        await fh.close()
      }
    } finally {
      await fsp.unlink(tmp).catch(() => undefined)
    }
  })
})
