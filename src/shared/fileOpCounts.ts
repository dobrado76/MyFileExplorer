/** Status-bar “12,345 of 100,000” / “12,345 scanned” for copy-move-delete progress. */
export function formatFileOpCounts(done: number, total: number): string {
  if (total <= 0) return done > 0 ? `${done.toLocaleString()} scanned` : '…'
  return `${done.toLocaleString()} of ${Math.max(total, done).toLocaleString()}`
}
