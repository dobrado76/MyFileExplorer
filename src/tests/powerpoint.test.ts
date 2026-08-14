import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }
}))

import {
  extractPptBinaryTexts,
  extractPptxSlideParagraphs,
  parseBgBlipEmbed,
  parsePptxRelationships,
  parsePptxSlideItems,
  parsePptxSlideSize,
  parseXfrmBox,
  pptxToPreviewSlides
} from '../main/preview/powerpoint'

describe('extractPptxSlideParagraphs', () => {
  it('joins text runs inside a paragraph', () => {
    const xml = `
      <p:sld>
        <a:p><a:r><a:t>Hello</a:t></a:r><a:r><a:t> world</a:t></a:r></a:p>
        <a:p><a:r><a:t>Second</a:t></a:r></a:p>
      </p:sld>`
    expect(extractPptxSlideParagraphs(xml)).toEqual(['Hello world', 'Second'])
  })

  it('decodes XML entities', () => {
    const xml = `<a:p><a:r><a:t>A &amp; B</a:t></a:r></a:p>`
    expect(extractPptxSlideParagraphs(xml)).toEqual(['A & B'])
  })
})

describe('parsePptxSlideSize', () => {
  it('reads sldSz and falls back', () => {
    expect(parsePptxSlideSize('<p:sldSz cx="12192000" cy="6858000"/>')).toEqual({
      cx: 12192000,
      cy: 6858000
    })
    expect(parsePptxSlideSize('<p:presentation/>').cx).toBeGreaterThan(0)
  })
})

describe('parseXfrmBox', () => {
  it('reads off/ext regardless of attribute order', () => {
    expect(
      parseXfrmBox('<a:xfrm><a:off y="10" x="20"/><a:ext cy="40" cx="30"/></a:xfrm>')
    ).toEqual({ x: 20, y: 10, w: 30, h: 40 })
  })
})

describe('parsePptxRelationships', () => {
  it('maps rId to target', () => {
    const xml = `
      <Relationships>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>`
    expect(parsePptxRelationships(xml).get('rId2')).toEqual({
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      target: '../media/image1.png'
    })
  })
})

describe('parsePptxSlideItems', () => {
  it('finds titled text and a picture with positions', () => {
    const xml = `
      <p:spTree>
        <p:sp>
          <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="80"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:pic>
          <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="0" y="400"/><a:ext cx="500" cy="300"/></a:xfrm></p:spPr>
        </p:pic>
      </p:spTree>`
    const items = parsePptxSlideItems(xml)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: 'text',
      ph: 'title',
      box: { x: 100, y: 200, w: 300, h: 80 }
    })
    expect(items[0]?.kind === 'text' && items[0].paras[0]?.text).toBe('Hello')
    expect(items[1]).toMatchObject({
      kind: 'pic',
      embed: 'rId2',
      box: { x: 0, y: 400, w: 500, h: 300 }
    })
  })

  it('reads a:t outside a:r (fields) and shape blip fills', () => {
    const xml = `
      <p:spTree>
        <p:sp>
          <p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="40"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:fld id="{1}" type="slidenum"><a:t>3</a:t></a:fld></a:p></p:txBody>
        </p:sp>
        <p:sp>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="200" cy="100"/></a:xfrm>
            <a:blipFill><a:blip r:embed="rId8"/></a:blipFill>
          </p:spPr>
        </p:sp>
      </p:spTree>`
    const items = parsePptxSlideItems(xml)
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'text',
          box: { x: 10, y: 20, w: 100, h: 40 },
          paras: [expect.objectContaining({ text: '3' })]
        }),
        expect.objectContaining({
          kind: 'pic',
          embed: 'rId8',
          box: { x: 0, y: 0, w: 200, h: 100 }
        })
      ])
    )
  })

  it('maps group-child coordinates into the group box', () => {
    const xml = `
      <p:spTree>
        <p:grpSp>
          <p:grpSpPr>
            <a:xfrm>
              <a:off x="1000" y="2000"/><a:ext cx="4000" cy="2000"/>
              <a:chOff x="0" y="0"/><a:chExt cx="4000" cy="2000"/>
            </a:xfrm>
          </p:grpSpPr>
          <p:sp>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000" cy="500"/></a:xfrm></p:spPr>
            <p:txBody><a:p><a:r><a:t>Grouped</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:grpSp>
      </p:spTree>`
    const items = parsePptxSlideItems(xml)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'text',
      box: { x: 1000, y: 2000, w: 4000, h: 500 }
    })
  })
})

