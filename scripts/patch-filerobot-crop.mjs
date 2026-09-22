/**
 * @deprecated Use `node scripts/patch-filerobot.mjs` — kept for old docs/scripts.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const r = spawnSync(process.execPath, [path.join(here, 'patch-filerobot.mjs')], {
  stdio: 'inherit'
})
process.exit(r.status ?? 1)
