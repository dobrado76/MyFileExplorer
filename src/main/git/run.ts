import { spawn } from 'node:child_process'
import { AppError } from '@shared/result'
import type { GitCommandResult } from '@shared/schemas/git'
import { settingsStore } from '../settings/store'
import { resolveGitExecutable } from './detect'

const MAX_OUTPUT = 8_000_000

export type GitRunOptions = {
  cwd: string
  args: string[]
  /** Kill after this many ms (default none for long fetch/pull). */
  timeoutMs?: number
}

export async function runGit(opts: GitRunOptions): Promise<GitCommandResult> {
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) {
    throw new AppError('not-allowed', 'Git integration is disabled')
  }
  const exe = await resolveGitExecutable(settings.git.executablePath || '')
  if (!exe.path) {
    throw new AppError('not-found', exe.message || 'Git was not found')
  }

  return await new Promise<GitCommandResult>((resolve) => {
    const child = spawn(exe.path!, opts.args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer =
      opts.timeoutMs != null && opts.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return
            child.kill('SIGKILL')
          }, opts.timeoutMs)
        : null

    const finish = (result: GitCommandResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      finish({
        success: false,
        exitCode: null,
        stdout,
        stderr: stderr || err.message,
        cancelled: false
      })
    })
    child.on('close', (code) => {
      finish({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
        cancelled: false
      })
    })
  })
}

/** Like runGit but does not require settings.git.enabled (for Test Git / detect). */
export async function runGitRaw(
  exePath: string,
  opts: GitRunOptions
): Promise<GitCommandResult> {
  return await new Promise<GitCommandResult>((resolve) => {
    const child = spawn(exePath, opts.args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr: stderr || err.message
      })
    })
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr
      })
    })
  })
}
