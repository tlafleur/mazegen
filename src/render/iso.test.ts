import { describe, expect, it } from 'vitest'
import { ISO_HEIGHT, isoLiveArea, isoStrokes, isoView } from './iso'
import { buildSheet, sheetMapping } from './sheet'
import { renderSvg } from './svg'
import { STYLES } from './style'
import { A4, DEFAULT_MARGIN, LETTER, PENS, PENCIL, landscape, type Paper } from './page'
import { baseGridFor, generateMaze, shapesFor } from '../generate'
import { MaskedGrid } from '../core/grid/masked'
import { rectangleMask } from '../core/grid/mask'
import { carveAtLevel } from '../core/difficulty'
import { makeRng } from '../core/rng'
import type { Point } from '../core/grid/planar'
import type { PathCommand } from './path'

const ISO = STYLES.find((s) => s.id === 'iso') as (typeof STYLES)[number]
const CLASSIC = STYLES[0] as (typeof STYLES)[number]
const PAPERS = [LETTER, A4, landscape(LETTER), landscape(A4)]

const gridFor = (paper: Paper, pitch: number): MaskedGrid =>
  new MaskedGrid(baseGridFor(paper, { id: 'x', label: 'x', pitch, stroke: 0.7 }, undefined, true),
    rectangleMask)

describe('the isometric projection', () => {
  const grid = { width: 100, height: 100, pitch: 9 }
  const view = isoView(LETTER, grid)

  it('foreshortens all three axes equally, which is what makes it isometric', () => {
    // A millimetre is a millimetre whichever axis it runs along. Without this
    // the drawing would not be measurable, only three-dimensional-looking.
    const o = view.to({ x: 50, y: 50 })
    const along = (p: Point, z = 0): number => {
      const q = view.to(p, z)
      return Math.hypot(q.x - o.x, q.y - o.y)
    }
    const x = along({ x: 60, y: 50 })
    expect(along({ x: 50, y: 60 })).toBeCloseTo(x, 9)
    expect(along({ x: 50, y: 50 }, 10)).toBeCloseTo(x, 9)
  })

  it('comes back to where it started', () => {
    // Solving on screen depends on this: a finger is a page point and has to
    // become the grid point the corridor under it was drawn from.
    for (const p of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 37, y: 81 }]) {
      const back = view.from(view.to(p))
      expect(back.x).toBeCloseTo(p.x, 9)
      expect(back.y).toBeCloseTo(p.y, 9)
    }
  })

  it('leaves parallel corridors cos30 of a cell apart', () => {
    // The cell-size promise, as much of it as a projection can keep. Two walls
    // a pitch apart in the grid are this far apart on the paper, and that is
    // the width a crayon has to fit down.
    const a = view.to({ x: 0, y: 0 })
    const b = view.to({ x: 10, y: 0 })
    const c = view.to({ x: 0, y: 10 })
    const dir = { x: b.x - a.x, y: b.y - a.y }
    const len = Math.hypot(dir.x, dir.y)
    const gap = Math.abs((c.x - a.x) * dir.y - (c.y - a.y) * dir.x) / len
    expect(gap).toBeCloseTo(10 * (Math.sqrt(3) / 2), 9)
  })

  it('keeps walls short enough to see the floor behind them', () => {
    // A wall hides height / sin30 millimetres of floor behind it. Past a whole
    // cell, corridors running away from the viewer vanish and the maze cannot
    // be solved from the page at all.
    expect(ISO_HEIGHT / 0.5).toBeLessThan(1)
  })
})

