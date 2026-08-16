/**
 * Write samples/preview-extensions — one small file per preview-supported ext.
 * Run: npm run samples:preview
 */
import { createRequire } from 'node:module'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const XLSX = require('xlsx')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(root, 'samples', 'preview-extensions')

const dirs = {
  images: path.join(outRoot, 'images'),
  audio: path.join(outRoot, 'audio'),
  video: path.join(outRoot, 'video'),
  documents: path.join(outRoot, 'documents'),
  text: path.join(outRoot, 'text-code'),
  archives: path.join(outRoot, 'archives'),
  other: path.join(outRoot, 'other')
}

function dest(folder, name) {
  return path.join(dirs[folder], name)
}

function write(folder, name, data) {
  const p = dest(folder, name)
  writeFileSync(p, data)
  return p
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, _stdout, stderr) => {
      if (err) {
        const hint = String(stderr || err.message || '').trim().split('\n').slice(-3).join(' | ')
        console.error(`[samples] ${path.basename(args[args.length - 1] || bin)}: ${hint}`)
      }
      resolve(!err)
    })
  })
}

function copyIfNonEmpty(from, to) {
  if (existsSync(from) && statSync(from).size > 0) {
    copyFileSync(from, to)
    return true
  }
  return false
}

function resolve7za() {
  try {
    const pkg = require.resolve('7zip-bin/package.json')
    const name = process.platform === 'win32' ? '7za.exe' : '7za'
    const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
    return path.join(path.dirname(pkg), plat, process.arch, name)
  } catch {
    return null
  }
}

function resolveFfmpeg() {
  try {
    const p = require('ffmpeg-static')
    return typeof p === 'string' ? p : null
  } catch {
    return null
  }
}

async function writeImages() {
  const sharp = (await import('sharp')).default
  const px = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 56, g: 128, b: 220 } }
  })
    .png()
    .toBuffer()

  const png = await sharp(px)
    .png()
    .toBuffer()
  write('images', 'sample.png', png)

  const jpg = await sharp(px).jpeg({ quality: 80 }).toBuffer()
  write('images', 'sample.jpg', jpg)
  write('images', 'sample.jpeg', jpg)
  write('images', 'sample.jfif', jpg)

  write('images', 'sample.webp', await sharp(px).webp({ quality: 80 }).toBuffer())
  write('images', 'sample.gif', await sharp(px).gif().toBuffer())
  write('images', 'sample.tiff', await sharp(px).tiff().toBuffer())
  write('images', 'sample.tif', await sharp(px).tiff().toBuffer())
  try {
    write('images', 'sample.avif', await sharp(px).avif({ quality: 50 }).toBuffer())
  } catch {
    write('images', 'sample.avif', png)
  }
  try {
    write('images', 'sample.bmp', await sharp(px).toFormat('bmp').toBuffer())
  } catch {
    const w = 32
    const h = 32
    const row = w * 3
    const pixels = Buffer.alloc(row * h)
    for (let i = 0; i < w * h; i++) {
      pixels[i * 3] = 220
      pixels[i * 3 + 1] = 128
      pixels[i * 3 + 2] = 56
    }
    const bmp = Buffer.alloc(54 + pixels.length)
    bmp.write('BM', 0)
    bmp.writeUInt32LE(bmp.length, 2)
    bmp.writeUInt32LE(54, 10)
    bmp.writeUInt32LE(40, 14)
    bmp.writeInt32LE(w, 18)
    bmp.writeInt32LE(h, 22)
    bmp.writeUInt16LE(1, 26)
    bmp.writeUInt16LE(24, 28)
    bmp.writeUInt32LE(pixels.length, 34)
    pixels.copy(bmp, 54)
    write('images', 'sample.bmp', bmp)
  }

  write(
    'images',
    'sample.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <rect width="64" height="64" fill="#2563eb"/>
  <text x="32" y="38" text-anchor="middle" fill="white" font-size="14">SVG</text>
</svg>
`
  )

  // TGA 24-bit 8×4, top-left origin, BGR blue
  const tgaW = 8
  const tgaH = 4
  const tga = Buffer.alloc(18 + tgaW * tgaH * 3)
  tga[2] = 2
  tga.writeUInt16LE(tgaW, 12)
  tga.writeUInt16LE(tgaH, 14)
  tga[16] = 24
  tga[17] = 0x20
  for (let i = 0; i < tgaW * tgaH; i++) {
    const o = 18 + i * 3
    tga[o] = 220
    tga[o + 1] = 128
    tga[o + 2] = 56
  }
  write('images', 'sample.tga', tga)

  // Radiance HDR 8×4 (2:1 → equirect hint). Uncompressed RGBE (width < 8 uses old scanlines).
  const hdrW = 8
  const hdrH = 4
  const rgbe = Buffer.alloc(hdrW * hdrH * 4)
  for (let i = 0; i < hdrW * hdrH; i++) {
    rgbe[i * 4] = 56
    rgbe[i * 4 + 1] = 128
    rgbe[i * 4 + 2] = 220
    rgbe[i * 4 + 3] = 128
  }
  write(
    'images',
    'sample.hdr',
    Buffer.concat([
      Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nEXPOSURE=1.0\n\n-Y ${hdrH} +X ${hdrW}\n`, 'ascii'),
      rgbe
    ])
  )

  // ICO = 16×16 PNG wrapped
  const png16 = await sharp(px).resize(16, 16).png().toBuffer()
  const ico = Buffer.alloc(22 + png16.length)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico[6] = 16
  ico[7] = 16
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(png16.length, 14)
  ico.writeUInt32LE(22, 18)
  png16.copy(ico, 22)
  write('images', 'sample.ico', ico)

  // Minimal Photoshop 8BPS (header only — preview may warn; still typed as psd)
  const psd = Buffer.alloc(26)
  psd.write('8BPS', 0)
  psd.writeUInt16BE(1, 4)
  psd.writeUInt32BE(0, 6)
  psd.writeUInt16BE(3, 12)
  psd.writeUInt32BE(8, 14)
  psd.writeUInt32BE(8, 18)
  psd.writeUInt16BE(8, 22)
  psd.writeUInt16BE(3, 24)
  write('images', 'sample.psd', psd)
}

