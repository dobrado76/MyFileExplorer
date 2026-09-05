import { useEffect, useState, type JSX } from 'react'
import type { ItemIcon } from '@shared/schemas/itemAds'
import { normalizeIconPack } from '@shared/schemas/iconPack'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { basename } from '../lib/paths'
import { ShellIcon, ShellTint } from './ShellIcon'
import {
  glyphIsResolvable,
  IconPicker,
  ICON_PICKER_DEFAULT_COLOR,
  type IconPickerGlyph,
  type IconPickerMode
} from './IconPicker'

export function ItemIconPickerDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const notify = useAppStore((s) => s.notify)
  const [mode, setMode] = useState<IconPickerMode>('glyph')
  const [glyph, setGlyph] = useState<IconPickerGlyph>({
    pack: 'lucide',
    name: 'FolderOpen',
    color: ICON_PICKER_DEFAULT_COLOR
  })
  const [customB64, setCustomB64] = useState<string | null>(null)
  const [hasIcon, setHasIcon] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await api.itemAds.getMany({ paths: [path] })
      if (cancelled || !res.ok) return
      const rec = res.value[path]
      const icon = rec?.icon
      if (!icon) return
      setHasIcon(true)
      if (icon.kind === 'lucide') {
        setMode('glyph')
        setGlyph({
          pack: normalizeIconPack(icon.pack),
          name: icon.name,
          color: icon.color
        })
      } else if (icon.kind === 'shell') {
        setMode('shell')
        setGlyph((g) => ({ ...g, color: icon.color }))
      } else {
        setMode('custom')
        if (rec?.iconPngBase64) setCustomB64(rec.iconPngBase64)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const write = async (icon: ItemIcon | null, imageBase64?: string): Promise<void> => {
    setBusy(true)
    try {
      await call(api.itemAds.setIcon({ path, icon, imageBase64 }))
      bumpColumnMeta(path)
      closeDialog()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not save the icon', true)
    } finally {
      setBusy(false)
    }
  }

  const applyGlyph = (g: IconPickerGlyph): void => {
    if (!glyphIsResolvable(g)) return
    void write({
      kind: 'lucide',
      name: g.name,
      color: g.color,
      ...(g.pack !== 'lucide' ? { pack: g.pack } : {})
    })
  }

  const apply = (): void => {
    if (mode === 'glyph') {
      applyGlyph(glyph)
      return
    }
    if (mode === 'shell') {
      void write({ kind: 'shell', color: glyph.color })
      return
    }
    if (!customB64) return
    void write({ kind: 'custom', sizePx: 32 }, customB64)
  }

  const browse = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await call(api.itemAds.importCustomIcon({ path }))
      if (result.cancelled) return
      setCustomB64(result.imageBase64)
      setMode('custom')
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not import that image', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-wide modal-tab-icon" role="dialog" aria-label="Set item icon">
        <div className="modal-title">Set icon — {basename(path)}</div>
        <div className="modal-body modal-body-tab-icon">
          <IconPicker
            modes={['shell', 'glyph', 'custom']}
            mode={mode}
            onModeChange={setMode}
            glyph={glyph}
            onGlyphChange={setGlyph}
            onGlyphActivate={applyGlyph}
            modeLabels={{ shell: 'Windows icon', glyph: 'Glyph', custom: 'Custom image' }}
            shell={{
              label: 'Windows icon + tint',
              help: 'Keeps the Explorer glyph (including a folder.ico if set).',
              showColor: true,
              preview: (
                <ShellTint color={glyph.color}>
                  <ShellIcon path={path} size={28} />
                </ShellTint>
              )
            }}
            custom={{
              hint:
                'Choose a .png, .jpg, or .ico. It is cover-cropped to a square and stored on the item (not under the app data folder).',
              preview: customB64 ? (
                <img
                  src={`data:image/png;base64,${customB64}`}
                  width={48}
                  height={48}
                  alt=""
                  className="item-custom-icon"
                />
              ) : (
                <span className="dim">No image</span>
              ),
              browseLabel: busy ? 'Importing…' : customB64 ? 'Change image…' : 'Choose image…',
              onBrowse: () => void browse(),
              busy
            }}
          />
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn modal-action-start"
            onClick={() => void write(null)}
            disabled={busy || !hasIcon}
          >
            Clear icon
          </button>
          <button type="button" className="btn" onClick={closeDialog} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={apply}
            disabled={
              busy ||
              (mode === 'glyph' && !glyphIsResolvable(glyph)) ||
              (mode === 'custom' && !customB64)
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
