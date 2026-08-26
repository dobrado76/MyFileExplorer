import { type JSX } from 'react'
import { isGlobalScript, type ScriptDefinition } from '@shared/schemas/scripts'
import { QUICK_LAUNCH_ICON_SIZE_DEFAULT } from '@shared/schemas/quickLaunch'
import { useAppStore } from '../store/appStore'
import { GlobalScriptIcon } from './GlobalScriptIcon'

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
        <GlobalScriptButton
          key={s.id}
          script={s}
          onRun={() =>
            openDialog({
              kind: 'script-run',
              scriptId: s.id,
              name: s.name,
              mode: 'global',
              recursive: false
            })
          }
          onManage={() => openDialog({ kind: 'script-manager', selectId: s.id })}
        />
      ))}
    </div>
  )
}

function GlobalScriptButton({
  script,
  onRun,
  onManage
}: {
  script: ScriptDefinition
  onRun: () => void
  onManage: () => void
}): JSX.Element {
  const show = script.toolbarShow ?? 'label'
  const showIcon = show !== 'label'
  const showLabel = show !== 'icon'
  const iconPx = script.iconSizePx ?? QUICK_LAUNCH_ICON_SIZE_DEFAULT
  const desc = script.description.trim()
  const tip = desc ? `${script.name}: ${desc}` : script.name
  return (
    <button
      type="button"
      className={`quick-launch-btn global-script-btn${showLabel ? ' has-label' : ''}${show === 'label' ? ' label-only' : ''}`}
      aria-label={script.name}
      title={tip}
      style={showLabel ? undefined : { width: iconPx, height: iconPx }}
      onClick={onRun}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onManage()
      }}
    >
      {showIcon ? <GlobalScriptIcon script={script} size={iconPx} /> : null}
      {showLabel ? <span className="quick-launch-label">{script.name}</span> : null}
    </button>
  )
}