async function writeAudioVideo() {
  const ffmpeg = resolveFfmpeg()
  const wav = dest('audio', 'sample.wav')
  if (!ffmpeg) {
    write('audio', 'README.txt', 'ffmpeg-static missing — re-run npm run samples:preview after npm install.\n')
    return
  }
  const wavOk = await run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.4',
    '-ac',
    '1',
    '-ar',
    '22050',
    wav
  ])
  if (!wavOk) return

  const audioMap = [
    ['sample.mp3', ['-c:a', 'libmp3lame', '-b:a', '64k']],
    ['sample.flac', ['-c:a', 'flac']],
    ['sample.ogg', ['-c:a', 'libvorbis', '-q:a', '2']],
    ['sample.opus', ['-c:a', 'libopus', '-b:a', '32k']],
    ['sample.m4a', ['-c:a', 'aac', '-b:a', '64k']],
    ['sample.aac', ['-c:a', 'aac', '-b:a', '64k', '-f', 'adts']]
  ]
  for (const [name, extra] of audioMap) {
    await run(ffmpeg, ['-y', '-i', wav, ...extra, dest('audio', name)])
  }
  await run(ffmpeg, ['-y', '-i', wav, '-c:a', 'wmav2', dest('audio', 'sample.wma')])

  const mp4 = dest('video', 'sample.mp4')
  await run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x2563eb:s=160x120:d=0.4:r=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    mp4
  ])
  if (!existsSync(mp4) || statSync(mp4).size === 0) return
  copyFileSync(mp4, dest('video', 'sample.m4v'))
  await run(ffmpeg, ['-y', '-i', mp4, '-c', 'copy', dest('video', 'sample.mov')])
  await run(ffmpeg, ['-y', '-i', mp4, '-c:v', 'libvpx', '-c:a', 'libvorbis', dest('video', 'sample.webm')])
  await run(ffmpeg, ['-y', '-i', mp4, '-c', 'copy', dest('video', 'sample.mkv')])
  await run(ffmpeg, ['-y', '-i', mp4, '-c:v', 'mpeg4', '-c:a', 'mp2', dest('video', 'sample.avi')])
  copyIfNonEmpty(dest('video', 'sample.avi'), dest('video', 'sample.divx'))
  const mpg = dest('video', 'sample.mpg')
  const mpgOk = await run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x2563eb:s=160x120:d=1:r=25',
    '-c:v',
    'mpeg1video',
    '-q:v',
    '8',
    '-an',
    mpg
  ])
  if (!mpgOk) {
    await run(ffmpeg, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x2563eb:s=160x120:d=1:r=25',
      '-c:v',
      'mpeg2video',
      '-q:v',
      '8',
      '-an',
      mpg
    ])
  }
  copyIfNonEmpty(mpg, dest('video', 'sample.mpeg'))
  await run(ffmpeg, ['-y', '-i', mp4, '-c:v', 'wmv2', '-c:a', 'wmav2', dest('video', 'sample.wmv')])
}

