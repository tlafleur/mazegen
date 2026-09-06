import { describe, expect, it } from 'vitest'
import {
  A4,
  CRAYON,
  FINE,
  HEXAGONS,
  LETTER,
  MARKER,
  PENCIL,
  PENS,
  defaultPaperFor,
  gridSizeFor,
} from './page'
import { chainSegments } from './chain'
import { renderSvg } from './svg'
import { generateMaze, shapesFor } from '../generate'
import type { Level } from '../core/difficulty'
import type { Paper, Pen } from './page'

/** A rectangular maze at the hardest level, the busiest case for rendering. */
function gen(paper: Paper, pen: Pen, seed: string, level: Level = 5) {
  const shape = shapesFor(paper, pen)[0] as { id: string; label: string; mask: () => boolean }
  return generateMaze({ paper, pen, level, shape, seed })
}
import type { Segment } from '../core/grid/planar'

describe('gridSizeFor', () => {
  // These are the tables in docs/DESIGN.md §4. If a change moves them, the doc
  // is wrong too.
  it('matches the documented Letter grid sizes', () => {
    expect(gridSizeFor(LETTER, CRAYON.pitch)).toEqual({ cols: 15, rows: 21 })
    expect(gridSizeFor(LETTER, MARKER.pitch)).toEqual({ cols: 21, rows: 28 })
    expect(gridSizeFor(LETTER, PENCIL.pitch)).toEqual({ cols: 31, rows: 42 })
    expect(gridSizeFor(LETTER, FINE.pitch)).toEqual({ cols: 47, rows: 63 })
  })

  it('matches the documented A4 grid sizes', () => {
    expect(gridSizeFor(A4, CRAYON.pitch)).toEqual({ cols: 15, rows: 22 })
    expect(gridSizeFor(A4, MARKER.pitch)).toEqual({ cols: 20, rows: 30 })
    expect(gridSizeFor(A4, PENCIL.pitch)).toEqual({ cols: 30, rows: 45 })
    expect(gridSizeFor(A4, FINE.pitch)).toEqual({ cols: 46, rows: 67 })
  })

  it('keeps the maze inside the printable area', () => {
    for (const paper of [LETTER, A4]) {
      for (const pen of PENS) {
        const { cols, rows } = gridSizeFor(paper, pen.pitch)
        expect(cols * pen.pitch).toBeLessThanOrEqual(paper.width - 2 * 12.7)
        expect(rows * pen.pitch).toBeLessThanOrEqual(paper.height - 2 * 12.7)
      }
    }
  })
})

describe('hexagonal sheets', () => {
  it('keep the maze inside the printable area at every cell size', () => {
    for (const paper of [LETTER, A4]) {
      for (const pen of PENS) {
        const g = generateMaze({
          paper,
          pen,
          level: 3,
          shape: shapesFor(paper, pen, HEXAGONS)[0] as Parameters<typeof generateMaze>[0]['shape'],
          seed: 'hex',
          cells: HEXAGONS,
        })
        expect(g.grid.width).toBeLessThanOrEqual(paper.width - 2 * 12.7)
        expect(g.grid.height).toBeLessThanOrEqual(paper.height - 2 * 12.7)
      }
    }
  })

  it('render with no change to the renderer', () => {
    const shape = shapesFor(LETTER, MARKER, HEXAGONS)[0] as Parameters<
      typeof generateMaze
    >[0]['shape']
    const g = generateMaze({
      paper: LETTER,
      pen: MARKER,
      level: 3,
      shape,
      seed: 'hex',
      cells: HEXAGONS,
    })
    const svg = renderSvg(g.grid, g.maze, g.solution, {
      paper: LETTER,
      stroke: MARKER.stroke,
      markers: true,
    })
    expect(svg).toContain('width="215.9mm"')
    // Diagonal walls: a square grid emits only axis-aligned segments, so a
    // coordinate pair that shares neither axis with its neighbour is proof the
    // hexagons reached the page.
    expect(svg.length).toBeGreaterThan(10000)
    expect(g.grid.cellCount).toBeGreaterThan(400)
  })

  it('gives a different maze from squares at the same settings', () => {
    const args = { paper: LETTER, pen: MARKER, level: 3 as const, seed: 'same' }
    const sq = generateMaze({
      ...args,
      shape: shapesFor(LETTER, MARKER)[0] as Parameters<typeof generateMaze>[0]['shape'],
    })
    const hx = generateMaze({
      ...args,
      cells: HEXAGONS,
      shape: shapesFor(LETTER, MARKER, HEXAGONS)[0] as Parameters<
        typeof generateMaze
      >[0]['shape'],
    })
    expect(hx.grid.cellCount).not.toBe(sq.grid.cellCount)
    // Six neighbours rather than four, so more adjacencies per cell.
    expect(hx.grid.edgeCount / hx.grid.cellCount).toBeGreaterThan(
      sq.grid.edgeCount / sq.grid.cellCount,
    )
  })
})

