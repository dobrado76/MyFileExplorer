/**
 * Force Filerobot crop to free-form (independent width/height on corner handles).
 * Re-apply after npm install. Clears Vite’s Filerobot prebundle so the patch is used.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(
  root,
  'node_modules',
  'react-filerobot-image-editor',
  'lib',
  'components',
  'Layers',
  'TransformersLayer',
  'CropTransformer.js'
)

function clearViteFilerobotCache() {
  const deps = path.join(root, 'node_modules', '.vite', 'deps')
  if (!fs.existsSync(deps)) return
  for (const name of fs.readdirSync(deps)) {
    if (name.startsWith('react-filerobot-image-editor')) {
      fs.unlinkSync(path.join(deps, name))
      console.log(`[patch-filerobot-crop] cleared Vite cache ${name}`)
    }
  }
}

function patchFilerobotCropSource(src) {
  let out = src
  out = out.replace(/keepRatio:!B\d*\s*\|\|\s*!C\d*/g, 'keepRatio:!1')
  out = out.replace(/keepRatio:!\(\s*B\d*\s*\|\|\s*C\d*\s*\)/g, 'keepRatio:!1')
  out = out.replace(/!\(\s*B\d*\s*\|\|\s*C\d*\s*\)\s*&&\s*D\(\)/g, '!1')
  out = out.replace(
    /shiftBehavior:\s*B\d*\s*\|\|\s*C\d*\s*\?\s*"none"\s*:\s*"default"/g,
    'shiftBehavior:"none"'
  )
  if (out.includes('keepRatio:!1') && !out.includes('shiftBehavior:"none"')) {
    out = out.replace(/keepRatio:!1,/, 'keepRatio:!1,shiftBehavior:"none",')
  }
  out = out.replace(
    /\(\s*B\d*\s*\|\|\s*C\d*\s*\?\s*void 0\s*:\s*\["top-left","bottom-left","top-right","bottom-right"\]\s*\)/g,
    'void 0'
  )
  return out
}

if (!fs.existsSync(file)) {
  console.warn('[patch-filerobot-crop] CropTransformer.js not found; skip')
  process.exit(0)
}

const before = fs.readFileSync(file, 'utf8')
const after = patchFilerobotCropSource(before)
if (after !== before) {
  fs.writeFileSync(file, after)
  console.log('[patch-filerobot-crop] applied free-form crop patch')
} else if (after.includes('keepRatio:!1')) {
  console.log('[patch-filerobot-crop] already free-form')
} else {
  console.warn('[patch-filerobot-crop] patterns not found — check upstream')
}

clearViteFilerobotCache()
