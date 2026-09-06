import { type JSX } from 'react'
import { userMetadataSettingsSchema, type UserMetadataSettings } from '@shared/schemas/userMetadata'
import { useAppStore } from '../store/appStore'
import { IpcError } from '../lib/ipc'

function emptyMeta(): UserMetadataSettings {
  return { enabled: false, showToolbarButton: false, sets: [], bindings: [], deletedIdentities: { fields: [], options: [] } }
}

function SettingsToggle({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange(v: boolean): void
}): JSX.Element {
  return (
    <label className="settings-toggle" htmlFor={id} title={hint}>
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {hint ? <span className="settings-toggle-hint">{hint}</span> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function UserMetadataSettingsPanel(): JSX.Element {
  const um = useAppStore((s) => s.settings.userMetadata) ?? emptyMeta()
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)
  const openDialog = useAppStore((s) => s.openDialog)

  const persist = async (next: UserMetadataSettings): Promise<boolean> => {
    const parsed = userMetadataSettingsSchema.safeParse(next)
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? 'Invalid metadata settings', true)
      return false
    }
    try {
      await applySettingsPatch({ userMetadata: parsed.data })
      return true
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
      return false
    }
  }

  const setCount = um.sets.length
  const bindingCount = um.bindings.length

  return (
    <div className="settings-panel user-meta-settings">
      <SettingsToggle
        id="set-um-enabled"
        label="Enable user metadata"
        hint="Off by default. When on: Context Metadata set… / Metadata…, preview editor, Details meta columns, and Power Search meta.<key>: for assigned folders."
        checked={um.enabled === true}
        onChange={(v) => void persist({ ...um, enabled: v })}
      />
      <SettingsToggle
        id="set-um-toolbar"
        label="Show toolbar button"
        hint="Adds a Metadata manager button on the main toolbar (left of Script Manager when that is shown)."
        checked={um.showToolbarButton === true}
        onChange={(v) => void persist({ ...um, showToolbarButton: v })}
      />
      <p className="settings-help">
        Define <strong>metadata sets</strong> in the manager, then assign them to folders (or mark
        subtrees as No metadata). Values live in NTFS stream <code>mfe_meta</code>; nothing shows
        until a folder is assigned (and this feature is enabled).
      </p>
      <p className="settings-help">
        {setCount === 0 && bindingCount === 0
          ? 'No sets or folder assignments yet.'
          : `${setCount} set${setCount === 1 ? '' : 's'} · ${bindingCount} folder assignment${bindingCount === 1 ? '' : 's'}`}
      </p>
      <div className="settings-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            openDialog({ kind: 'user-metadata-manager', returnSection: 'metadata' })
          }
        >
          Manage sets…
        </button>
      </div>
    </div>
  )
}
