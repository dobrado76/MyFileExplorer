import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Client as FtpClient, type FileInfo as FtpFileInfo } from 'basic-ftp'
import { Client as SshClient } from 'ssh2'
import type { DirEntry } from '@shared/schemas/fs'
import { AppError } from '@shared/result'
import {
  formatRemoteLocation,
  remoteBasename,
  remoteJoin,
  parseRemoteLocation
} from '@shared/remotePaths'
import type { RemoteConnection, RemoteProtocol } from '@shared/schemas/remoteConnections'
import {
  getRemoteConnection,
  getRemotePassword,
  updateRemoteFingerprint
} from './connectionsStore'

type RemoteSession = {
  connectionId: string
  protocol: RemoteProtocol
  sftp?: {
    ssh: SshClient
    sftp: import('ssh2').SFTPWrapper
  }
  ftp?: FtpClient
  lastUsed: number
}

const sessions = new Map<string, RemoteSession>()
/** basic-ftp allows only one in-flight command per client — serialize all work per connection. */
const connectionQueues = new Map<string, Promise<unknown>>()
const IDLE_MS = 15 * 60_000

function fingerprintOf(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64')
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i + 1).toLowerCase()
}

function touch(session: RemoteSession): void {
  session.lastUsed = Date.now()
}

/**
 * Run remote work exclusively for a connection. FTP clients close themselves if a
 * second command starts while one is still running; SFTP is also safer serialized.
 */
async function withConnectionLock<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = connectionQueues.get(connectionId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = prev.then(() => gate, () => gate)
  connectionQueues.set(connectionId, tail)
  await prev.then(
    () => undefined,
    () => undefined
  )
  try {
    return await fn()
  } finally {
    release()
    if (connectionQueues.get(connectionId) === tail) {
      connectionQueues.delete(connectionId)
    }
  }
}

function isFtpClosedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /client is closed|still running|Forgot to use/i.test(msg)
}

async function connectRemoteUnlocked(connectionId: string): Promise<RemoteConnection> {
  const existing = sessions.get(connectionId)
  if (existing) {
    touch(existing)
    const c = getRemoteConnection(connectionId)
    if (!c) throw new AppError('not-found', 'Remote connection not found')
    return c
  }
  const conn = getRemoteConnection(connectionId)
  if (!conn) throw new AppError('not-found', 'Remote connection not found')
  if (conn.protocol === 'ftp' && !conn.insecureFtpAck) {
    throw new AppError('validation', 'Cleartext FTP requires an insecure acknowledgment')
  }
  const password = getRemotePassword(connectionId)
  if (password == null) {
    throw new AppError('validation', 'No password saved for this connection — edit and set one')
  }
  const session =
    conn.protocol === 'sftp'
      ? await connectSftp(conn, password)
      : await connectFtp(conn, password)
  sessions.set(connectionId, session)
  return conn
}

export async function connectRemote(connectionId: string): Promise<RemoteConnection> {
  return withConnectionLock(connectionId, () => connectRemoteUnlocked(connectionId))
}

async function requireSession(connectionId: string): Promise<RemoteSession> {
  let s = sessions.get(connectionId)
  if (!s) {
    // Caller must already hold the connection lock (withRemoteSession / connectRemote).
    await connectRemoteUnlocked(connectionId)
    s = sessions.get(connectionId)
  }
  if (!s) throw new AppError('io', 'Remote session unavailable')
  touch(s)
  return s
}

/** Drop a dead session so the next op reconnects (must run under the connection lock). */
function invalidateSessionUnlocked(connectionId: string): void {
  const s = sessions.get(connectionId)
  if (!s) return
  sessions.delete(connectionId)
  try {
    if (s.sftp) {
      s.sftp.sftp.end()
      s.sftp.ssh.end()
    }
    if (s.ftp) s.ftp.close()
  } catch {
    /* ignore */
  }
}

/**
 * Run an FTP/SFTP op under the per-connection lock. If FTP closed mid-flight from a
 * prior race, reconnect once and retry.
 */
