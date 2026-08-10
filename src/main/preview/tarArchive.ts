/**
 * List `.tar` / `.tar.gz` / `.tgz` for the preview contents tree (no extract).
 */
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { extract as tarExtract } from 'tar-stream'
import { buildArchiveTreeFromEntries, MAX_ZIP_TREE_NODES, type ZipListEntry } from './zipArchive'

function drain(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('data', () => undefined)
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
}

async function listTarEntries(
  filePath: string,
  gzip: boolean
): Promise<ZipListEntry[]> {
  const entries: ZipListEntry[] = []

  await new Promise<void>((resolve, reject) => {
    const extract = tarExtract()
    let failed = false
    let truncated = false

    extract.on('entry', (header, stream, next) => {
      if (truncated) {
        void drain(stream).then(() => next()).catch(next)
        return
      }

      const name = (header.name || '').replace(/\\/g, '/').replace(/^\.\//, '')
      if (name && !name.includes('..')) {
        const isDir = header.type === 'directory' || name.endsWith('/')
        entries.push({
          name,
          isDir,
          uncompressedSize:
            !isDir && typeof header.size === 'number' && header.size >= 0
              ? header.size
              : undefined
        })
        if (entries.length >= MAX_ZIP_TREE_NODES + 64) {
          truncated = true
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

    if (gzip) {
      const gunzip = createGunzip()
      gunzip.on('error', (e) => {
        failed = true
        reject(e)
      })
      input.pipe(gunzip).pipe(extract)
    } else {
      input.pipe(extract)
    }
  })

  return entries
}

export async function loadTarArchiveTree(
  filePath: string,
  gzip: boolean
): Promise<{
  tree: ReturnType<typeof buildArchiveTreeFromEntries>['tree']
  truncated: boolean
  fileCount: number
  folderCount: number
}> {
  const entries = await listTarEntries(filePath, gzip)
  return buildArchiveTreeFromEntries(entries)
}