function writeDocuments() {
  write(
    'documents',
    'sample.md',
    `# Sample markdown

A **bold** line and a [link](https://example.com).

- Preview / Raw toggle
`
  )
  write('documents', 'sample.markdown', 'Same as `.md` — GFM preview.\n\n`code`\n')
  write(
    'documents',
    'sample.html',
    `<!doctype html><html><body><h1>HTML sample</h1><p>Sanitized preview.</p></body></html>\n`
  )
  write('documents', 'sample.htm', '<p>HTM alias</p>\n')
  write(
    'documents',
    'sample.smi',
    `<SAMI>
<HEAD><STYLE TYPE="text/css">
P { font-family: sans-serif; }
.ENCC { Name: English; lang: en-US; }
</STYLE></HEAD>
<BODY>
<SYNC Start=0><P Class=ENCC>Hello from SAMI
<SYNC Start=1000><P Class=ENCC>Second cue
</BODY></SAMI>
`
  )
  copyFileSync(dest('documents', 'sample.smi'), dest('documents', 'sample.sami'))

  write(
    'documents',
    'sample.rtf',
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0\\fs24 Sample RTF paragraph.\\par}\n'
  )

  write(
    'documents',
    'sample.pdf',
    `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 80]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 51>>stream
BT /F1 12 Tf 20 36 Td (Sample PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000247 00000 n 
0000000348 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
418
%%EOF
`
  )
}

async function writeOffice() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Qty'],
    ['Apples', 3],
    ['Pears', 2]
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, dest('documents', 'sample.xlsx'))
  XLSX.writeFile(wb, dest('documents', 'sample.xlsm'))
  try {
    XLSX.writeFile(wb, dest('documents', 'sample.xlsb'))
  } catch {
    /* optional */
  }
  XLSX.writeFile(wb, dest('documents', 'sample.xls'), { bookType: 'xls' })
  XLSX.writeFile(wb, dest('documents', 'sample.ods'), { bookType: 'ods' })
  write('documents', 'sample.csv', 'Name,Qty\nApples,3\nPears,2\n')

  const docx = new JSZip()
  docx.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )
  docx.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )
  docx.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Sample Word document.</w:t></w:r></w:p></w:body>
</w:document>`
  )
  write('documents', 'sample.docx', await docx.generateAsync({ type: 'nodebuffer' }))

  const pptx = new JSZip()
  pptx.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  )
  pptx.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  )
  pptx.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
  )
  pptx.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
  )
  pptx.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Sample slide</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:spTree></p:cSld></p:sld>`
  )
  write('documents', 'sample.pptx', await pptx.generateAsync({ type: 'nodebuffer' }))

  // Legacy OLE magic so they sniff as Office, not text
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  write('documents', 'sample.doc', Buffer.concat([ole, Buffer.from('\nSample.doc — drop a real Word 97 file for full text extract.\n')]))
  write('documents', 'sample.ppt', Buffer.concat([ole, Buffer.from('\nSample.ppt — drop a real PowerPoint 97 file for text scrape.\n')]))
}

