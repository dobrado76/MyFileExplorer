/**
 * List a Unity `.unitypackage` (gzip-compressed tar) as an Assets/… tree.
 * Reads only `pathname` bodies + `asset` sizes — does not extract payloads.
 */
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { extract as tarExtract } from 'tar-stream'
import type { ArchiveTreeNode } from '@shared/schemas/preview'
import { buildArchiveTreeFromEntries, type ZipListEntry } from './zipArchive'

const GUID_RE = /^([0-9a-f]{32})\/(pathname|asset|asset\.meta|preview\.png)$/i

type GuidInfo = {
  pathname?: string
  assetSize?: number
  hasAsset: boolean
}

function readStreamText(stream: NodeJS.ReadableStream, maxBytes = 64_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    stream.on('data', (chunk: Buffer) => {
      if (total >= maxBytes) return
      const slice = total + chunk.length > maxBytes ? chunk.subarray(0, maxBytes - total) : chunk
      chunks.push(slice)
      total += slice.length
    })
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

function drain(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('data', () => undefined)
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
}

/**
 * Stream-parse a `.unitypackage` and return a ZIP-style preview tree of Unity paths.
 */
export async function loadUnityPackageTree(filePath: string): Promise<{
  tree: ArchiveTreeNode[]
  truncated: boolean
  fileCount: number
  folderCount: number
}> {
  const byGuid = new Map<string, GuidInfo>()

  await new Promise<void>((resolve, reject) => {
    const extract = tarExtract()
    let failed = false

    extract.on('entry', (header, stream, next) => {
      const name = (header.name || '').replace(/\\/g, '/').replace(/^\.\//, '')
      const m = GUID_RE.exec(name)
      if (!m || header.type === 'directory') {
        void drain(stream).then(() => next()).catch(next)
        return
      }
      const guid = m[1]!.toLowerCase()
      const kind = m[2]!.toLowerCase()
      let info = byGuid.get(guid)
      if (!info) {
        info = { hasAsset: false }
        byGuid.set(guid, info)
      }

      if (kind === 'pathname') {
        void readStreamText(stream)
          .then((text) => {
            const line = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0]?.trim()
            if (line) info!.pathname = line.replace(/\\/g, '/')
            next()
          })
          .catch(next)
        return
      }

      if (kind === 'asset') {
        info.hasAsset = true
        if (typeof header.size === 'number' && header.size >= 0) {
          info.assetSize = header.size
        }
      }

      void drain(stream).then(() => next()).catch(next)
    })

    extract.on('finish', () => {
      if (!failed) resolve()
    })
    extract.on('error', (e) => {
      failed = true
      reject(e)
    })

    const input = createReadStream(filePath)
    input.on('error', (e) => {
      failed = true
      reject(e)
    })
    const gunzip = createGunzip()
    gunzip.on('error', (e) => {
      failed = true
      reject(e)
    })
    input.pipe(gunzip).pipe(extract)
  })

  const entries: ZipListEntry[] = []
  for (const info of byGuid.values()) {
    const pathname = info.pathname?.replace(/^\/+/, '').trim()
    if (!pathname || pathname.includes('..')) continue
    if (info.hasAsset) {
      entries.push({
        name: pathname,
        isDir: false,
        uncompressedSize: info.assetSize
      })
    } else {
      entries.push({
        name: pathname.endsWith('/') ? pathname : `${pathname}/`,
        isDir: true
      })
    }
  }

  return buildArchiveTreeFromEntries(entries)
}
