import { describe, expect, it } from 'vitest'
import {
  parseCategorizerMap,
  serializeCategorizerMap,
  isDeleteMapRow
} from '../shared/slideshow/categorizerMap'

const SAMPLE = `"Del0", Keys.Insert, ""
"Del1", Keys.Back, ""
"Delete", Keys.Delete,  ""


"DonePerfectSX", Keys.F5, "C:\\!!!Redo\\!!BOB\\!NewSexy\\zNew\\"
"DonePerfectBG", Keys.F6, "C:\\!!!Redo\\!!BOB\\!NewBOG\\zNew\\"


"NormalBest", Keys.F11, "C:\\!!!Redo\\!!Redid\\!Faces\\zNew\\"
"NormalBest", Keys.F12, "C:\\!!!Redo\\!!Redid\\!NoFaces\\zNew\\"
"NormalBest", Keys.F9, "C:\\!!!Redo\\!!Redid\\!TODO\\!Faces\\"
"NormalBest", Keys.F10, "C:\\!!!Redo\\!!Redid\\!TODO\\!NoFaces\\"
"Collections", Keys.O, "C:\\!!!Redo\\!!BOB\\Collections\\zNew\\"


"NotX", Keys.N, "C:\\!Patchwork\\!\\!Collage\\!todo\\zNew\\"
"ImgAI", Keys.B, "C:\\AI\\ToImg2Img\\Img2Img\\"
`

describe('categorizerMap', () => {
  it('parses sample including blank lines and empty delete paths', () => {
    const rows = parseCategorizerMap(SAMPLE)
    expect(rows.length).toBe(12)
    expect(rows[0]).toEqual({ name: 'Del0', keyToken: 'Insert', path: '' })
    expect(isDeleteMapRow(rows[0]!)).toBe(true)
    expect(rows[3]!.name).toBe('DonePerfectSX')
    expect(rows[3]!.keyToken).toBe('F5')
    expect(rows[3]!.path).toContain('NewSexy')
    const normal = rows.filter((r) => r.name === 'NormalBest')
    expect(normal).toHaveLength(4)
  })

  it('round-trips names and keys', () => {
    const rows = parseCategorizerMap(SAMPLE)
    const again = parseCategorizerMap(serializeCategorizerMap(rows))
    expect(again).toEqual(rows)
  })
})