describe('parseBgBlipEmbed', () => {
  it('reads the slide/master background blip', () => {
    const xml = `
      <p:cSld>
        <p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:bgPr></p:bg>
        <p:spTree/>
      </p:cSld>`
    expect(parseBgBlipEmbed(xml)).toBe('rId2')
    expect(parseBgBlipEmbed('<p:sld/>')).toBeNull()
  })
})

describe('parsePptxSlideItems namespaces', () => {
  it('reads unprefixed pic/blip and graphicFrame images', () => {
    const xml = `
      <sld>
        <spTree>
          <pic>
            <blipFill><blip r:embed="rId2"/></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="200" cy="100"/></xfrm></spPr>
          </pic>
          <graphicFrame>
            <xfrm><off x="10" y="10"/><ext cx="50" cy="50"/></xfrm>
            <graphic><graphicData><pic><blipFill><blip r:embed="rId9"/></blipFill></pic></graphicData></graphic>
          </graphicFrame>
        </spTree>
      </sld>`
    const items = parsePptxSlideItems(xml)
    expect(items.filter((it) => it.kind === 'pic')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pic', embed: 'rId2', box: { x: 0, y: 0, w: 200, h: 100 } }),
        expect.objectContaining({ kind: 'pic', embed: 'rId9' })
      ])
    )
  })
})

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function writeMiniPptx(dir: string): Promise<string> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?>
     <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Default Extension="xml" ContentType="application/xml"/>
       <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
       <Default Extension="png" ContentType="image/png"/>
     </Types>`
  )
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
       <p:sldSz cx="12192000" cy="6858000"/>
     </p:presentation>`
  )
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
       <p:cSld><p:spTree>
         <p:pic>
           <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
           <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm></p:spPr>
         </p:pic>
       </p:spTree></p:cSld>
     </p:sld>`
  )
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
     </Relationships>`
  )
  zip.file(
    'ppt/slides/slide2.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
       <p:cSld><p:spTree/></p:cSld>
     </p:sld>`
  )
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>
     </Relationships>`
  )
  zip.file('ppt/media/image1.png', PNG_1x1)
  zip.file('ppt/media/image2.png', PNG_1x1)
  const file = path.join(dir, 'mini.pptx')
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  await fsp.writeFile(file, buf)
  return file
}

describe('pptxToPreviewSlides', () => {
  it('extracts package images even when the rel target path is wrong', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-pptx-'))
    const file = await writeMiniPptx(dir)
    const warnings: string[] = []
    const slides = await pptxToPreviewSlides(file, warnings)
    expect(slides).toHaveLength(2)
    expect(slides[0]?.items.some((it) => it.kind === 'pic') || slides[0]?.bgImageUrl).toBeTruthy()
    expect(slides[1]?.bgImageUrl || slides[1]?.items.some((it) => it.kind === 'pic')).toBeTruthy()
    expect(slides[0]?.bgImageUrl ?? '').not.toContain('thumbnail')
  })
})

describe('extractPptBinaryTexts', () => {
  it('finds UTF-16LE strings', () => {
    const text = 'Agenda Overview'
    const u16 = Buffer.alloc(text.length * 2)
    for (let i = 0; i < text.length; i++) u16.writeUInt16LE(text.charCodeAt(i), i * 2)
    const buf = Buffer.concat([Buffer.alloc(4), u16, Buffer.alloc(2)])
    expect(extractPptBinaryTexts(buf)).toContain('Agenda Overview')
  })
})
