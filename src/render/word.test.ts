import { describe, expect, it } from 'vitest'
import {
  bestLayout,
  bitmapMask,
  dilate,
  limbWidth,
  underline,
  wordShape,
  type Bitmap,
} from './word'
import { MaskedGrid } from '../core/grid/masked'
import { SquareGrid } from '../core/grid/square'
import { carveAtLevel } from '../core/difficulty'
import { makeRng } from '../core/rng'
import { solve } from '../core/analyze'

function make(width: number, height: number, fill: (i: number, j: number) => boolean): Bitmap {
  const on = new Uint8Array(width * height)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) on[j * width + i] = fill(i, j) ? 1 : 0
  }
  return { width, height, on }
}

const count = (b: Bitmap): number => b.on.reduce((n, v) => n + v, 0)

describe('bitmapMask', () => {
  it('maps the shorter axis to [-1, 1]', () => {
    // A bitmap with only its left half set: the mask must be true on the left
    // of the box and false on the right, at every height.
    const bmp = make(40, 80, (i) => i < 20)
    const mask = bitmapMask(bmp, 2)
    for (const y of [-1.9, 0, 1.9]) {
      expect(mask(-0.5, y)).toBe(true)
      expect(mask(0.5, y)).toBe(false)
    }
  })

  it('maps the longer axis to [-aspect, aspect]', () => {
    const bmp = make(40, 80, (_i, j) => j < 40)
    const mask = bitmapMask(bmp, 2)
    expect(mask(0, -1.9)).toBe(true)
    expect(mask(0, 1.9)).toBe(false)
  })

  it('is false outside the box', () => {
    const mask = bitmapMask(make(10, 10, () => true), 1)
    expect(mask(-1.1, 0)).toBe(false)
    expect(mask(1.1, 0)).toBe(false)
    expect(mask(0, -1.1)).toBe(false)
    expect(mask(0, 1.1)).toBe(false)
  })

  it('agrees with the grid about where a mask is applied', () => {
    // The real coupling: a mask covering only the left half must keep only
    // cells on the left. If this drifts, a word comes out mirrored or shifted.
    const grid = new MaskedGrid(new SquareGrid(20, 30, 5), bitmapMask(make(40, 60, (i) => i < 20), 1.5))
    const mid = grid.base.width / 2
    for (let c = 0; c < grid.cellCount; c++) {
      expect(grid.cellCenter(c).x).toBeLessThan(mid)
    }
  })
})

describe('dilate', () => {
  it('grows a single pixel into a square of the given radius', () => {
    const out = dilate(make(21, 21, (i, j) => i === 10 && j === 10), 3)
    expect(count(out)).toBe(7 * 7)
    expect(out.on[10 * 21 + 13]).toBe(1)
    expect(out.on[10 * 21 + 14]).toBe(0)
  })

  it('leaves a bitmap alone at radius zero', () => {
    const b = make(8, 8, (i) => i === 3)
    expect(dilate(b, 0)).toBe(b)
    expect(dilate(b, 0.4)).toBe(b)
  })

  it('does not spill past the edges', () => {
    const out = dilate(make(9, 9, (i, j) => i === 0 && j === 0), 2)
    expect(count(out)).toBe(3 * 3)
  })

  it('thickens a thin stroke to something a corridor fits in', () => {
    // The whole reason it exists: a letter's stem is a line until this runs.
    const stem = make(60, 60, (i) => i >= 29 && i <= 30)
    const thick = dilate(stem, 4)
    let run = 0
    for (let i = 0; i < 60; i++) run += thick.on[30 * 60 + i] as number
    expect(run).toBe(10)
  })
})

