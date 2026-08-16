import type { JSX } from 'react'
import type { DriveInfo } from '@shared/schemas/fs'
import {
  driveHasSpace,
  driveSpaceIsLow,
  formatFreeOfTotal,
  usedBytesOf
} from '@shared/driveSpace'

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
  large
}: {
  drive: DriveInfo
  large?: boolean
}): JSX.Element {
  const letter = /^([a-zA-Z]):/.exec(drive.path)?.[1]?.toUpperCase() ?? drive.label
  const space = driveHasSpace(drive)
    ? formatFreeOfTotal(drive.freeBytes!, drive.totalBytes!)
    : drive.offline
      ? 'Disconnected'
      : drive.driveType === 'remote'
        ? drive.remotePath || 'Network drive'
        : 'Size unknown'
  return (
    <div className={`drive-space-card${large ? ' large' : ''}`}>
      {space && driveHasSpace(drive) ? (
        <DrivePie drive={drive} size={large ? 88 : 56} />
      ) : (
        <div className="drive-pie drive-pie-empty" style={{ width: large ? 88 : 56, height: large ? 88 : 56 }} />
      )}
      <div className="drive-space-meta">
        <div className="drive-space-letter">{letter}</div>
        {drive.volumeName ? <div className="drive-space-name">{drive.volumeName}</div> : null}
        <div className="drive-space-line">{space}</div>
      </div>
    </div>
  )
}

export function DriveSpacePreview({
  drives,
  focusPath
}: {
  drives: DriveInfo[]
  focusPath?: string | null
}): JSX.Element {
  const letter = focusPath ? /^([a-zA-Z]):/.exec(focusPath)?.[1]?.toUpperCase() : null
  const focused = letter
    ? drives.find((d) => d.path[0]?.toUpperCase() === letter)
    : undefined
  const list = focused ? [focused] : drives

  return (
    <div className={`drive-space-preview${focused ? ' single' : ''}`}>
      {list.map((d) => (
        <DriveSpaceCard key={d.path} drive={d} large={!!focused} />
      ))}
    </div>
  )
}
