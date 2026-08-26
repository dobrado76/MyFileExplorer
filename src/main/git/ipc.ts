import type { IpcMainInvokeEvent } from 'electron'
import { dialog, BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc/contract'
import {
  gitBranchCreateRequestSchema,
  gitBranchSwitchRequestSchema,
  gitCommitRequestSchema,
  gitDiffRequestSchema,
  gitPathRequestSchema,
  gitPathsRequestSchema,
  gitRepoRequestSchema,
  gitStashRequestSchema
} from '@shared/schemas/git'
import * as git from './index'

const emptySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]).optional()
const testSchema = z.object({ executablePath: z.string().optional() }).optional()

type Handle = <S extends z.ZodType, T>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>, event: IpcMainInvokeEvent) => Promise<T> | T
) => void

export function registerGitIpc(handle: Handle): void {
  handle(IPC.gitDetect, emptySchema, async () => {
    const { settingsStore } = await import('../settings/store')
    const path = settingsStore().get().git?.executablePath ?? ''
    return git.resolveGitExecutable(path)
  })

  handle(IPC.gitTest, testSchema, async (req) => {
    const { settingsStore } = await import('../settings/store')
    const path = req?.executablePath ?? settingsStore().get().git?.executablePath ?? ''
    return git.testGit(path)
  })

  handle(IPC.gitDiscover, gitPathRequestSchema, async (req) => git.discoverRepo(req.path))

  handle(IPC.gitGetStatus, gitPathRequestSchema, async (req) => {
    const r = await git.ensureStatusForPath(req.path)
    return r
  })

  handle(IPC.gitRefresh, gitRepoRequestSchema, async (req) => {
    const status = await git.getOrRefreshStatus(req.repoRoot, { force: true })
    return { status }
  })

  handle(IPC.gitInvalidate, gitRepoRequestSchema, (req) => {
    git.invalidateRepo(req.repoRoot)
    return { ok: true as const }
  })

  handle(IPC.gitStage, gitPathsRequestSchema, async (req) =>
    git.stagePaths(req.repoRoot, req.paths)
  )
  handle(IPC.gitUnstage, gitPathsRequestSchema, async (req) =>
    git.unstagePaths(req.repoRoot, req.paths)
  )
  handle(IPC.gitDiscard, gitPathsRequestSchema, async (req) =>
    git.discardPaths(req.repoRoot, req.paths)
  )
  handle(IPC.gitCommit, gitCommitRequestSchema, async (req) =>
    git.commit(req.repoRoot, req.message, req.pushAfter)
  )
  handle(IPC.gitFetch, gitRepoRequestSchema, async (req) => git.fetch(req.repoRoot))
  handle(IPC.gitPull, gitRepoRequestSchema, async (req) => git.pull(req.repoRoot))
  handle(IPC.gitPush, gitRepoRequestSchema, async (req) => git.push(req.repoRoot))
  handle(IPC.gitListBranches, gitRepoRequestSchema, async (req) => ({
    branches: await git.listBranches(req.repoRoot)
  }))
  handle(IPC.gitSwitchBranch, gitBranchSwitchRequestSchema, async (req) =>
    git.switchBranch(req.repoRoot, req.branch)
  )
  handle(IPC.gitCreateBranch, gitBranchCreateRequestSchema, async (req) =>
    git.createBranch(req.repoRoot, req.branch, req.switchTo !== false)
  )
  handle(IPC.gitStash, gitStashRequestSchema, async (req) =>
    git.stash(req.repoRoot, req.message, req.includeUntracked)
  )
  handle(IPC.gitStashPop, gitRepoRequestSchema, async (req) => git.stashPop(req.repoRoot))
  handle(IPC.gitShowDiff, gitDiffRequestSchema, async (req) =>
    git.showExternalDiff(req.repoRoot, req.path)
  )
  handle(IPC.gitOpenTerminal, gitRepoRequestSchema, async (req) => {
    await git.openRepoTerminal(req.repoRoot)
    return { opened: true as const }
  })
  handle(IPC.gitRelativePaths, gitPathsRequestSchema, (req) => ({
    paths: git.toRepoRelativePaths(req.repoRoot, req.paths)
  }))

  handle(IPC.gitPickExecutable, emptySchema, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Choose git.exe',
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile' as const]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || !picked.filePaths[0]) return { path: null as string | null }
    return { path: picked.filePaths[0] }
  })

  handle(IPC.gitPickDiffTool, emptySchema, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Choose diff tool',
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile' as const]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || !picked.filePaths[0]) return { path: null as string | null }
    return { path: picked.filePaths[0] }
  })
}
