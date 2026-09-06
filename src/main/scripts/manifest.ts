import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { formatInputManifest } from '@shared/scriptCli'

export function writeInputManifestFile(paths: string[], dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `mfe-script-input-${randomUUID()}.txt`)
  fs.writeFileSync(file, formatInputManifest(paths), 'utf8')
  return file
}

/** Sibling JSON next to an input-list: user-metadata snapshot for scripts. */
export function writeMetaManifestFile(payload: unknown, dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `mfe-script-meta-${randomUUID()}.json`)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  return file
}

export function cleanupManifestFile(file: string | null): void {
  if (!file) return
  try {
    fs.unlinkSync(file)
  } catch {
    /* already gone */
  }
}
