/**
 * Stage remote files under userData for open / preview (D46).
 * Never writes onto the remote; mfe-media allowlists this scratch root.
 */
import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import { parseRemoteLocation, remoteBasename } from '@shared/remotePaths'
import { protocolAllowlist } from '../security/paths'
import { remoteDownloadFile, remoteStat } from './sessionPool'

let scratchRoot: string | null = null
const inFlight = new Map<string, Promise<string>>()

function getScratchRoot(): string {
  if (!scratchRoot) {
    scratchRoot = path.join(app.getPath('userData'), 'remote-scratch')
    fs.mkdirSync(scratchRoot, { recursive: true })
    protocolAllowlist.allowDirPermanently(scratchRoot)
  }
  return scratchRoot
}

function safeFileName(name: string): string {
  let cleaned = ''
  for (const ch of name) {
    const code = ch.charCodeAt(0)
    if (code < 32 || '<>:"/\\|?*'.includes(ch)) cleaned += '_'
    else cleaned += ch
  }
  cleaned = cleaned.replace(/^\.+/, '')
  return cleaned || 'file'
}

export async function ensureRemoteLocalFile(uri: string): Promise<{
  localPath: string
  size: number
  mtimeMs: number
}> {
  const loc = parseRemoteLocation(uri)
  if (!loc) throw new AppError('validation', 'Not a remote location')

  const st = await remoteStat(uri)
  if (!st) throw new AppError('not-found', 'Remote file not found')
  if (st.kind === 'dir') {
    throw new AppError('not-allowed', 'Cannot stage a remote folder as a file')
  }

  const key = crypto.createHash('sha1').update(uri.toLowerCase()).digest('hex').slice(0, 20)
  const base = safeFileName(remoteBasename(loc.remotePath))
  const dir = path.join(getScratchRoot(), key)
  const localPath = path.join(dir, base)
  const metaPath = `${localPath}.mfe-meta.json`
  const flightKey = `${uri.toLowerCase()}|${st.size}|${st.mtimeMs}`

  const pending = inFlight.get(flightKey)
  if (pending) {
    const p = await pending
    return { localPath: p, size: st.size, mtimeMs: st.mtimeMs }
  }

  const job = (async (): Promise<string> => {
    try {
      if (fs.existsSync(localPath) && fs.existsSync(metaPath)) {
        try {
          const raw = await fsp.readFile(metaPath, 'utf8')
          const meta = JSON.parse(raw) as { size?: number; mtimeMs?: number }
          const lst = await fsp.stat(localPath)
          if (
            meta.size === st.size &&
            meta.mtimeMs === st.mtimeMs &&
            lst.size === st.size
          ) {
            return localPath
          }
        } catch {
          /* re-download */
        }
      }

      await fsp.mkdir(dir, { recursive: true })
      const tmp = `${localPath}.partial`
      try {
        await fsp.unlink(tmp)
      } catch {
        /* ok */
      }
      await remoteDownloadFile(uri, tmp)
      await fsp.rename(tmp, localPath)
      await fsp.writeFile(
        metaPath,
        JSON.stringify({ size: st.size, mtimeMs: st.mtimeMs, uri }),
        'utf8'
      )
      return localPath
    } finally {
      inFlight.delete(flightKey)
    }
  })()

  inFlight.set(flightKey, job)
  const local = await job
  return { localPath: local, size: st.size, mtimeMs: st.mtimeMs }
}