async function withRemoteSession<T>(
  connectionId: string,
  fn: (session: RemoteSession) => Promise<T>
): Promise<T> {
  return withConnectionLock(connectionId, async () => {
    let session = await requireSession(connectionId)
    try {
      return await fn(session)
    } catch (e) {
      if (!isFtpClosedError(e) || !session.ftp) throw e
      invalidateSessionUnlocked(connectionId)
      session = await requireSession(connectionId)
      return await fn(session)
    }
  })
}

export function isRemoteConnected(connectionId: string): boolean {
  return sessions.has(connectionId)
}

export function listConnectedRemoteIds(): string[] {
  return [...sessions.keys()]
}

export async function disconnectRemote(connectionId: string): Promise<void> {
  const s = sessions.get(connectionId)
  if (!s) return
  sessions.delete(connectionId)
  try {
    if (s.sftp) {
      s.sftp.sftp.end()
      s.sftp.ssh.end()
    }
    if (s.ftp) s.ftp.close()
  } catch {
    /* ignore */
  }
}

export async function disconnectAllRemotes(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => disconnectRemote(id)))
}

setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > IDLE_MS) void disconnectRemote(id)
  }
}, 60_000).unref?.()

async function connectSftp(conn: RemoteConnection, password: string): Promise<RemoteSession> {
  const ssh = new SshClient()
  const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => {
    const onReady = (): void => {
      ssh.sftp((err, sftpClient) => {
        if (err || !sftpClient) {
          reject(err ?? new Error('SFTP unavailable'))
          return
        }
        resolve(sftpClient)
      })
    }
    ssh.on('ready', onReady)
    ssh.on('error', reject)
    ssh.connect({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      readyTimeout: 20_000,
      hostVerifier: (key: Buffer) => {
        const fp = fingerprintOf(key)
        if (!conn.hostFingerprint) {
          updateRemoteFingerprint(conn.id, fp)
          return true
        }
        if (conn.hostFingerprint === fp) return true
        reject(
          new AppError(
            'not-allowed',
            'SSH host key mismatch — edit the connection to clear the stored fingerprint if the server changed'
          )
        )
        return false
      }
    })
  })
  return { connectionId: conn.id, protocol: 'sftp', sftp: { ssh, sftp }, lastUsed: Date.now() }
}

async function connectFtp(conn: RemoteConnection, password: string): Promise<RemoteSession> {
  const client = new FtpClient(20_000)
  client.ftp.verbose = false
  const secure =
    conn.protocol === 'ftps'
      ? ('implicit' as const)
      : false
  try {
    await client.access({
      host: conn.host,
      port: conn.port,
      user: conn.username,
      password,
      secure,
      secureOptions:
        conn.protocol === 'ftps'
          ? {
              // TOFU-lite: accept first cert; pin fingerprint string of cert DER if stored
              rejectUnauthorized: false,
              checkServerIdentity: (_host, cert) => {
                const raw = (cert as { raw?: Buffer }).raw
                if (!raw) return undefined
                const fp = createHash('sha256').update(raw).digest('base64')
                if (!conn.hostFingerprint) {
                  updateRemoteFingerprint(conn.id, fp)
                  return undefined
                }
                if (conn.hostFingerprint === fp) return undefined
                return new Error('FTPS certificate mismatch')
              }
            }
          : undefined
    })
  } catch (e) {
    client.close()
    throw e
  }
  return { connectionId: conn.id, protocol: conn.protocol, ftp: client, lastUsed: Date.now() }
}

function ftpToEntries(
  connectionId: string,
  dirPath: string,
  list: FtpFileInfo[]
): DirEntry[] {
  const out: DirEntry[] = []
  for (const f of list) {
    if (f.name === '.' || f.name === '..') continue
    const kind: DirEntry['kind'] = f.isDirectory ? 'dir' : f.isSymbolicLink ? 'symlink' : 'file'
    const child = remoteJoin(dirPath, f.name)
    if (!child) continue
    out.push({
      name: f.name,
      path: formatRemoteLocation(connectionId, child),
      kind: kind === 'symlink' ? (f.isDirectory ? 'dir' : 'file') : kind,
      size: f.isDirectory ? 0 : Number(f.size) || 0,
      mtimeMs: f.modifiedAt ? f.modifiedAt.getTime() : 0,
      birthtimeMs: 0,
      ext: kind === 'dir' ? '' : extOf(f.name),
      isHidden: f.name.startsWith('.')
    })
  }
  return out
}

