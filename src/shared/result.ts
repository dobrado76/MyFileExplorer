export type ErrCode =
  'not-found' | 'not-allowed' | 'busy' | 'conflict' | 'validation' | 'cancelled' | 'io' | 'unknown'

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: { code: ErrCode; message: string; remediation?: string } }
export type Result<T> = Ok<T> | Err

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err(code: ErrCode, message: string, remediation?: string): Err {
  return { ok: false, error: remediation ? { code, message, remediation } : { code, message } }
}

/** Error subclass main-process code can throw to control the envelope code. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrCode,
    message: string,
    public readonly remediation?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

const ERRNO_TO_CODE: Record<string, ErrCode> = {
  ENOENT: 'not-found',
  EACCES: 'not-allowed',
  EPERM: 'not-allowed',
  EEXIST: 'conflict',
  ENOTEMPTY: 'conflict',
  EBUSY: 'busy',
  EMFILE: 'busy',
  EXDEV: 'io',
  EISDIR: 'io',
  ENOTDIR: 'io'
}

export function errFromUnknown(e: unknown): Err {
  if (e instanceof AppError) return err(e.code, e.message, e.remediation)
  if (
    e &&
    typeof e === 'object' &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
  ) {
    const nodeCode = (e as { code: string }).code
    const mapped = ERRNO_TO_CODE[nodeCode]
    const message = e instanceof Error ? e.message : String(e)
    if (mapped) return err(mapped, message)
    return err('io', message)
  }
  if (e instanceof Error) return err('unknown', e.message)
  return err('unknown', String(e))
}