function writeTextCode() {
  const files = {
    'sample.txt': 'Plain text sample.\nSecond line.\n',
    'sample.json': '{\n  "name": "sample",\n  "ok": true\n}\n',
    'sample.yaml': 'name: sample\nok: true\n',
    'sample.yml': 'alias: yaml\n',
    'sample.wlt': 'kind: layout\nname: sample\n',
    'Foo.png.meta': 'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\n',
    'sample.mat': 'Material:\n  m_Name: Sample\n',
    'sample.asset': '%YAML 1.1\n---\nm_Name: SampleAsset\n',
    'sample.terrainlayer': 'name: Dirt\ndiffuseTexture: {fileID: 0}\n',
    'sample.lighting': 'm_GIWorkflowMode: 1\n',
    'sample.unity': '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Sample\n',
    'sample.prefab': '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Prefab\n',
    'sample.controller': '%YAML 1.1\n---\nm_Name: SampleController\n',
    'sample.anim': '%YAML 1.1\n---\nm_Name: Walk\n',
    'sample.shadergraph': '{"m_Type":"UnityEditor.ShaderGraph.GraphData","m_Name":"Sample"}\n',
    'sample.shader': 'Shader "Sample/Unlit" {\n  SubShader {\n    Pass {\n      CGPROGRAM\n      #pragma vertex vert\n      float4 vert() : SV_POSITION { return 0; }\n      ENDCG\n    }\n  }\n}\n',
    'sample.mtl': 'newmtl red\nKd 1 0 0\nmap_Kd sample.png\n',
    'sample.csproj':
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n',
    'sample.sln':
      'Microsoft Visual Studio Solution File, Format Version 12.00\n# Visual Studio Version 17\nProject("{FAE04EC0-301F-11D3-BF4B-00C04F79FBC1}") = "App", "App.csproj", "{AABBCCDD-0000-0000-0000-000000000001}"\nEndProject\n',
    'sample.vsconfig': '{ "version": "1.0", "components": [] }\n',
    'sample.tsv': 'Name\tQty\nApples\t3\n',
    'sample.log': '2026-08-16 15:00:00 INFO sample log line\n',
    'sample.ini': '[app]\nname=sample\n',
    'sample.cfg': 'key = value\n',
    'sample.conf': 'listen 80;\n',
    'sample.toml': 'name = "sample"\ncount = 3\n',
    'sample.xml': '<root><item id="1">Hello</item></root>\n',
    'sample.ffs_gui':
      '<?xml version="1.0"?><FreeFileSync XmlType="GUI"><FolderPair><Left>C:\\A</Left><Right>D:\\B</Right></FolderPair></FreeFileSync>\n',
    'sample.css': 'body { color: #111; }\n',
    'sample.scss': '$c: #2563eb;\nbody { color: $c; }\n',
    'sample.less': '@c: #2563eb;\nbody { color: @c; }\n',
    'sample.js': 'export const hello = () => "js"\n',
    'sample.jsx': 'export function Box() { return <div>jsx</div> }\n',
    'sample.mjs': 'export const hello = "mjs"\n',
    'sample.cjs': 'module.exports = { hello: "cjs" }\n',
    'sample.ts': 'export const hello: string = "ts"\n',
    'sample.tsx': 'export function Box(): JSX.Element { return <div>tsx</div> }\n',
    'sample.py': 'def hello() -> str:\n    return "py"\n',
    'sample.rb': 'def hello\n  "rb"\nend\n',
    'sample.rs': 'fn main() { println!("rs"); }\n',
    'sample.go': 'package main\nfunc main() {}\n',
    'sample.java': 'class Sample { public static void main(String[] a) {} }\n',
    'sample.c': 'int main(void) { return 0; }\n',
    'sample.h': '#pragma once\nvoid hello(void);\n',
    'sample.cpp': 'int main() { return 0; }\n',
    'sample.hpp': '#pragma once\nstruct Sample {};\n',
    'sample.cs': 'class Sample { static void Main() {} }\n',
    'sample.php': '<?php echo "php";\n',
    'sample.sh': '#!/bin/sh\necho hello\n',
    'sample.ps1': 'Write-Host "ps1"\n',
    'sample.psm1': 'function Get-Sample { "psm1" }\n',
    'sample.psd1': '@{ ModuleVersion = "1.0" }\n',
    'sample.ps': 'Write-Host "ps"\n',
    'sample.bat': '@echo off\necho bat\n',
    'sample.cmd': '@echo off\necho cmd\n',
    'sample.vbs': 'WScript.Echo "vbs"\n',
    'sample.vbe': "' Encoded VBScript sample (plain for preview)\nWScript.Echo \"vbe\"\n",
    'sample.sql': 'SELECT name FROM items WHERE qty > 0;\n',
    'sample.lua': 'print("lua")\n',
    'sample.vue': '<template><p>vue</p></template>\n<script>export default {}</script>\n',
    'sample.svelte': '<script>let n = 1</script>\n<p>{n}</p>\n',
    'sample.gitignore': 'node_modules/\ndist/\n',
    'sample.env': 'SAMPLE_KEY=1\n',
    'sample.editorconfig': 'root = true\n[*]\nindent_size = 2\n',
    'sample.prettierrc': '{ "semi": false }\n',
    'sample.srt':
      '1\n00:00:00,000 --> 00:00:01,500\nHello <i>SRT</i>\n\n2\n00:00:01,500 --> 00:00:03,000\nSecond cue\n',
    'sample.sub': '{0}{25}Hello|SUB\n',
    'sample.pyi': 'def hello() -> str: ...\n',
    'sample.cue': 'FILE "sample.bin" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n',
    'sample.ccd': '[CloneCD]\nVersion=3\n[Disc]\nTocEntries=1\nSessions=1\n'
  }
  for (const [name, body] of Object.entries(files)) write('text', name, body)

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MyFileExplorer//Preview sample//EN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Sample calendar',
    'X-WR-TIMEZONE:Australia/Sydney',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Australia/Sydney:20260816T100000',
    'DTEND;TZID=Australia/Sydney:20260816T103000',
    'SUMMARY:Team standup',
    'LOCATION:Room 4',
    'DESCRIPTION:Daily sync',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260817',
    'DTEND;VALUE=DATE:20260818',
    'SUMMARY:Public holiday',
    'END:VEVENT',
    'BEGIN:VTODO',
    'SUMMARY:Buy milk',
    'DUE;VALUE=DATE:20260818',
    'END:VTODO',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
  write('text', 'sample.ics', ics)
  write('text', 'sample.ical', ics)

  write(
    'text',
    'sample.eml',
    [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Cc: Team <team@example.com>',
      'Subject: Sample email for preview',
      'Date: Sun, 16 Aug 2026 15:00:00 +1000',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="bnd"',
      '',
      '--bnd',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain body — this is the .eml sample.',
      '--bnd',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p><b>HTML</b> body for the email preview.</p>',
      '--bnd--',
      ''
    ].join('\r\n')
  )
}

