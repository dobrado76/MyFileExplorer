import { z } from 'zod'

export const gitFileStateSchema = z.enum([
  'clean',
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'ignored',
  'conflicted'
])
export type GitFileState = z.infer<typeof gitFileStateSchema>

export const gitPathStatusSchema = z.object({
  relativePath: z.string(),
  staged: gitFileStateSchema.nullable(),
  workingTree: gitFileStateSchema.nullable(),
  conflicted: z.boolean(),
  originalPath: z.string().optional()
})
export type GitPathStatus = z.infer<typeof gitPathStatusSchema>

export const gitFolderAggregateSchema = z.object({
  containsModified: z.boolean(),
  containsStaged: z.boolean(),
  containsUntracked: z.boolean(),
  containsConflict: z.boolean()
})
export type GitFolderAggregateStatus = z.infer<typeof gitFolderAggregateSchema>

export const gitRepositoryInfoSchema = z.object({
  rootPath: z.string(),
  gitDir: z.string(),
  branch: z.string().nullable(),
  detachedHead: z.boolean(),
  upstream: z.string().optional(),
  ahead: z.number().int().optional(),
  behind: z.number().int().optional(),
  lastStatusRefresh: z.number()
})
export type GitRepositoryInfo = z.infer<typeof gitRepositoryInfoSchema>

export const gitRepositoryStatusSchema = z.object({
  info: gitRepositoryInfoSchema,
  paths: z.array(gitPathStatusSchema),
  folders: z.record(z.string(), gitFolderAggregateSchema),
  changedCount: z.number().int(),
  conflictCount: z.number().int(),
  stagedCount: z.number().int(),
  untrackedCount: z.number().int()
})
export type GitRepositoryStatus = z.infer<typeof gitRepositoryStatusSchema>

export const gitExecutableInfoSchema = z.object({
  found: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  message: z.string().optional()
})
export type GitExecutableInfo = z.infer<typeof gitExecutableInfoSchema>

export const gitCommandResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  cancelled: z.boolean().optional()
})
export type GitCommandResult = z.infer<typeof gitCommandResultSchema>

export const gitBranchInfoSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  upstream: z.string().optional()
})
export type GitBranchInfo = z.infer<typeof gitBranchInfoSchema>

export const gitToolConfigSchema = z.object({
  executable: z.string().catch(''),
  argsTemplate: z.string().catch('"{left}" "{right}"')
})
export type GitToolConfig = z.infer<typeof gitToolConfigSchema>

export const GIT_HISTORY_PAGE_SIZE_MIN = 20
export const GIT_HISTORY_PAGE_SIZE_MAX = 500
export const GIT_HISTORY_PAGE_SIZE_DEFAULT = 150

export const gitSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  executablePath: z.string().catch(''),
  showOverlays: z.boolean().catch(true),
  showFolderIndicators: z.boolean().catch(true),
  showToolbar: z.boolean().catch(true),
  showChangedCount: z.boolean().catch(true),
  showIgnored: z.boolean().catch(false),
  showStatusColumn: z.boolean().catch(true),
  showAheadBehind: z.boolean().catch(true),
  autoFetch: z.boolean().catch(false),
  refreshDebounceMs: z.number().int().min(100).max(5000).catch(400),
  historyPageSize: z
    .number()
    .int()
    .min(GIT_HISTORY_PAGE_SIZE_MIN)
    .max(GIT_HISTORY_PAGE_SIZE_MAX)
    .catch(GIT_HISTORY_PAGE_SIZE_DEFAULT),
  suspendLargeRepos: z.boolean().catch(false),
  largeRepoFileThreshold: z.number().int().min(10_000).max(5_000_000).catch(500_000),
  diffTool: gitToolConfigSchema.catch({ executable: '', argsTemplate: '"{left}" "{right}"' }),
  externalClient: gitToolConfigSchema.catch({ executable: '', argsTemplate: '"{repoRoot}"' }),
  diagnostics: z.boolean().catch(false)
})
export type GitSettings = z.infer<typeof gitSettingsSchema>

export const defaultGitSettings: GitSettings = {
  enabled: false,
  executablePath: '',
  showOverlays: true,
  showFolderIndicators: true,
  showToolbar: true,
  showChangedCount: true,
  showIgnored: false,
  showStatusColumn: true,
  showAheadBehind: true,
  autoFetch: false,
  refreshDebounceMs: 400,
  historyPageSize: GIT_HISTORY_PAGE_SIZE_DEFAULT,
  suspendLargeRepos: false,
  largeRepoFileThreshold: 500_000,
  diffTool: { executable: '', argsTemplate: '"{left}" "{right}"' },
  externalClient: { executable: '', argsTemplate: '"{repoRoot}"' },
  diagnostics: false
}

