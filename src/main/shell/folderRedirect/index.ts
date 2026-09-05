import fs from 'node:fs'
import {
  SHELL_REDIRECT_V1_SUBTREES,
  buildLauncherRegistryCommand,
  commandReferencesMfeLauncher,
  commandsMatch,
  deriveShellRedirectStatus,
  hkcuCommandKey,
  hkcuSubtreeKey,
  isCompleteShellRedirectBackup,
  verbFromSubtree
} from '@shared/shellFolderRedirect'
import { AppError } from '@shared/result'
import type {
  ShellRedirectGetStatusResponse,
  ShellRedirectInvocation,
  ShellRedirectMutateResponse,
  ShellRedirectStatus
} from '@shared/schemas/shellRedirect'
import { logMain } from '../../logging'
import {
  ensureShellRedirectSidecarLauncher,
  shellRedirectBackupManifestPath,
  shellRedirectDir,
  shellRedirectInvocationsPath,
  shellRedirectRegFragmentPath,
  resolveLauncherPath,
  resolveMfeExePath,
  writeShellRedirectTargetExe
} from './paths'
import {
  parseRegValues,
  regDeleteTree,
  regDeleteValue,
  regExport,
  regImport,
  regKeyExists,
  regQuery,
  regSetDefault,
  regValueExists
} from './reg'
import { readShellRedirectState, setUserRequestedEnabled } from './state'

export const BACKUP_FORMAT_VERSION = 1

export type SubtreeBackupEntry = {
  existedBefore: boolean
  regFile: string
}

export type ShellRedirectBackupManifest = {
  version: number
  savedAt: string
  subtrees: Record<string, SubtreeBackupEntry>
  applied: Record<string, string>
}

function emptyManifest(): ShellRedirectBackupManifest {
  return {
    version: BACKUP_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    subtrees: {},
    applied: {}
  }
}

export function readBackupManifest(): ShellRedirectBackupManifest | null {
  try {
    const raw = fs.readFileSync(shellRedirectBackupManifestPath(), 'utf8')
    const parsed = JSON.parse(raw) as ShellRedirectBackupManifest
    if (!parsed || typeof parsed !== 'object' || parsed.version !== BACKUP_FORMAT_VERSION) return null
    if (!isCompleteShellRedirectBackup(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function writeBackupManifest(manifest: ShellRedirectBackupManifest): void {
  shellRedirectDir()
  fs.writeFileSync(shellRedirectBackupManifestPath(), JSON.stringify(manifest, null, 2), 'utf8')
}

/** After a verified restore, drop the baseline so the next Enable captures a fresh one. */
export function clearShellRedirectBackupArtifacts(): void {
  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const regFile = shellRedirectRegFragmentPath(subtree)
    try {
      if (fs.existsSync(regFile)) fs.unlinkSync(regFile)
    } catch {
      /* ignore */
    }
  }
  try {
    if (fs.existsSync(shellRedirectBackupManifestPath())) {
      fs.unlinkSync(shellRedirectBackupManifestPath())
    }
  } catch {
    /* ignore */
  }
}

async function readCommandValue(subtree: string): Promise<string | null> {
  const key = hkcuCommandKey(subtree)
  const out = await regQuery(key)
  if (!out) return null
  const values = parseRegValues(out)
  const cmd = (values[''] ?? values['(Default)'] ?? '').trim()
  return cmd || null
}

async function subtreeHasDelegateExecute(subtree: string): Promise<boolean> {
  const root = hkcuSubtreeKey(subtree)
  const cmd = hkcuCommandKey(subtree)
  if (await regValueExists(root, 'DelegateExecute')) return true
  if (await regValueExists(cmd, 'DelegateExecute')) return true
  return false
}

async function clearDelegateExecute(subtree: string): Promise<void> {
  await regDeleteValue(hkcuSubtreeKey(subtree), 'DelegateExecute')
  await regDeleteValue(hkcuCommandKey(subtree), 'DelegateExecute')
}

function expectedCommands(launcherPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const verb = verbFromSubtree(subtree)
    out[hkcuCommandKey(subtree)] = buildLauncherRegistryCommand(launcherPath, verb)
  }
  return out
}

async function exportSubtreeBackup(
  manifest: ShellRedirectBackupManifest,
  subtree: string
): Promise<void> {
  const key = hkcuSubtreeKey(subtree)
  const existedBefore = await regKeyExists(key)
  const regFile = shellRedirectRegFragmentPath(subtree)
  if (existedBefore) {
    await regExport(key, regFile)
  } else if (fs.existsSync(regFile)) {
    fs.unlinkSync(regFile)
  }
  manifest.subtrees[subtree] = {
    existedBefore,
    regFile: existedBefore ? regFile : ''
  }
}

async function applyRedirectCommands(launcherPath: string, applied: Record<string, string>): Promise<void> {
  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const verb = verbFromSubtree(subtree)
    const cmdKey = hkcuCommandKey(subtree)
    const cmd = buildLauncherRegistryCommand(launcherPath, verb)
    await regSetDefault(cmdKey, cmd)
    await clearDelegateExecute(subtree)
    applied[cmdKey] = cmd
  }
}

async function verifyCommands(expected: Record<string, string>): Promise<boolean> {
  for (const [cmdKey, want] of Object.entries(expected)) {
    const subtree = SHELL_REDIRECT_V1_SUBTREES.find((s) => hkcuCommandKey(s) === cmdKey)
    if (!subtree) continue
    const live = await readCommandValue(subtree)
    if (!live || !commandsMatch(live, want)) return false
    if (await subtreeHasDelegateExecute(subtree)) return false
  }
  return true
}

async function verifyRestoredNoLauncher(): Promise<boolean> {
  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const live = await readCommandValue(subtree)
    if (commandReferencesMfeLauncher(live)) return false
  }
  return true
}