function writeBothEndian32(buf, offset, value) {
  buf.writeUInt32LE(value, offset)
  buf.writeUInt32BE(value, offset + 4)
}

function writeBothEndian16(buf, offset, value) {
  buf.writeUInt16LE(value, offset)
  buf.writeUInt16BE(value, offset + 2)
}

function isoDirRecord(opts) {
  const nameLen = opts.name.length
  const len = 33 + nameLen + ((nameLen + 1) % 2)
  const buf = Buffer.alloc(len, 0)
  buf[0] = len
  writeBothEndian32(buf, 2, opts.lba)
  writeBothEndian32(buf, 10, opts.size)
  buf[25] = opts.isDir ? 0x02 : 0x00
  buf[32] = nameLen
  opts.name.copy(buf, 33)
  return buf
}

function buildMinimalIso() {
  const SECTOR = 2048
  const rootLba = 20
  const fileLba = 21
  const fileData = Buffer.from('hello from sample.iso\n')
  const sectors = 22
  const image = Buffer.alloc(sectors * SECTOR, 0)
  const pvd = image.subarray(16 * SECTOR, 17 * SECTOR)
  pvd[0] = 1
  pvd.write('CD001', 1, 5, 'ascii')
  pvd[6] = 1
  pvd.write('SAMPLE'.padEnd(32, ' '), 40, 32, 'ascii')
  writeBothEndian32(pvd, 80, sectors)
  writeBothEndian16(pvd, 128, SECTOR)
  isoDirRecord({ lba: rootLba, size: SECTOR, isDir: true, name: Buffer.from([0]) }).copy(pvd, 156)
  const term = image.subarray(17 * SECTOR, 18 * SECTOR)
  term[0] = 255
  term.write('CD001', 1, 5, 'ascii')
  term[6] = 1
  const rootDir = image.subarray(rootLba * SECTOR, (rootLba + 1) * SECTOR)
  let off = 0
  for (const rec of [
    isoDirRecord({ lba: rootLba, size: SECTOR, isDir: true, name: Buffer.from([0]) }),
    isoDirRecord({ lba: rootLba, size: SECTOR, isDir: true, name: Buffer.from([1]) }),
    isoDirRecord({
      lba: fileLba,
      size: fileData.length,
      isDir: false,
      name: Buffer.from('HELLO.TXT;1', 'ascii')
    })
  ]) {
    rec.copy(rootDir, off)
    off += rec.length
  }
  fileData.copy(image, fileLba * SECTOR)
  return image
}

