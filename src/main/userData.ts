import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** Stable folder under `%APPDATA%` for both `npm run dev` and installed builds (D17). */
export const USER_DATA_FOLDER_NAME = 'MyFileExplorer'

const PROFILE_FILES = ['settings.json', 'session.json', 'window-state.json'] as const
const MIGRATE_MARKER = '.migrated-userdata-v1'

/**
 * Pin `userData` before any stores or the single-instance lock touch disk.
 *
 * - Default: `%APPDATA%\MyFileExplorer` (same for packaged + unpackaged)
 * - `MFE_USER_DATA=<abs path>`: override
 * - `MFE_ISOLATED_USER_DATA=1`: repo-local `.dev-user-data/` (optional isolation)
 *
 * One-time migration copies profile JSON from legacy locations when those files
 * are newer than (or missing from) the shared folder.
 */
export function configureUserData(): string {
  const resolved = resolveUserDataPath()
  fs.mkdirSync(resolved, { recursive: true })
  app.setPath('userData', resolved)
  migrateLegacyProfiles(resolved)
  return resolved
}

function resolveUserDataPath(): string {
  const override = process.env['MFE_USER_DATA']?.trim()
  if (override) return path.resolve(override)

  if (process.env['MFE_ISOLATED_USER_DATA'] === '1') {
    return path.join(process.cwd(), '.dev-user-data')
  }

  return path.join(app.getPath('appData'), USER_DATA_FOLDER_NAME)
}

function migrateLegacyProfiles(dest: string): void {
  const marker = path.join(dest, MIGRATE_MARKER)
  if (fs.existsSync(marker)) return

  const candidates = legacyCandidateDirs()
  let importedFrom: string | null = null

  for (const src of candidates) {
    if (!fs.existsSync(src) || path.resolve(src) === path.resolve(dest)) continue
    if (!shouldImportFrom(src, dest)) continue
    copyProfileFiles(src, dest)
    importedFrom = src
    break
  }

  try {
    fs.writeFileSync(
      marker,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          importedFrom,
          dest
        },
        null,
        2
      ),
      'utf8'
    )
  } catch {
    // non-fatal
  }

  if (importedFrom) {
    console.info(`[userData] Migrated profile from ${importedFrom} → ${dest}`)
  }
}

function legacyCandidateDirs(): string[] {
  const dirs: string[] = []
  // Prefer repo `.dev-user-data` when present (typical while developing).
  dirs.push(path.join(process.cwd(), '.dev-user-data'))
  // Docs / early Electron name from package.json `name`.
  dirs.push(path.join(app.getPath('appData'), 'my-file-explorer'))
  return dirs
}

function shouldImportFrom(src: string, dest: string): boolean {
  const srcSettings = path.join(src, 'settings.json')
  if (!fs.existsSync(srcSettings)) return false
  const destSettings = path.join(dest, 'settings.json')
  if (!fs.existsSync(destSettings)) return true
  try {
    const srcM = fs.statSync(srcSettings).mtimeMs
    const destM = fs.statSync(destSettings).mtimeMs
    return srcM > destM
  } catch {
    return false
  }
}

function copyProfileFiles(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of PROFILE_FILES) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (!fs.existsSync(from)) continue
    try {
      fs.copyFileSync(from, to)
    } catch (e) {
      console.warn(`[userData] Failed to copy ${name}:`, e)
    }
  }
}
