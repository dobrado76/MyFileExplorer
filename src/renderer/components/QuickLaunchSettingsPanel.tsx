import { useEffect, useState, type JSX } from 'react'
import {
  MAX_QUICK_LAUNCH,
  mergeQuickLaunchPaths,
  QUICK_LAUNCH_ICON_SIZE_DEFAULT,
  QUICK_LAUNCH_ICON_SIZE_MAX,
  QUICK_LAUNCH_ICON_SIZE_MIN,
  type QuickLaunchItem,
  type QuickLaunchShow
} from '@shared/schemas/quickLaunch'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { QuickLaunchIcon } from './QuickLaunchIcon'
import { QuickLaunchIconPicker, type QuickLaunchIconPatch } from './QuickLaunchIconPicker'
import { SettingsClampedNumber } from './SettingsClampedNumber'

export function QuickLaunchSettingsPanel(): JSX.Element {
  const items = useAppStore((s) => s.settings.quickLaunch ?? [])
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)

  const persist = (next: QuickLaunchItem[]): void => {
    void applySettingsPatch({ quickLaunch: next })
  }

  const [pickerId, setPickerId] = useState<string | null>(null)
  const pickerItem = pickerId ? items.find((x) => x.id === pickerId) : undefined

  const update = (id: string, patch: Partial<QuickLaunchItem>): void => {
    persist(items.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const applyIcon = (id: string, patch: QuickLaunchIconPatch): void => {
    persist(
      items.map((x) => {
        if (x.id !== id) return x
        const next: QuickLaunchItem = {
          ...x,
          iconKind: patch.iconKind,
          lucideName: patch.lucideName ?? x.lucideName,
          lucideColor: patch.lucideColor
        }
        if (patch.iconId) next.iconId = patch.iconId
        else delete next.iconId
        if (patch.iconKind !== 'lucide') delete next.lucideName
        return next
      })
    )
    setPickerId(null)
  }

  const add = async (): Promise<void> => {
    if (items.length >= MAX_QUICK_LAUNCH) {
      notify(`Quick Launch is limited to ${MAX_QUICK_LAUNCH} items`, true)
      return
    }
    try {
      const res = await call(api.quickLaunch.pickProgram())
      if (res.cancelled) return
      const { next, added } = mergeQuickLaunchPaths(items, [res.path])
      if (added === 0) {
        notify('That program is already on Quick Launch')
        return
      }
      persist(next)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not add program', true)
    }
  }

  const browsePath = async (item: QuickLaunchItem): Promise<void> => {
    try {
      const res = await call(api.quickLaunch.pickProgram())
      if (res.cancelled) return
      update(item.id, { path: res.path, name: item.name.trim() ? item.name : res.name })
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not pick program', true)
    }
  }

  const move = (index: number, dir: -1 | 1): void => {
    const j = index + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    const a = next[index]
    const b = next[j]
    if (!a || !b) return
    next[index] = b
    next[j] = a
    persist(next)
  }

  const remove = (item: QuickLaunchItem): void => {
    persist(items.filter((x) => x.id !== item.id))
    if (item.iconKind === 'custom' && item.iconId) {
      void call(api.quickLaunch.deleteIcon({ id: item.iconId })).catch(() => {})
    }
  }

  return (
    <div className="settings-stack">
      <div className="settings-index-head">
        <p className="settings-help">
          Pin the programs you open all day — Photoshop, Visual Studio, a browser — on the toolbar.
          Each pin can show the icon, the name, or both, and each has its own icon size
          (12–48 px). The icon is the program’s own glyph, a Lucide icon and color, or a
          custom image (same choices as tab / item icons). Add, edit, reorder, and remove
          them here. Click a toolbar button to launch. Right-click for Open file location or
          Remove. Drop an .exe or shortcut onto the strip (when it is visible) to add another.
        </p>
        <div className="settings-inline">
          <button
            type="button"
            className="btn"
            title="Pick a program or shortcut"
            disabled={items.length >= MAX_QUICK_LAUNCH}
            onClick={() => void add()}
          >
            Add…
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="settings-help">Nothing here yet. Add… — the toolbar strip stays hidden until then.</p>
      ) : (
        <div className="settings-qa-list settings-ql-list">
          {items.map((item, index) => (
            <QuickLaunchSettingsRow
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              onUpdate={update}
              onBrowse={() => void browsePath(item)}
              onEditIcon={() => setPickerId(item.id)}
              onMove={move}
              onRemove={() => remove(item)}
            />
          ))}
        </div>
      )}
      <p className="settings-help">
        {items.length} / {MAX_QUICK_LAUNCH}. Custom images stay on this PC (not in Settings export).
        Paths may use %ENV% variables.
      </p>
      {pickerItem ? (
        <QuickLaunchIconPicker
          item={pickerItem}
          onClose={() => setPickerId(null)}
          onApply={(patch) => applyIcon(pickerItem.id, patch)}
        />
      ) : null}
    </div>
  )
}

