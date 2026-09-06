import { describe, expect, it } from 'vitest'
import { CHEESE, MOUSE, SAFE_INSET, placeMarker, type MarkerPart } from './marker'
import { LETTER } from './page'
import type { PathCommand } from './path'

function boundsOf(parts: readonly MarkerPart[]): {
  x0: number
  y0: number
  x1: number
  y1: number
} {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const see = (x: number, y: number): void => {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  for (const part of parts) {
    for (const c of part.commands as readonly PathCommand[]) {
      if (c.op === 'Z') continue
      see(c.x, c.y)
      if (c.op === 'Q') see(c.cx, c.cy)
      if (c.op === 'C') {
        see(c.c1x, c.c1y)
        see(c.c2x, c.c2y)
      }
    }
  }
  return { x0, y0, x1, y1 }
}

const page = { width: LETTER.width, height: LETTER.height }

/** What the sheet asks for: 10 mm at half a wall's weight. */
const art = { size: 10, gap: 1.5, stroke: 0.45 } as const

describe('placeMarker', () => {
  it('draws outside the opening, in the direction it faces', () => {
    const parts = placeMarker(
      { marker: MOUSE, at: { x: 100, y: 60 }, outward: { x: 0, y: -1 }, ...art },
      page,
    )
    const b = boundsOf(parts)
    // Entirely above the opening, and clear of it by the gap.
    expect(b.y1).toBeLessThanOrEqual(60 - 1.5)
    expect(b.x0).toBeGreaterThan(90)
    expect(b.x1).toBeLessThan(110)
  })

  it('keeps every mark inside the printable area', () => {
    // The maze fills its margin, so an opening on the outline sits about 13 mm
    // from the paper edge and a full-size marker would reach past 5 mm — inside
    // the strip printers physically cannot mark.
    for (const [at, outward] of [
      [{ x: 108, y: 13.7 }, { x: 0, y: -1 }],
      [{ x: 108, y: 265.7 }, { x: 0, y: 1 }],
      [{ x: 13.7, y: 140 }, { x: -1, y: 0 }],
      [{ x: 202.2, y: 140 }, { x: 1, y: 0 }],
    ] as const) {
      const parts = placeMarker({ marker: MOUSE, at, outward, ...art }, page)
      expect(parts.length).toBeGreaterThan(0)
      const b = boundsOf(parts)
      expect(b.x0).toBeGreaterThanOrEqual(SAFE_INSET)
      expect(b.y0).toBeGreaterThanOrEqual(SAFE_INSET)
      expect(b.x1).toBeLessThanOrEqual(page.width - SAFE_INSET)
      expect(b.y1).toBeLessThanOrEqual(page.height - SAFE_INSET)
    }
  })

  it('treats the requested size as a maximum', () => {
    const roomy = placeMarker(
      { marker: CHEESE, at: { x: 100, y: 100 }, outward: { x: 0, y: -1 }, ...art },
      page,
    )
    const tight = placeMarker(
      { marker: CHEESE, at: { x: 100, y: 13.7 }, outward: { x: 0, y: -1 }, ...art },
      page,
    )
    const rb = boundsOf(roomy)
    const tb = boundsOf(tight)
    expect(rb.y1 - rb.y0).toBeGreaterThan(tb.y1 - tb.y0)
    // Shrunk, not cropped: the same parts are still there.
    expect(tight).toHaveLength(roomy.length)
  })

  it('slides a corner marker back onto the sheet', () => {
    const parts = placeMarker(
      { marker: MOUSE, at: { x: 1, y: 100 }, outward: { x: -1, y: 0 }, ...art },
      page,
    )
    // Nothing to the left of an opening 1 mm from the edge.
    expect(parts).toHaveLength(0)

    const along = placeMarker(
      { marker: MOUSE, at: { x: 6, y: 30 }, outward: { x: 0, y: -1 }, ...art },
      page,
    )
    expect(along.length).toBeGreaterThan(0)
    expect(boundsOf(along).x0).toBeGreaterThanOrEqual(SAFE_INSET)
  })

  it('leaves out a marker too small to read', () => {
    // Six millimetres of room, minus the gap, is under the legible floor.
    expect(
      placeMarker(
        { marker: MOUSE, at: { x: 100, y: 11 }, outward: { x: 0, y: -1 }, ...art },
        page,
      ),
    ).toHaveLength(0)
  })

  it('scales the whole drawing, keeping its proportions', () => {
    const at = { x: 100, y: 100 } as const
    const outward = { x: 0, y: -1 } as const
    const big = boundsOf(placeMarker({ marker: MOUSE, at, outward, ...art }, page))
    const small = boundsOf(placeMarker({ marker: MOUSE, at, outward, ...art, size: 5 }, page))
    expect((big.x1 - big.x0) / (big.y1 - big.y0)).toBeCloseTo(
      (small.x1 - small.x0) / (small.y1 - small.y0),
      6,
    )
    expect((big.x1 - big.x0) / (small.x1 - small.x0)).toBeCloseTo(2, 6)
  })

  it('keeps the mouse and the cheese different enough to tell apart', () => {
    // Same box, so what distinguishes them is the drawing: the mouse is one
    // closed form plus an ear, a tail and an eye; the cheese is a wedge and
    // three holes.
    expect(MOUSE.parts).toHaveLength(4)
    expect(CHEESE.parts).toHaveLength(4)
    expect(MOUSE.parts.filter((p) => p.fill === true)).toHaveLength(1)
    expect(CHEESE.parts.filter((p) => p.fill === true)).toHaveLength(0)
  })
})
