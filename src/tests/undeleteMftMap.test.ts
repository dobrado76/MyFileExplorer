import { describe, expect, it } from 'vitest'
import { mftRecordVolumeOffset, parseDataRunsBig, type MftLayout } from '../main/fs/undelete/mftMap'

describe('undelete mftMap', () => {
  it('parses large LCN runlists with bigint', () => {
    // length=1, offset=+0x100000000 (5-byte offset) — header 0x51
    const runs = parseDataRunsBig(
      Buffer.from([0x51, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00])
    )
    expect(runs[0]?.lcn).toBe(0x100000000n)
    expect(runs[0]?.length).toBe(1n)
  })

  it('maps record indexes through fragmented $MFT runs', () => {
    const layout: MftLayout = {
      vol: {
        bytesPerSector: 512,
        bytesPerCluster: 4096,
        bytesPerFileRecord: 1024,
        mftStartLcn: 100n,
        mftValidDataLength: 1024n * 10n,
        totalClusters: 1_000_000n
      },
      // 4 records per cluster (4096/1024). Run0: VCN 0-1 → LCN 100; Run1: VCN 2-3 → LCN 5000
      runs: [
        { startVcn: 0n, clusters: 2n, lcn: 100n },
        { startVcn: 2n, clusters: 2n, lcn: 5000n }
      ],
      recordCount: 16
    }
    expect(mftRecordVolumeOffset(layout, 0)).toBe(100n * 4096n)
    expect(mftRecordVolumeOffset(layout, 4)).toBe(100n * 4096n + 4096n)
    expect(mftRecordVolumeOffset(layout, 8)).toBe(5000n * 4096n)
  })
})