export async function listRemoteDirectory(
  locationUri: string,
  includeHidden: boolean
): Promise<{ path: string; entries: DirEntry[] }> {
  const loc = parseRemoteLocation(locationUri)
  if (!loc) throw new AppError('validation', `Not a remote location: ${locationUri}`)
  const remotePath = loc.remotePath

  return withRemoteSession(loc.connectionId, async (session) => {
    if (session.sftp) {
      const list = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) => {
        session.sftp!.sftp.readdir(remotePath, (err, list) => {
          if (err) reject(err)
          else resolve(list ?? [])
        })
      })
      const entries: DirEntry[] = []
      for (const f of list) {
        const name = f.filename
        if (name === '.' || name === '..') continue
        const isDir = (f.attrs.mode & 0o040000) === 0o040000
        const isLnk = (f.attrs.mode & 0o120000) === 0o120000
        if (!includeHidden && name.startsWith('.')) continue
        const child = remoteJoin(remotePath, name)
        if (!child) continue
        entries.push({
          name,
          path: formatRemoteLocation(loc.connectionId, child),
          kind: isDir || isLnk ? 'dir' : 'file',
          size: isDir ? 0 : Number(f.attrs.size) || 0,
          mtimeMs: (f.attrs.mtime || 0) * 1000,
          birthtimeMs: 0,
          ext: isDir ? '' : extOf(name),
          isHidden: name.startsWith('.')
        })
      }
      return { path: formatRemoteLocation(loc.connectionId, remotePath), entries }
    }

    if (session.ftp) {
      const list = await session.ftp.list(remotePath)
      let entries = ftpToEntries(loc.connectionId, remotePath, list)
      if (!includeHidden) entries = entries.filter((e) => !e.isHidden)
      return { path: formatRemoteLocation(loc.connectionId, remotePath), entries }
    }

    throw new AppError('io', 'Remote session has no protocol client')
  })
}

export async function remoteMkdir(parentUri: string, name: string): Promise<string> {
  const loc = parseRemoteLocation(parentUri)
  if (!loc) throw new AppError('validation', 'Not a remote location')
  const child = remoteJoin(loc.remotePath, name)
  if (!child) throw new AppError('validation', 'Invalid folder name')
  return withRemoteSession(loc.connectionId, async (session) => {
    if (session.sftp) {
      await new Promise<void>((resolve, reject) => {
        session.sftp!.sftp.mkdir(child, (err) => (err ? reject(err) : resolve()))
      })
    } else if (session.ftp) {
      await session.ftp.ensureDir(child)
    }
    return formatRemoteLocation(loc.connectionId, child)
  })
}

export async function remoteRename(uri: string, newName: string): Promise<string> {
  const loc = parseRemoteLocation(uri)
  if (!loc) throw new AppError('validation', 'Not a remote location')
  const parent =
    loc.remotePath === '/'
      ? '/'
      : loc.remotePath.slice(0, loc.remotePath.lastIndexOf('/')) || '/'
  const dest = remoteJoin(parent === '' ? '/' : parent, newName)
  if (!dest) throw new AppError('validation', 'Invalid name')
  return withRemoteSession(loc.connectionId, async (session) => {
    if (session.sftp) {
      await new Promise<void>((resolve, reject) => {
        session.sftp!.sftp.rename(loc.remotePath, dest, (err) => (err ? reject(err) : resolve()))
      })
    } else if (session.ftp) {
      await session.ftp.rename(loc.remotePath, dest)
    }
    return formatRemoteLocation(loc.connectionId, dest)
  })
}