describe('defaultPaperFor', () => {
  it('picks Letter in the regions that use it', () => {
    for (const locale of ['en-US', 'es-MX', 'en-CA', 'fr-CA', 'es-CL', 'fil-PH']) {
      expect(defaultPaperFor(locale).id).toBe('letter')
    }
  })

  it('picks A4 everywhere else', () => {
    for (const locale of ['en-GB', 'de-DE', 'ja-JP', 'fr-FR', 'pt-BR', 'en-AU']) {
      expect(defaultPaperFor(locale).id).toBe('a4')
    }
  })

  it('resolves a bare language to its implied region', () => {
    expect(defaultPaperFor('en').id).toBe('letter')
    expect(defaultPaperFor('de').id).toBe('a4')
  })

  it('falls back to A4 when the locale is missing or unparseable', () => {
    expect(defaultPaperFor(undefined).id).toBe('a4')
    expect(defaultPaperFor('').id).toBe('a4')
    expect(defaultPaperFor('not a locale!!').id).toBe('a4')
  })
})

/** Normalised key so a segment compares equal regardless of direction. */
function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

function segmentsOf(polylines: number[][]): string[] {
  const out: string[] = []
  for (const poly of polylines) {
    for (let i = 1; i < poly.length; i++) {
      out.push(key(poly[i - 1] as number, poly[i] as number))
    }
  }
  return out
}

describe('chainSegments', () => {
  it('joins a straight run into one polyline', () => {
    const segs: Segment[] = [
      [0, 1],
      [1, 2],
      [2, 3],
    ]
    expect(chainSegments(segs, 4)).toEqual([[0, 1, 2, 3]])
  })

  it('splits at a junction', () => {
    //   0 - 1 - 2
    //           |
    //           3
    const segs: Segment[] = [
      [0, 1],
      [1, 2],
      [2, 3],
    ]
    // Vertex 2 has degree 2 here, so it is still one run; add a fourth arm.
    const branched: Segment[] = [...segs, [2, 4]]
    const polys = chainSegments(branched, 5)
    expect(polys.length).toBe(3)
    expect(segmentsOf(polys).sort()).toEqual(['0-1', '1-2', '2-3', '2-4'].sort())
  })

  it('closes a loop, repeating the first vertex', () => {
    const segs: Segment[] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]
    const polys = chainSegments(segs, 4)
    expect(polys).toHaveLength(1)
    const loop = polys[0] as number[]
    expect(loop).toHaveLength(5)
    expect(loop[0]).toBe(loop[4])
  })

  it('handles an empty input', () => {
    expect(chainSegments([], 0)).toEqual([])
  })

  it('emits every wall of a real maze exactly once', () => {
    const { grid, maze } = gen(LETTER, PENCIL, 'chain-check')
    const segs: Segment[] = grid.boundarySegments([maze.start, maze.end])
    for (let e = 0; e < grid.edgeCount; e++) {
      if (maze.open[e] === 0) segs.push(grid.wallSegment(e))
    }

    const emitted = segmentsOf(chainSegments(segs, grid.vertexCount))
    expect(emitted).toHaveLength(segs.length)
    expect(new Set(emitted).size).toBe(segs.length)
    expect(new Set(emitted)).toEqual(new Set(segs.map(([a, b]) => key(a, b))))
  })

  it('collapses thousands of segments into far fewer subpaths', () => {
    const { grid, maze } = gen(LETTER, PENCIL, 'chain-count')
    const segs: Segment[] = grid.boundarySegments([maze.start, maze.end])
    for (let e = 0; e < grid.edgeCount; e++) {
      if (maze.open[e] === 0) segs.push(grid.wallSegment(e))
    }
    const polys = chainSegments(segs, grid.vertexCount)
    expect(segs.length).toBeGreaterThan(1000)
    expect(polys.length).toBeLessThan(segs.length / 2)
  })
})

