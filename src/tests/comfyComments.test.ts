import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseA1111Parameters } from '../main/preview/a1111'
import { resolveComfySettingLinks } from '../main/preview/comfyLinks'
import { pushA1111GenerationFields, decodeGenerationParameters } from '../main/preview/genFields'
import {
  extractExifTextCandidates,
  extractJpegComComments,
  pickGenerationParametersText
} from '../main/preview/exifText'
import type { PreviewField } from '@shared/schemas/preview'

const COMFY_COMMENT = `A sexy asian girl in her mid twenties, standing
Negative prompt: lowres, blurry
Steps: 10, Sampler: exp_heun_2_x0, Schedule type: sgm_uniform, CFG scale: 1.0, Seed: 6366931142467254660, Size: 1200x1600, Model: redcraft22INT8Convrot_2Krea2Edition.safetensors, VAE: Wan2_1_VAE_fp32.safetensors, Denoising strength: 1.0`

describe('ComfyUI Comments / A1111-style params', () => {
  it('parses Schedule type, VAE, Denoising strength', () => {
    const p = parseA1111Parameters(COMFY_COMMENT)
    expect(p).not.toBeNull()
    expect(p!.prompt).toContain('asian girl')
    expect(p!.negative).toBe('lowres, blurry')
    expect(p!.settings['Steps']).toBe('10')
    expect(p!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(p!.settings['Schedule type']).toBe('sgm_uniform')
    expect(p!.settings['CFG scale']).toBe('1.0')
    expect(p!.settings['Seed']).toBe('6366931142467254660')
    expect(p!.settings['Size']).toBe('1200x1600')
    expect(p!.settings['Model']).toBe('redcraft22INT8Convrot_2Krea2Edition.safetensors')
    expect(p!.settings['VAE']).toBe('Wan2_1_VAE_fp32.safetensors')
    expect(p!.settings['Denoising strength']).toBe('1.0')
  })

  it('pushes all settings as preview fields', () => {
    const parsed = parseA1111Parameters(COMFY_COMMENT)!
    const fields: PreviewField[] = []
    const warnings: string[] = []
    pushA1111GenerationFields(parsed, fields, warnings)
    const byId = Object.fromEntries(fields.map((f) => [f.id, f]))
    expect(byId['gen.prompt']?.value).toContain('asian girl')
    expect(byId['gen.negative']?.value).toBe('lowres, blurry')
    expect(byId['gen.scheduleType']?.value).toBe('sgm_uniform')
    expect(byId['gen.vae']?.value).toBe('Wan2_1_VAE_fp32.safetensors')
    expect(byId['gen.denoising']?.value).toBe('1.0')
    expect(byId['gen.model']?.value).toContain('Krea2')
    expect(byId['gen.rawParameters']).toBeUndefined()
  })

  it('keeps Raw parameters when the prompt body did not parse', () => {
    const parsed = parseA1111Parameters(
      'Negative prompt: blurry\nSteps: 10, Sampler: euler'
    )!
    const fields: PreviewField[] = []
    pushA1111GenerationFields(parsed, fields, [])
    const byId = Object.fromEntries(fields.map((f) => [f.id, f]))
    expect(byId['gen.prompt']).toBeUndefined()
    expect(byId['gen.negative']?.value).toBe('blurry')
    expect(byId['gen.rawParameters']?.value).toContain('Negative prompt: blurry')
  })
})

describe('ComfyUI linked KSampler widgets', () => {
  const linked = `woman sorceress, fantasy settings
Negative prompt: hentai, cartoon
Steps: ['153', 0], Sampler: ['152', 0], Schedule type: ['155', 0], CFG scale: ['154', 0], Seed: 1454000321, Size: 1200x1600, Model: muse.safetensors, VAE: Wan2.safetensors, Denoising strength: ['156', 0]`

  const prompt = JSON.stringify({
    '152': { class_type: 'LTSampler', inputs: { value: 'exp_heun_2_x0' } },
    '153': { class_type: 'LTSteps', inputs: { value: 8 } },
    '154': { class_type: 'LTCFG', inputs: { value: 1 } },
    '155': { class_type: 'LTScheduler', inputs: { value: 'sgm_uniform' } },
    '156': { class_type: 'LTDenoise', inputs: { value: 1 } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        sampler_name: ['152', 0],
        steps: ['153', 0],
        cfg: ['154', 0],
        scheduler: ['155', 0],
        denoise: ['156', 0]
      }
    }
  })

  it('fills Steps and Sampler from the prompt graph when the comment only has links', () => {
    const jpeg = jpegWithComments([linked, prompt])
    const parsed = decodeGenerationParameters(jpeg, 'jpg', null)
    expect(parsed).not.toBeNull()
    expect(parsed!.negative).toBe('hentai, cartoon')
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.settings['Schedule type']).toBe('sgm_uniform')
    expect(parsed!.settings['CFG scale']).toBe('1')
    expect(parsed!.settings['Denoising strength']).toBe('1')
    expect(parsed!.settings['Seed']).toBe('1454000321')
    expect(parsed!.settings['Model']).toBe('muse.safetensors')
  })

  it('reads the same links from a workflow nodes list', () => {
    const parsed = parseA1111Parameters(linked)!
    const workflow = JSON.stringify({
      nodes: [
        { id: 153, type: 'LTSteps', widgets_values: [8] },
        { id: 152, type: 'LTSampler', widgets_values: ['exp_heun_2_x0'] },
        { id: 155, type: 'LTScheduler', widgets_values: ['sgm_uniform'] },
        { id: 154, type: 'LTCFG', widgets_values: [1] },
        { id: 156, type: 'LTDenoise', widgets_values: [1] }
      ],
      links: []
    })
    const resolved = resolveComfySettingLinks(parsed, [linked, workflow])
    expect(resolved.settings['Steps']).toBe('8')
    expect(resolved.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(resolved.settings['Schedule type']).toBe('sgm_uniform')
    expect(resolved.settings['Denoising strength']).toBe('1')
  })

  it('reads a prompt graph appended to the same comment', () => {
    const jpeg = jpegWithComments([`${linked}\n${prompt}`])
    const parsed = decodeGenerationParameters(jpeg, 'jpg', null)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.negative).toBe('hentai, cartoon')
  })

  it('reads a prompt graph stored in XMP', () => {
    const xml = `<?xpacket?><rdf:Description>${prompt}</rdf:Description>`
    const jpeg = jpegWithXmp(linked, xml)
    const parsed = decodeGenerationParameters(jpeg, 'jpg', null)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Schedule type']).toBe('sgm_uniform')
    expect(parsed!.settings['CFG scale']).toBe('1')
  })

  it('reads object widget values and literal KSampler inputs', () => {
    const parsed = parseA1111Parameters(linked)!
    const workflow = JSON.stringify({
      nodes: [
        { id: 153, type: 'LTSteps', widgets_values: { value: 8 } },
        { id: 152, type: 'LTSampler', widgets_values: { value: 'exp_heun_2_x0' } },
        { id: 155, type: 'LTScheduler', widgets_values: { scheduler: 'sgm_uniform' } },
        { id: 154, type: 'LTCFG', widgets_values: { value: 1 } },
        { id: 156, type: 'LTDenoise', widgets_values: { denoise: 1 } }
      ]
    })
    const resolved = resolveComfySettingLinks(parsed, [workflow])
    expect(resolved.settings['Steps']).toBe('8')
    expect(resolved.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(resolved.settings['Schedule type']).toBe('sgm_uniform')
    expect(resolved.settings['Denoising strength']).toBe('1')
  })

  it('reads a prompt whose long text input sits in front of class_type', () => {
    const longText = 'portrait of a woman in studio light, '.repeat(40)
    const graph = JSON.stringify({
      '1': { inputs: { text: longText, clip: ['4', 0] }, class_type: 'CLIPTextEncode' },
      '152': { inputs: { value: 'exp_heun_2_x0' }, class_type: 'LTSampler' },
      '153': { inputs: { value: 8 }, class_type: 'LTSteps' },
      '154': { inputs: { value: 1 }, class_type: 'LTCFG' },
      '155': { inputs: { value: 'sgm_uniform' }, class_type: 'LTScheduler' },
      '156': { inputs: { value: 1 }, class_type: 'LTDenoise' },
      '3': {
        inputs: {
          sampler_name: ['152', 0],
          steps: ['153', 0],
          cfg: ['154', 0],
          scheduler: ['155', 0],
          denoise: ['156', 0]
        },
        class_type: 'KSampler'
      }
    })
    const xml = `<?xpacket?><rdf:Description>${graph.replaceAll('"', '&quot;')}</rdf:Description>`
    const parsed = decodeGenerationParameters(jpegWithXmp(linked, xml), 'jpg', null)
    expect(graph.indexOf('class_type')).toBeGreaterThan(240)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.settings['Schedule type']).toBe('sgm_uniform')
    expect(parsed!.settings['CFG scale']).toBe('1')
    expect(parsed!.settings['Denoising strength']).toBe('1')
    expect(parsed!.settings['Seed']).toBe('1454000321')
  })

  it('reads a Python-repr prompt graph', () => {
    const py = `{'6': {'inputs': {'text': '${'word '.repeat(30)}'}, 'class_type': 'CLIPTextEncode'}, '152': {'inputs': {'value': 'exp_heun_2_x0'}, 'class_type': 'LTSampler'}, '153': {'inputs': {'value': 8}, 'class_type': 'LTSteps'}, '154': {'inputs': {'value': 1.0}, 'class_type': 'LTCFG'}, '155': {'inputs': {'value': 'sgm_uniform'}, 'class_type': 'LTScheduler'}, '156': {'inputs': {'value': 1.0}, 'class_type': 'LTDenoise'}}`
    const parsed = decodeGenerationParameters(jpegWithComments([linked, py]), 'jpg', null)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.settings['Schedule type']).toBe('sgm_uniform')
    expect(parsed!.settings['CFG scale']).toBe('1')
    expect(parsed!.settings['Denoising strength']).toBe('1')
  })

  it('joins a prompt graph split across JPEG comments', () => {
    const mid = Math.floor(prompt.length / 2)
    const parsed = decodeGenerationParameters(
      jpegWithComments([linked, prompt.slice(0, mid), prompt.slice(mid)]),
      'jpg',
      null
    )
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.settings['Denoising strength']).toBe('1')
  })

  it('inflates a zlib-compressed prompt graph', () => {
    const parsed = decodeGenerationParameters(jpegWithCompressed(linked, prompt), 'jpg', null)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Schedule type']).toBe('sgm_uniform')
    expect(parsed!.settings['CFG scale']).toBe('1')
  })

  it('reassembles a prompt graph stored in extended XMP', () => {
    const parsed = decodeGenerationParameters(jpegWithExtendedXmp(linked, prompt), 'jpg', null)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.settings['Denoising strength']).toBe('1')
  })

  it('reads a prompt graph stored in a private JPEG marker after a long prompt', () => {
    const longText = 'a figure {smiling} in {"x":1} light, '.repeat(30)
    const graph = JSON.stringify({
      '1': { inputs: { text: longText }, class_type: 'CLIPTextEncode' },
      '152': { inputs: { value: 'exp_heun_2_x0' }, class_type: 'LTSampler' },
      '153': { inputs: { value: 8 }, class_type: 'LTSteps' },
      '154': { inputs: { value: 1 }, class_type: 'LTCFG' },
      '155': { inputs: { value: 'sgm_uniform' }, class_type: 'LTScheduler' },
      '156': { inputs: { value: 1 }, class_type: 'LTDenoise' }
    })
    const parsed = decodeGenerationParameters(jpegWithPrivateMarker(linked, graph), 'jpg', null)
    expect(graph.indexOf('class_type')).toBeGreaterThan(240)
    expect(parsed!.settings['Steps']).toBe('8')
    expect(parsed!.settings['Sampler']).toBe('exp_heun_2_x0')
    expect(parsed!.settings['Schedule type']).toBe('sgm_uniform')
    expect(parsed!.settings['CFG scale']).toBe('1')
    expect(parsed!.settings['Denoising strength']).toBe('1')
    expect(parsed!.settings['Seed']).toBe('1454000321')
  })
})

