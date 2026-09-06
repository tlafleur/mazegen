import { describe, expect, it } from 'vitest'
import { buildPdf, type Sheet } from './pdf'
import { toPdfPath } from './path'
import { A4, LETTER, MARKER } from './page'
import { renderPdf } from './svg'
import { generateMaze, shapesFor } from '../generate'

const MM_TO_PT = 72 / 25.4

/**
 * The file as one character per byte.
 *
 * Everything the writer emits is Latin-1, so string indices are byte offsets —
 * which is what lets the offsets the file claims be checked against where its
 * objects actually sit.
 */
function bytes(pdf: Uint8Array): string {
  let s = ''
  for (const b of pdf) s += String.fromCharCode(b)
  return s
}

/** The nth content stream, unwrapped. */
function content(text: string, n = 0): string {
  let from = 0
  for (let i = 0; i < n; i++) from = text.indexOf('\nendstream', from) + 1
  const start = text.indexOf('stream\n', from) + 'stream\n'.length
  const end = text.indexOf('\nendstream', start)
  return text.slice(start, end)
}

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    width: LETTER.width,
    height: LETTER.height,
    strokes: [
      {
        commands: [
          { op: 'M', x: 10, y: 10 },
          { op: 'L', x: 110, y: 10 },
        ],
        width: 0.5,
      },
    ],
    labels: [],
    ...over,
  }
}

describe('buildPdf page geometry', () => {
  it('declares Letter as exactly 612 x 792 points', () => {
    expect(bytes(buildPdf([sheet()]))).toContain('/MediaBox [0 0 612 792]')
  })

  it('declares A4 at its standard point size', () => {
    const text = bytes(buildPdf([sheet({ width: A4.width, height: A4.height })]))
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
  })

  it('scales millimetres to points precisely enough to print 1:1', () => {
    const m = /(\S+) 0 0 (\S+) 0 (\S+) cm/.exec(bytes(buildPdf([sheet()])))
    expect(m).not.toBeNull()
    const [, sx, sy, ty] = m as RegExpExecArray

    // Two decimal places on this factor gives 2.83, which is 0.16% small: a
    // 100 mm ruler line would print at 99.84 mm and the bottom edge of a Letter
    // page would land 1.3 pt inside the MediaBox. Since 1:1 sizing is the whole
    // reason the PDF exists, hold the factor to well under a micron.
    expect(Number(sx)).toBeCloseTo(MM_TO_PT, 6)
    // Negative: PDF measures up from the bottom left, everything upstream
    // measures down from the top left.
    expect(Number(sy)).toBeCloseTo(-MM_TO_PT, 6)

    // The composed transform has to land the bottom edge of the sheet on zero.
    const bottomPt = Number(ty) + Number(sy) * LETTER.height
    expect(Math.abs(bottomPt) * (25.4 / 72)).toBeLessThan(0.001)
  })

  it('keeps the 100 mm reference line 100 units long', () => {
    // The line is written in millimetres and the page transform is the only
    // thing that scales it, so a ruler against the print measures the transform.
    const text = bytes(buildPdf([sheet()]))
    const ops = content(text)
    expect(ops).toContain('10 10 m')
    expect(ops).toContain('110 10 l')
  })
})

