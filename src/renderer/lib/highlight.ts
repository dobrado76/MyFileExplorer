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
import dos from 'highlight.js/lib/languages/dos'
import vbscript from 'highlight.js/lib/languages/vbscript'
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
  hljs.registerLanguage('dos', dos)
  hljs.registerLanguage('cmd', dos)
  hljs.registerLanguage('vbscript', vbscript)
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
    smi: 'html',
    sami: 'html',
    xhtml: 'html',
    xml: 'xml',
    svg: 'xml',
    xsd: 'xml',
    xsl: 'xml',
    xslt: 'xml',
    plist: 'xml',
    ffs_gui: 'xml',
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
    wlt: 'yaml',
    meta: 'yaml',
    mat: 'yaml',
    asset: 'yaml',
    terrainlayer: 'yaml',
    lighting: 'yaml',
    unity: 'yaml',
    prefab: 'yaml',
    controller: 'yaml',
    anim: 'yaml',
    shadergraph: 'json',
    shader: 'shader',
    mtl: 'ini',
    csproj: 'xml',
    sln: 'sln',
    vsconfig: 'json',
    css: 'css',
    scss: 'scss',
    less: 'css',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    pyw: 'python',
    pyi: 'python',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    psm1: 'powershell',
    psd1: 'powershell',
    ps: 'powershell',
    bat: 'dos',
    cmd: 'dos',
    vbs: 'vbscript',
    vbe: 'vbscript',
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
    svelte: 'xml',
    srt: 'srt',
    sub: 'srt',
    ics: 'ics',
    ical: 'ics',
    eml: 'eml'
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
  if (language === 'sln') {
    return { language: 'sln', html: highlightSln(source) }
  }
  if (language === 'shader') {
    return { language: 'shader', html: highlightUnityShader(source) }
  }
  if (language === 'srt') {
    return { language: 'srt', html: highlightSubtitle(source) }
  }
  if (language === 'ics') {
    return { language: 'ics', html: highlightIcs(source) }
  }
  if (language === 'eml') {
    return { language: 'eml', html: highlightEml(source) }
  }
  if (!language || language === 'plaintext') {
    return { language: language || null, html: highlightHashComments(source) }
  }
  try {
    if (hljs.getLanguage(language)) {
      const result = hljs.highlight(source, { language, ignoreIllegals: true })
      return { language, html: result.value }
    }
  } catch {
    /* fall through */
  }
  return { language, html: highlightHashComments(source) }
}

const SCRIPT_TO_HLJS = {
  powershell: 'powershell',
  python: 'python',
  cmd: 'dos',
  bash: 'bash'
} as const

/** Highlight a D51 script in the editor (PowerShell / Python / cmd / bash). */
export function highlightScriptSource(
  source: string,
  language: keyof typeof SCRIPT_TO_HLJS
): HighlightResult {
  return highlightLanguage(source, SCRIPT_TO_HLJS[language])
}

/** Highlight source; falls back to escaped plaintext on failure / unknown lang. */
export function highlightCode(source: string, filePath: string): HighlightResult {
  const lang = languageFromPath(filePath)
  if (lang === 'sln') {
    return { language: 'sln', html: highlightSln(source) }
  }
  if (lang === 'shader') {
    return { language: 'shader', html: highlightUnityShader(source) }
  }
  if (lang === 'srt') {
    return { language: 'srt', html: highlightSubtitle(source) }
  }
  if (lang === 'ics') {
    return { language: 'ics', html: highlightIcs(source) }
  }
  if (lang === 'eml') {
    return { language: 'eml', html: highlightEml(source) }
  }
  if (!lang || lang === 'plaintext') {
    return { language: lang, html: highlightHashComments(source) }
  }
  return highlightLanguage(source, lang)
}

/**
 * For unknown / plaintext: treat lines that are only optional whitespace + `#…`
 * as comments (same `hljs-comment` styling as Python).
 */
