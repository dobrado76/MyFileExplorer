/**
 * Set a custom folder icon via desktop.ini + Folder.ico (Explorer/shell convention).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import { requireAbsolute, pathExists, statPath } from './list'
import {
  flagsFromAttributes,
  getFileAttributes,
  setWinAttributeFlags
} from './winAttrs'
import { clearShellIconCache } from '../icons/shell'

const INI_NAME = 'desktop.ini'
const ICO_NAME = 'Folder.ico'

function buildDesktopIni(relativeIco: string): string {
  return [
    '[.ShellClassInfo]',
    `IconResource=${relativeIco},0`,
    `IconFile=${relativeIco}`,
    'IconIndex=0',
    ''
  ].join('\r\n')
}

async function clearProtectiveAttrs(abs: string): Promise<void> {
  const attrs = getFileAttributes(abs)
  if (attrs == null) return
  const flags = flagsFromAttributes(attrs)
  if (flags.readOnly || flags.system || flags.hidden) {
    setWinAttributeFlags(abs, {
      readOnly: false,
      system: false,
      hidden: false,
      archive: flags.archive
    })
  }
}

/**
 * Copy `iconPath` (.ico) into the folder as Folder.ico and point desktop.ini at it.
 * Sets folder Read-only + desktop.ini Hidden|System so Explorer picks it up.
 */
export async function setFolderCustomIcon(
  folderPath: string,
  iconPath: string
): Promise<{ path: string }> {
  const folder = requireAbsolute(folderPath)
  const icon = requireAbsolute(iconPath)
  const st = await statPath(folder)
  if (!st.exists || st.kind !== 'dir') {
    throw new AppError('not-found', 'Not a folder', 'Select a single folder to change its icon.')
  }
  if (!(await pathExists(icon))) {
    throw new AppError('not-found', `Icon not found: ${icon}`)
  }
  const ext = path.extname(icon).toLowerCase()
  if (ext !== '.ico') {
    throw new AppError('validation', 'Choose a .ico file', 'Windows folder icons use .ico resources.')
  }

  await clearProtectiveAttrs(folder)
  const destIco = path.join(folder, ICO_NAME)
  const iniPath = path.join(folder, INI_NAME)

  try {
    await clearProtectiveAttrs(destIco)
  } catch {
    /* may not exist */
  }
  try {
    await clearProtectiveAttrs(iniPath)
  } catch {
    /* may not exist */
  }

  await fsp.copyFile(icon, destIco)
  await fsp.writeFile(iniPath, buildDesktopIni(ICO_NAME), 'utf8')

  setWinAttributeFlags(destIco, { readOnly: false, hidden: true, system: true, archive: true })
  setWinAttributeFlags(iniPath, { readOnly: false, hidden: true, system: true, archive: true })

  const folderAttrs = getFileAttributes(folder)
  const folderFlags = folderAttrs != null ? flagsFromAttributes(folderAttrs) : {
    readOnly: false,
    hidden: false,
    system: false,
    archive: true
  }
  setWinAttributeFlags(folder, { ...folderFlags, readOnly: true })

  await clearShellIconCache()
  return { path: folder }
}