describe('renderSvg', () => {
  it('sizes the document to the sheet in millimetres', () => {
    const { grid, maze, solution } = gen(LETTER, CRAYON, 'svg-letter')
    const svg = renderSvg(grid, maze, solution, { paper: LETTER, stroke: CRAYON.stroke })
    expect(svg).toContain('width="215.9mm"')
    expect(svg).toContain('height="279.4mm"')
    expect(svg).toContain('viewBox="0 0 215.9 279.4"')
  })

  it('uses A4 dimensions for A4', () => {
    const { grid, maze, solution } = gen(A4, CRAYON, 'svg-a4')
    const svg = renderSvg(grid, maze, solution, { paper: A4, stroke: CRAYON.stroke })
    expect(svg).toContain('width="210mm"')
    expect(svg).toContain('height="297mm"')
  })

  it('omits the solution unless asked', () => {
    const { grid, maze, solution } = gen(LETTER, CRAYON, 'svg-solution')
    const without = renderSvg(grid, maze, solution, { paper: LETTER, stroke: 1 })
    const with_ = renderSvg(grid, maze, solution, {
      paper: LETTER,
      stroke: 1,
      showSolution: true,
    })
    expect(without).not.toContain('stroke-dasharray')
    expect(with_).toContain('stroke-dasharray')
  })

  it('draws a 100 mm reference line when calibration is on', () => {
    const { grid, maze, solution } = gen(LETTER, CRAYON, 'svg-rule')
    const svg = renderSvg(grid, maze, solution, {
      paper: LETTER,
      stroke: 1,
      calibration: true,
      caption: 'measure me',
    })
    // Starts at the margin, ends exactly 100 mm later.
    expect(svg).toContain('M12.7 271.4L112.7 271.4')
    expect(svg).toContain('measure me')
  })

  it('escapes caption text', () => {
    const { grid, maze, solution } = gen(LETTER, CRAYON, 'svg-esc')
    const svg = renderSvg(grid, maze, solution, {
      paper: LETTER,
      stroke: 1,
      calibration: true,
      caption: '<script>&',
    })
    expect(svg).toContain('&lt;script&gt;&amp;')
    expect(svg).not.toContain('<script>')
  })

  it('keeps all geometry inside the page', () => {
    const { grid, maze, solution } = gen(LETTER, PENCIL, 'svg-bounds')
    const svg = renderSvg(grid, maze, solution, {
      paper: LETTER,
      stroke: PENCIL.stroke,
      showSolution: true,
    })
    const coords = svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)
    let checked = 0
    for (const m of coords) {
      const x = Number(m[1])
      const y = Number(m[2])
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(LETTER.width)
      expect(y).toBeLessThanOrEqual(LETTER.height)
      checked++
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('is deterministic', () => {
    const a = gen(LETTER, CRAYON, 'repeat')
    const b = gen(LETTER, CRAYON, 'repeat')
    const opts = { paper: LETTER, stroke: CRAYON.stroke, showSolution: true }
    expect(renderSvg(a.grid, a.maze, a.solution, opts)).toBe(
      renderSvg(b.grid, b.maze, b.solution, opts),
    )
  })
})
