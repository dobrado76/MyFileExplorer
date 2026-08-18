import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import { AppError } from '@shared/result'

function secretKey(id: string): string {
  return `ai-secret:${id}`
}

type SecretsMap = Record<string, string>
let secretsCache: SecretsMap | null = null

function secretsPath(): string {
  return path.join(app.getPath('userData'), 'ai-secrets.json')
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

export function getAiApiKey(id: string): string | null {
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

export function hasAiApiKey(id: string): boolean {
  const map = loadSecretsMap()
  return Boolean(map[secretKey(id)])
}

export function setAiApiKey(id: string, apiKey: string | null): void {
  const map = loadSecretsMap()
  const key = secretKey(id)
  if (!apiKey) {
    delete map[key]
    saveSecretsMap(map)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError('not-allowed', 'OS secret storage is unavailable; cannot save API keys')
  }
  map[key] = safeStorage.encryptString(apiKey).toString('base64')
  saveSecretsMap(map)
}

export function deleteAiApiKey(id: string): void {
  setAiApiKey(id, null)
}
