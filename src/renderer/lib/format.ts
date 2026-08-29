export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

export function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return (
    d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  )
}

export function typeLabel(ext: string, isDir: boolean): string {
  if (ext.toLowerCase() === 'mfevirtual') return 'Virtual Folder'
  if (isDir) return 'Folder'
  return ext ? `${ext.toUpperCase()} file` : 'File'
}