/**
 * Exact subtree restore: delete managed key, then import the snapshot (if any).
 * Never deletes when the backup said the key existed but the .reg is missing.
 */
async function rollbackSubtree(subtree: string, entry: SubtreeBackupEntry): Promise<void> {
  const key = hkcuSubtreeKey(subtree)
  if (entry.existedBefore) {
    if (!entry.regFile || !fs.existsSync(entry.regFile)) {
      throw new AppError(
        'validation',
        `Shell redirect backup fragment missing for ${subtree} — restore aborted`,
        undefined,
        entry.regFile || key
      )
    }
    await regDeleteTree(key)
    await regImport(entry.regFile)
    return
  }
  await regDeleteTree(key)
}

export async function restoreShellRedirectFromBackup(): Promise<void> {
  const manifest = readBackupManifest()
  if (!manifest) {
    // Fail closed: never wipe open/explore without a valid baseline.
    const stillOurs = !(await verifyRestoredNoLauncher())
    if (stillOurs) {
      throw new AppError(
        'validation',
        'Shell redirect backup is missing or corrupt — restore aborted. Registry was not modified.',
        'restoreRequired'
      )
    }
    setUserRequestedEnabled(false)
    return
  }

  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const entry = manifest.subtrees[subtree]
    if (!entry) {
      throw new AppError(
        'validation',
        `Shell redirect backup incomplete (missing ${subtree}) — restore aborted`,
        'restoreRequired'
      )
    }
    await rollbackSubtree(subtree, entry)
  }

  if (!(await verifyRestoredNoLauncher())) {
    throw new AppError(
      'unknown',
      'Shell redirect restore finished but registry still references MfeShellLauncher.exe',
      'restoreRequired'
    )
  }

  clearShellRedirectBackupArtifacts()
  setUserRequestedEnabled(false)
}

export async function enableShellRedirect(): Promise<ShellRedirectMutateResponse> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Shell redirect is only available on Windows')
  }

  const launcherPath = resolveLauncherPath()
  if (!fs.existsSync(launcherPath)) {
    throw new AppError('not-found', `Launcher not found: ${launcherPath}`)
  }

  const existing = readBackupManifest()
  // Keep the original pre-enable baseline while redirect is still applied;
  // after a successful restore the artifacts are deleted so Enable always re-snapshots.
  const reuseBaseline =
    existing != null &&
    Object.keys(existing.applied).length > 0 &&
    isCompleteShellRedirectBackup(existing)

  const manifest = reuseBaseline ? { ...existing, subtrees: { ...existing.subtrees } } : emptyManifest()
  const rollbackEntries: Array<{ subtree: string; entry: SubtreeBackupEntry }> = []

  try {
    for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
      if (!reuseBaseline || !manifest.subtrees[subtree]) {
        await exportSubtreeBackup(manifest, subtree)
      }
      rollbackEntries.push({
        subtree,
        entry: { ...manifest.subtrees[subtree]! }
      })
    }

    manifest.savedAt = new Date().toISOString()
    writeBackupManifest(manifest)

    const applied: Record<string, string> = {}
    await applyRedirectCommands(launcherPath, applied)
    manifest.applied = applied
    writeBackupManifest(manifest)

    const expected = expectedCommands(launcherPath)
    const ok = await verifyCommands(expected)
    if (!ok) {
      throw new AppError('unknown', 'Registry verification failed after apply')
    }

    setUserRequestedEnabled(true)
    writeShellRedirectTargetExe()
    ensureShellRedirectSidecarLauncher(launcherPath)
    logMain('info', 'shell-redirect: enabled')
    return toMutateResponse(await getShellRedirectStatus())
  } catch (e) {
    for (const { subtree, entry } of rollbackEntries) {
      try {
        await rollbackSubtree(subtree, entry)
      } catch (rollbackErr) {
        logMain(
          'error',
          `shell-redirect rollback failed for ${subtree}: ${
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          }`
        )
      }
    }
    throw e
  }
}

