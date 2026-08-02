import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

let logFile: string | null = null

function file(): string {
  if (!logFile) {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'main.log')
    try {
      const st = fs.statSync(logFile)
      if (st.size > 2 * 1024 * 1024) fs.truncateSync(logFile, 0)
    } catch {
      // no log yet
    }
  }
  return logFile
}

export function logMain(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`
  try {
    fs.appendFileSync(file(), line)
  } catch {
    // never crash on logging
  }
  if (level === 'error') console.error(message)
}
