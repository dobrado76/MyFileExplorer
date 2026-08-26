import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { GitRepositoryStatus } from '@shared/schemas/git'
import type { GitDecoratedRef, GitLogCommit } from '@shared/schemas/gitLog'
import {
  buildGitGraph,
  collapseLaneEnds,
  gitForkPath,
  graphConnectionKind,
  laneColorIndex,
  parentRowIndex,
  splitLaneStarts,
  type GitGraphRow
} from '@shared/gitGraph'
import { api, call, IpcError } from '../../lib/ipc'
import { basename } from '../../lib/paths'
import { SpinnerIcon } from '../../lib/icons'
import { useAppStore } from '../../store/appStore'
import { GitBranchCreateDialog, GitTagCreateDialog, GitTagDeleteDialog } from '../git/GitDialogs'
import { GitCommitDetailDialog } from '../git/GitCommitDetailDialog'
import { GitHistoryContextMenu } from './GitHistoryContextMenu'
import { GitRepoPreviewToolbar } from './GitRepoPreviewToolbar'

const LANE_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#06b6d4',
  '#ef4444',
  '#eab308',
  '#ec4899'
]

const COL_W = 14
const ROW_H = 28
const NODE_R = 3.5

function relativeTime(unixSec: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor(nowMs / 1000 - unixSec))
  if (sec < 45) return 'just now'
  if (sec < 90) return '1 minute ago'
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`
  if (sec < 5400) return '1 hour ago'
  if (sec < 86_400) return `${Math.floor(sec / 3600)} hours ago`
  if (sec < 172_800) return '1 day ago'
  if (sec < 2_592_000) return `${Math.floor(sec / 86_400)} days ago`
  if (sec < 5_184_000) return '1 month ago'
  if (sec < 31_536_000) return `${Math.floor(sec / 2_592_000)} months ago`
  const y = Math.floor(sec / 31_536_000)
  return y === 1 ? '1 year ago' : `${y} years ago`
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

function avatarColor(email: string): string {
  return LANE_COLORS[laneColorIndex(email || 'x', LANE_COLORS.length)]!
}

function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

function RefBadge({ badge }: { badge: GitDecoratedRef }): JSX.Element {
  const { kind, name, current: isCurrent } = badge
  const cls =
    kind === 'tag'
      ? 'git-ref-badge tag'
      : kind === 'remote'
        ? 'git-ref-badge remote'
        : kind === 'head'
          ? 'git-ref-badge head'
          : isCurrent
            ? 'git-ref-badge branch current'
            : 'git-ref-badge branch'
  return (
    <span className={cls} title={`${kind}: ${name}`}>
      {isCurrent && kind === 'branch' ? (
        <span className="git-ref-head-mark" aria-hidden>
          ▶
        </span>
      ) : null}
      {name}
    </span>
  )
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!
}

function xAt(lane: number): number {
  return 8 + lane * COL_W + COL_W / 2
}

function rowLaneCount(row: GitGraphRow): number {
  return Math.max(
    row.incoming.length,
    row.outgoing.length,
    row.commitLane + 1,
    ...row.connections.map((c) => Math.max(c.fromLane, c.toLane) + 1),
    1
  )
}

/**
 * Joins: node → parent S-curve (leave this path alone).
 * Splits: full-row S-curve into the next row’s center, where the new lane
 * continues downward. This avoids the cramped half-row elbow.
 */
function GitGraphSvg({ rows }: { rows: GitGraphRow[] }): JSX.Element {
  const maxLanes = Math.max(1, ...rows.map(rowLaneCount))
  const w = maxLanes * COL_W + 8
  const h = Math.max(rows.length * ROW_H, ROW_H)
  const splitStarts = splitLaneStarts(rows)
  const collapseEnds = collapseLaneEnds(rows)
  const lines: JSX.Element[] = []
  const forks: JSX.Element[] = []
  const nodes: JSX.Element[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const top = i * ROW_H
    const mid = top + ROW_H / 2
    const bot = top + ROW_H

    row.incoming.forEach((hash, lane) => {
      if (!hash) return
      const endsHere = hash === row.hash
      const startsAtMid = splitStarts.has(`${i}:${lane}`)
      const collapsesAtMid = collapseEnds.has(`${i}:${lane}`)
      lines.push(
        <line
          key={`in-${i}-${lane}`}
          x1={xAt(lane)}
          y1={startsAtMid ? mid : top}
          x2={xAt(lane)}
          y2={endsHere || collapsesAtMid ? mid : bot}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
        />
      )
    })

    for (const [ci, c] of row.connections.entries()) {
      const x0 = xAt(c.fromLane)
      const x1 = xAt(c.toLane)
      const kind = graphConnectionKind(row, c)
      if (kind === 'collapse') {
        forks.push(
          <path
            key={`c-${i}-${ci}`}
            d={gitForkPath(x0, mid, x1, mid + ROW_H)}
            fill="none"
            stroke={laneColor(c.fromLane)}
            strokeWidth={1.5}
          />
        )
        continue
      }
      if (kind === 'same') {
        lines.push(
          <line
            key={`c-${i}-${ci}`}
            x1={x0}
            y1={mid}
            x2={x1}
            y2={bot}
            stroke={laneColor(c.fromLane)}
            strokeWidth={1.5}
          />
        )
        continue
      }
      if (kind === 'join') {
        const j = parentRowIndex(rows, c.parentHash, i)
        const y1 = j >= 0 ? j * ROW_H + ROW_H / 2 : bot
        forks.push(
          <path
            key={`c-${i}-${ci}`}
            d={gitForkPath(x0, mid, x1, y1)}
            fill="none"
            stroke={laneColor(c.fromLane)}
            strokeWidth={1.5}
          />
        )
        continue
      }
      forks.push(
        <path
          key={`c-${i}-${ci}`}
          d={gitForkPath(x0, mid, x1, mid + ROW_H)}
          fill="none"
          stroke={laneColor(c.toLane)}
          strokeWidth={1.5}
        />
      )
    }

    nodes.push(
      <circle
        key={`n-${i}`}
        cx={xAt(row.commitLane)}
        cy={mid}
        r={NODE_R}
        fill={laneColor(row.commitLane)}
      />
    )
  }

  return (
    <svg className="git-graph-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {lines}
      {forks}
      {nodes}
    </svg>
  )
}

function graphWidth(rows: GitGraphRow[]): number {
  return Math.max(1, ...rows.map(rowLaneCount)) * COL_W + 8
}

function matchesFilter(c: GitLogCommit, q: string): boolean {
  if (!q) return true
  const hay = `${c.hash} ${c.subject} ${c.authorName} ${c.authorEmail}`.toLowerCase()
  return hay.includes(q)
}

export function GitRepoPreview({
  repoRoot,
  status,
  onRefreshStatus
}: {
  repoRoot: string
  status: GitRepositoryStatus | null
  onRefreshStatus?(): void
}): JSX.Element {
  const mergeGitStatus = useAppStore((s) => s.mergeGitStatus)
  const [commits, setCommits] = useState<GitLogCommit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [head, setHead] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [ctx, setCtx] = useState<{ hash: string; x: number; y: number } | null>(null)
  const [branchDlg, setBranchDlg] = useState<string | null>(null)
  const [tagDlg, setTagDlg] = useState<string | null>(null)
  const [deleteTagDlg, setDeleteTagDlg] = useState<string | null>(null)
  const [detailDlg, setDetailDlg] = useState<GitLogCommit | null>(null)
  const [now] = useState(() => Date.now())
  const commitsLenRef = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    commitsLenRef.current = commits.length
  }, [commits.length])

  const load = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = opts?.append === true
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const skip = append ? commitsLenRef.current : 0
        const res = await call(api.git.log({ repoRoot, limit: 150, skip }))
        setHead(res.head)
        setTruncated(res.truncated)
        setCommits((prev) => (append ? [...prev, ...res.commits] : res.commits))
        if (!append && res.commits[0]) setSelected(res.commits[0].hash)
      } catch (e) {
        setError(e instanceof IpcError ? e.message : String(e))
        if (!append) setCommits([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [repoRoot]
  )

  useEffect(() => {
    void load()
  }, [load])

  const afterMutate = useCallback(async () => {
    onRefreshStatus?.()
    try {
      const res = await call(api.git.refresh({ repoRoot }))
      mergeGitStatus(res.status)
    } catch {
      /* ignore */
    }
    await load()
  }, [load, mergeGitStatus, onRefreshStatus, repoRoot])

  const filterQ = filter.trim().toLowerCase()
  const visibleCommits = useMemo(
    () => (filterQ ? commits.filter((c) => matchesFilter(c, filterQ)) : commits),
    [commits, filterQ]
  )

  const graph = useMemo(
    () => buildGitGraph(visibleCommits.map((c) => ({ hash: c.hash, parents: c.parents }))),
    [visibleCommits]
  )

  const selectedCommit = commits.find((c) => c.hash === selected) ?? null
  const ctxCommit = ctx ? (commits.find((c) => c.hash === ctx.hash) ?? null) : null

  const selectAndScroll = useCallback((hash: string) => {
    setSelected(hash)
    const el = rowRefs.current.get(hash)
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  const openCommitDetail = useCallback(
    (hash: string) => {
      const c = commits.find((x) => x.hash === hash)
      if (c) setDetailDlg(c)
    },
    [commits]
  )

  return (
    <div className="git-repo-preview">
      <div className="git-repo-preview-header">
        <div className="git-repo-preview-title">
          <span className="git-repo-preview-name" title={repoRoot}>
            {basename(repoRoot)}
          </span>
          <span className="git-repo-preview-kind">Git repository</span>
        </div>
      </div>

      <GitRepoPreviewToolbar
        repoRoot={repoRoot}
        status={status}
        filter={filter}
        onFilterChange={setFilter}
        onRefresh={() => {
          onRefreshStatus?.()
          void load()
        }}
      />

      {loading && commits.length === 0 ? (
        <div className="git-repo-preview-loading">
          <SpinnerIcon size={18} />
          <span>Loading history…</span>
        </div>
      ) : error && commits.length === 0 ? (
        <div className="git-repo-preview-error">{error}</div>
      ) : (
        <>
          <div
            className="git-history"
            role="list"
            aria-label="Commit history"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && selected) {
                e.preventDefault()
                openCommitDetail(selected)
              }
            }}
          >
            <div className="git-history-stack">
              <div className="git-history-graph-layer" aria-hidden>
                <GitGraphSvg rows={graph} />
              </div>
              {visibleCommits.map((c) => {
                const isHead = head != null && c.hash === head
                const isSel = selected === c.hash
                return (
                  <button
                    type="button"
                    key={c.hash}
                    role="listitem"
                    ref={(el) => {
                      if (el) rowRefs.current.set(c.hash, el)
                      else rowRefs.current.delete(c.hash)
                    }}
                    className={`git-history-row${isSel ? ' selected' : ''}${isHead ? ' is-head' : ''}`}
                    onClick={() => setSelected(c.hash)}
                    onDoubleClick={() => openCommitDetail(c.hash)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelected(c.hash)
                      setCtx({ hash: c.hash, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <span className="git-history-graph" style={{ width: graphWidth(graph) }} />
                    <span className="git-history-msg">
                      {c.refs.length > 0 ? (
                        <span className="git-history-refs">
                          {c.refs.map((r) => (
                            <RefBadge key={`${r.kind}:${r.name}`} badge={r} />
                          ))}
                        </span>
                      ) : null}
                      <span className="git-history-subject" title={c.subject}>
                        {c.subject || '(no message)'}
                      </span>
                    </span>
                    <span className="git-history-author" title={c.authorEmail}>
                      <span
                        className="git-history-avatar"
                        style={{ background: avatarColor(c.authorEmail) }}
                        aria-hidden
                      >
                        {authorInitials(c.authorName)}
                      </span>
                      <span className="git-history-author-name">{c.authorName || 'Unknown'}</span>
                    </span>
                    <span
                      className="git-history-date"
                      title={new Date(c.authorDate * 1000).toLocaleString()}
                    >
                      {relativeTime(c.authorDate, now)}
                    </span>
                    <span
                      className="git-history-hash"
                      title={`${c.hash} — click to copy`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(c.hash)
                      }}
                    >
                      {shortHash(c.hash)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          {truncated && !filterQ ? (
            <div className="git-history-more">
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={() => void load({ append: true })}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null}
          {selectedCommit ? (
            <div className="git-commit-detail">
              <div className="git-commit-detail-hash" title={selectedCommit.hash}>
                {selectedCommit.hash}
              </div>
              <div className="git-commit-detail-subject">{selectedCommit.subject}</div>
              <div className="git-commit-detail-meta">
                {selectedCommit.authorName}
                {selectedCommit.authorEmail ? ` <${selectedCommit.authorEmail}>` : ''}
                {' · '}
                {new Date(selectedCommit.authorDate * 1000).toLocaleString()}
              </div>
            </div>
          ) : null}
        </>
      )}

      {ctx && ctxCommit ? (
        <GitHistoryContextMenu
          repoRoot={repoRoot}
          commit={ctxCommit}
          commits={commits}
          head={head}
          pos={{ x: ctx.x, y: ctx.y }}
          onClose={() => setCtx(null)}
          onDone={() => void afterMutate()}
          onSelectHash={selectAndScroll}
          onOpenBranchDialog={() => setBranchDlg(ctxCommit.hash)}
          onOpenTagDialog={() => setTagDlg(ctxCommit.hash)}
          onOpenDeleteTagDialog={(tag) => setDeleteTagDlg(tag)}
        />
      ) : null}
      {branchDlg ? (
        <GitBranchCreateDialog
          repoRoot={repoRoot}
          startPoint={branchDlg}
          onClose={() => setBranchDlg(null)}
          onDone={() => void afterMutate()}
        />
      ) : null}
      {tagDlg ? (
        <GitTagCreateDialog
          repoRoot={repoRoot}
          commit={tagDlg}
          onClose={() => setTagDlg(null)}
          onDone={() => void afterMutate()}
        />
      ) : null}
      {deleteTagDlg ? (
        <GitTagDeleteDialog
          repoRoot={repoRoot}
          tag={deleteTagDlg}
          onClose={() => setDeleteTagDlg(null)}
          onDone={() => void afterMutate()}
        />
      ) : null}
      {detailDlg ? (
        <GitCommitDetailDialog
          repoRoot={repoRoot}
          commit={detailDlg}
          onClose={() => setDetailDlg(null)}
          onNavigateCommit={(hash) => {
            const c = commits.find((x) => x.hash === hash)
            if (c) {
              setDetailDlg(c)
              selectAndScroll(hash)
            }
          }}
        />
      ) : null}
    </div>
  )
}
