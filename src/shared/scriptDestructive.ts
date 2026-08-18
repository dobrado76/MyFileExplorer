const DESTRUCTIVE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bos\.remove\b/, label: 'os.remove' },
  { re: /\bos\.unlink\b/, label: 'os.unlink' },
  { re: /\bshutil\.rmtree\b/, label: 'shutil.rmtree' },
  { re: /\bpathlib\.Path\([^)]*\)\.unlink\b/, label: 'Path.unlink' },
  { re: /\bRemove-Item\b/i, label: 'Remove-Item' },
  { re: /\bRemove-ItemProperty\b/i, label: 'Remove-ItemProperty' },
  { re: /\brmdir\b/i, label: 'rmdir' },
  { re: /(^|[^\w])rm\s+(-[a-zA-Z]*r|-rf|-fr)\b/, label: 'rm -r' },
  { re: /(^|[^\w])del\s+/i, label: 'del' },
  { re: /\berase\s+/i, label: 'erase' },
  { re: /\bunlink\s+/, label: 'unlink' },
  { re: /\bformat\s+[a-zA-Z]:/i, label: 'format' },
  { re: /\bClear-Content\b/i, label: 'Clear-Content' },
  { re: /\bMove-Item\b[\s\S]{0,80}-Destination\s+.*Recycle/i, label: 'Move-Item' }
]

export function scanDestructiveSource(source: string): string[] {
  const hits: string[] = []
  const seen = new Set<string>()
  for (const { re, label } of DESTRUCTIVE_PATTERNS) {
    if (re.test(source) && !seen.has(label)) {
      seen.add(label)
      hits.push(label)
    }
  }
  return hits
}

export function looksDestructive(source: string): boolean {
  return scanDestructiveSource(source).length > 0
}

/** Best-effort path redaction for AI repair payloads (never a security boundary). */
export function redactPathsInText(text: string): string {
  return text
    .replace(/\\\\[^\s"'`]+/g, '<unc-path>')
    .replace(/\b[A-Za-z]:\\[^\s"'`]+/g, '<path>')
    .replace(/\/(?:home|Users|mnt|media|Volumes)\/[^\s"'`]+/g, '<path>')
}