describe('fitting an isometric drawing to the page', () => {
  it('draws a grid it sized itself at full size, on every paper and pen', () => {
    for (const paper of PAPERS) {
      for (const pen of PENS) {
        const live = isoLiveArea(paper, pen.pitch)
        const view = isoView(paper, { ...live, pitch: pen.pitch })
        expect(view.scale).toBeCloseTo(1, 9)
      }
    }
  })

  it('shrinks a grid it did not size, rather than running off the paper', () => {
    // A word maze arrives at whatever grid the word needed.
    const view = isoView(LETTER, { width: 900, height: 900, pitch: 9 })
    expect(view.scale).toBeLessThan(0.5)
    for (const p of [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 0, y: 900 }, { x: 900, y: 900 }]) {
      const q = view.to(p, 9 * ISO_HEIGHT)
      expect(q.x).toBeGreaterThanOrEqual(-1e-9)
      expect(q.y).toBeGreaterThanOrEqual(-1e-9)
      expect(q.x).toBeLessThanOrEqual(LETTER.width + 1e-9)
      expect(q.y).toBeLessThanOrEqual(LETTER.height + 1e-9)
    }
  })

  it('puts every corner of the grid inside the printable area', () => {
    for (const paper of PAPERS) {
      const live = isoLiveArea(paper, 6)
      const view = isoView(paper, { ...live, pitch: 6 })
      const h = 6 * ISO_HEIGHT
      for (const [p, z] of [
        [{ x: 0, y: 0 }, h],
        [{ x: live.width, y: 0 }, h],
        [{ x: 0, y: live.height }, h],
        [{ x: live.width, y: live.height }, 0],
      ] as const) {
        const q = view.to(p, z)
        expect(q.x).toBeGreaterThanOrEqual(DEFAULT_MARGIN - 1e-6)
        expect(q.y).toBeGreaterThanOrEqual(DEFAULT_MARGIN - 1e-6)
        expect(q.x).toBeLessThanOrEqual(paper.width - DEFAULT_MARGIN + 1e-6)
        expect(q.y).toBeLessThanOrEqual(paper.height - DEFAULT_MARGIN + 1e-6)
      }
    }
  })

  it('fills a wide sheet better than a tall one, which is why it is worth saying so', () => {
    // The projected bounding box is always 1.73:1, whatever the grid, so a
    // portrait page leaves a band of paper empty above and below. Not a defect
    // to tune away — it is what rotating a rectangle 45° does — but the reason
    // the panel says an isometric maze wants a wide page.
    const used = (paper: Paper): number => {
      const live = isoLiveArea(paper, 6)
      const span = live.width + live.height
      return (span * 0.5) / (paper.height - 2 * DEFAULT_MARGIN)
    }
    expect(used(landscape(LETTER))).toBeGreaterThan(used(LETTER) * 1.5)
  })
})

describe('isometric walls', () => {
  const paper = landscape(LETTER)
  const grid = gridFor(paper, 9)
  const [start, end] = grid.farthestBoundaryPair()
  const maze = carveAtLevel(grid, makeRng('iso'), 3, start, end)
  const view = isoView(paper, grid)

  it('draws each wall filled and then outlined, so a nearer one hides a further', () => {
    const strokes = isoStrokes(grid, maze, view, 0.7, [])
    expect(strokes.length).toBeGreaterThan(100)
    for (let i = 0; i < strokes.length; i += 2) {
      expect(strokes[i]?.fill).toBe(true)
      expect(strokes[i]?.light).toBe(true)
      expect(strokes[i + 1]?.fill).toBeUndefined()
    }
  })

  it('draws them back to front', () => {
    // The whole occlusion model. Depth is the sum of the grid coordinates,
    // which grows toward the viewer, so the fills have to arrive in that order.
    const strokes = isoStrokes(grid, maze, view, 0.7, [])
    let previous = -Infinity
    for (let i = 0; i < strokes.length; i += 2) {
      // The lowest point of the panel on the page stands in for its depth.
      const ys = (strokes[i]?.commands ?? []).flatMap((c: PathCommand) =>
        'y' in c ? [c.y] : [],
      )
      const near = Math.max(...ys)
      expect(near).toBeGreaterThanOrEqual(previous - 1e-6)
      previous = near
    }
  })

  it('leaves the upright edge out where one wall runs straight into the next', () => {
    // Otherwise every long wall is a row of bricks, and the hatching buries the
    // maze. Four edges each would be the naive count; real mazes have long
    // straight runs, so the real one is well under it.
    const strokes = isoStrokes(grid, maze, view, 0.7, [])
    let drawn = 0
    let panels = 0
    for (let i = 1; i < strokes.length; i += 2) {
      panels++
      drawn += (strokes[i]?.commands.length ?? 0) / 2
    }
    expect(drawn).toBeLessThan(panels * 3.4)
    expect(drawn).toBeGreaterThan(panels * 2)
  })
})

