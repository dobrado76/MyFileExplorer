import { useEffect, useState, type JSX } from 'react'
import { isLucideTabIcon, tabIconPack } from '@shared/tabIcons'
import { useAppStore } from '../store/appStore'
import {
  glyphIsResolvable,
  IconPicker,
  ICON_PICKER_DEFAULT_COLOR,
  type IconPickerGlyph
} from './IconPicker'

export function TabIconPickerDialog({ tabId }: { tabId: string }): JSX.Element | null {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId))
  const setTabIcon = useAppStore((s) => s.setTabIcon)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)

  const lucide = tab && isLucideTabIcon(tab.icon) ? tab.icon : null
  const [glyph, setGlyph] = useState<IconPickerGlyph>(() => ({
    pack: lucide ? tabIconPack(lucide) : 'lucide',
    name: lucide?.name ?? 'FolderOpen',
    color: lucide?.color ?? ICON_PICKER_DEFAULT_COLOR
  }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    if (!tab) closeDialog()
  }, [tab, closeDialog])

  if (!tab) return null

  const applyGlyph = (g: IconPickerGlyph): void => {
    if (!glyphIsResolvable(g)) return
    setTabIcon(tabId, {
      name: g.name,
      color: g.color,
      ...(g.pack !== 'lucide' ? { pack: g.pack } : {})
    })
    closeDialog()
  }

  const clear = (): void => {
    setTabIcon(tabId, null)
    closeDialog()
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-wide modal-tab-icon" role="dialog" aria-label="Set tab icon">
        <div className="modal-title">Set tab icon</div>
        <div className="modal-body modal-body-tab-icon">
          <IconPicker
            modes={['glyph']}
            mode="glyph"
            onModeChange={() => {}}
            glyph={glyph}
            onGlyphChange={setGlyph}
            onGlyphActivate={applyGlyph}
          />
        </div>
        <div className="modal-actions">
          <div className="modal-action-start-group">
            <button type="button" className="btn" onClick={clear} disabled={!tab.icon}>
              Clear icon
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => openDialog({ kind: 'tab-custom-icon', tabId })}
            >
              Custom icon…
            </button>
          </div>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => applyGlyph(glyph)}
            disabled={!glyphIsResolvable(glyph)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
