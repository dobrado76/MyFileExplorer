import { parentPort, workerData } from 'node:worker_threads'

const data = workerData as { pattern: string; flags: string; value: string }
try {
  const re = new RegExp(`^(?:${data.pattern})$`, data.flags === 'i' ? 'i' : '')
  parentPort?.postMessage({ ok: true, match: re.test(data.value) })
} catch (e) {
  parentPort?.postMessage({
    ok: false,
    error: e instanceof Error ? e.message : 'Invalid regular expression'
  })
}