export const gitPathRequestSchema = z.object({ path: z.string().min(1) })
export const gitRepoRequestSchema = z.object({ repoRoot: z.string().min(1) })
export const gitPathsRequestSchema = z.object({
  repoRoot: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1)
})
export const gitCommitRequestSchema = z.object({
  repoRoot: z.string().min(1),
  message: z.string().min(1).max(10_000),
  pushAfter: z.boolean().optional(),
  /** Stage all tracked/untracked changes before commit (when nothing useful is staged). */
  stageAll: z.boolean().optional()
})
export const gitBranchSwitchRequestSchema = z.object({
  repoRoot: z.string().min(1),
  branch: z.string().min(1).max(255)
})
export const gitBranchCreateRequestSchema = z.object({
  repoRoot: z.string().min(1),
  branch: z.string().min(1).max(255),
  switchTo: z.boolean().catch(true),
  /** Create at this commit (default: HEAD). */
  startPoint: z.string().min(7).max(64).optional()
})
export const gitStashRequestSchema = z.object({
  repoRoot: z.string().min(1),
  message: z.string().max(500).optional(),
  includeUntracked: z.boolean().optional()
})
export const gitDiffRequestSchema = z.object({
  repoRoot: z.string().min(1),
  path: z.string().min(1),
  /** Blob at this commit vs its parent (same path). Omit for HEAD vs working tree. */
  commit: z.string().min(7).max(64).optional(),
  /** When set with commit, compare blobs at both commits for path. */
  otherCommit: z.string().min(7).max(64).optional()
})
export const gitCloneRequestSchema = z.object({
  parentDir: z.string().min(1),
  folderName: z.string().min(1).max(200),
  url: z.string().min(1).max(2048)
})
export const gitCloneResultSchema = z.object({
  path: z.string().min(1),
  success: z.boolean(),
  stderr: z.string(),
  stdout: z.string()
})
export type GitCloneResult = z.infer<typeof gitCloneResultSchema>
export const gitOutgoingCommitSchema = z.object({
  hash: z.string().min(7).max(64),
  subject: z.string().max(2000)
})
export type GitOutgoingCommit = z.infer<typeof gitOutgoingCommitSchema>
export const gitOutgoingResultSchema = z.object({
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  commits: z.array(gitOutgoingCommitSchema).max(200)
})
export type GitOutgoingResult = z.infer<typeof gitOutgoingResultSchema>
export const gitCommitRefRequestSchema = z.object({
  repoRoot: z.string().min(1),
  commit: z.string().min(7).max(64)
})
export const gitCreateTagRequestSchema = z.object({
  repoRoot: z.string().min(1),
  tag: z.string().min(1).max(255),
  commit: z.string().min(7).max(64),
  /** After creating locally, push the tag to the remote (default origin). */
  pushToRemote: z.boolean().optional(),
  /** Overwrite the tag on the remote when it already points at another commit. */
  forceRemote: z.boolean().optional(),
  remote: z.string().min(1).max(255).optional()
})
export const gitDeleteTagRequestSchema = z.object({
  repoRoot: z.string().min(1),
  tag: z.string().min(1).max(255),
  /** Also delete the tag on the remote. */
  deleteRemote: z.boolean().optional(),
  remote: z.string().min(1).max(255).optional()
})
export const gitResetModeSchema = z.enum(['soft', 'mixed', 'hard'])
export type GitResetMode = z.infer<typeof gitResetModeSchema>
export const gitResetRequestSchema = z.object({
  repoRoot: z.string().min(1),
  commit: z.string().min(7).max(64),
  mode: gitResetModeSchema
})

/** UI priority for overlays (highest first). */
export const GIT_STATUS_PRIORITY: GitFileState[] = [
  'conflicted',
  'deleted',
  'added',
  'modified',
  'renamed',
  'copied',
  'untracked',
  'ignored',
  'clean'
]

export function primaryGitState(row: GitPathStatus): GitFileState {
  if (row.conflicted) return 'conflicted'
  for (const s of GIT_STATUS_PRIORITY) {
    if (s === 'clean' || s === 'conflicted') continue
    if (row.staged === s || row.workingTree === s) return s
  }
  return 'clean'
}

export function gitStatusLabel(row: GitPathStatus): string {
  if (row.conflicted) return 'Conflict'
  const st = row.staged
  const wt = row.workingTree
  if (st && wt && st !== 'clean' && wt !== 'clean') {
    if (st === 'modified' && wt === 'modified') return 'Modified + Staged'
    return `${capitalize(st)} + ${capitalize(wt)}`
  }
  if (st && st !== 'clean') return st === 'added' ? 'Staged' : capitalize(st)
  if (wt && wt !== 'clean') return capitalize(wt)
  return 'Clean'
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