describe('an isometric sheet', () => {
  const paper = landscape(LETTER)

  it('holds far fewer cells than a flat one, and says so honestly', () => {
    const shape = shapesFor(paper, PENCIL)[0] as ReturnType<typeof shapesFor>[number]
    const flat = generateMaze({ paper, pen: PENCIL, level: 3, shape, seed: 'k' })
    const iso = generateMaze({ paper, pen: PENCIL, level: 3, shape, seed: 'k', iso: true })
    expect(iso.grid.cellCount).toBeLessThan(flat.grid.cellCount / 2)
    expect(iso.grid.pitch).toBe(flat.grid.pitch)
  })

  it('draws nothing off the paper', () => {
    const shape = shapesFor(paper, PENCIL, undefined, true)[0] as ReturnType<typeof shapesFor>[number]
    const g = generateMaze({ paper, pen: PENCIL, level: 3, shape, seed: 'edge', iso: true })
    const sheet = buildSheet(g.grid, g.maze, g.solution, {
      paper,
      stroke: PENCIL.stroke,
      style: ISO,
      markers: 'mouse',
      showSolution: true,
    })
    for (const s of sheet.strokes) {
      for (const c of s.commands) {
        if (!('x' in c)) continue
        expect(c.x).toBeGreaterThanOrEqual(-1e-6)
        expect(c.y).toBeGreaterThanOrEqual(-1e-6)
        expect(c.x).toBeLessThanOrEqual(paper.width + 1e-6)
        expect(c.y).toBeLessThanOrEqual(paper.height + 1e-6)
      }
    }
  })

  it('is a different drawing from the flat one, at the same size in millimetres', () => {
    const shape = shapesFor(paper, PENCIL, undefined, true)[0] as ReturnType<typeof shapesFor>[number]
    const g = generateMaze({ paper, pen: PENCIL, level: 3, shape, seed: 'both', iso: true })
    const base = { paper, stroke: PENCIL.stroke }
    const flat = renderSvg(g.grid, g.maze, g.solution, { ...base, style: CLASSIC })
    const iso = renderSvg(g.grid, g.maze, g.solution, { ...base, style: ISO })
    expect(iso).not.toBe(flat)
    for (const svg of [flat, iso]) expect(svg).toContain(`width="${paper.width}mm"`)
  })
})

describe('sheetMapping', () => {
  const grid = gridFor(LETTER, 9)

  it('round-trips under both projections', () => {
    for (const style of [CLASSIC, ISO]) {
      const map = sheetMapping(LETTER, grid, style)
      for (const p of [{ x: 0, y: 0 }, { x: 40, y: 90 }, { x: grid.width, y: grid.height }]) {
        const back = map.toGrid(map.toPage(p))
        expect(back.x).toBeCloseTo(p.x, 9)
        expect(back.y).toBeCloseTo(p.y, 9)
      }
    }
  })

  it('agrees with what the sheet was actually drawn with', () => {
    // The one thing that must not drift: if these two disagreed, a finger would
    // land in a different cell from the one printed under it.
    for (const style of [CLASSIC, ISO]) {
      const [s, e] = grid.farthestBoundaryPair()
      const maze = carveAtLevel(grid, makeRng('map'), 3, s, e)
      const sheet = buildSheet(grid, maze, [s, e], {
        paper: LETTER,
        stroke: 0.7,
        style,
        markers: 'none',
        showSolution: true,
      })
      const map = sheetMapping(LETTER, grid, style)
      const drawn = sheet.strokes.at(-1)?.commands ?? []
      const middle = drawn[Math.floor(drawn.length / 2)] as PathCommand
      if (!('x' in middle)) throw new Error('no point to check')
      const cell = grid.cellAtPoint(map.toGrid({ x: middle.x, y: middle.y }))
      expect(cell).not.toBe(-1)
    }
  })
})