describe('underline', () => {
  it('joins separate letters into one shape', () => {
    // Two disconnected blocks, as two letters are.
    const two = make(60, 40, (i, j) => j >= 10 && j <= 30 && (i < 20 || i > 40))
    const joined = underline(two, 6)

    const grid = (b: Bitmap) => {
      const seen = new Uint8Array(b.on.length)
      let parts = 0
      for (let s = 0; s < b.on.length; s++) {
        if (b.on[s] === 0 || seen[s] === 1) continue
        parts++
        const stack = [s]
        seen[s] = 1
        while (stack.length > 0) {
          const cur = stack.pop() as number
          const x = cur % b.width
          const y = Math.floor(cur / b.width)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= b.width || ny >= b.height) continue
            const k = ny * b.width + nx
            if (b.on[k] === 0 || seen[k] === 1) continue
            seen[k] = 1
            stack.push(k)
          }
        }
      }
      return parts
    }

    expect(grid(two)).toBe(2)
    expect(grid(joined)).toBe(1)
  })

  it('sits inside the foot of the ink, not below it', () => {
    // A bar hanging in space under the letters would be a component of its own,
    // which is the opposite of the point.
    const block = make(40, 40, (i, j) => j >= 10 && j <= 20 && i >= 10 && i <= 30)
    const out = underline(block, 5)
    for (let j = 21; j < 40; j++) {
      for (let i = 0; i < 40; i++) expect(out.on[j * 40 + i]).toBe(0)
    }
    // And it reaches across the full width of the ink.
    for (let i = 10; i <= 30; i++) expect(out.on[20 * 40 + i]).toBe(1)
  })

  it('bridges one band of ink to the next', () => {
    // Two lines of text: an underline per line joins each line's letters, and
    // without a bridge between them the second line is still a separate maze.
    const two = make(60, 60, (i, j) =>
      ((j >= 5 && j <= 20) || (j >= 40 && j <= 55)) && (i < 20 || i > 40),
    )
    const joined = underline(two, 5)
    let bridged = 0
    for (let j = 20; j <= 40; j++) {
      for (let i = 0; i < 60; i++) bridged += joined.on[j * 60 + i] as number
    }
    expect(bridged).toBeGreaterThan(0)
  })

  it('leaves an empty bitmap alone', () => {
    const empty = make(10, 10, () => false)
    expect(underline(empty, 3)).toBe(empty)
  })
})

describe('limbWidth', () => {
  it('measures the width of a stem', () => {
    const stem = make(60, 40, (i) => i >= 20 && i < 26)
    expect(limbWidth(stem)).toBe(6)
  })

  it('takes the median across limbs of different widths', () => {
    // Two stems, one twice the other: the median is the one that occurs in more
    // rows, which is what dilation should be judged against.
    const two = make(60, 40, (i, j) => (j < 30 ? i >= 10 && i < 14 : i >= 10 && i < 30))
    expect(limbWidth(two)).toBe(4)
  })

  it('is zero on an empty bitmap', () => {
    expect(limbWidth(make(10, 10, () => false))).toBe(0)
  })
})

describe('bestLayout', () => {
  // A monospaced stand-in, so the arithmetic is checkable by hand.
  const widthOf = (t: string): number => t.length * 0.6
  const cap = 0.7

  it('sets a long word on several lines to fill a portrait page', () => {
    const rows = bestLayout('ABCDEFGH', 1.3, widthOf, cap)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.join('')).toBe('ABCDEFGH')
  })

  it('leaves a short word on one line', () => {
    // Two wide letters stacked would be far taller than the page.
    expect(bestLayout('GO', 1.3, widthOf, cap)).toEqual(['GO'])
  })

  it('uses one line for a wide page', () => {
    expect(bestLayout('ABCDEF', 0.3, widthOf, cap)).toEqual(['ABCDEF'])
  })

  it('never drops or reorders a letter', () => {
    for (const word of ['A', 'HI', 'SAM', 'MAZE', 'ELEPHANT', 'ABCDEFGHIJKL']) {
      for (const aspect of [0.5, 1, 1.3, 2]) {
        expect(bestLayout(word, aspect, widthOf, cap).join('')).toBe(word)
      }
    }
  })
})

describe('wordShape', () => {
  it('declines an empty word', () => {
    expect(wordShape('   ', { cellsAcross: 30, aspect: 1.3 })).toBeNull()
  })

  it('declines when there is no canvas to draw on', () => {
    // Node has no document; the caller falls back to a plain shape rather than
    // throwing in the middle of a render.
    expect(wordShape('SAM', { cellsAcross: 30, aspect: 1.3 })).toBeNull()
  })
})

describe('a maze inside a bitmap shape', () => {
  it('carves and solves like any other mask', () => {
    // A fat ring, standing in for a letter O: the case where the mask has a
    // hole and the shape is not convex.
    const bmp = make(120, 120, (i, j) => {
      const d = Math.hypot(i - 60, j - 60)
      return d < 55 && d > 28
    })
    const grid = new MaskedGrid(new SquareGrid(40, 40, 5), bitmapMask(bmp, 1))
    expect(grid.cellCount).toBeGreaterThan(200)
    expect(grid.cellCount).toBeLessThan(1600)
    const [s, e] = grid.farthestBoundaryPair()
    expect(solve(carveAtLevel(grid, makeRng('ring'), 3, s, e))).not.toBeNull()
  })
})