describe('buildPdf file structure', () => {
  it('points every cross-reference entry at its object', () => {
    const text = bytes(buildPdf([sheet(), sheet({ width: A4.width, height: A4.height })]))

    // Reached the way a reader reaches it: through startxref, not by search —
    // `startxref` itself ends in the same four characters.
    const xrefAt = Number((/startxref\n(\d+)\n/.exec(text) as RegExpExecArray)[1])
    const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt)) as RegExpExecArray
    const total = Number(header[1])
    const table = text.slice(xrefAt + header[0].length)

    // Object 0 is the free-list head and points nowhere.
    expect(table.slice(0, 20)).toBe('0000000000 65535 f \n')

    for (let i = 1; i < total; i++) {
      const entry = table.slice(i * 20, i * 20 + 20)
      const offset = Number(entry.slice(0, 10))
      expect(entry.slice(10)).toBe(' 00000 n \n')
      expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`)
    }
  })

  it('points startxref at the cross-reference table', () => {
    const text = bytes(buildPdf([sheet()]))
    const m = /startxref\n(\d+)\n%%EOF\n$/.exec(text) as RegExpExecArray
    expect(m).not.toBeNull()
    expect(text.slice(Number(m[1]), Number(m[1]) + 5)).toBe('xref\n')
  })

  it('declares each stream length in bytes', () => {
    // The length has to be exact: a reader takes it literally and hands the
    // stream to the content parser without looking for `endstream`.
    const text = bytes(buildPdf([sheet()]))
    const m = /<< \/Length (\d+) >>\nstream\n/.exec(text) as RegExpExecArray
    const start = (m.index as number) + m[0].length
    const end = text.indexOf('\nendstream', start)
    expect(end - start).toBe(Number(m[1]))
  })

  it('opens with a header that marks the file binary', () => {
    const pdf = buildPdf([sheet()])
    expect(bytes(pdf).slice(0, 8)).toBe('%PDF-1.4')
    // Four high bytes tell anything in the path that this is not text to be
    // helpfully re-encoded.
    expect([...pdf.slice(10, 14)]).toEqual([0xe2, 0xe3, 0xcf, 0xd3])
  })

  it('lists every page in the page tree', () => {
    const text = bytes(buildPdf([sheet(), sheet(), sheet()]))
    expect(text).toContain('/Kids [3 0 R 5 0 R 7 0 R] /Count 3')
    expect(text).toContain('/Size 10')
    // Every page refers to the one shared font object.
    expect(text.match(/\/F1 9 0 R/g)).toHaveLength(3)
  })

  it('refuses to write a file with no pages', () => {
    expect(() => buildPdf([])).toThrow(/at least one page/)
  })
})

describe('buildPdf drawing', () => {
  it('strokes outlines and fills solids', () => {
    const ops = content(
      bytes(
        buildPdf([
          sheet({
            strokes: [
              { commands: [{ op: 'M', x: 1, y: 1 }, { op: 'L', x: 2, y: 2 }], width: 0.5 },
              {
                commands: [{ op: 'M', x: 3, y: 3 }, { op: 'L', x: 4, y: 4 }],
                width: 0.5,
                fill: true,
              },
            ],
          }),
        ]),
      ),
    )
    expect(ops).toMatch(/0\.5 w\n1 1 m\n2 2 l\nS/)
    expect(ops).toMatch(/3 3 m\n4 4 l\nf/)
    // A filled path takes no stroke width, and must not inherit one.
    expect(ops.slice(ops.indexOf('3 3 m') - 20, ops.indexOf('3 3 m'))).not.toContain(' w')
  })

  it('emits a dash pattern in millimetres', () => {
    const ops = content(
      bytes(
        buildPdf([
          sheet({
            strokes: [
              {
                commands: [{ op: 'M', x: 1, y: 1 }, { op: 'L', x: 9, y: 1 }],
                width: 0.3,
                dash: [2, 2],
              },
            ],
          }),
        ]),
      ),
    )
    expect(ops).toContain('[2 2] 0 d')
  })

  it('leaves each stroke’s state where it found it', () => {
    const ops = content(bytes(buildPdf([sheet()])))
    let depth = 0
    let lowest = 0
    for (const line of ops.split('\n')) {
      if (line === 'q') depth++
      if (line === 'Q') depth--
      lowest = Math.min(lowest, depth)
    }
    expect(depth).toBe(0)
    expect(lowest).toBe(0)
  })

  it('writes text outside the flipped block', () => {
    // Inside the page transform the y axis is mirrored, which would print every
    // caption back to front.
    const ops = content(
      bytes(buildPdf([sheet({ labels: [{ text: 'ok', at: { x: 10, y: 20 }, size: 3 }] })])),
    )
    const flipEnds = ops.lastIndexOf('Q')
    expect(ops.indexOf('BT')).toBeGreaterThan(flipEnds)
    expect(ops).toContain('(ok) Tj')
  })

  it('places text in points, measured up from the bottom', () => {
    const ops = content(
      bytes(buildPdf([sheet({ labels: [{ text: 'x', at: { x: 10, y: 20 }, size: 3 }] })])),
    )
    const m = /1 0 0 1 (\S+) (\S+) Tm/.exec(ops) as RegExpExecArray
    expect(Number(m[1])).toBeCloseTo(10 * MM_TO_PT, 4)
    expect(Number(m[2])).toBeCloseTo((LETTER.height - 20) * MM_TO_PT, 4)
  })
})

describe('buildPdf text encoding', () => {
  const label = (text: string): string =>
    content(bytes(buildPdf([sheet({ labels: [{ text, at: { x: 5, y: 5 }, size: 3 }] })])))

  it('writes Latin-1 punctuation as single bytes', () => {
    // The captions use these two, and the font is declared WinAnsiEncoding.
    const ops = label('100 mm · 8½ × 11')
    expect(ops).toContain('(100 mm · 8½ × 11) Tj')
  })

  it('escapes the characters that would end the string early', () => {
    expect(label('a(b)c\\d')).toContain('(a\\(b\\)c\\\\d) Tj')
  })

  it('substitutes anything outside Latin-1', () => {
    // Not cosmetic: a multi-byte character would make the declared /Length
    // shorter than the stream and every offset after it wrong.
    const ops = label('seed — 中')
    expect(ops).toContain('(seed ? ?) Tj')
  })

  it('keeps the declared length right for a caption full of punctuation', () => {
    const text = bytes(
      buildPdf([
        sheet({
          labels: [{ text: '100 mm · Letter · ★ 中', at: { x: 5, y: 5 }, size: 3 }],
        }),
      ]),
    )
    const m = /<< \/Length (\d+) >>\nstream\n/.exec(text) as RegExpExecArray
    const start = (m.index as number) + m[0].length
    expect(text.indexOf('\nendstream', start) - start).toBe(Number(m[1]))
  })
})

describe('toPdfPath', () => {
  it('spells moves, lines and closes', () => {
    expect(
      toPdfPath([
        { op: 'M', x: 1, y: 2 },
        { op: 'L', x: 3, y: 4 },
        { op: 'Z' },
      ]),
    ).toBe('1 2 m\n3 4 l\nh')
  })

  it('raises a quadratic to the cubic that draws the same curve', () => {
    const from = { x: 0, y: 0 }
    const ctrl = { x: 10, y: 30 }
    const to = { x: 20, y: 0 }
    const out = toPdfPath([
      { op: 'M', x: from.x, y: from.y },
      { op: 'Q', cx: ctrl.x, cy: ctrl.y, x: to.x, y: to.y },
    ])
    const m = /(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) c/.exec(out) as RegExpExecArray
    const [c1x, c1y, c2x, c2y, ex, ey] = m.slice(1).map(Number) as number[]

    const quad = (t: number, a: number, b: number, c: number): number =>
      (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c
    const cubic = (t: number, a: number, b: number, c: number, d: number): number =>
      (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d

    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      // Coordinates are written to three decimals, so a micron is as close as
      // the emitted curve can be; the raising itself is exact.
      expect(cubic(t, from.x, c1x as number, c2x as number, ex as number)).toBeCloseTo(
        quad(t, from.x, ctrl.x, to.x),
        3,
      )
      expect(cubic(t, from.y, c1y as number, c2y as number, ey as number)).toBeCloseTo(
        quad(t, from.y, ctrl.y, to.y),
        3,
      )
    }
  })

  it('starts each quadratic from the current point, not the last move', () => {
    // Rounded corners come through as a run of Q commands; taking the start of
    // each from the subpath's first point instead of the previous endpoint puts
    // every corner after the first in the wrong place.
    const out = toPdfPath([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 10, y: 0 },
      { op: 'Q', cx: 12, cy: 0, x: 12, y: 2 },
      { op: 'L', x: 12, y: 10 },
      { op: 'Q', cx: 12, cy: 12, x: 14, y: 12 },
    ])
    const curves = out.split('\n').filter((l) => l.endsWith(' c'))
    expect(curves).toHaveLength(2)
    // Second curve leaves (12, 10): two thirds of the way to (12, 12) is
    // (12, 11.333).
    const second = (curves[1] as string).split(' ').map(Number)
    expect(second[0]).toBeCloseTo(12, 3)
    expect(second[1]).toBeCloseTo(11.333, 3)
  })
})

describe('renderPdf', () => {
  const shape = shapesFor(LETTER, MARKER)[0] as { id: string; label: string; mask: () => boolean }
  const g = generateMaze({ paper: LETTER, pen: MARKER, level: 3, shape, seed: 'pdf' })
  const opts = { paper: LETTER, stroke: MARKER.stroke, markers: true, calibration: true }

  it('produces the same bytes for the same maze', () => {
    expect(renderPdf(g.grid, g.maze, g.solution, opts)).toEqual(
      renderPdf(g.grid, g.maze, g.solution, opts),
    )
  })

  it('keeps every drawn point inside the page', () => {
    const ops = content(bytes(renderPdf(g.grid, g.maze, g.solution, opts)))
    let checked = 0
    for (const line of ops.split('\n')) {
      const m = /^([-\d. ]+) (m|l|c)$/.exec(line)
      if (m === null) continue
      const nums = (m[1] as string).split(' ').map(Number)
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(0)
        expect(nums[i]).toBeLessThanOrEqual(LETTER.width)
        expect(nums[i + 1]).toBeGreaterThanOrEqual(0)
        expect(nums[i + 1]).toBeLessThanOrEqual(LETTER.height)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('draws the whole maze, not a sample of it', () => {
    const ops = content(bytes(renderPdf(g.grid, g.maze, g.solution, opts)))
    // One subpath per chained wall run; the SVG has the same count.
    expect((ops.match(/ m$/gm) ?? []).length).toBeGreaterThan(200)
  })
})
