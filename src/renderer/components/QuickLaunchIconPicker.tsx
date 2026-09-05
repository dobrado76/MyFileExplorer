import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import {
  QUICK_LAUNCH_LUCIDE_COLOR,
  type QuickLaunchIconKind,
  type QuickLaunchItem
} from '@shared/schemas/quickLaunch'
import { normalizeIconPack, type IconPackId } from '@shared/schemas/iconPack'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { cacheQuickLaunchIconUrl, QuickLaunchIcon } from './QuickLaunchIcon'
import { ShellIcon } from './ShellIcon'
import {
  glyphIsResolvable,
  IconPicker,
  type IconPickerGlyph,
  type IconPickerMode
} from './IconPicker'

export type QuickLaunchIconPatch = {
  iconKind: QuickLaunchIconKind
  iconId?: string
  lucideName?: string
  lucideColor: string
  lucidePack?: IconPackId
}

export function QuickLaunchIconPicker({
  item,
  onClose,
  onApply,
  shellTabLabel = 'App icon',
  shellHelp = 'Uses the .exe or shortcut glyph from Explorer.',
  titlePrefix = 'Set icon'
}: {
  item: QuickLaunchItem
  onClose: () => void
  onApply: (patch: QuickLaunchIconPatch) => void
  shellTabLabel?: string
  shellHelp?: string
  titlePrefix?: string
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [mode, setMode] = useState<IconPickerMode>(
    item.iconKind === 'lucide' ? 'glyph' : item.iconKind === 'custom' ? 'custom' : 'shell'
  )
  const [glyph, setGlyph] = useState<IconPickerGlyph>({
    pack: normalizeIconPack(item.lucidePack),
    name: item.lucideName ?? 'AppWindow',
    color: item.lucideColor || QUICK_LAUNCH_LUCIDE_COLOR
  })
  const [customId, setCustomId] = useState(item.iconKind === 'custom' ? item.iconId : undefined)
  const [busy, setBusy] = useState(false)
  const [resolvedPath, setResolvedPath] = useState(item.path)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    if (!/%[A-Za-z0-9_]+%/.test(item.path)) {
      setResolvedPath(item.path)
      return
    }
    let live = true
    void call(api.app.expandPath({ path: item.path }))
      .then((r) => {
        if (live) setResolvedPath(r.path)
      })
      .catch(() => {
        if (live) setResolvedPath(item.path)
      })
    return () => {
      live = false
    }
  }, [item.path])

  const browse = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await call(api.quickLaunch.importIcon())
      if (res.cancelled) return
      cacheQuickLaunchIconUrl(res.id, res.mediaUrl)
      if (customId && customId !== res.id) {
        void call(api.quickLaunch.deleteIcon({ id: customId })).catch(() => {})
      }
      setCustomId(res.id)
      setMode('custom')
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not set icon', true)
    } finally {
      setBusy(false)
    }
  }

  const deleteIcons = (...ids: Array<string | undefined>): void => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      void call(api.quickLaunch.deleteIcon({ id })).catch(() => {})
    }
  }

  const applyGlyph = (g: IconPickerGlyph): void => {
    if (!glyphIsResolvable(g)) return
    deleteIcons(item.iconKind === 'custom' ? item.iconId : undefined, customId)
    onApply({
      iconKind: 'lucide',
      lucideName: g.name,
      lucideColor: g.color,
      lucidePack: g.pack
    })
  }

  const apply = (): void => {
    if (mode === 'glyph') {
      applyGlyph(glyph)
      return
    }
    if (mode === 'shell') {
      deleteIcons(item.iconKind === 'custom' ? item.iconId : undefined, customId)
      onApply({ iconKind: 'shell', lucideColor: glyph.color })
      return
    }
    if (!customId) return
    if (item.iconKind === 'custom' && item.iconId && item.iconId !== customId) {
      deleteIcons(item.iconId)
    }
    onApply({ iconKind: 'custom', iconId: customId, lucideColor: glyph.color })
  }

  const previewItem: QuickLaunchItem = {
    ...item,
    iconKind: 'custom',
    iconId: customId
  }

  return createPortal(
    <div
      className="modal-backdrop quick-launch-icon-picker-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal modal-wide modal-tab-icon"
        role="dialog"
        aria-label={`${titlePrefix} — ${item.name}`}
      >
        <div className="modal-title">
          {titlePrefix} — {item.name}
        </div>
        <div className="modal-body modal-body-tab-icon">
          <IconPicker
            modes={['shell', 'glyph', 'custom']}
            mode={mode}
            onModeChange={setMode}
            glyph={glyph}
            onGlyphChange={setGlyph}
            onGlyphActivate={applyGlyph}
            modeLabels={{ shell: shellTabLabel, glyph: 'Glyph', custom: 'Custom image' }}
            shell={{
              label: shellTabLabel,
              help: shellHelp,
              preview: <ShellIcon path={resolvedPath} size={28} />
            }}
            custom={{
              hint:
                'Choose a .png, .jpg, or .ico. It is cover-cropped to a square and stored on this PC (not in Settings export).',
              preview: customId ? (
                <QuickLaunchIcon item={previewItem} size={48} />
              ) : (
                <span className="dim">No image</span>
              ),
              browseLabel: busy ? 'Importing…' : customId ? 'Change image…' : 'Choose image…',
              onBrowse: () => void browse(),
              busy
            }}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={apply}
            disabled={
              busy ||
              (mode === 'glyph' && !glyphIsResolvable(glyph)) ||
              (mode === 'custom' && !customId)
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