function jpegWithComments(comments: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
  for (const text of comments) parts.push(jpegCom(text))
  parts.push(Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}

function jpegWithXmp(comment: string, xml: string): Buffer {
  const ns = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1')
  const body = Buffer.from(xml, 'utf8')
  const payload = Buffer.concat([ns, body])
  const app1 = Buffer.alloc(4 + payload.length)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1.writeUInt16BE(2 + payload.length, 2)
  payload.copy(app1, 4)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, jpegCom(comment), Buffer.from([0xff, 0xd9])])
}

function jpegWithCompressed(comment: string, json: string): Buffer {
  const payload = zlib.deflateSync(Buffer.from(json, 'utf8'))
  const seg = Buffer.alloc(4 + payload.length)
  seg[0] = 0xff
  seg[1] = 0xfe
  seg.writeUInt16BE(2 + payload.length, 2)
  payload.copy(seg, 4)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jpegCom(comment), seg, Buffer.from([0xff, 0xd9])])
}

function jpegWithExtendedXmp(comment: string, xml: string): Buffer {
  const guid = '0123456789abcdef0123456789abcdef'
  const full = Buffer.from(xml, 'utf8')
  const mid = Math.max(1, Math.floor(full.length / 2))
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    xmpExtSegment(guid, full.length, 0, full.subarray(0, mid)),
    xmpExtSegment(guid, full.length, mid, full.subarray(mid)),
    jpegCom(comment),
    Buffer.from([0xff, 0xd9])
  ])
}

