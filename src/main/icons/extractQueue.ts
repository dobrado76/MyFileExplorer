/**
 * Serialize CPU/Win32-heavy shell icon extraction so SHGetFileInfo + Sharp
 * cannot starve the Electron main process (UI freeze in large .exe folders).
 */

type Job = {
  run: () => Promise<string | null>
  resolve: (url: string | null) => void
  reject: (err: unknown) => void
}

const queue: Job[] = []
let running = 0
/** One at a time — SHGetFileInfo is sync and blocks the main thread. */
const MAX_CONCURRENT = 1

function yieldMain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function pump(): void {
  if (running >= MAX_CONCURRENT || queue.length === 0) return
  const job = queue.shift()!
  running++
  void (async () => {
    try {
      // Let pending IPC / paint run before the next sync SHGetFileInfo.
      await yieldMain()
      const url = await job.run()
      job.resolve(url)
    } catch (err) {
      job.reject(err)
    } finally {
      running--
      await yieldMain()
      pump()
    }
  })()
}

/** Run icon extract+encode work on the limited queue (cache hits should not use this). */
export function enqueueShellIconExtract(run: () => Promise<string | null>): Promise<string | null> {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject })
    pump()
  })
}
