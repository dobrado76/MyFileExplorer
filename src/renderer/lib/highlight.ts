/**
 * Syntax highlighting for text previews (highlight.js, selective languages).
 */
import hljs from 'highlight.js/lib/core'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import javascript from 'highlight.js/lib/languages/javascript'
import yaml from 'highlight.js/lib/languages/yaml'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import ini from 'highlight.js/lib/languages/ini'
import sql from 'highlight.js/lib/languages/sql'
import csharp from 'highlight.js/lib/languages/csharp'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import lua from 'highlight.js/lib/languages/lua'
import plaintext from 'highlight.js/lib/languages/plaintext'

let registered = false

function ensureRegistered(): void {
  if (registered) return
  hljs.registerLanguage('xml', xml)
  hljs.registerLanguage('html', xml)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('yaml', yaml)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('scss', scss)
  hljs.registerLanguage('markdown', markdown)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('powershell', powershell)
  hljs.registerLanguage('ini', ini)
  hljs.registerLanguage('sql', sql)
  hljs.registerLanguage('csharp', csharp)
  hljs.registerLanguage('java', java)
  hljs.registerLanguage('cpp', cpp)
  hljs.registerLanguage('rust', rust)
  hljs.registerLanguage('go', go)
  hljs.registerLanguage('php', php)
  hljs.registerLanguage('ruby', ruby)
  hljs.registerLanguage('lua', lua)
  hljs.registerLanguage('plaintext', plaintext)
  registered = true
}

/** Map file path / name → highlight.js language id (null = plain). */
export function languageFromPath(filePath: string): string | null {
  const base = filePath.replace(/\//g, '\\').split('\\').pop()?.toLowerCase() ?? ''
  if (!base) return null

  // Extensionless / special names
  if (base === 'dockerfile') return null
  if (base === '.gitignore' || base === '.editorconfig') return 'ini'
  if (base === '.env' || base.startsWith('.env.')) return 'ini'
  if (base === '.prettierrc' || base.endsWith('.prettierrc')) return 'json'
  if (base === 'cmakelists.txt') return 'plaintext'

  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : ''
  if (!ext) return null

  const map: Record<string, string> = {
    html: 'html',
    htm: 'html',
    xhtml: 'html',
    xml: 'xml',
    svg: 'xml',
    xsd: 'xml',
    xsl: 'xml',
    xslt: 'xml',
    plist: 'xml',
    json: 'json',
    jsonc: 'json',
    json5: 'json',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    yml: 'yaml',
    yaml: 'yaml',
    css: 'css',
    scss: 'scss',
    less: 'css',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    pyw: 'python',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    psm1: 'powershell',
    bat: 'plaintext',
    cmd: 'plaintext',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    toml: 'ini',
    properties: 'ini',
    sql: 'sql',
    cs: 'csharp',
    java: 'java',
    c: 'cpp',
    h: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    rs: 'rust',
    go: 'go',
    php: 'php',
    rb: 'ruby',
    lua: 'lua',
    vue: 'xml',
    svelte: 'xml'
  }
  return map[ext] ?? null
}

export type HighlightResult = {
  language: string | null
  /** HTML fragment of highlighted tokens (already escaped by highlight.js). */
  html: string
}

/** Highlight source with an explicit language id (e.g. preview JSON fields). */
export function highlightLanguage(source: string, language: string): HighlightResult {
  ensureRegistered()
  if (!language || language === 'plaintext') {
    return { language, html: escapeHtml(source) }
  }
  try {
    if (hljs.getLanguage(language)) {
      const result = hljs.highlight(source, { language, ignoreIllegals: true })
      return { language, html: result.value }
    }
  } catch {
    /* fall through */
  }
  return { language, html: escapeHtml(source) }
}

/** Highlight source; falls back to escaped plaintext on failure / unknown lang. */
export function highlightCode(source: string, filePath: string): HighlightResult {
  const lang = languageFromPath(filePath)
  if (!lang || lang === 'plaintext') {
    return { language: lang, html: escapeHtml(source) }
  }
  return highlightLanguage(source, lang)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
