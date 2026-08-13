/**
 * Win32-only LAN neighborhood: NetShareEnum / WNet dialogs + discovery worker.
 * Loaded lazily from `network.ts` so Linux builds never pull koffi at startup.
 */
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import koffi from 'koffi'
import { app, BrowserWindow } from 'electron'
import { AppError } from '@shared/result'
import type { NetworkHost, NetworkShare } from '@shared/schemas/network'
import {
  isHiddenNetworkShare,
  normalizeServerName,
  shareUnc
} from '@shared/networkPaths'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'
import { getSettings } from '../settings/store'
import {
  flushRememberedNetworkHosts,
  getRememberedNetworkHosts,
  rememberNetworkHost,
  rememberNetworkHosts
} from './networkRemembered'
import { hostsForNetworkTree } from './networkShared'

const RESOURCETYPE_DISK = 1
const STYPE_DISKTREE = 0

type MprApi = {
  WNetConnectionDialog: (hwnd: unknown, dwType: number) => number
  WNetDisconnectDialog: (hwnd: unknown, dwType: number) => number
}

type NetApi = {
  NetShareEnum: (
    server: string | null,
    level: number,
    bufptr: unknown[],
    prefmaxlen: number,
    entriesread: number[],
    totalentries: number[],
    resume: number[]
  ) => number
  NetApiBufferFree: (buf: unknown) => number
}

let mprApi: MprApi | null | undefined
let netApi: NetApi | null | undefined
let ShareInfo1: ReturnType<typeof koffi.struct> | null = null

function ensureMpr(): MprApi | null {
  if (mprApi !== undefined) return mprApi
  try {
    const mpr = koffi.load('mpr.dll')
    mprApi = {
      WNetConnectionDialog: mpr.func(
        'uint32 __stdcall WNetConnectionDialog(void *hwnd, uint32 dwType)'
      ),
      WNetDisconnectDialog: mpr.func(
        'uint32 __stdcall WNetDisconnectDialog(void *hwnd, uint32 dwType)'
      )
    }
  } catch (e) {
    logMain('warn', `network: mpr.dll load failed: ${e instanceof Error ? e.message : String(e)}`)
    mprApi = null
  }
  return mprApi
}

function ensureNetApi(): NetApi | null {
  if (netApi !== undefined) return netApi
  try {
    const netapi32 = koffi.load('netapi32.dll')
    ShareInfo1 = koffi.struct('MfeSHARE_INFO_1', {
      shi1_netname: 'str16',
      shi1_type: 'uint32',
      shi1_remark: 'str16'
    })
    netApi = {
      NetShareEnum: netapi32.func(
        'uint32 __stdcall NetShareEnum(str16 servername, uint32 level, _Out_ void **bufptr, uint32 prefmaxlen, _Out_ uint32 *entriesread, _Out_ uint32 *totalentries, _Inout_ uint32 *resume_handle)'
      ),
      NetApiBufferFree: netapi32.func('uint32 __stdcall NetApiBufferFree(void *Buffer)')
    }
  } catch (e) {
    logMain('warn', `network: netapi32 load failed: ${e instanceof Error ? e.message : String(e)}`)
    netApi = null
  }
  return netApi
}

function hwndFromWindow(win: BrowserWindow | null): unknown {
  if (!win || win.isDestroyed()) return null
  try {
    const buf = win.getNativeWindowHandle()
    if (buf.length >= 8) return buf.readBigUInt64LE(0)
    if (buf.length >= 4) return buf.readUInt32LE(0)
  } catch {
    /* ignore */
  }
  return null
}

function ownerHwnd(): unknown {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return hwndFromWindow(focused)
  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  return hwndFromWindow(all[0] ?? null)
}

export function openMapNetworkDriveDialog(): { opened: boolean; result: number } {
  const api = ensureMpr()
  if (!api) throw new AppError('io', 'Map network drive is only available on Windows')
  const hwnd = ownerHwnd()
  const result = api.WNetConnectionDialog(hwnd, RESOURCETYPE_DISK)
  return { opened: true, result }
}

export function openDisconnectNetworkDriveDialog(): { opened: boolean; result: number } {
  const api = ensureMpr()
  if (!api) throw new AppError('io', 'Disconnect network drive is only available on Windows')
  const hwnd = ownerHwnd()
  const result = api.WNetDisconnectDialog(hwnd, RESOURCETYPE_DISK)
  return { opened: true, result }
}

