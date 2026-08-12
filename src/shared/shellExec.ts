/** Helpers for launching user context-menu programs (D41). */

/** `.bat` / `.cmd` cannot be passed to Node `spawn` on Windows (EINVAL). */
export function isWindowsBatchFile(path: string): boolean {
  return /\.(bat|cmd)$/i.test(path.trim())
}

/**
 * Quote one argv token for `cmd.exe /s /c` (spaces / quotes).
 * Does not enable shell metacharacters — tokens are still discrete args.
 */
export function quoteWindowsCmdArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (!/[\s"]/u.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}
