import type { MyFileExplorerApi } from '../shared/ipc/api'

declare global {
  interface Window {
    myFileExplorer: MyFileExplorerApi
  }
}

export {}
