import { describe, expect, it } from 'vitest'
import { parseA1111Parameters } from '../main/preview/a1111'
import { pushA1111GenerationFields } from '../main/preview/genFields'
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
    expect(byId['gen.rawParameters']?.value).toContain('Steps: 10')
  })
})

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
    const payload = Buffer.from('ASCII\0\0\0hello Steps: 1, Seed: 2', 'binary')
    // Simpler: just ImageDescription in IFD0
    const desc = Buffer.from('a prompt\nSteps: 3, Sampler: a, Seed: 9\0', 'ascii')
    const parts: Buffer[] = []
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