export function listNetworkShares(serverRaw: string): NetworkShare[] {
  const api = ensureNetApi()
  if (!api || !ShareInfo1) {
    throw new AppError('io', 'Network shares are only available on Windows')
  }
  const server = normalizeServerName(serverRaw)
  if (!server) throw new AppError('validation', 'Invalid server name')
  const uncServer = `\\\\${server}`

  const bufptr: unknown[] = [null]
  const entriesread = [0]
  const totalentries = [0]
  const resume = [0]
  const status = api.NetShareEnum(server, 1, bufptr, 0xffffffff, entriesread, totalentries, resume)
  if (status !== 0 && status !== 234) {
    throw new AppError(
      'io',
      status === 53 || status === 67 || status === 1707
        ? `Cannot reach ${uncServer}`
        : status === 5
          ? `Access denied listing shares on ${server}`
          : `Could not list shares (error ${status})`
    )
  }

  const base = bufptr[0]
  const count = entriesread[0] ?? 0
  const out: NetworkShare[] = []
  try {
    if (base && count > 0) {
      const sizeof = koffi.sizeof(ShareInfo1)
      for (let i = 0; i < count; i++) {
        const row = koffi.decode(base as never, i * sizeof, ShareInfo1) as {
          shi1_netname: string
          shi1_type: number
          shi1_remark: string
        }
        const name = String(row.shi1_netname ?? '').trim()
        if (!name || isHiddenNetworkShare(name)) continue
        const type = row.shi1_type >>> 0
        const baseType = type & 0x0fffffff
        if (baseType !== STYPE_DISKTREE) continue
        const remark = String(row.shi1_remark ?? '').trim()
        out.push({
          name,
          unc: shareUnc(server, name),
          ...(remark ? { remark } : {})
        })
      }
    }
  } finally {
    if (base) api.NetApiBufferFree(base)
  }

  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  rememberNetworkHost(server)
  return out
}

let discoverWorker: Worker | null = null
let activeGeneration = 0
let discoverBusy = false

function workerScriptPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'out', 'main', 'networkDiscoverWorker.js'),
    path.join(
      path.dirname(process.execPath),
      'resources',
      'app.asar',
      'out',
      'main',
      'networkDiscoverWorker.js'
    ),
    path.join(__dirname, 'networkDiscoverWorker.js'),
    path.join(__dirname, '..', 'networkDiscoverWorker.js')
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return candidates[0]!
}

function ensureDiscoverWorker(): Worker | null {
  if (discoverWorker) return discoverWorker
  try {
    const w = new Worker(workerScriptPath())
    w.on('message', (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as {
        type?: string
        generation?: number
        hosts?: NetworkHost[]
        message?: string
      }
      if (m.type === 'progress' && typeof m.generation === 'number') {
        if (m.generation !== activeGeneration) return
        broadcast({
          type: 'network-discovery',
          payload: {
            generation: m.generation,
            status: 'running',
            hosts: hostsForNetworkTree(Array.isArray(m.hosts) ? m.hosts : [])
          }
        })
      } else if (m.type === 'done' && typeof m.generation === 'number') {
        if (m.generation !== activeGeneration) return
        discoverBusy = false
        const hosts = hostsForNetworkTree(Array.isArray(m.hosts) ? m.hosts : [])
        if (hosts.length > 0) rememberNetworkHosts(hosts)
        broadcast({
          type: 'network-discovery',
          payload: {
            generation: m.generation,
            status: 'done',
            hosts
          }
        })
      } else if (m.type === 'error' && typeof m.generation === 'number') {
        if (m.generation !== activeGeneration) return
        discoverBusy = false
        const hosts = hostsForNetworkTree(Array.isArray(m.hosts) ? m.hosts : [])
        broadcast({
          type: 'network-discovery',
          payload: {
            generation: m.generation,
            status: 'error',
            hosts,
            message: typeof m.message === 'string' ? m.message : 'Discovery failed'
          }
        })
      }
    })
    w.on('error', (err) => {
      logMain(
        'error',
        `network discover worker error: ${err instanceof Error ? err.message : String(err)}`
      )
      discoverWorker = null
      discoverBusy = false
      broadcast({
        type: 'network-discovery',
        payload: {
          generation: activeGeneration,
          status: 'error',
          hosts: [],
          message: err instanceof Error ? err.message : String(err)
        }
      })
    })
    w.on('exit', () => {
      discoverWorker = null
      discoverBusy = false
    })
    discoverWorker = w
    return w
  } catch (e) {
    logMain(
      'error',
      `network: failed to start discover worker: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

export function startNetworkDiscovery(): { generation: number } {
  if (getSettings().networkDiscovery.enabled === false) {
    const generation = ++activeGeneration
    discoverBusy = false
    try {
      discoverWorker?.postMessage({ type: 'cancel', generation: activeGeneration - 1 })
    } catch {
      /* ignore */
    }
    broadcast({
      type: 'network-discovery',
      payload: { generation, status: 'done', hosts: [] }
    })
    return { generation }
  }

  const generation = ++activeGeneration
  discoverBusy = true
  broadcast({
    type: 'network-discovery',
    payload: { generation, status: 'running', hosts: [] }
  })

  const w = ensureDiscoverWorker()
  if (!w) {
    discoverBusy = false
    broadcast({
      type: 'network-discovery',
      payload: {
        generation,
        status: 'error',
        hosts: [],
        message: 'Could not start network discovery'
      }
    })
    return { generation }
  }

  w.postMessage({
    type: 'discover',
    generation,
    remembered: hostsForNetworkTree(getRememberedNetworkHosts())
  })
  return { generation }
}

export function cancelNetworkDiscovery(): { cancelled: boolean } {
  if (!discoverBusy && !discoverWorker) return { cancelled: false }
  activeGeneration++
  discoverBusy = false
  try {
    discoverWorker?.postMessage({ type: 'cancel', generation: activeGeneration - 1 })
  } catch {
    /* ignore */
  }
  return { cancelled: true }
}

export function disposeNetworkDiscovery(): void {
  cancelNetworkDiscovery()
  try {
    void discoverWorker?.terminate()
  } catch {
    /* ignore */
  }
  discoverWorker = null
  flushRememberedNetworkHosts()
}
