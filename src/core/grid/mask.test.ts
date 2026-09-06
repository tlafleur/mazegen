import { describe, expect, it } from 'vitest'
import { SquareGrid } from './square'
import { MaskedGrid } from './masked'
import { circleMask, heartMask, polygonMask, rectangleMask, starMask, shapeLibrary } from './mask'
import { carveAtLevel, LEVELS } from '../difficulty'
import { reachableCount, solve } from '../analyze'
import { makeRng } from '../rng'
import { A4, LETTER, PENS, gridSizeFor } from '../../render/page'

const gridFor = (paper = LETTER, pitch = 6): SquareGrid => {
  const { cols, rows } = gridSizeFor(paper, pitch)
  return new SquareGrid(cols, rows, pitch)
}

describe('polygonMask', () => {
  it('tests a square correctly', () => {
    const square = polygonMask([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ])
    expect(square(0, 0)).toBe(true)
    expect(square(0.9, 0.9)).toBe(true)
    expect(square(1.5, 0)).toBe(false)
    expect(square(0, -1.5)).toBe(false)
  })

  it('handles the concave notches of a star', () => {
    const star = starMask(5, 0.42)
    expect(star(0, 0)).toBe(true)
    // Straight up is a point; the notch beside it is outside at the same radius.
    expect(star(0, -0.9)).toBe(true)
    expect(star(0.55, -0.75)).toBe(false)
  })
})

describe('shape masks', () => {
  it('keeps a circle round rather than stretching it to the page', () => {
    expect(circleMask(1, 0)).toBe(true)
    expect(circleMask(0, 1)).toBe(true)
    expect(circleMask(0.7, 0.7)).toBe(true)
    expect(circleMask(0.8, 0.8)).toBe(false)
  })

  it('puts the lobes of the heart at the top of the page', () => {
    // Page coordinates grow downward, so the lobes are at negative y.
    expect(heartMask(0, 0)).toBe(true)
    expect(heartMask(0, 0.9)).toBe(true) // the point, below
    expect(heartMask(0, -0.95)).toBe(false) // the cleft between the lobes
    expect(heartMask(-0.5, -0.85)).toBe(true) // left lobe
    expect(heartMask(0.5, -0.85)).toBe(true) // right lobe
  })

  it('fits the heart inside the page rather than clipping it', () => {
    // Sweep for the widest point anywhere on the shape. It has to reach the
    // page edge (or the heart is needlessly small) without crossing it (or the
    // sides print sliced off, which is what an unscaled curve does).
    let widest = 0
    for (let i = -1400; i <= 1400; i++) {
      const y = i / 1000
      for (let j = 1400; j > Math.round(widest * 1000); j--) {
        const x = j / 1000
        if (heartMask(x, y)) {
          widest = x
          break
        }
      }
    }
    expect(widest).toBeGreaterThan(0.97)
    expect(widest).toBeLessThanOrEqual(1)
  })
})

