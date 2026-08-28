import type { JSX } from 'react'
import type { DriveInfo } from '@shared/schemas/fs'
import type { FolderStatsPreviewModel } from '@shared/folderStats'
import {
  driveHasSpace,
  driveSpaceIsLow,
  formatFreeOfTotal,
  usedBytesOf
} from '@shared/driveSpace'
import { FolderStatsCard } from './FolderStatsCard'

function DrivePie({
  drive,
  size
}: {
  drive: DriveInfo
  size: number
}): JSX.Element {
  const total = drive.totalBytes ?? 0
  const used = usedBytesOf(drive)
  const pct = total > 0 ? used / total : 0
  const r = 15.5
  const c = 2 * Math.PI * r
  const usedLen = c * Math.min(1, Math.max(0, pct))
  const low = driveSpaceIsLow(drive)
  return (
    <svg
      className="drive-pie"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
    >
      <circle className="drive-pie-track" cx="20" cy="20" r={r} />
      {usedLen > 0 ? (
        <circle
          className={`drive-pie-used${low ? ' low' : ''}`}
          cx="20"
          cy="20"
          r={r}
          strokeDasharray={`${usedLen} ${c - usedLen}`}
          transform="rotate(-90 20 20)"
        />
      ) : null}
    </svg>
  )
}

function DriveSpaceCard({
  drive,
  large,
  compact
}: {
  drive: DriveInfo
  large?: boolean
  /** Slimmer row when folder statistics / space map sit below. */
  compact?: boolean
}): JSX.Element {
  const letter = /^([a-zA-Z]):/.exec(drive.path)?.[1]?.toUpperCase() ?? drive.label
  const name = drive.volumeName || (drive.driveType === 'remote' ? drive.remotePath : undefined)
  const space = driveHasSpace(drive)
    ? formatFreeOfTotal(drive.freeBytes!, drive.totalBytes!)
    : drive.offline
      ? 'Disconnected'
      : 'Size unknown'
  const pieSize = compact ? 48 : large ? 88 : 56
  return (
    <div
      className={`drive-space-card${large && !compact ? ' large' : ''}${compact ? ' compact' : ''}`}
    >
      {driveHasSpace(drive) ? (
        <DrivePie drive={drive} size={pieSize} />
      ) : (
        <div className="drive-pie drive-pie-empty" style={{ width: pieSize, height: pieSize }} />
      )}
      <div className="drive-space-meta">
        <div className="drive-space-letter">{letter}</div>
        {name ? <div className="drive-space-name">{name}</div> : null}
        <div className="drive-space-line">{space}</div>
      </div>
    </div>
  )
}

export function DriveSpacePreview({
  drives,
  focusPath,
  folderStats,
  folderPath,
  dateModifiedLabel,
  indexedLabel,
  onRevealPath,
  onOpenPath,
  onNotify
}: {
  drives: DriveInfo[]
  focusPath?: string | null
  /** When Calculate Statistics has tagged this volume root (D66). */
  folderStats?: FolderStatsPreviewModel | null
  folderPath?: string | null
  dateModifiedLabel?: string
  indexedLabel?: string
  onRevealPath?: (path: string) => void
  onOpenPath?: (path: string) => void
  onNotify?: (text: string, isError?: boolean) => void
}): JSX.Element {
  const letter = focusPath ? /^([a-zA-Z]):/.exec(focusPath)?.[1]?.toUpperCase() : null
  const focused = letter
    ? drives.find((d) => d.path[0]?.toUpperCase() === letter)
    : undefined
  const list = focused ? [focused] : drives
  const showStats =
    !!focused &&
    !!folderStats &&
    !!folderPath &&
    !!onRevealPath &&
    !!onOpenPath

  if (list.length === 0) {
    return <div className="preview-empty">No drives listed</div>
  }

  return (
    <div
      className={`drive-space-preview${focused ? ' single' : ''}${showStats ? ' with-stats' : ''}`}
    >
      {list.map((d) => (
        <DriveSpaceCard
          key={d.path}
          drive={d}
          large={!!focused}
          compact={showStats}
        />
      ))}
      {showStats ? (
        <FolderStatsCard
          folderPath={folderPath!}
          stats={folderStats!}
          dateModifiedLabel={dateModifiedLabel ?? '—'}
          indexedLabel={indexedLabel}
          onRevealPath={onRevealPath!}
          onOpenPath={onOpenPath!}
          onNotify={onNotify}
          suppressHero
        />
      ) : null}
    </div>
  )
}
