import fsp from 'node:fs/promises'
import type { DriveInfo } from '@shared/schemas/fs'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    return [{ path: '/', label: '/' }]
  }
  const results = await Promise.allSettled(
    LETTERS.map(async (letter) => {
      const root = `${letter}:\\`
      await fsp.access(root)
      return { path: root, label: `${letter}:` }
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<DriveInfo> => r.status === 'fulfilled')
    .map((r) => r.value)
}