/** Visual Studio `.sln` — not XML; keyword / string / GUID / `#` comment. */
function highlightSln(source: string): string {
  const token =
    /("[^"]*")|(\{[\dA-Fa-f-]+\})|\b(Project|EndProject|GlobalSection|EndGlobalSection|Global|EndGlobal)\b/g
  return source.split('\n').map((line) => {
    const comment = /^(\s*)(#.*)$/.exec(line)
    if (comment) {
      return `${escapeHtml(comment[1]!)}<span class="hljs-comment">${escapeHtml(comment[2]!)}</span>`
    }
    let out = ''
    let last = 0
    token.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = token.exec(line))) {
      out += escapeHtml(line.slice(last, m.index))
      if (m[1]) out += `<span class="hljs-string">${escapeHtml(m[1])}</span>`
      else if (m[2]) out += `<span class="hljs-number">${escapeHtml(m[2])}</span>`
      else out += `<span class="hljs-keyword">${escapeHtml(m[3]!)}</span>`
      last = m.index + m[0].length
    }
    return out + escapeHtml(line.slice(last))
  }).join('\n')
}

/** Unity ShaderLab + HLSL (highlight.js has no hlsl grammar in this build). */
const SHADER_KEYWORD =
  /\b(?:Shader|Properties|SubShader|Pass|Tags|Fallback|CustomEditor|Category|GrabPass|UsePass|Name|LOD|Blend|ZWrite|ZTest|Cull|Offset|Stencil|ColorMask|AlphaToMask|Lighting|Material|SetTexture|Fog|BindChannels|CGPROGRAM|ENDCG|CGINCLUDE|HLSLPROGRAM|ENDHLSL|HLSLINCLUDE|float2|float3|float4|float|half2|half3|half4|half|fixed2|fixed3|fixed4|fixed|int2|int3|int4|int|uint|bool|void|sampler2D|samplerCUBE|Texture2D|SamplerState|StructuredBuffer|RWTexture2D|cbuffer|struct|return|else|if|for|while|out|inout|in|uniform|static|const|inline|break|continue|discard|clip|lerp|saturate|normalize|cross|tex2D|dot|mul)\b/g

function highlightUnityShader(source: string): string {
  let inBlock = false
  return source.split('\n').map((line) => {
    let out = ''
    let i = 0
    const pushComment = (s: string): void => {
      out += `<span class="hljs-comment">${escapeHtml(s)}</span>`
    }
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end < 0) {
        pushComment(line)
        return out
      }
      pushComment(line.slice(0, end + 2))
      inBlock = false
      i = end + 2
    }
    while (i < line.length) {
      if (line.startsWith('/*', i)) {
        const end = line.indexOf('*/', i + 2)
        if (end < 0) {
          pushComment(line.slice(i))
          inBlock = true
          return out
        }
        pushComment(line.slice(i, end + 2))
        i = end + 2
        continue
      }
      if (line.startsWith('//', i)) {
        pushComment(line.slice(i))
        return out
      }
      if (line[i] === '"') {
        let j = i + 1
        while (j < line.length && line[j] !== '"') {
          if (line[j] === '\\') j++
          j++
        }
        if (j < line.length) j++
        out += `<span class="hljs-string">${escapeHtml(line.slice(i, j))}</span>`
        i = j
        continue
      }
      if (line[i] === '#') {
        const rest = line.slice(i)
        const m = /^(#(?:pragma|include|define|if|ifdef|ifndef|else|elif|endif|undef)\b.*)$/.exec(rest)
        if (m) {
          out += `<span class="hljs-meta">${escapeHtml(m[1]!)}</span>`
          return out
        }
      }
      SHADER_KEYWORD.lastIndex = i
      const kw = SHADER_KEYWORD.exec(line)
      if (kw && kw.index === i) {
        out += `<span class="hljs-keyword">${escapeHtml(kw[0])}</span>`
        i += kw[0].length
        continue
      }
      const num = /^(\d+\.?\d*f?)/.exec(line.slice(i))
      if (num && /(?:^|[^\w.])/.test(line[i - 1] ?? '')) {
        out += `<span class="hljs-number">${escapeHtml(num[1]!)}</span>`
        i += num[1]!.length
        continue
      }
      out += escapeHtml(line[i]!)
      i++
    }
    return out
  }).join('\n')
}

