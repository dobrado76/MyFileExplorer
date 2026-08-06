import { type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { SpinnerIcon } from '../lib/icons'

/** Banner above the file view while browsing the Recycle Bin in-app. */
export function RecycleBinBanner(): JSX.Element | null {
  const recycleBin = useAppStore((s) => s.recycleBin)
  const closeRecycleBinView = useAppStore((s) => s.closeRecycleBinView)
  const emptyRecycleBinView = useAppStore((s) => s.emptyRecycleBinView)
  const refreshRecycleBinView = useAppStore((s) => s.refreshRecycleBinView)
  const restoreFromRecycleBinView = useAppStore((s) => s.restoreFromRecycleBinView)
  const selected = useAppStore((s) => s.activeTab().selected)

  if (!recycleBin.active) return null

  const n = recycleBin.items.length
  const sel = selected.length

  return (
    <div className="search-banner recycle-banner">
      {recycleBin.loading ? (
        <>
          <SpinnerIcon size={14} className="spin" />
          <span>Loading Recycle Bin…</span>
          <button type="button" onClick={closeRecycleBinView}>
            Close
          </button>
        </>
      ) : (
        <>
          <span>
            Recycle Bin — {n} item{n === 1 ? '' : 's'}
            {recycleBin.truncated ? ' (truncated)' : ''}
          </span>
          {sel > 0 ? (
            <button type="button" onClick={() => void restoreFromRecycleBinView()}>
              Restore{sel > 1 ? ` (${sel})` : ''}
            </button>
          ) : null}
          <button
            type="button"
            className="banner-danger"
            disabled={n === 0}
            onClick={emptyRecycleBinView}
          >
            Empty Recycle Bin
          </button>
          <button type="button" onClick={() => void refreshRecycleBinView()}>
            Refresh
          </button>
          <button type="button" onClick={closeRecycleBinView}>
            Close
          </button>
        </>
      )}
    </div>
  )
}
