export { resolveGitExecutable, testGit } from './detect'
export { discoverRepo, fetchStatus, assertGitReady } from './discover'
export {
  getCachedStatus,
  getOrRefreshStatus,
  ensureStatusForPath,
  invalidateRepo,
  clearAllGitCache,
  scheduleRefresh,
  notifyPathChanged
} from './cache'
export {
  stagePaths,
  unstagePaths,
  discardPaths,
  commit,
  fetch,
  pull,
  push,
  listBranches,
  switchBranch,
  createBranch,
  stash,
  stashPop,
  showExternalDiff,
  openRepoTerminal
} from './ops'
export { toRepoRelativePaths } from './paths'
export { parsePorcelainV2, buildFolderAggregates } from './statusParse'
