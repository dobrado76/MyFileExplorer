/**
 * Build or verify AI-SUPPORT.md from the support manifest.
 *
 *   node scripts/build-ai-support.mjs           # write AI-SUPPORT.md
 *   node scripts/build-ai-support.mjs --check   # compare only; do not write
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'scripts', 'ai-support-manifest.json')
const outPath = path.join(root, 'AI-SUPPORT.md')
const check = process.argv.includes('--check')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const linkRe = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const GITHUB_BLOB = 'https://github.com/dobrado76/MyFileExplorer/blob/main/'
const GITHUB_RAW = 'https://raw.githubusercontent.com/dobrado76/MyFileExplorer/main/'

function fail(messages) {
  for (const line of messages) console.error(line)
  process.exit(1)
}

function exists(rel) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    fail([`Missing support source: ${rel}`])
  }
  return abs
}

function localLinkTarget(fromRel, raw) {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('mfe:')
  ) {
    return null
  }
  const noAnchor = trimmed.split('#')[0].split('?')[0]
  if (!noAnchor) return null
  let decoded
  try {
    decoded = decodeURIComponent(noAnchor)
  } catch {
    decoded = noAnchor
  }
  return path.normalize(path.join(path.dirname(path.join(root, fromRel)), decoded))
}

function checkLinks(rel, text) {
  const problems = []
  for (const match of text.matchAll(linkRe)) {
    const target = localLinkTarget(rel, match[3])
    if (!target) continue
    if (!fs.existsSync(target)) {
      problems.push(`${rel}: broken link ${match[3]}`)
    }
  }
  return problems
}

function posixRel(abs) {
  return path.relative(root, abs).split(path.sep).join('/')
}

function sourceId(rel) {
  return `src-${rel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

function decodeFrag(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function headingSlug(text) {
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
  const slug = plain
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return slug || 'section'
}

function annotate(rel, body) {
  const sid = sourceId(rel)
  const counts = new Map()
  const frags = new Map()
  const out = [`<a id="${sid}"></a>`, '']
  for (const line of body.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!heading) {
      out.push(line)
      continue
    }
    const base = headingSlug(heading[2])
    const seen = counts.get(base) || 0
    counts.set(base, seen + 1)
    const frag = seen === 0 ? base : `${base}-${seen}`
    const id = `${sid}--${frag}`
    frags.set(frag, id)
    out.push(`<a id="${id}"></a>`)
    out.push(line)
  }
  return { sid, frags, text: out.join('\n') }
}

function stampVersion(text, version) {
  if (!/^(?:\*\*App:\*\*[^\n]*\*\*Version:\*\*|\*\*Version:\*\*)\s*0\.21\.0/m.test(text)) return text
  const note = [
    '> **Version stamp:** A 0.21.0 line in this section is when the page was last stamped.',
    `> The repository package version is ${version}. There is no changelog of behavior changes for 0.21.1 or 0.21.2.`,
    "> The running build is Settings → About. Do not quote 0.21.0 as the user's version.",
    ''
  ].join('\n')
  return text.replace(/(<a id="src-[^"]+"><\/a>\n)/, `$1\n${note}`)
}

function hrefFor(fromRel, bang, dest, sections) {
  const trimmed = dest.trim()
  if (/^(https?:|mailto:|mfe:)/i.test(trimmed)) return null
  const hashAt = trimmed.indexOf('#')
  const pathPart = (hashAt === -1 ? trimmed : trimmed.slice(0, hashAt)).split('?')[0]
  const fragRaw = hashAt === -1 ? '' : trimmed.slice(hashAt + 1).split('?')[0]
  const frag = decodeFrag(fragRaw)
  if (!pathPart) {
    const here = sections.get(fromRel.replaceAll('\\', '/'))
    return (here && (here.frags.get(frag) || here.frags.get(headingSlug(frag)))) || here?.sid || null
  }
  const abs = localLinkTarget(fromRel, pathPart)
  if (!abs) return null
  const rel = posixRel(abs)
  const section = sections.get(rel)
  if (section) {
    return (frag && (section.frags.get(frag) || section.frags.get(headingSlug(frag)))) || section.sid
  }
  if (!fs.existsSync(abs)) return null
  const base = bang === '!' ? GITHUB_RAW : GITHUB_BLOB
  return `${base}${rel}${frag ? `#${frag}` : ''}`
}

function rewriteLinks(fromRel, text, sections) {
  const linked = text.replace(linkRe, (full, bang, label, dest) => {
    const href = hrefFor(fromRel, bang, dest, sections)
    if (!href) return full
    const target = href.startsWith('http') ? href : `#${href}`
    return `${bang}[${label}](${target})`
  })
  return linked.replace(/\]\(([^)\s]+)\)/g, (full, dest) => {
    if (/^(https?:|mailto:|mfe:|#)/i.test(dest.trim())) return full
    const href = hrefFor(fromRel, '', dest, sections)
    if (!href) return full
    const target = href.startsWith('http') ? href : `#${href}`
    return `](${target})`
  })
}

function marker(rel) {
  const body = fs.readFileSync(exists(rel), 'utf8').replace(/\r\n/g, '\n')
  const annotated = annotate(rel, body)
  return { rel, body, ...annotated }
}

const sources = [...manifest.preamble, ...manifest.files].map(marker)
const broken = sources.flatMap((source) => checkLinks(source.rel, source.body))
if (broken.length > 0) fail(broken)

const sections = new Map(sources.map((source) => [source.rel, source]))
for (const source of sources) {
  source.text = stampVersion(source.text, pkg.version)
  source.text = rewriteLinks(source.rel, source.text, sections)
}

const index = manifest.files.map((rel) => `- [${rel}](#${sourceId(rel)})`).join('\n')

const parts = [
  `# MyFileExplorer — AI support knowledge base`,
  ``,
  `Generated from \`scripts/ai-support-manifest.json\`. Do not edit this file by hand.`,
  `Rebuild with \`npm run docs:support\`.`,
  ``,
  `| | |`,
  `| --- | --- |`,
  `| **Application** | MyFileExplorer |`,
  `| **Package version** | ${pkg.version} |`,
  `| **Repository** | https://github.com/dobrado76/MyFileExplorer |`,
  `| **Issues** | https://github.com/dobrado76/MyFileExplorer/issues |`,
  `| **Releases** | https://github.com/dobrado76/MyFileExplorer/releases/latest |`,
  `| **License** | GPL-3.0 — https://github.com/dobrado76/MyFileExplorer/blob/main/LICENSE |`,
  ``,
  `Links in this file jump to another section of this file. A link that leaves the project is a full https URL.`,
  `A **Version:** 0.21.0 line inside a section is when that page was last stamped, not the running build. The running build is Settings → About. This package is ${pkg.version}. There is no changelog of behavior changes for 0.21.1 or 0.21.2.`,
  `If the overview (README, advantages, business note, product spec) disagrees with the reference, FAQ, configuration, troubleshooting, or that topic's feature guide, follow the feature guide and the reference.`,
  ``,
  `## Contents`,
  ``,
  `1. [Symptom index](#${sourceId(manifest.preamble[0])})`,
  `2. [Instructions for AI assistants](#${sourceId(manifest.preamble[1])})`,
  `3. Source documents, in order:`,
  ``,
  index,
  ``
]

for (const source of sources) {
  parts.push(
    ``,
    `---`,
    ``,
    `<!-- source: ${source.rel} -->`,
    ``,
    source.text.trimEnd(),
    ``,
    `<!-- end source: ${source.rel} -->`,
    ``
  )
}

const output = `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`

const ids = new Set([...output.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]))
const dangling = []
for (const match of output.matchAll(/\]\(#(src-[^)]+)\)/g)) {
  if (!ids.has(match[1])) dangling.push(match[1])
}
if (dangling.length > 0) {
  fail([`Bundle links to missing anchors: ${[...new Set(dangling)].slice(0, 12).join(', ')}`])
}
if (!output.includes('](#src-docs-troubleshooting-md)')) {
  fail(['Link rewrite did not anchor troubleshooting.md'])
}
if (!output.includes('](#src-docs-power-rename-md)')) {
  fail(['Link rewrite did not anchor POWER_RENAME.md'])
}

if (check) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : ''
  if (current !== output) {
    fail([
      'AI-SUPPORT.md is missing or out of date.',
      'Rebuild it with: npm run docs:support'
    ])
  }
  console.log('AI-SUPPORT.md matches the support sources.')
} else {
  fs.writeFileSync(outPath, output)
  console.log(`Wrote ${path.relative(root, outPath)} (${output.length} bytes)`)
}