export async function repairShellRedirect(): Promise<ShellRedirectMutateResponse> {
  const launcherPath = resolveLauncherPath()
  if (!fs.existsSync(launcherPath)) {
    throw new AppError('not-found', `Launcher not found: ${launcherPath}`)
  }

  const manifest = readBackupManifest()
  if (!manifest) {
    throw new AppError('validation', 'No backup manifest — enable redirect first or restore manually')
  }

  // Snapshot live commands so a partial repair can roll back.
  const prior: Record<string, string | null> = {}
  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    prior[subtree] = await readCommandValue(subtree)
  }

  try {
    const applied: Record<string, string> = {}
    await applyRedirectCommands(launcherPath, applied)
    manifest.applied = applied
    manifest.savedAt = new Date().toISOString()
    writeBackupManifest(manifest)

    const expected = expectedCommands(launcherPath)
    const ok = await verifyCommands(expected)
    if (!ok) {
      throw new AppError('unknown', 'Registry verification failed after repair')
    }

    setUserRequestedEnabled(true)
    writeShellRedirectTargetExe()
    ensureShellRedirectSidecarLauncher(launcherPath)
    logMain('info', 'shell-redirect: repaired')
    return toMutateResponse(await getShellRedirectStatus())
  } catch (e) {
    for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
      const cmd = prior[subtree]
      const cmdKey = hkcuCommandKey(subtree)
      try {
        if (cmd) await regSetDefault(cmdKey, cmd)
      } catch (rollbackErr) {
        logMain(
          'error',
          `shell-redirect repair rollback failed for ${subtree}: ${
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          }`
        )
      }
    }
    throw e
  }
}

function readInvocations(limit = 20): ShellRedirectInvocation[] {
  try {
    const raw = fs.readFileSync(shellRedirectInvocationsPath(), 'utf8')
    const lines = raw.split(/\r?\n/).filter((l) => l.trim())
    const parsed: ShellRedirectInvocation[] = []
    for (const line of lines.slice(-limit)) {
      try {
        parsed.push(JSON.parse(line) as ShellRedirectInvocation)
      } catch {
        // skip bad line
      }
    }
    return parsed.reverse()
  } catch {
    return []
  }
}

function countInvocations(): number {
  try {
    const raw = fs.readFileSync(shellRedirectInvocationsPath(), 'utf8')
    return raw.split(/\r?\n/).filter((l) => l.trim()).length
  } catch {
    return 0
  }
}

export function countInvocationsBeforeTest(): number {
  return countInvocations()
}

export async function getShellRedirectStatus(): Promise<ShellRedirectGetStatusResponse> {
  const state = readShellRedirectState()
  const launcherPath = resolveLauncherPath()
  const installPath = resolveMfeExePath()
  const launcherExists = fs.existsSync(launcherPath)
  const manifest = readBackupManifest()
  const hasBackup = manifest != null

  const expected = launcherExists ? expectedCommands(launcherPath) : {}
  let allKeysMatch = true
  let anyKeyPresent = false
  const activeKeys: string[] = []

  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const live = await readCommandValue(subtree)
    const want = expected[hkcuCommandKey(subtree)]
    const hasDelegate = await subtreeHasDelegateExecute(subtree)
    if (live) {
      anyKeyPresent = true
      if (want && commandsMatch(live, want) && !hasDelegate) {
        activeKeys.push(subtree)
      } else {
        allKeysMatch = false
      }
    } else if (want) {
      allKeysMatch = false
    }
    if (hasDelegate && want) allKeysMatch = false
  }

  const status: ShellRedirectStatus = deriveShellRedirectStatus({
    userRequested: state.userRequestedEnabled,
    launcherExists,
    hasBackup,
    allKeysMatch: allKeysMatch && Object.keys(expected).length > 0,
    anyKeyPresent
  })

  const invocations = readInvocations(1)
  return {
    status,
    active: status === 'enabled',
    userRequested: state.userRequestedEnabled,
    launcherExists,
    activeKeys,
    launcherPath,
    installPath,
    invocationCount: countInvocations(),
    lastInvocation: invocations[0] ?? null
  }
}

function toMutateResponse(status: ShellRedirectGetStatusResponse): ShellRedirectMutateResponse {
  return {
    status: status.status,
    active: status.active,
    userRequested: status.userRequested
  }
}

export async function disableShellRedirect(): Promise<ShellRedirectMutateResponse> {
  await restoreShellRedirectFromBackup()
  return toMutateResponse(await getShellRedirectStatus())
}

export function readShellRedirectInvocations(limit = 20): ShellRedirectInvocation[] {
  return readInvocations(limit)
}

export function clearShellRedirectInvocations(): void {
  try {
    fs.unlinkSync(shellRedirectInvocationsPath())
  } catch {
    // no file
  }
}

/** Startup: repair path drift when user still wants redirect active. */
export async function maybeAutoRepairShellRedirect(): Promise<void> {
  if (process.platform !== 'win32') return
  const state = readShellRedirectState()
  if (!state.userRequestedEnabled) return
  const status = await getShellRedirectStatus()
  if (status.status === 'enabled') return
  if (status.status === 'drifted' || status.status === 'missingLauncher') {
    try {
      await repairShellRedirect()
      logMain('info', 'shell-redirect: auto-repaired on startup')
    } catch (e) {
      logMain(
        'warn',
        `shell-redirect auto-repair failed: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }
}
