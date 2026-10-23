/**
 * Electron's patched `fs` treats every `.asar` as a package and keeps that
 * file mapped until the process exits. A file manager that stats or indexes
 * `dist\win-unpacked\resources\app.asar` (or another project's copy) therefore
 * locks the archive the packer has to replace.
 *
 * Reads of *this* install's own `resources\app.asar` stay on the patched fs.
 * Every other `.asar` goes through `original-fs`, which does not keep a handle.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

type FsFn = (...args: never[]) => unknown

let physical: typeof fs | null = null

function physicalFs(): typeof fs {
  if (physical) return physical
  if (process.versions.electron) {
    try {
      physical = createRequire(process.execPath)('original-fs') as typeof fs
      return physical
    } catch {
      /* fall through */
    }
    try {
      physical = require('original-fs') as typeof fs
      return physical
    } catch {
      /* fall through */
    }
  }
  physical = fs
  return physical
}

export function ownAppAsarPath(): string | null {
  const resources = process.resourcesPath
  if (!resources) return null
  return path.join(resources, 'app.asar')
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/[\\/]+/g, '\\').toLowerCase()
}

/** True when `filePath` is some other app's `.asar` (or a path inside it). */
export function isForeignAsarPath(filePath: string, ownAsar: string | null = ownAppAsarPath()): boolean {
  const norm = normalizePath(filePath)
  const marker = '.asar'
  let from = 0
  while (from < norm.length) {
    const idx = norm.indexOf(marker, from)
    if (idx < 0) return false
    const boundary = idx + marker.length
    const next = norm[boundary]
    if (next === undefined || next === '\\') {
      if (!ownAsar) return true
      const own = normalizePath(ownAsar)
      if (norm === own || norm.startsWith(own + '\\')) return false
      return true
    }
    from = boundary
  }
  return false
}

function pathFromArg(arg: unknown): string | null {
  if (typeof arg === 'string') return arg
  if (Buffer.isBuffer(arg)) return arg.toString('utf8')
  if (arg instanceof URL && arg.protocol === 'file:') {
    try {
      return fileURLToPath(arg)
    } catch {
      return null
    }
  }
  return null
}

function divert<T extends FsFn>(orig: T, physicalFn: T): T {
  return function (this: unknown, ...args: never[]) {
    const filePath = pathFromArg(args[0])
    if (filePath && isForeignAsarPath(filePath) && physicalFn !== orig) {
      return physicalFn.apply(this, args)
    }
    return orig.apply(this, args)
  } as T
}

function patchMethod(target: object, source: object, name: string): void {
  const orig = (target as Record<string, unknown>)[name]
  const phys = (source as Record<string, unknown>)[name]
  if (typeof orig !== 'function' || typeof phys !== 'function' || orig === phys) return
  ;(target as Record<string, unknown>)[name] = divert(orig as FsFn, phys as FsFn)
}

const FS_METHODS = [
  'stat',
  'lstat',
  'statSync',
  'lstatSync',
  'open',
  'openSync',
  'readFile',
  'readFileSync',
  'realpath',
  'realpathSync',
  'access',
  'accessSync',
  'readdir',
  'readdirSync',
  'copyFile',
  'copyFileSync',
  'createReadStream'
] as const

const PROMISE_METHODS = [
  'stat',
  'lstat',
  'open',
  'readFile',
  'realpath',
  'access',
  'readdir',
  'copyFile'
] as const

let installed = false

/** Install once, before any user-path listing or search walk. */
export function installForeignAsarBypass(): void {
  if (installed || !process.versions.electron) return
  const phys = physicalFs()
  if (phys === fs) return
  installed = true
  for (const name of FS_METHODS) patchMethod(fs, phys, name)
  for (const name of PROMISE_METHODS) patchMethod(fsp, phys.promises, name)
}

installForeignAsarBypass()
