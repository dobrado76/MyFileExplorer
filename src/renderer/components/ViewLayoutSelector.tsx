import type { JSX } from 'react'
import type { ViewLayout } from '@shared/schemas/session'
import { useAppStore } from '../store/appStore'

const MODES: { mode: ViewLayout; label: string; title: string }[] = [
  { mode: 1, label: '1', title: 'Single view' },
  { mode: 2, label: '2', title: 'Side-by-side (2 panes)' },
  { mode: 4, label: '4', title: '2×2 grid (4 panes)' }
]

export function ViewLayoutSelector(): JSX.Element {
  const viewLayout = useAppStore((s) => s.viewLayout)
  const setViewLayout = useAppStore((s) => s.setViewLayout)

  return (
    <div className="view-layout-selector" role="group" aria-label="View layout">
      {MODES.map(({ mode, label, title }) => (
        <button
          key={mode}
          type="button"
          className={`view-layout-btn${viewLayout === mode ? ' active' : ''}`}
          title={title}
          aria-label={title}
          aria-pressed={viewLayout === mode}
          onClick={() => void setViewLayout(mode)}
        >
          <span className={`view-layout-icon layout-${mode}`} aria-hidden />
          <span className="view-layout-label">{label}</span>
        </button>
      ))}
    </div>
  )
}
