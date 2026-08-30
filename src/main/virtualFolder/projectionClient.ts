/**
 * Named-pipe client for MyFileExplorer.VirtualFolderService (D68).
 * Win32 only — import dynamically behind `process.platform === 'win32'`.
 */
import net from 'node:net'
import { AppError } from '@shared/result'

export const VIRTUAL_FOLDER_PIPE = '\\\\.\\pipe\\MyFileExplorer.VirtualFolderService'

export type ProjectionStatus = {
  winFspAvailable: boolean
  hostMode: string
  mountCount: number
  version: string
}

export type ProjectionMountInfo = {
  documentPath: string
  mountPath: string
  active: boolean
}

type PipeResponse = {
  ok: boolean
  error?: string
  id?: string
  status?: ProjectionStatus
  mounts?: ProjectionMountInfo[]
  mount?: ProjectionMountInfo
}

const CONNECT_MS = 2_500
const IO_MS = 8_000

function request(cmd: string, documentPath?: string): Promise<PipeResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      cmd,
      ...(documentPath ? { documentPath } : {})
    })
    const socket = net.connect(VIRTUAL_FOLDER_PIPE)
    let settled = false
    let buf = ''
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      reject(err)
    }
    const timer = setTimeout(() => fail(new AppError('io', 'Virtual Folder projection service timed out')), IO_MS)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.setTimeout(0)
      socket.write(payload + '\n')
    })
    socket.on('data', (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      clearTimeout(timer)
      if (settled) return
      settled = true
      const line = buf.slice(0, nl).trim()
      try {
        socket.end()
      } catch {
        /* ignore */
      }
      try {
        resolve(JSON.parse(line) as PipeResponse)
      } catch {
        reject(new AppError('io', 'Invalid response from Virtual Folder projection service'))
      }
    })
    socket.on('error', (e) => {
      clearTimeout(timer)
      const msg = e instanceof Error ? e.message : String(e)
      fail(
        new AppError(
          'io',
          `Virtual Folder projection service unavailable (${msg}). Start MfeVirtualFolderService or install WinFsp.`,
          'Run the projection service with --console, or install it as a Windows service.'
        )
      )
    })
    socket.on('timeout', () => fail(new AppError('io', 'Virtual Folder projection service timed out')))
    socket.setTimeout(CONNECT_MS)
  })
}

async function call(cmd: string, documentPath?: string): Promise<PipeResponse> {
  const res = await request(cmd, documentPath)
  if (!res.ok) {
    throw new AppError('io', res.error || 'Projection command failed')
  }
  return res
}

export async function projectionStatus(): Promise<ProjectionStatus> {
  const res = await call('status')
  return (
    res.status ?? {
      winFspAvailable: false,
      hostMode: 'per-user',
      mountCount: 0,
      version: '0'
    }
  )
}

export async function projectionMount(documentPath: string): Promise<ProjectionMountInfo> {
  const res = await call('mount', documentPath)
  if (!res.mount) throw new AppError('io', 'Mount succeeded but no mount info returned')
  return res.mount
}

export async function projectionUnmount(documentPath: string): Promise<void> {
  await call('unmount', documentPath)
}

export async function projectionListMounts(): Promise<ProjectionMountInfo[]> {
  const res = await call('listmounts')
  return res.mounts ?? []
}
