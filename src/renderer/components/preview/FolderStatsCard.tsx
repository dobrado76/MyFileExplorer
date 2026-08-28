import type { JSX } from 'react'
import type { FolderStatsPreviewModel, FolderStatsCategoryKey } from '@shared/folderStats'
import { FOLDER_STATS_CATEGORY_KEYS } from '@shared/folderStats'
import { formatBytesBinary } from '@shared/driveSpace'
import { FolderIcon } from '../../lib/icons'
import { basename } from '../../lib/paths'
import { FolderStatsTreemap } from './FolderStatsTreemap'

const CATEGORY_LABELS: Record<FolderStatsCategoryKey, string> = {
  images: 'Images',
  videos: 'Videos',
  documents: 'Documents',
  archives: 'Archives',
  other: 'Other'
}

function joinUnder(folder: string, rel: string): string {
  const base = folder.replace(/[\\/]+$/, '')
  const rest = rel.replace(/\//g, '\\').replace(/^\\+/, '')
  return `${base}\\${rest}`
}

function formatAge(ms: number): string {
  const ago = Date.now() - ms
  if (!Number.isFinite(ago) || ago < 0) return new Date(ms).toLocaleString()
  const sec = Math.floor(ago / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const days = Math.floor(hr / 24)
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(ms).toLocaleString()
}

function pctOf(bytes: number, total: number): number {
  if (!(total > 0) || !(bytes > 0)) return 0
  return Math.round((100 * bytes) / total)
}

export type FolderStatsCardProps = {
  folderPath: string
  stats: FolderStatsPreviewModel
  dateModifiedLabel: string
  indexedLabel?: string
  onRevealPath: (absPath: string) => void
  onOpenPath: (absPath: string) => void
  onNotify?: (text: string, isError?: boolean) => void
}

export function FolderStatsCard({
  folderPath,
  stats,
  dateModifiedLabel,
  indexedLabel,
  onRevealPath,
  onOpenPath,
  onNotify
}: FolderStatsCardProps): JSX.Element {
  const name = basename(folderPath) || folderPath
  const mayBeStale = stats.folderMtimeMs > stats.calculatedAtMs
  const total = stats.totalSize
  const hasMap = stats.leaves.length > 0

  const resolveLeaf = (relativePath: string): string => joinUnder(folderPath, relativePath)

  const reveal = (relativePath: string): void => {
    try {
      onRevealPath(resolveLeaf(relativePath))
    } catch {
      onNotify?.('Item not found', true)
    }
  }

  return (
    <div className={`folder-stats-card${hasMap ? ' folder-stats-card-with-map' : ''}`}>
      <div className="folder-stats-scroll">
        <div className="folder-stats-hero">
          <div className="preview-icon folder-stats-icon">
            <FolderIcon size={48} />
          </div>
          <div className="folder-stats-hero-text">
            <div className="folder-stats-name" title={folderPath}>
              {name}
            </div>
            <div className="folder-stats-path mono" title={folderPath}>
              {folderPath}
            </div>
            <div className="folder-stats-summary">
              {stats.folderTotCount.toLocaleString()} folder
              {stats.folderTotCount === 1 ? '' : 's'} · {stats.fileTotCount.toLocaleString()} file
              {stats.fileTotCount === 1 ? '' : 's'} · {formatBytesBinary(stats.totalSize) || '0 B'}
            </div>
            <div className="folder-stats-meta-line">
              <span>Date modified {dateModifiedLabel}</span>
              {stats.newestMtimeMs > 0 ? (
                <span>Newest content {new Date(stats.newestMtimeMs).toLocaleString()}</span>
              ) : null}
              {indexedLabel ? <span>Indexed {indexedLabel}</span> : null}
            </div>
          <div
            className="folder-stats-stale"
            title="Statistics update when you run Calculate Statistics"
          >
            {mayBeStale
              ? 'Statistics may be out of date'
              : `Statistics calculated ${formatAge(stats.calculatedAtMs)}`}
            {stats.leaves.length > 0
              ? ` · map shows ${stats.leaves.length.toLocaleString()} files`
              : ''}
          </div>
          </div>
        </div>

        <section className="folder-stats-section">
          <div className="folder-stats-section-title">Contents</div>
          <ul className="folder-stats-categories">
            {FOLDER_STATS_CATEGORY_KEYS.map((key) => {
              const row = stats.categories[key]
              if (!row || row.count === 0) return null
              const pct = pctOf(row.bytes, total)
              return (
                <li key={key}>
                  <span className="folder-stats-cat-label">{CATEGORY_LABELS[key]}</span>
                  <span className="folder-stats-cat-vals">
                    {row.count.toLocaleString()}
                    {row.bytes > 0 ? ` · ${formatBytesBinary(row.bytes)}` : ''}
                    {pct > 0 ? ` · ${pct}%` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          {stats.topExtensions.length > 0 ? (
            <div className="folder-stats-top-ext">
              Top types:{' '}
              {stats.topExtensions
                .map((t) => `.${t.ext} ${t.count.toLocaleString()}`)
                .join(' · ')}
            </div>
          ) : null}
        </section>

        {stats.largest.length > 0 ? (
          <section className="folder-stats-section">
            <div className="folder-stats-section-title">Largest</div>
            <ul className="folder-stats-list">
              {stats.largest.map((leaf) => (
                <li key={leaf.relativePath}>
                  <button
                    type="button"
                    className="folder-stats-link"
                    title={leaf.relativePath}
                    onClick={() => reveal(leaf.relativePath)}
                  >
                    <span className="folder-stats-link-name">{leaf.name}</span>
                    <span className="folder-stats-link-size">
                      {formatBytesBinary(leaf.size) || '0 B'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {stats.recent.length > 0 ? (
          <section className="folder-stats-section">
            <div className="folder-stats-section-title">Recently modified</div>
            <ul className="folder-stats-list">
              {stats.recent.map((entry) => (
                <li key={`${entry.isDir ? 'd' : 'f'}:${entry.relativePath}`}>
                  <button
                    type="button"
                    className="folder-stats-link"
                    title={entry.relativePath}
                    onClick={() => reveal(entry.relativePath)}
                  >
                    <span className="folder-stats-link-name">
                      {entry.name}
                      {entry.isDir ? ' \\' : ''}
                    </span>
                    <span className="folder-stats-link-size">{formatAge(entry.mtimeMs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {hasMap ? (
        <section className="folder-stats-section folder-stats-section-map">
          <div className="folder-stats-map-heading">
            <div className="folder-stats-section-title">Space usage</div>
            {stats.clump != null && stats.clump.fileCount > 0 ? (
              <div
                className="folder-stats-map-other"
                title={`${stats.clump.fileCount.toLocaleString()} files not shown as tiles · ${
                  formatBytesBinary(stats.clump.size) || '0 B'
                }`}
              >
                Other {stats.clump.fileCount.toLocaleString()} files
                {stats.clump.size > 0 ? ` · ${formatBytesBinary(stats.clump.size)}` : ''}
              </div>
            ) : null}
          </div>
          <FolderStatsTreemap
            leaves={stats.leaves}
            onLeafClick={(leaf) => reveal(leaf.relativePath)}
            onLeafDoubleClick={(leaf) => onOpenPath(resolveLeaf(leaf.relativePath))}
          />
        </section>
      ) : null}
    </div>
  )
}
