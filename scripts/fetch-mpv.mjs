/**
 * Download a portable Windows mpv build into tools/mpv/ (dev + pack).
 * Uses GitHub releases from shinchiro/mpv-winbuild-cmake (x86_64 7z).
 *
 * Usage: node scripts/fetch-mpv.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'tools', 'mpv')
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

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'MyFileExplorer-fetch-mpv' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          getJson(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (u) => {
      https
        .get(u, { headers: { 'User-Agent': 'MyFileExplorer-fetch-mpv' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close()
            fs.unlinkSync(dest)
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

async function main() {
  if (process.platform !== 'win32') {
    console.log('fetch-mpv: Windows only (skipping on', process.platform + ')')
    return
  }

  const marker = path.join(outDir, 'mpv.exe')
  if (fs.existsSync(marker) && !process.argv.includes('--force')) {
    console.log('fetch-mpv: already present at', marker)
    return
  }

  console.log('fetch-mpv: querying GitHub releases…')
  const release = await getJson(
    'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest'
  )
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset = assets.find(
    (a) =>
      typeof a.name === 'string' &&
      /^mpv-x86_64-.*\.7z$/i.test(a.name) &&
      !/v3|v4|dev/i.test(a.name)
  ) || assets.find((a) => typeof a.name === 'string' && /^mpv-x86_64-.*\.7z$/i.test(a.name))

  if (!asset?.browser_download_url) {
    throw new Error('No mpv-x86_64-*.7z asset found on latest release')
  }

  await fsp.mkdir(outDir, { recursive: true })
  const archive = path.join(outDir, asset.name)
  console.log('fetch-mpv: downloading', asset.name)
  await download(asset.browser_download_url, archive)

  const seven = resolve7za()
  console.log('fetch-mpv: extracting with', seven)
  // Clear previous binaries but keep the archive until extract succeeds
  for (const name of fs.readdirSync(outDir)) {
    if (name === asset.name) continue
    fs.rmSync(path.join(outDir, name), { recursive: true, force: true })
  }
  execFileSync(seven, ['x', archive, `-o${outDir}`, '-y'], { stdio: 'inherit' })
  fs.unlinkSync(archive)

  if (!fs.existsSync(marker)) {
    // Some archives nest mpv.exe one level down
    const nested = fs
      .readdirSync(outDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(outDir, d.name, 'mpv.exe'))
      .find((p) => fs.existsSync(p))
    if (nested) {
      const nestDir = path.dirname(nested)
      for (const name of fs.readdirSync(nestDir)) {
        fs.renameSync(path.join(nestDir, name), path.join(outDir, name))
      }
      fs.rmSync(nestDir, { recursive: true, force: true })
    }
  }

  if (!fs.existsSync(marker)) {
    throw new Error('mpv.exe missing after extract')
  }
  console.log('fetch-mpv: ready at', marker)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
