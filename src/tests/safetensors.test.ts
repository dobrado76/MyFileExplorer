import { describe, expect, it } from 'vitest'
import {
  formatParamCount,
  inferSafetensorsKind,
  summarizeSafetensorsHeader,
  safetensorsFieldsFromSummary,
  summarizePerTensorMap,
  readSafetensorsHeader,
  deepParseJsonValue,
  MAX_SAFETENSORS_HEADER_BYTES
} from '../main/preview/safetensors'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function buildSafetensorsFile(header: Record<string, unknown>, dataBytes = 32): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const out = Buffer.alloc(8 + json.length + dataBytes)
  out.writeBigUInt64LE(BigInt(json.length), 0)
  json.copy(out, 8)
  return out
}

describe('safetensors preview', () => {
  it('formats parameter counts', () => {
    expect(formatParamCount(512)).toBe('512')
    expect(formatParamCount(137_022_720)).toMatch(/137/)
    expect(formatParamCount(1_500_000_000)).toMatch(/1\.5/)
  })

  it('deep-parses nested JSON strings', () => {
    const parsed = deepParseJsonValue({
      software: '{"name":"ai-toolkit","version":"1.0"}',
      training_info: '{"steps":1000,"optimizer":"adamw"}'
    }) as Record<string, unknown>
    expect(parsed.software).toEqual({ name: 'ai-toolkit', version: '1.0' })
    expect(parsed.training_info).toEqual({ steps: 1000, optimizer: 'adamw' })
  })

  it('summarizes tensors and presents tidy fields without raw dump', () => {
    const summary = summarizeSafetensorsHeader({
      __metadata__: {
        format: 'pt',
        ss_output_name: 'my_lora',
        ss_network_dim: '32',
        ss_network_alpha: '16',
        ss_network_module: 'networks.lora',
        ss_base_model_version: 'sdxl_base_v1-0',
        ss_sd_model_name: 'ponyDiffusionV6XL.safetensors',
        software: JSON.stringify({
          name: 'ai-toolkit',
          version: '2.1',
          repo: 'https://github.com/ostris/ai-toolkit'
        }),
        training_info: JSON.stringify({ step: 3000, optimizer: 'adamw8bit' })
      },
      'lora_unet_down_blocks_0_attentions_0.lora_down.weight': {
        dtype: 'F16',
        shape: [32, 640],
        data_offsets: [0, 40960]
      },
      'lora_unet_down_blocks_0_attentions_0.lora_up.weight': {
        dtype: 'F16',
        shape: [640, 32],
        data_offsets: [40960, 81920]
      }
    })
    expect(summary.likelyKind).toBe('LoRA')

    const warnings: string[] = []
    const { subtitle, fields } = safetensorsFieldsFromSummary(summary, warnings)
    expect(subtitle).toContain('SafeTensors')
    expect(subtitle).toContain('LoRA')
    expect(fields.some((f) => f.label === 'Name' && f.value === 'my_lora')).toBe(true)
    expect(fields.some((f) => f.label === 'Software' && f.value === 'ai-toolkit')).toBe(true)
    expect(fields.some((f) => f.label === 'Dim' && f.value === '32')).toBe(true)
    expect(fields.some((f) => f.label === 'Step' && f.value === '3000')).toBe(true)
    expect(fields.some((f) => f.label === 'Repo' && f.value.includes('ai-toolkit'))).toBe(true)
    expect(fields.some((f) => f.id === 'st.trainingInfo')).toBe(false)
    expect(fields.some((f) => f.id === 'st.meta.more')).toBe(false)
    expect(fields.some((f) => f.id === 'st.meta.raw')).toBe(false)
    expect(fields.some((f) => f.label === 'Format' && f.value === 'pt')).toBe(false)
  })

  it('detects LoRA tensors nested under diffusion_model', () => {
    expect(
      inferSafetensorsKind(
        ['diffusion_model.blocks.0.attn.gate.lora_A.weight', 'diffusion_model.blocks.0.attn.gate.lora_B.weight'],
        { format: 'pt' }
      )
    ).toBe('LoRA')
  })

  it('infers diffusion checkpoint from tensor names', () => {
    expect(
      inferSafetensorsKind(
        ['model.diffusion_model.input_blocks.0.0.weight', 'model.diffusion_model.out.0.weight'],
        { format: 'pt' }
      )
    ).toBe('Diffusion UNet')
  })

  it('reads header from a real file without loading weights', async () => {
    const header = {
      __metadata__: { format: 'pt', 'modelspec.title': 'Test Model' },
      'layer.weight': { dtype: 'F32', shape: [4, 4], data_offsets: [0, 64] }
    }
    const buf = buildSafetensorsFile(header, 64)
    const big = Buffer.concat([buf, Buffer.alloc(1024)])
    const tmp = path.join(os.tmpdir(), `mfe-st-${Date.now()}.safetensors`)
    fs.writeFileSync(tmp, big)
    try {
      const read = await readSafetensorsHeader(tmp)
      expect(read).not.toBeNull()
      const summary = summarizeSafetensorsHeader(read!.header)
      expect(summary.metadata['modelspec.title']).toBe('Test Model')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('rejects absurd header lengths', () => {
    expect(MAX_SAFETENSORS_HEADER_BYTES).toBeGreaterThan(1024)
  })

  it('summarizes per-tensor quantization metadata instead of row-per-tensor', () => {
    const quant: Record<string, unknown> = {}
    for (let i = 0; i < 40; i++) {
      quant[`blocks.${i}.attn.weight`] = {
        scheme: 'int8_tensorwise',
        packed: true,
        block_size: 256
      }
    }
    const rows = summarizePerTensorMap('quantization_metadata', quant)
    expect(rows.some((r) => r.value.includes('40 tensors'))).toBe(true)
    expect(rows.some((r) => r.value.includes('int8_tensorwise'))).toBe(true)
    expect(rows.length).toBeLessThan(10)

    const summary = summarizeSafetensorsHeader({
      __metadata__: {
        format: 'pt',
        quantization_metadata: JSON.stringify(quant)
      },
      'blocks.0.attn.weight': { dtype: 'I8', shape: [1024, 1024], data_offsets: [0, 1_048_576] }
    })
    const { fields } = safetensorsFieldsFromSummary(summary, [])
    const quantRows = fields.filter((f) => /quantization|scheme|block/i.test(f.label))
    expect(quantRows.length).toBeGreaterThan(0)
    expect(quantRows.length).toBeLessThan(12)
    // Must not emit one field per tensor
    expect(fields.length).toBeLessThan(30)
  })
})
