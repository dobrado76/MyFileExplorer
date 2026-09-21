/** Shared detection for “this path is no longer a Git repo”. */

export function isGitMissingRepoMessage(message: string): boolean {
  return /not a git repository/i.test(message)
}
