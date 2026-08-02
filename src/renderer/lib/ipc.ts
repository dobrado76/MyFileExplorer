import type { Result, Err } from '@shared/result'

export class IpcError extends Error {
  constructor(public readonly envelope: Err['error']) {
    super(envelope.message)
    this.name = 'IpcError'
  }
  get code(): string {
    return this.envelope.code
  }
}

/** Unwrap a Result-returning IPC call; throws IpcError on failure. */
export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new IpcError(result.error)
  return result.value
}

export const api = window.myFileExplorer
