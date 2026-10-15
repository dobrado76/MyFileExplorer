/**
 * Stage the VC++ 2015–2022 CRT DLLs that koffi.node (and other native addons) import.
 * Electron does not ship them. A Windows 10 machine without the redistributable
 * then fails at startup: "The specified module could not be found" on koffi.node.
 *
 * Prefer the Visual Studio redist folder. Fall back to System32 (same binaries
 * once the redistributable is installed on the build machine).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'build', 'vc-redist')
const DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']

function dirHasAll(dir) {
  return DLLS.every((name) => fs.existsSync(path.join(dir, name)))
}

function isX64Dll(file) {
  const b = fs.readFileSync(file)
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return false
  const pe = b.readUInt32LE(0x3c)
  if (pe + 6 > b.length) return false
  return b.readUInt16LE(pe + 4) === 0x8664
}

function vsInstallRoots() {
  const roots = []
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  )
  if (fs.existsSync(vswhere)) {
    try {
      const out = execFileSync(vswhere, ['-products', '*', '-property', 'installationPath'], {
        encoding: 'utf8'
      })
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) roots.push(trimmed)
      }
    } catch {
      /* fall through to the common layout */
    }
  }
  const pf = process.env.ProgramFiles
  if (pf) {
    const vs = path.join(pf, 'Microsoft Visual Studio')
    if (fs.existsSync(vs)) {
      for (const year of fs.readdirSync(vs)) {
        const yearDir = path.join(vs, year)
        let editions
        try {
          editions = fs.readdirSync(yearDir)
        } catch {
          continue
        }
        for (const edition of editions) roots.push(path.join(yearDir, edition))
      }
    }
  }
  return [...new Set(roots)]
}

function findVsCrtDir() {
  /** @type {{ dir: string, ver: string }[]} */
  const hits = []
  for (const install of vsInstallRoots()) {
    const msvc = path.join(install, 'VC', 'Redist', 'MSVC')
    if (!fs.existsSync(msvc)) continue
    for (const ver of fs.readdirSync(msvc)) {
      const x64 = path.join(msvc, ver, 'x64')
      if (!fs.existsSync(x64)) continue
      for (const name of fs.readdirSync(x64)) {
        const dir = path.join(x64, name)
        try {
          if (fs.statSync(dir).isDirectory() && dirHasAll(dir)) hits.push({ dir, ver })
        } catch {
          /* skip */
        }
      }
    }
  }
  hits.sort((a, b) => a.ver.localeCompare(b.ver, undefined, { numeric: true }))
  return hits.at(-1)?.dir ?? null
}

function findSourceDir() {
  const vs = findVsCrtDir()
  if (vs) return vs
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  if (dirHasAll(system32)) return system32
  return null
}

const source = findSourceDir()
if (!source) {
  throw new Error(
    `VC++ CRT DLLs not found (${DLLS.join(', ')}). Install the Visual C++ 2015–2022 x64 redistributable on the build machine.`
  )
}

fs.mkdirSync(dest, { recursive: true })
for (const name of DLLS) {
  const src = path.join(source, name)
  if (!isX64Dll(src)) throw new Error(`${src} is not an x64 DLL`)
  const out = path.join(dest, name)
  fs.copyFileSync(src, out)
}

console.log(`vc-redist: staged ${DLLS.join(', ')} from ${source}`)
