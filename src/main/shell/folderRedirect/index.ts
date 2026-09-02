import fs from 'node:fs'
import {
  SHELL_REDIRECT_V1_SUBTREES,
  buildLauncherRegistryCommand,
  commandsMatch,
  hkcuCommandKey,
  hkcuSubtreeKey,
  verbFromSubtree
} from '@shared/shellFolderRedirect'
import { AppError } from '@shared/result'
import type {
  ShellRedirectGetStatusResponse,
  ShellRedirectInvocation,
  ShellRedirectMutateResponse,
  ShellRedirectStatus
} from '@shared/schemas/shellRedirect'
import { deriveShellRedirectStatus } from '@shared/shellFolderRedirect'
import { logMain } from '../../logging'
import {
  shellRedirectBackupManifestPath,
  shellRedirectDir,
  shellRedirectInvocationsPath,
  shellRedirectRegFragmentPath,
  resolveLauncherPath,
  resolveMfeExePath,
  writeShellRedirectTargetExe
} from './paths'
import { parseRegValues, regDeleteTree, regExport, regImport, regKeyExists, regQuery, regSetDefault } from './reg'
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
    return parsed
  } catch {
    return null
  }
}

function writeBackupManifest(manifest: ShellRedirectBackupManifest): void {
  shellRedirectDir()
  fs.writeFileSync(shellRedirectBackupManifestPath(), JSON.stringify(manifest, null, 2), 'utf8')
}

async function readCommandValue(subtree: string): Promise<string | null> {
  const key = hkcuCommandKey(subtree)
  const out = await regQuery(key)
  if (!out) return null
  const values = parseRegValues(out)
  const cmd = (values[''] ?? values['(Default)'] ?? '').trim()
  return cmd || null
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
    applied[cmdKey] = cmd
  }
}

async function verifyCommands(expected: Record<string, string>): Promise<boolean> {
  for (const [cmdKey, want] of Object.entries(expected)) {
    const subtree = SHELL_REDIRECT_V1_SUBTREES.find((s) => hkcuCommandKey(s) === cmdKey)
    if (!subtree) continue
    const live = await readCommandValue(subtree)
    if (!live || !commandsMatch(live, want)) return false
  }
  return true
}

async function rollbackSubtree(subtree: string, entry: SubtreeBackupEntry): Promise<void> {
  const key = hkcuSubtreeKey(subtree)
  if (entry.existedBefore && entry.regFile && fs.existsSync(entry.regFile)) {
    await regImport(entry.regFile)
    return
  }
  await regDeleteTree(key)
}

export async function restoreShellRedirectFromBackup(): Promise<void> {
  const manifest = readBackupManifest()
  if (!manifest) {
    for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
      await regDeleteTree(hkcuSubtreeKey(subtree))
    }
    setUserRequestedEnabled(false)
    return
  }

  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const entry = manifest.subtrees[subtree]
    if (entry) {
      await rollbackSubtree(subtree, entry)
    } else {
      await regDeleteTree(hkcuSubtreeKey(subtree))
    }
  }

  manifest.applied = {}
  writeBackupManifest(manifest)
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
  const manifest = existing ?? emptyManifest()
  const rollbackEntries: Array<{ subtree: string; entry: SubtreeBackupEntry }> = []

  try {
    for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
      if (!manifest.subtrees[subtree]) {
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
  logMain('info', 'shell-redirect: repaired')
  return toMutateResponse(await getShellRedirectStatus())
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
  const hasBackup = manifest != null && Object.keys(manifest.subtrees).length > 0

  const expected = launcherExists ? expectedCommands(launcherPath) : {}
  let allKeysMatch = true
  let anyKeyPresent = false
  const activeKeys: string[] = []

  for (const subtree of SHELL_REDIRECT_V1_SUBTREES) {
    const live = await readCommandValue(subtree)
    const want = expected[hkcuCommandKey(subtree)]
    if (live) {
      anyKeyPresent = true
      if (want && commandsMatch(live, want)) {
        activeKeys.push(subtree)
      } else {
        allKeysMatch = false
      }
    } else if (want) {
      allKeysMatch = false
    }
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
