/**
 * Windows Hidden attribute for `.mfevirtual` definition files (D67).
 * Keeps Explorer (default “don’t show hidden”) from listing the JSON beside a projected mount.
 */
import { isVirtualFolderDocumentPath } from '@shared/virtualFolder'
import { getWinAttributeFlags, setWinAttributeFlags } from '../fs/winAttrs'

/** FILE_ATTRIBUTE_HIDDEN on Windows — no-op elsewhere. Idempotent. */
export function applyVirtualFolderDocumentHiddenAttribute(absPath: string): void {
  if (process.platform !== 'win32') return
  if (!isVirtualFolderDocumentPath(absPath)) return
  try {
    const cur = getWinAttributeFlags(absPath)
    if (cur?.hidden) return
    setWinAttributeFlags(absPath, {
      readOnly: cur?.readOnly ?? false,
      hidden: true,
      system: cur?.system ?? false,
      archive: cur?.archive ?? true
    })
  } catch {
    /* best-effort */
  }
}
