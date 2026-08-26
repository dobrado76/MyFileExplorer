import { create } from 'zustand'

type GitFileHistoryTarget = {
  repoRoot: string
  path: string
}

type State = {
  target: GitFileHistoryTarget | null
  open(repoRoot: string, path: string): void
  close(): void
}

export const useGitFileHistory = create<State>((set) => ({
  target: null,
  open: (repoRoot, path) => set({ target: { repoRoot, path } }),
  close: () => set({ target: null })
}))