/** Email (`.eml`) — highlight headers; leave the MIME body escaped. */
function highlightEml(source: string): string {
  const m = /\r?\n\r?\n/.exec(source)
  const head = m ? source.slice(0, m.index) : source
  const body = m ? source.slice(m.index) : ''
  const headHtml = head.split('\n').map((line) => {
    if (/^[ \t]/.test(line)) return escapeHtml(line)
    const hm = /^([A-Za-z0-9-]+)(:)(.*)$/.exec(line)
    if (!hm) return escapeHtml(line)
    return `<span class="hljs-keyword">${escapeHtml(hm[1]!)}</span>${escapeHtml(hm[2]!)}<span class="hljs-string">${escapeHtml(hm[3]!)}</span>`
  }).join('\n')
  return headHtml + escapeHtml(body)
}

/** iCalendar (`.ics` / `.ical`) — property names, BEGIN/END, dates. */
function highlightIcs(source: string): string {
  return source.split('\n').map((line) => {
    if (/^[ \t]/.test(line)) return escapeHtml(line)
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?)(:)(.*)$/.exec(line)
    if (!m) return escapeHtml(line)
    const name = m[1]!
    const params = m[2]!
    const colon = m[3]!
    const value = m[4]!
    const nameHtml = /^(BEGIN|END)$/i.test(name)
      ? `<span class="hljs-keyword">${escapeHtml(name)}</span>`
      : `<span class="hljs-meta">${escapeHtml(name)}</span>`
    let valueHtml = escapeHtml(value)
    if (/^(BEGIN|END)$/i.test(name)) {
      valueHtml = `<span class="hljs-keyword">${escapeHtml(value)}</span>`
    } else if (/^\d{8}(?:T\d{6}Z?)?$/i.test(value)) {
      valueHtml = `<span class="hljs-number">${escapeHtml(value)}</span>`
    } else if (value.length > 0) {
      valueHtml = `<span class="hljs-string">${escapeHtml(value)}</span>`
    }
    return `${nameHtml}${params ? `<span class="hljs-meta">${escapeHtml(params)}</span>` : ''}${escapeHtml(colon)}${valueHtml}`
  }).join('\n')
}

/** SubRip (`.srt`) + MicroDVD / SubViewer (`.sub` when text). */
function highlightSubtitle(source: string): string {
  return source.split('\n').map((line) => {
    if (/^\s*\d+\s*$/.test(line)) {
      return `<span class="hljs-number">${escapeHtml(line)}</span>`
    }
    if (line.includes('-->') && /\d{1,2}:\d{2}:\d{2}[,.]\d/.test(line)) {
      return highlightSrtTiming(line)
    }
    const micro = /^(\{\d+\})(\{\d+\})(.*)$/.exec(line)
    if (micro) {
      return `<span class="hljs-number">${escapeHtml(micro[1]!)}</span><span class="hljs-number">${escapeHtml(micro[2]!)}</span>${highlightDialogue(micro[3]!)}`
    }
    if (/^\s*\d{1,2}:\d{2}:\d{2}[.,]\d+,\s*\d{1,2}:\d{2}:\d{2}[.,]\d+\s*$/.test(line)) {
      return `<span class="hljs-number">${escapeHtml(line)}</span>`
    }
    return highlightDialogue(line)
  }).join('\n')
}

function highlightSrtTiming(line: string): string {
  const re = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})|(-->)/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    out += escapeHtml(line.slice(last, m.index))
    if (m[1]) out += `<span class="hljs-number">${escapeHtml(m[1])}</span>`
    else out += `<span class="hljs-keyword">${escapeHtml(m[2]!)}</span>`
    last = m.index + m[0].length
  }
  return out + escapeHtml(line.slice(last))
}

function highlightDialogue(line: string): string {
  const re = /(<[^>\n]+>|\{[^}\n]+\})/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    out += escapeHtml(line.slice(last, m.index))
    out += `<span class="hljs-meta">${escapeHtml(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + escapeHtml(line.slice(last))
}

function highlightHashComments(source: string): string {
  const parts = source.split('\n')
  return parts
    .map((line) => {
      const m = /^(\s*)(#.*)$/.exec(line)
      if (!m) return escapeHtml(line)
      return `${escapeHtml(m[1]!)}<span class="hljs-comment">${escapeHtml(m[2]!)}</span>`
    })
    .join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