function xmpExtSegment(guid: string, total: number, offset: number, data: Buffer): Buffer {
  const header = Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1')
  const payload = Buffer.alloc(header.length + 40 + data.length)
  header.copy(payload, 0)
  payload.write(guid, header.length, 'ascii')
  payload.writeUInt32BE(total, header.length + 32)
  payload.writeUInt32BE(offset, header.length + 36)
  data.copy(payload, header.length + 40)
  const app1 = Buffer.alloc(4 + payload.length)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1.writeUInt16BE(2 + payload.length, 2)
  payload.copy(app1, 4)
  return app1
}

function jpegWithPrivateMarker(comment: string, graph: string): Buffer {
  const payload = Buffer.from(`note {"x":1} ${graph}`, 'utf8')
  const seg = Buffer.alloc(4 + payload.length)
  seg[0] = 0xff
  seg[1] = 0xef
  seg.writeUInt16BE(2 + payload.length, 2)
  payload.copy(seg, 4)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegCom(comment),
    seg,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
  ])
}

function jpegCom(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const seg = Buffer.alloc(4 + payload.length)
  seg[0] = 0xff
  seg[1] = 0xfe
  seg.writeUInt16BE(2 + payload.length, 2)
  payload.copy(seg, 4)
  return seg
}

describe('exifText helpers', () => {
  it('reads JPEG COM markers', () => {
    // Minimal JPEG: SOI + COM + EOI
    const comment = Buffer.from('Steps: 5, Sampler: Euler, Seed: 1', 'utf8')
    const com = Buffer.alloc(2 + 2 + comment.length)
    com[0] = 0xff
    com[1] = 0xfe
    com.writeUInt16BE(2 + comment.length, 2)
    comment.copy(com, 4)
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), com, Buffer.from([0xff, 0xd9])])
    expect(extractJpegComComments(jpeg)).toEqual([comment.toString('utf8')])
  })

  it('reads EXIF UserComment ASCII', () => {
    // Build a tiny little-endian TIFF with UserComment in Exif IFD
    // Simpler: just ImageDescription in IFD0
    const desc = Buffer.from('a prompt\nSteps: 3, Sampler: a, Seed: 9\0', 'ascii')
    // We'll construct properly:
    // II * 42, IFD0 offset=8
    // IFD0: 1 entry (ImageDescription 0x010E type=2 count=len offset=...)
    // next IFD = 0
    const header = Buffer.alloc(8)
    header.write('II', 0)
    header.writeUInt16LE(42, 2)
    header.writeUInt32LE(8, 4)

    const ifdCount = Buffer.alloc(2)
    ifdCount.writeUInt16LE(1, 0)
    const entry = Buffer.alloc(12)
    entry.writeUInt16LE(0x010e, 0)
    entry.writeUInt16LE(2, 2)
    entry.writeUInt32LE(desc.length, 4)
    const dataOffset = 8 + 2 + 12 + 4
    entry.writeUInt32LE(dataOffset, 8)
    const next = Buffer.alloc(4) // 0
    const tiff = Buffer.concat([header, ifdCount, entry, next, desc])
    const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
    const texts = extractExifTextCandidates(exif)
    expect(texts.some((t) => t.includes('Steps: 3'))).toBe(true)
  })

  it('picks the A1111-looking candidate', () => {
    const picked = pickGenerationParametersText(
      ['random note', COMFY_COMMENT],
      (s) => parseA1111Parameters(s) !== null
    )
    expect(picked).toBe(COMFY_COMMENT)
  })
})
