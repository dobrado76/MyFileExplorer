import { describe, expect, it } from 'vitest'
import { alignedReadRange } from '../main/fs/undelete/volume'

describe('undelete volume aligned reads', () => {
  it('aligns raw volume read ranges to sector boundaries', () => {
    // 1000-byte file at cluster start — must read 1024 and slice
    const a = alignedReadRange(4096n, 1000, 512)
    expect(a.readOffset).toBe(4096n)
    expect(a.readLength).toBe(1024)
    expect(a.sliceStart).toBe(0)

    // Already aligned
    const b = alignedReadRange(4096n, 4096, 512)
    expect(b.readOffset).toBe(4096n)
    expect(b.readLength).toBe(4096)
    expect(b.sliceStart).toBe(0)

    // Unaligned offset inside a sector
    const c = alignedReadRange(4100n, 10, 512)
    expect(c.readOffset).toBe(4096n)
    expect(c.sliceStart).toBe(4)
    expect(c.readLength).toBe(512)
  })
})