export async function remoteDelete(uri: string): Promise<void> {
  const loc = parseRemoteLocation(uri)
  if (!loc) throw new AppError('validation', 'Not a remote location')
  if (loc.remotePath === '/') throw new AppError('not-allowed', 'Cannot delete remote root')
  await withRemoteSession(loc.connectionId, async (session) => {
    if (session.sftp) {
      const st = await new Promise<import('ssh2').Stats>((resolve, reject) => {
        session.sftp!.sftp.stat(loc.remotePath, (err, stats) =>
          err || !stats ? reject(err) : resolve(stats)
        )
      })
      if (st.isDirectory()) {
        await new Promise<void>((resolve, reject) => {
          session.sftp!.sftp.rmdir(loc.remotePath, (err) => (err ? reject(err) : resolve()))
        })
      } else {
        await new Promise<void>((resolve, reject) => {
          session.sftp!.sftp.unlink(loc.remotePath, (err) => (err ? reject(err) : resolve()))
        })
      }
    } else if (session.ftp) {
      await session.ftp.remove(loc.remotePath, true)
    }
  })
}

export async function remoteUploadFile(
  localPath: string,
  destDirUri: string,
  destName?: string
): Promise<string> {
  const loc = parseRemoteLocation(destDirUri)
  if (!loc) throw new AppError('validation', 'Not a remote location')
  const name = destName || path.basename(localPath)
  const dest = remoteJoin(loc.remotePath, name)
  if (!dest) throw new AppError('validation', 'Invalid destination name')
  return withRemoteSession(loc.connectionId, async (session) => {
    if (session.sftp) {
      await new Promise<void>((resolve, reject) => {
        session.sftp!.sftp.fastPut(localPath, dest, (err) => (err ? reject(err) : resolve()))
      })
    } else if (session.ftp) {
      await session.ftp.uploadFrom(localPath, dest)
    }
    return formatRemoteLocation(loc.connectionId, dest)
  })
}

export async function remoteDownloadFile(uri: string, localPath: string): Promise<void> {
  const loc = parseRemoteLocation(uri)
  if (!loc) throw new AppError('validation', 'Not a remote location')
  // Never mkdir drive roots (Z:\) — exists but mkdir throws EPERM on Windows.
  const parent = path.dirname(localPath)
  if (parent && parent !== '.' && !fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true })
  }
  await withRemoteSession(loc.connectionId, async (session) => {
    if (session.sftp) {
      await new Promise<void>((resolve, reject) => {
        session.sftp!.sftp.fastGet(loc.remotePath, localPath, (err) =>
          err ? reject(err) : resolve()
        )
      })
    } else if (session.ftp) {
      await session.ftp.downloadTo(localPath, loc.remotePath)
    }
  })
}

export type RemoteStatInfo = {
  kind: 'file' | 'dir'
  size: number
  mtimeMs: number
}

/** Stat a remote file/dir (size + mtime). Null when missing. */
export async function remoteStat(uri: string): Promise<RemoteStatInfo | null> {
  const loc = parseRemoteLocation(uri)
  if (!loc) return null
  try {
    return await withRemoteSession(loc.connectionId, async (session) => {
      if (session.sftp) {
        const st = await new Promise<import('ssh2').Stats | null>((resolve) => {
          session.sftp!.sftp.stat(loc.remotePath, (err, stats) =>
            resolve(err || !stats ? null : stats)
          )
        })
        if (!st) return null
        return {
          kind: st.isDirectory() ? 'dir' : 'file',
          size: st.isDirectory() ? 0 : Number(st.size) || 0,
          mtimeMs: (st.mtime || 0) * 1000
        }
      }
      if (session.ftp) {
        if (loc.remotePath === '/') {
          return { kind: 'dir' as const, size: 0, mtimeMs: 0 }
        }
        const parent = loc.remotePath.slice(0, loc.remotePath.lastIndexOf('/')) || '/'
        const base = remoteBasename(loc.remotePath)
        const list = await session.ftp.list(parent)
        const hit = list.find((f) => f.name === base)
        if (!hit) return null
        return {
          kind: hit.isDirectory ? ('dir' as const) : ('file' as const),
          size: hit.isDirectory ? 0 : Number(hit.size) || 0,
          mtimeMs: hit.modifiedAt ? hit.modifiedAt.getTime() : 0
        }
      }
      return null
    })
  } catch {
    return null
  }
}

export async function remoteStatKind(uri: string): Promise<'file' | 'dir' | null> {
  const st = await remoteStat(uri)
  return st?.kind ?? null
}

export function remoteStartLocation(conn: RemoteConnection): string {
  return formatRemoteLocation(conn.id, conn.startPath || '/')
}

