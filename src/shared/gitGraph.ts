/**
 * Assign graph lanes for a linear commit list (parents appear later when present).
 */

export type GitGraphCommit = {
  hash: string
  parents: string[]
}

export type GitGraphConnection = {
  fromLane: number
  toLane: number
  parentHash: string
  kind: 'parent' | 'collapse'
}

export type GitGraphRow = {
  hash: string
  commitLane: number
  /** Active tips at the top of this row (before placing the commit). */
  incoming: (string | null)[]
  /** Active tips at the bottom (after parents seeded). */
  outgoing: (string | null)[]
  connections: GitGraphConnection[]
}

export function buildGitGraph(commits: GitGraphCommit[]): GitGraphRow[] {
  const rows: GitGraphRow[] = []
  let tips: (string | null)[] = []

  for (const c of commits) {
    const incoming = tips.slice()
    let commitLane = incoming.findIndex((h) => h === c.hash)
    if (commitLane < 0) {
      commitLane = firstEmpty(incoming)
      while (incoming.length <= commitLane) incoming.push(null)
      incoming[commitLane] = c.hash
    }

    const outgoing = incoming.map((h) => (h === c.hash ? null : h))
    const connections: GitGraphConnection[] = []

    for (let pi = 0; pi < c.parents.length; pi++) {
      const parent = c.parents[pi]!
      let targetLane: number
      if (pi === 0) {
        const duplicateLane = outgoing.findIndex((h, lane) => lane !== commitLane && h === parent)
        if (duplicateLane >= 0) {
          // Keep shared ancestry in the leftmost lane instead of letting the
          // most recently visited branch drag it right for the rest of history.
          targetLane = Math.min(commitLane, duplicateLane)
          const collapsingLane = Math.max(commitLane, duplicateLane)
          outgoing[targetLane] = parent
          outgoing[collapsingLane] = null

          if (targetLane === commitLane) {
            connections.push({
              fromLane: commitLane,
              toLane: targetLane,
              parentHash: parent,
              kind: 'parent'
            })
          }
          connections.push({
            fromLane: collapsingLane,
            toLane: targetLane,
            parentHash: parent,
            kind: 'collapse'
          })
        } else {
          targetLane = commitLane
          outgoing[targetLane] = parent
          connections.push({
            fromLane: commitLane,
            toLane: targetLane,
            parentHash: parent,
            kind: 'parent'
          })
        }
        continue
      } else {
        const existing = outgoing.findIndex((h) => h === parent)
        targetLane = existing >= 0 ? existing : firstEmpty(outgoing)
      }
      while (outgoing.length <= targetLane) outgoing.push(null)
      if (outgoing[targetLane] && outgoing[targetLane] !== parent) {
        targetLane = firstEmpty(outgoing)
        while (outgoing.length <= targetLane) outgoing.push(null)
      }
      outgoing[targetLane] = parent
      connections.push({
        fromLane: commitLane,
        toLane: targetLane,
        parentHash: parent,
        kind: 'parent'
      })
    }

    while (outgoing.length > 0 && outgoing[outgoing.length - 1] == null) outgoing.pop()

    rows.push({
      hash: c.hash,
      commitLane,
      incoming: incoming.slice(),
      outgoing: outgoing.slice(),
      connections
    })
    tips = outgoing
  }

  return rows
}

function firstEmpty(lanes: (string | null)[]): number {
  const i = lanes.findIndex((h) => h == null)
  return i >= 0 ? i : lanes.length
}

export function laneColorIndex(key: string, paletteSize: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return paletteSize > 0 ? h % paletteSize : 0
}

export function parentRowIndex(
  rows: readonly { hash: string }[],
  parentHash: string,
  after: number
): number {
  for (let j = after + 1; j < rows.length; j++) {
    if (rows[j]!.hash === parentHash) return j
  }
  return -1
}

export function graphConnectionKind(
  row: GitGraphRow,
  c: GitGraphConnection
): 'join' | 'split' | 'same' | 'collapse' {
  if (c.kind === 'collapse') return 'collapse'
  if (c.fromLane === c.toLane) return 'same'
  const tip = row.incoming[c.toLane]
  return tip != null && tip !== row.hash ? 'join' : 'split'
}

/** Rows whose upper half is occupied by a split curve entering the new lane. */
export function splitLaneStarts(rows: readonly GitGraphRow[]): Set<string> {
  const starts = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    for (const c of row.connections) {
      if (graphConnectionKind(row, c) === 'split' && i + 1 < rows.length) {
        starts.add(`${i + 1}:${c.toLane}`)
      }
    }
  }
  return starts
}

/** Active lanes that collapse into another lane after their row midpoint. */
export function collapseLaneEnds(rows: readonly GitGraphRow[]): Set<string> {
  const ends = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    for (const c of rows[i]!.connections) {
      if (c.kind === 'collapse') ends.add(`${i}:${c.fromLane}`)
    }
  }
  return ends
}

/** S-curve with vertical tangents at both ends (Git Graph / Git Extensions). */
export function gitForkPath(x0: number, y0: number, x1: number, y1: number): string {
  const dy = Math.max(10, Math.abs(y1 - y0) * 0.45)
  return `M ${x0} ${y0} C ${x0} ${y0 + dy}, ${x1} ${y1 - dy}, ${x1} ${y1}`
}