async function writeArchives() {
  const zip = new JSZip()
  zip.file('readme.txt', 'Inside the sample zip.\n')
  zip.folder('folder')?.file('nested.txt', 'nested\n')
  write('archives', 'sample.zip', await zip.generateAsync({ type: 'nodebuffer' }))

  const apk = new JSZip()
  apk.file('AndroidManifest.xml', '<manifest package="com.example.sample" />\n')
  apk.file('res/values/strings.xml', '<resources><string name="app_name">Sample</string></resources>\n')
  write('archives', 'sample.apk', await apk.generateAsync({ type: 'nodebuffer' }))

  const seven = resolve7za()
  const staging = path.join(outRoot, '.tmp-pack')
  mkdirSync(staging, { recursive: true })
  writeFileSync(path.join(staging, 'readme.txt'), 'Inside the sample archive.\n')
  try {
    if (seven && existsSync(seven)) {
      await run(seven, ['a', '-t7z', dest('archives', 'sample.7z'), 'readme.txt'], { cwd: staging })
      await run(seven, ['a', '-ttar', dest('archives', 'sample.tar'), 'readme.txt'], { cwd: staging })
      await run(seven, ['a', '-tgzip', dest('archives', 'sample.tar.gz'), dest('archives', 'sample.tar')])
      if (existsSync(dest('archives', 'sample.tar.gz'))) {
        copyFileSync(dest('archives', 'sample.tar.gz'), dest('archives', 'sample.tgz'))
      }
      const ug = path.join(staging, 'unity')
      mkdirSync(path.join(ug, '0123456789abcdef0123456789abcdef'), { recursive: true })
      writeFileSync(
        path.join(ug, '0123456789abcdef0123456789abcdef', 'pathname'),
        'Assets/Sample.txt'
      )
      writeFileSync(path.join(ug, '0123456789abcdef0123456789abcdef', 'asset'), 'hello\n')
      const tar = path.join(staging, 'unity.tar')
      await run(seven, ['a', '-ttar', tar, '0123456789abcdef0123456789abcdef'], { cwd: ug })
      if (existsSync(tar)) {
        await run(seven, ['a', '-tgzip', dest('archives', 'sample.unitypackage'), tar])
      }
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  const iso = buildMinimalIso()
  write('archives', 'sample.iso', iso)
  copyFileSync(dest('archives', 'sample.iso'), dest('archives', 'sample.img'))
}

function writeOther() {
  write(
    'other',
    'sample.obj',
    `# sample triangle
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 0
vt 0 1
f 1/1 2/2 3/3
`
  )
  write(
    'other',
    'sample.fbx',
    `; FBX 7.4.0 project file
FBXHeaderExtension:  {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
}
`
  )
  // 3DS: PRIMARY + EDIT3DS + named object + mesh with 3 verts / 1 face
  const verts = Buffer.alloc(2 + 3 * 12)
  verts.writeUInt16LE(3, 0)
  verts.writeFloatLE(1, 14)
  verts.writeFloatLE(1, 26)
  const faces = Buffer.alloc(2 + 8)
  faces.writeUInt16LE(1, 0)
  faces.writeUInt16LE(0, 2)
  faces.writeUInt16LE(1, 4)
  faces.writeUInt16LE(2, 6)
  const vChunk = Buffer.alloc(6 + verts.length)
  vChunk.writeUInt16LE(0x4110, 0)
  vChunk.writeUInt32LE(vChunk.length, 2)
  verts.copy(vChunk, 6)
  const fChunk = Buffer.alloc(6 + faces.length)
  fChunk.writeUInt16LE(0x4120, 0)
  fChunk.writeUInt32LE(fChunk.length, 2)
  faces.copy(fChunk, 6)
  const mesh = Buffer.concat([vChunk, fChunk])
  const meshChunk = Buffer.alloc(6 + mesh.length)
  meshChunk.writeUInt16LE(0x4100, 0)
  meshChunk.writeUInt32LE(meshChunk.length, 2)
  mesh.copy(meshChunk, 6)
  const name = Buffer.from('Tri\0')
  const obj = Buffer.concat([name, meshChunk])
  const objChunk = Buffer.alloc(6 + obj.length)
  objChunk.writeUInt16LE(0x4000, 0)
  objChunk.writeUInt32LE(objChunk.length, 2)
  obj.copy(objChunk, 6)
  const edit = Buffer.alloc(6 + objChunk.length)
  edit.writeUInt16LE(0x3d3d, 0)
  edit.writeUInt32LE(edit.length, 2)
  objChunk.copy(edit, 6)
  const primary = Buffer.alloc(6 + edit.length)
  primary.writeUInt16LE(0x4d4d, 0)
  primary.writeUInt32LE(primary.length, 2)
  edit.copy(primary, 6)
  write('other', 'sample.3ds', primary)

  const header = JSON.stringify({
    __metadata__: {
      ss_output_name: 'sample-lora',
      ss_network_dim: '8',
      ss_network_alpha: '8',
      'modelspec.title': 'Sample LoRA'
    },
    weight: { dtype: 'F32', shape: [2], data_offsets: [0, 8] }
  })
  const hbuf = Buffer.from(header, 'utf8')
  const st = Buffer.alloc(8 + hbuf.length + 8)
  st.writeBigUInt64LE(BigInt(hbuf.length), 0)
  hbuf.copy(st, 8)
  write('other', 'sample.safetensors', st)

  write('other', 'sample.uvw', Buffer.concat([Buffer.from('Unwrap UVW\0'), Buffer.alloc(64)]))

  // Tiny TTF: 'cmap'-less file still named .ttf — preview shows font kind; embed a
  // 1-table stub so it is not sniffed as text.
  const ttf = Buffer.alloc(12 + 16)
  ttf.writeUInt32BE(0x00010000, 0)
  ttf.writeUInt16BE(1, 4)
  ttf.write('name', 12)
  write('other', 'sample.ttf', ttf)

  // MZ + PE stub (executable kind)
  const mz = Buffer.alloc(64, 0)
  mz.write('MZ', 0)
  mz.writeUInt32LE(64, 0x3c)
  const pe = Buffer.alloc(24, 0)
  pe.write('PE\0\0', 0)
  pe.writeUInt16LE(0x14c, 4)
  write('other', 'sample.exe', Buffer.concat([mz, pe]))
  copyFileSync(dest('other', 'sample.exe'), dest('other', 'sample.dll'))
  copyFileSync(dest('other', 'sample.exe'), dest('other', 'sample.scr'))
  copyFileSync(dest('other', 'sample.exe'), dest('other', 'sample.ocx'))
  copyFileSync(dest('other', 'sample.exe'), dest('other', 'sample.cpl'))
  copyFileSync(dest('other', 'sample.exe'), dest('other', 'sample.sys'))
  write('other', 'sample.com', Buffer.from([0xb4, 0x4c, 0xcd, 0x21]))

  if (process.platform === 'win32') {
    const lnk = dest('other', 'sample.lnk')
    const notepad = path.join(process.env.WINDIR || 'C:\\Windows', 'notepad.exe')
    const ps = [
      '$ErrorActionPreference = "Stop"',
      `$w = New-Object -ComObject WScript.Shell`,
      `$s = $w.CreateShortcut('${lnk.replace(/'/g, "''")}')`,
      `$s.TargetPath = '${notepad.replace(/'/g, "''")}'`,
      `$s.Description = 'Sample shortcut'`,
      '$s.Save()'
    ].join('; ')
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true })
    } catch {
      write('other', 'sample.lnk', Buffer.from('LNK sample — run on Windows to regenerate.\n'))
    }
  }
}

async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    console.error(`[samples] ${name} failed:`, e instanceof Error ? e.message : e)
  }
}

async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
  await step('images', writeImages)
  await step('documents', writeDocuments)
  await step('office', writeOffice)
  await step('text-code', writeTextCode)
  await step('archives', writeArchives)
  await step('other', writeOther)
  await step('audio/video', writeAudioVideo)
  console.log(`Wrote samples under ${outRoot}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
