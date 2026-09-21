import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { tipContentStamp } from '../main/thumbs/tipStamp'

describe('tipContentStamp', () => {
  it('changes when tip bytes change at the same length', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-tip-stamp-'))
    const file = path.join(dir, 'tip.bin')
    const a = Buffer.alloc(16_384, 1)
    const b = Buffer.alloc(16_384, 2)
    await fsp.writeFile(file, a)
    const stampA = await tipContentStamp(file, a.length)
    await fsp.writeFile(file, b)
    const stampB = await tipContentStamp(file, b.length)
    expect(stampA).not.toBe(stampB)
    expect(stampA).toMatch(/^[0-9a-f]{16}$/)
    await fsp.rm(dir, { recursive: true, force: true })
  })
})