describe('MaskedGrid', () => {
  it('leaves ids untouched when the mask removes nothing', () => {
    // Sidewinder carves on the base rectangle but its output indexes the masked
    // grid, which is only sound because a complete mask renumbers nothing.
    const base = gridFor()
    const grid = new MaskedGrid(base, rectangleMask)
    expect(grid.isComplete).toBe(true)
    expect(grid.cellCount).toBe(base.cellCount)
    expect(grid.edgeCount).toBe(base.edgeCount)
    expect(grid.rowStructured()).toBe(base)
    for (let e = 0; e < grid.edgeCount; e++) {
      expect(grid.endpoints(e)).toEqual(base.endpoints(e))
    }
  })

  it('offers no row structure once cells are missing', () => {
    const grid = new MaskedGrid(gridFor(), circleMask)
    expect(grid.isComplete).toBe(false)
    expect(grid.rowStructured()).toBeNull()
  })

  it('draws the full outline, less the openings', () => {
    const base = gridFor(LETTER, 12)
    const grid = new MaskedGrid(base, rectangleMask)
    const faces = 2 * base.cols + 2 * base.rows
    expect(grid.boundarySegments()).toHaveLength(faces)
    expect(grid.boundarySegments([0, base.cellCount - 1])).toHaveLength(faces - 2)
  })

  it('drops the corners of a circle', () => {
    const base = gridFor()
    const grid = new MaskedGrid(base, circleMask)
    expect(grid.cellCount).toBeLessThan(base.cellCount)
    // A circle inscribed in the width covers about pi/4 of that square, and
    // nothing outside it.
    expect(grid.cellCount).toBeGreaterThan(base.cols * base.cols * 0.7)
    expect(grid.cellCount).toBeLessThan(base.cols * base.cols * 0.85)
  })

  it('refuses a mask that leaves almost nothing', () => {
    expect(() => new MaskedGrid(gridFor(), (x, y) => x > 0.99 && y > 0.99)).toThrow(/connected/)
  })

  it('keeps only one connected piece', () => {
    // Two disjoint blobs: only the larger survives, so the maze is solvable.
    const grid = new MaskedGrid(gridFor(), (x, y) => (y < -0.5 ? x < 0 : y > 0.5))
    const solved = carveAtLevel(grid, makeRng('split'), 3)
    expect(reachableCount(solved)).toBe(grid.cellCount)
  })

  it('opens onto the outside of the shape', () => {
    const base = gridFor(LETTER, 12)
    const grid = new MaskedGrid(base, rectangleMask)
    const [start, end] = grid.farthestBoundaryPair()
    for (const cell of [start, end]) {
      const p = grid.openingPoint(cell)
      const onEdge =
        p.x === 0 || p.y === 0 || p.x === base.width || p.y === base.height
      expect(onEdge).toBe(true)
    }
  })

  it('picks opposite corners of a rectangle as entrance and exit', () => {
    const base = gridFor(LETTER, 12)
    const grid = new MaskedGrid(base, rectangleMask)
    const [start, end] = grid.farthestBoundaryPair()
    const corners = [
      base.cellAt(0, 0),
      base.cellAt(base.cols - 1, 0),
      base.cellAt(0, base.rows - 1),
      base.cellAt(base.cols - 1, base.rows - 1),
    ]
    expect(corners).toContain(start)
    expect(corners).toContain(end)
    expect(start).not.toBe(end)
  })
})

describe('every shape, on every sheet', () => {
  const cases = [LETTER, A4].flatMap((paper) =>
    PENS.map((pen) => {
      const { cols, rows } = gridSizeFor(paper, pen.pitch)
      const base = new SquareGrid(cols, rows, pen.pitch)
      return { name: `${paper.id}/${pen.id}`, base, aspect: base.height / base.width }
    }),
  )

  it.each(cases)('builds a solvable maze at every level on $name', ({ base, aspect }) => {
    for (const shape of shapeLibrary(aspect)) {
      const grid = new MaskedGrid(base, shape.mask)
      const [start, end] = grid.farthestBoundaryPair()
      expect(start).not.toBe(end)

      for (const level of LEVELS) {
        const maze = carveAtLevel(grid, makeRng(`${shape.id}-${level}`), level, start, end)
        expect(reachableCount(maze)).toBe(grid.cellCount)
        expect(solve(maze)).not.toBeNull()
      }
    }
  })

  // A cell with one mask neighbour or none is a forced corridor: no choice to
  // make, and visually a spike off the side of the shape. A star tapers to a
  // point, so about one per point is inherent; many more would mean the shape
  // had thinned into filament.
  it.each(cases)('keeps forced corridors rare on $name', ({ base, aspect }) => {
    for (const shape of shapeLibrary(aspect)) {
      const grid = new MaskedGrid(base, shape.mask)
      let spurs = 0
      for (let c = 0; c < grid.cellCount; c++) {
        let neighbours = 0
        for (let dir = 0; dir < 4; dir++) if (grid.neighbourAcross(c, dir) !== -1) neighbours++
        if (neighbours <= 1) spurs++
      }
      expect(spurs).toBeLessThanOrEqual(6)
    }
  })

  it.each(cases)('leaves each shape enough maze on $name', ({ base, aspect }) => {
    for (const shape of shapeLibrary(aspect)) {
      const grid = new MaskedGrid(base, shape.mask)

      // What matters is whether enough cells survive to be a maze at all. An
      // earlier version of this test used a coverage fraction floor of 0.28,
      // taken from the star when the star was the sparsest shape — which meant
      // it measured the library that happened to exist rather than the property
      // worth holding. A dinosaur is honestly sparser than a star: long neck,
      // stubby legs, a lot of surrounding page. On the smallest grid it keeps
      // 87 cells against the star's 101, and both are real mazes.
      expect(grid.cellCount).toBeGreaterThan(60)
      // A floor low enough to admit a sparse silhouette, high enough to reject
      // anything that has thinned into filament.
      expect(grid.cellCount).toBeGreaterThan(base.cellCount * 0.22)
    }
  })
})
