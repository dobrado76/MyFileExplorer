/**
 * Download the **pinned** portable Windows mpv build into tools/mpv/.
 * Pin: scripts/mpv-pin.json (tag + asset + SHA-256). Never uses /releases/latest.
 *
 * Usage:
 *   node scripts/fetch-mpv.mjs
 *   node scripts/fetch-mpv.mjs --force
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'tools', 'mpv')
const pinPath = path.join(root, 'scripts', 'mpv-pin.json')
const require = createRequire(import.meta.url)

function resolve7za() {
  const pkg = require.resolve('7zip-bin/package.json')
  const binRoot = path.dirname(pkg)
  const name = process.platform === 'win32' ? '7za.exe' : '7za'
  const platformDir =
    process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return path.join(binRoot, platformDir, arch, name)
}

function loadPin() {
  const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'))
  if (!pin.tag || !pin.asset || !pin.sha256 || !pin.url) {
    throw new Error(`Invalid pin at ${pinPath} (need tag, asset, sha256, url)`)
  }
  pin.sha256 = String(pin.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(pin.sha256)) {
    throw new Error(`Invalid sha256 in ${pinPath}`)
  }
  return pin
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (u) => {
      https
        .get(u, { headers: { 'User-Agent': 'MyFileExplorer-fetch-mpv' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close()
            try {
              fs.unlinkSync(dest)
            } catch {
              /* ignore */
            }
            download(res.headers.location, dest).then(resolve, reject)
            return
          }
          if (res.statusCode !== 200) {
            file.close()
            reject(new Error(`HTTP ${res.statusCode} downloading ${u}`))
            return
          }
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
        })
        .on('error', (e) => {
          try {
            file.close()
            fs.unlinkSync(dest)
          } catch {
            /* ignore */
          }
          reject(e)
        })
    }
    get(url)
  })
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function readStamp() {
  const stamp = path.join(outDir, '.mpv-pin.json')
  try {
    return JSON.parse(fs.readFileSync(stamp, 'utf8'))
  } catch {
    return null
  }
}

function writeStamp(pin) {
  fs.writeFileSync(
    path.join(outDir, '.mpv-pin.json'),
    JSON.stringify({ tag: pin.tag, asset: pin.asset, sha256: pin.sha256 }, null, 2) + '\n',
    'utf8'
  )
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('fetch-mpv: Windows only (skipping on', process.platform + ')')
    return
  }

  const pin = loadPin()
  const marker = path.join(outDir, 'mpv.exe')
  const force = process.argv.includes('--force')
  const stamp = readStamp()
  if (
    !force &&
    fs.existsSync(marker) &&
    stamp &&
    stamp.tag === pin.tag &&
    stamp.asset === pin.asset &&
    stamp.sha256 === pin.sha256
  ) {
    console.log(`fetch-mpv: pinned ${pin.tag} / ${pin.asset} already present`)
    return
  }

  await fsp.mkdir(outDir, { recursive: true })
  const archive = path.join(outDir, pin.asset)
  console.log(`fetch-mpv: downloading pinned ${pin.tag} / ${pin.asset}`)
  await download(pin.url, archive)

  const actual = sha256File(archive)
  if (actual !== pin.sha256) {
    try {
      fs.unlinkSync(archive)
    } catch {
      /* ignore */
    }
    throw new Error(
      `SHA-256 mismatch for ${pin.asset}\n  expected ${pin.sha256}\n  actual   ${actual}`
    )
  }
  console.log('fetch-mpv: SHA-256 OK')

  const seven = resolve7za()
  console.log('fetch-mpv: extracting with', seven)
  for (const name of fs.readdirSync(outDir)) {
    if (name === pin.asset || name === 'README.md' || name === 'THIRD_PARTY_NOTICES.md') continue
    fs.rmSync(path.join(outDir, name), { recursive: true, force: true })
  }
  execFileSync(seven, ['x', archive, `-o${outDir}`, '-y'], { stdio: 'inherit' })
  fs.unlinkSync(archive)

  if (!fs.existsSync(marker)) {
    const nested = fs
      .readdirSync(outDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(outDir, d.name, 'mpv.exe'))
      .find((p) => fs.existsSync(p))
    if (nested) {
      const nestDir = path.dirname(nested)
      for (const name of fs.readdirSync(nestDir)) {
        const dest = path.join(outDir, name)
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
        fs.renameSync(path.join(nestDir, name), dest)
      }
      fs.rmSync(nestDir, { recursive: true, force: true })
    }
  }

  if (!fs.existsSync(marker)) {
    throw new Error('mpv.exe missing after extract')
  }
  writeStamp(pin)
  console.log('fetch-mpv: ready at', marker, `(${pin.tag})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
