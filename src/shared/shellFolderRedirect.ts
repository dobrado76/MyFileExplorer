/**
 * Pure helpers for experimental Directory shell-redirect (D72). Unit-tested.
 */

/** v1 managed verb roots under HKCU\Software\Classes\ */
export const SHELL_REDIRECT_V1_SUBTREES = [
  'Directory\\shell\\open',
  'Directory\\shell\\explore'
] as const

export type ShellRedirectSubtree = (typeof SHELL_REDIRECT_V1_SUBTREES)[number]

export type ShellTargetKind = 'directory' | 'file' | 'unsupported'

/** Verb name from subtree path, e.g. Directory\shell\open → open */
export function verbFromSubtree(subtree: string): string {
  const parts = subtree.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? 'open'
}

/** HKCU path for a managed subtree root. */
export function hkcuSubtreeKey(subtree: string): string {
  return `HKCU\\Software\\Classes\\${subtree}`
}

/** Command subkey for a managed verb. */
export function hkcuCommandKey(subtree: string): string {
  return `${hkcuSubtreeKey(subtree)}\\command`
}

/** Build the registry (Default) command value for a verb. */
export function buildLauncherRegistryCommand(launcherExe: string, verb: string): string {
  const q = (p: string) => `"${p.replace(/"/g, '\\"')}"`
  return `${q(launcherExe)} ${verb} ${q('%1')}`
}

/** Normalize paths for comparison (registry may use mixed slashes). */
export function normalizeRegistryCommand(cmd: string): string {
  return cmd.trim().replace(/\//g, '\\').toLowerCase()
}

export function commandsMatch(a: string, b: string): boolean {
  return normalizeRegistryCommand(a) === normalizeRegistryCommand(b)
}

/**
 * Classify a shell %1 target. Launcher mirrors this logic in C#.
 * Only ordinary drive/UNC filesystem paths are forwarded to MFE.
 */
export function classifyShellTarget(raw: string): ShellTargetKind {
  const target = raw.trim().replace(/^"+|"+$/g, '')
  if (!target) return 'unsupported'
  if (target.startsWith('::{') || target.startsWith('shell:')) return 'unsupported'
  if (/^\\\\[^\\]+\\[^\\]*$/.test(target.replace(/\\+$/, ''))) {
    return 'directory'
  }
  if (/^[a-zA-Z]:[\\/]/.test(target) || /^[a-zA-Z]:$/.test(target)) {
    return 'directory'
  }
  if (target.startsWith('\\\\')) {
    return 'directory'
  }
  return 'unsupported'
}

export type ShellRedirectDerivedStatus =
  | 'disabled'
  | 'enabled'
  | 'drifted'
  | 'missingLauncher'
  | 'restoreRequired'

export function deriveShellRedirectStatus(input: {
  userRequested: boolean
  launcherExists: boolean
  hasBackup: boolean
  allKeysMatch: boolean
  anyKeyPresent: boolean
}): ShellRedirectDerivedStatus {
  if (!input.launcherExists && input.anyKeyPresent) return 'missingLauncher'
  if (!input.anyKeyPresent && !input.userRequested) return 'disabled'
  if (!input.anyKeyPresent && input.userRequested) {
    return input.hasBackup ? 'restoreRequired' : 'disabled'
  }
  if (input.allKeysMatch && input.launcherExists) return 'enabled'
  if (input.userRequested) return 'drifted'
  return 'drifted'
}
