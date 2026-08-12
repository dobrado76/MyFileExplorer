import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import {
  remoteConnectionsFileSchema,
  remoteConnectionSchema,
  type RemoteConnection,
  type RemoteProtocol,
  DEFAULT_REMOTE_PORTS
} from '@shared/schemas/remoteConnections'
import { normalizeRemotePosixPath } from '@shared/remotePaths'
import { JsonStore } from '../store/jsonStore'
import { AppError } from '@shared/result'

const emptyFile = { version: 1 as const, connections: [] as RemoteConnection[] }

let store: JsonStore<typeof emptyFile> | null = null

function connectionsStore(): JsonStore<typeof emptyFile> {
  if (!store) {
    store = new JsonStore(
      path.join(app.getPath('userData'), 'remote-connections.json'),
      remoteConnectionsFileSchema,
      emptyFile,
      200
    )
  }
  return store
}

function secretKey(id: string): string {
  return `remote-secret:${id}`
}

type SecretsMap = Record<string, string>
let secretsCache: SecretsMap | null = null

function secretsPath(): string {
  return path.join(app.getPath('userData'), 'remote-secrets.json')
}

function loadSecretsMap(): SecretsMap {
  if (secretsCache) return secretsCache
  try {
    if (!fs.existsSync(secretsPath())) {
      secretsCache = {}
      return secretsCache
    }
    const raw = JSON.parse(fs.readFileSync(secretsPath(), 'utf8')) as unknown
    secretsCache =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SecretsMap) : {}
  } catch {
    secretsCache = {}
  }
  return secretsCache
}

function saveSecretsMap(map: SecretsMap): void {
  secretsCache = map
  fs.writeFileSync(secretsPath(), JSON.stringify(map, null, 2), 'utf8')
}

export function listRemoteConnections(): RemoteConnection[] {
  const parsed = remoteConnectionsFileSchema.parse(connectionsStore().get())
  return [...parsed.connections].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

export function getRemoteConnection(id: string): RemoteConnection | null {
  return listRemoteConnections().find((c) => c.id === id) ?? null
}

export function getRemotePassword(id: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  const map = loadSecretsMap()
  const b64 = map[secretKey(id)]
  if (!b64) return null
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return null
  }
}

function setRemotePassword(id: string, password: string | null): void {
  const map = loadSecretsMap()
  const key = secretKey(id)
  if (!password) {
    delete map[key]
    saveSecretsMap(map)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError(
      'not-allowed',
      'OS secret storage is unavailable; cannot save remote passwords'
    )
  }
  map[key] = safeStorage.encryptString(password).toString('base64')
  saveSecretsMap(map)
}

export type UpsertRemoteConnectionInput = {
  id?: string
  name: string
  protocol: RemoteProtocol
  host: string
  port?: number
  username: string
  startPath?: string
  insecureFtpAck?: boolean
  /** Omit to leave existing password; empty string clears; non-empty sets. */
  password?: string | null
  hostFingerprint?: string | null
}

export function upsertRemoteConnection(input: UpsertRemoteConnectionInput): RemoteConnection {
  const protocol = input.protocol
  if (protocol === 'ftp' && input.insecureFtpAck !== true) {
    throw new AppError(
      'validation',
      'Cleartext FTP requires acknowledging that credentials and data are unencrypted'
    )
  }
  const startPath = normalizeRemotePosixPath(input.startPath ?? '/') ?? '/'
  const port = input.port && input.port > 0 ? input.port : DEFAULT_REMOTE_PORTS[protocol]
  const id = input.id?.trim() || randomUUID()
  const existing = getRemoteConnection(id)
  let hasPassword = existing?.hasPassword ?? false

  if (input.password !== undefined) {
    if (input.password === null || input.password === '') {
      setRemotePassword(id, null)
      hasPassword = false
    } else {
      setRemotePassword(id, input.password)
      hasPassword = true
    }
  }

  const next: RemoteConnection = {
    id,
    name: input.name.trim(),
    protocol,
    host: input.host.trim(),
    port,
    username: input.username.trim(),
    startPath,
    insecureFtpAck: protocol === 'ftp' ? true : false,
    hostFingerprint:
      input.hostFingerprint !== undefined
        ? input.hostFingerprint
        : (existing?.hostFingerprint ?? null),
    hasPassword,
    updatedAt: Date.now()
  }

  if (!next.name || !next.host || !next.username) {
    throw new AppError('validation', 'Name, host, and username are required')
  }

  const all = listRemoteConnections().filter((c) => c.id !== id)
  all.push(next)
  connectionsStore().replace({ version: 1, connections: all })
  connectionsStore().flush()
  return next
}

export function renameRemoteConnection(id: string, name: string): RemoteConnection {
  const cur = getRemoteConnection(id)
  if (!cur) throw new AppError('not-found', 'Remote connection not found')
  const trimmed = name.trim()
  if (!trimmed) throw new AppError('validation', 'Name is required')
  return upsertRemoteConnection({
    id,
    name: trimmed,
    protocol: cur.protocol,
    host: cur.host,
    port: cur.port,
    username: cur.username,
    startPath: cur.startPath,
    insecureFtpAck: cur.insecureFtpAck,
    hostFingerprint: cur.hostFingerprint
  })
}

export function deleteRemoteConnection(id: string): void {
  setRemotePassword(id, null)
  const all = listRemoteConnections().filter((c) => c.id !== id)
  connectionsStore().replace({ version: 1, connections: all })
  connectionsStore().flush()
}

export function updateRemoteFingerprint(id: string, fingerprint: string | null): void {
  const cur = getRemoteConnection(id)
  if (!cur) return
  upsertRemoteConnection({
    id,
    name: cur.name,
    protocol: cur.protocol,
    host: cur.host,
    port: cur.port,
    username: cur.username,
    startPath: cur.startPath,
    insecureFtpAck: cur.insecureFtpAck,
    hostFingerprint: fingerprint
  })
}

/** Connections for settings export — never include password material. */
export function listRemoteConnectionsForExport(): RemoteConnection[] {
  return listRemoteConnections().map((c) => ({
    ...c,
    hasPassword: false
  }))
}

/**
 * Replace the saved connection list (settings import). Clears all stored passwords.
 * Returns the normalized list length.
 */
export function replaceRemoteConnections(
  connections: RemoteConnection[]
): RemoteConnection[] {
  // Wipe all secrets — passwords do not travel with export/import.
  saveSecretsMap({})
  const normalized: RemoteConnection[] = []
  const seen = new Set<string>()
  for (const raw of connections) {
    const parsed = remoteConnectionSchema.safeParse({
      ...raw,
      hasPassword: false
    })
    if (!parsed.success) continue
    if (seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    if (parsed.data.protocol === 'ftp' && !parsed.data.insecureFtpAck) continue
    normalized.push({ ...parsed.data, hasPassword: false, updatedAt: Date.now() })
  }
  connectionsStore().replace({ version: 1, connections: normalized })
  connectionsStore().flush()
  return listRemoteConnections()
}
