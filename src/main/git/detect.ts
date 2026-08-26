import fsp from 'node:fs/promises'
import path from 'node:path'
import type { GitExecutableInfo } from '@shared/schemas/git'
import { runGitRaw } from './run'

const WIN_CANDIDATES = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\bin\\git.exe'
]

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function whichGit(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const arg = process.platform === 'win32' ? 'git.exe' : 'git'
  try {
    const { spawn } = await import('node:child_process')
    return await new Promise((resolve) => {
      const child = spawn(cmd, [arg], { shell: false, windowsHide: true })
      let out = ''
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString('utf8')
      })
      child.on('close', (code) => {
        if (code !== 0) {
          resolve(null)
          return
        }
        const first = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean)
        resolve(first || null)
      })
      child.on('error', () => resolve(null))
    })
  } catch {
    return null
  }
}

export async function resolveGitExecutable(userPath: string): Promise<GitExecutableInfo> {
  const candidates: string[] = []
  const trimmed = userPath.trim()
  if (trimmed) candidates.push(trimmed)
  const fromPath = await whichGit()
  if (fromPath) candidates.push(fromPath)
  if (process.platform === 'win32') candidates.push(...WIN_CANDIDATES)

  const seen = new Set<string>()
  for (const c of candidates) {
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (!(await pathExists(c))) continue
    const ver = await runGitRaw(c, { cwd: path.parse(c).root || process.cwd(), args: ['--version'] })
    if (ver.success) {
      return {
        found: true,
        path: c,
        version: (ver.stdout || ver.stderr).trim().split(/\r?\n/)[0] || 'git',
        message: undefined
      }
    }
  }
  return {
    found: false,
    message: 'Git was not found. Install Git or choose an executable manually.'
  }
}

export async function testGit(userPath: string): Promise<GitExecutableInfo> {
  return resolveGitExecutable(userPath)
}
