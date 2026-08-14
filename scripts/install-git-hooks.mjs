/**
 * Copy repo hooks into .git/hooks (no git config). Safe when .git is missing
 * (npm pack / some CI layouts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gitPath = path.join(root, '.git')
if (!fs.existsSync(gitPath)) process.exit(0)

let hooksDir = path.join(gitPath, 'hooks')
if (fs.statSync(gitPath).isFile()) {
  const text = fs.readFileSync(gitPath, 'utf8')
  const m = /^gitdir:\s*(.+)$/m.exec(text)
  if (!m) process.exit(0)
  hooksDir = path.join(m[1].trim(), 'hooks')
}

const srcDir = path.join(root, '.githooks')
if (!fs.existsSync(srcDir)) process.exit(0)

fs.mkdirSync(hooksDir, { recursive: true })
for (const name of fs.readdirSync(srcDir)) {
  if (name.startsWith('.')) continue
  const src = path.join(srcDir, name)
  if (!fs.statSync(src).isFile()) continue
  const dest = path.join(hooksDir, name)
  const body = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n')
  fs.writeFileSync(dest, body)
  try {
    fs.chmodSync(dest, 0o755)
  } catch {
    /* Windows */
  }
}
