import { type JSX } from 'react'
import { isGlobalScript } from '@shared/schemas/scripts'
import { useAppStore } from '../store/appStore'

/** One toolbar button per global script. Hidden entirely when none exist. */
export function GlobalScriptsMenu(): JSX.Element | null {
  const library = useAppStore((s) => s.scriptLibrary)
  const openDialog = useAppStore((s) => s.openDialog)
  const scripts = (Array.isArray(library) ? library : []).filter(isGlobalScript)
  if (scripts.length === 0) return null

  return (
    <div className="toolbar-edit toolbar-global-scripts" role="group" aria-label="Global scripts">
      <span className="toolbar-sep" aria-hidden />
      {scripts.map((s) => (
        <button
          key={s.id}
          type="button"
          className="global-script-btn"
          aria-label={s.name}
          title={s.description.trim() || s.name}
          onClick={() =>
            openDialog({
              kind: 'script-run',
              scriptId: s.id,
              name: s.name,
              mode: 'global',
              recursive: false
            })
          }
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openDialog({ kind: 'script-manager', selectId: s.id })
          }}
        >
          {s.name}
        </button>
      ))}
    </div>
  )
}