function QuickLaunchSettingsRow({
  item,
  index,
  count,
  onUpdate,
  onBrowse,
  onEditIcon,
  onMove,
  onRemove
}: {
  item: QuickLaunchItem
  index: number
  count: number
  onUpdate: (id: string, patch: Partial<QuickLaunchItem>) => void
  onBrowse: () => void
  onEditIcon: () => void
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: () => void
}): JSX.Element {
  const [name, setName] = useState(item.name)
  const [path, setPath] = useState(item.path)
  const [args, setArgs] = useState(item.args)

  useEffect(() => {
    setName(item.name)
    setPath(item.path)
    setArgs(item.args)
  }, [item.id, item.name, item.path, item.args])

  const commitName = (): void => {
    const v = name.trim().slice(0, 80)
    if (!v) {
      setName(item.name)
      return
    }
    if (v !== item.name) onUpdate(item.id, { name: v })
  }

  const commitPath = (): void => {
    const v = path.trim().slice(0, 500)
    if (!v) {
      setPath(item.path)
      return
    }
    if (v !== item.path) onUpdate(item.id, { path: v })
  }

  const commitArgs = (): void => {
    const v = args.slice(0, 500)
    if (v !== item.args) onUpdate(item.id, { args: v })
  }

  return (
    <div className="settings-qa-row settings-ql-row">
      <div className="settings-ql-icon" title="Program icon">
        <QuickLaunchIcon item={item} size={item.iconSizePx ?? QUICK_LAUNCH_ICON_SIZE_DEFAULT} />
      </div>
      <div className="settings-qa-meta">
        <input
          type="text"
          className="settings-qa-label-input"
          value={name}
          aria-label="Display name"
          placeholder="Name"
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <div className="settings-ql-path-row">
          <input
            type="text"
            className="settings-ql-path-input"
            value={path}
            aria-label="Program path"
            placeholder="%ProgramFiles%\App\app.exe"
            title="Absolute path. %ENV% variables work."
            onChange={(e) => setPath(e.target.value.slice(0, 500))}
            onBlur={commitPath}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <button type="button" className="btn" onClick={onBrowse}>
            Browse…
          </button>
        </div>
        <input
          type="text"
          className="settings-ql-args-input"
          value={args}
          aria-label="Arguments"
          placeholder="Optional arguments"
          title="Passed to the program. Use quotes for values with spaces."
          onChange={(e) => setArgs(e.target.value.slice(0, 500))}
          onBlur={commitArgs}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
      <div className="settings-qa-actions">
        <label className="settings-ql-show">
          <span className="dim">Show</span>
          <select
            value={item.show ?? 'icon'}
            aria-label={`Toolbar face for ${item.name}`}
            onChange={(e) => onUpdate(item.id, { show: e.target.value as QuickLaunchShow })}
          >
            <option value="icon">Icon</option>
            <option value="label">Label</option>
            <option value="both">Icon and label</option>
          </select>
        </label>
        <label className="settings-ql-icon-size">
          <span className="dim">Icon size</span>
          <SettingsClampedNumber
            value={item.iconSizePx ?? QUICK_LAUNCH_ICON_SIZE_DEFAULT}
            min={QUICK_LAUNCH_ICON_SIZE_MIN}
            max={QUICK_LAUNCH_ICON_SIZE_MAX}
            title={`${QUICK_LAUNCH_ICON_SIZE_MIN}–${QUICK_LAUNCH_ICON_SIZE_MAX} px (toolbar glyph for this pin)`}
            onCommit={(n) => onUpdate(item.id, { iconSizePx: n })}
          />
        </label>
        <button
          type="button"
          className="btn"
          title="App icon, Lucide, or a custom image"
          onClick={onEditIcon}
        >
          Icon…
        </button>
        <button
          type="button"
          className="btn"
          disabled={index === 0}
          aria-label={`Move ${item.name} left`}
          onClick={() => onMove(index, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn"
          disabled={index >= count - 1}
          aria-label={`Move ${item.name} right`}
          onClick={() => onMove(index, 1)}
        >
          ↓
        </button>
        <button type="button" className="btn" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  )
}
