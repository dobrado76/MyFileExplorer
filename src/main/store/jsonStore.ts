import fs from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'

/**
 * Small persisted JSON document with Zod validation, debounced atomic writes
 * and a synchronous flush for `before-quit`.
 */
export class JsonStore<T> {
  private value: T
  private timer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(
    private readonly file: string,
    private readonly schema: ZodType<T>,
    private readonly fallback: T,
    private readonly debounceMs = 400
  ) {
    this.value = this.loadSync()
  }

  private loadSync(): T {
    try {
      if (!fs.existsSync(this.file)) return this.fallback
      const raw = fs.readFileSync(this.file, 'utf8')
      const json: unknown = JSON.parse(raw)
      const parsed = this.schema.safeParse(json)
      if (parsed.success) return parsed.data
      // Soft recover: merge onto defaults so schema evolution does not wipe prefs.
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        const merged = { ...(this.fallback as object), ...(json as object) }
        const again = this.schema.safeParse(merged)
        if (again.success) {
          console.warn(`Recovered ${this.file} after schema mismatch (merged with defaults)`)
          return again.data
        }
      }
      console.warn(`Could not parse ${this.file}; using defaults (file left on disk)`)
    } catch {
      // missing or corrupt file — fall back without overwriting disk
    }
    return this.fallback
  }

  get(): T {
    return this.value
  }

  set(next: unknown): T {
    this.value = this.schema.parse(next)
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
    return this.value
  }

  /**
   * Assign an already-validated value and schedule a write.
   * Use when the caller parsed with a live schema (avoids a stale schema
   * capture inside a long-lived store after main-process HMR).
   */
  replace(next: T): T {
    this.value = next
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
    return this.value
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
      this.dirty = false
    } catch (e) {
      console.error(`Failed to write ${this.file}:`, e)
    }
  }
}
