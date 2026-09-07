import { describe, expect, it } from 'vitest'
import { CW, IN, OUT, PolarGrid, polarGridSize } from './polar'
import { MaskedGrid } from './masked'
import { rectangleMask } from './mask'
import { carveAtLevel } from '../difficulty'
import { makeRng } from '../rng'
import { solve } from '../analyze'
import { chainSegments } from '../../render/chain'
import type { CellId } from '../types'

const g = new PolarGrid(8, 9)

/** Every face of a cell that has something across it. */
function facesOf(grid: PolarGrid, cell: CellId): number[] {
  const out: number[] = []
  for (let d = 0; d < grid.faces; d++) if (grid.neighbourAcross(cell, d) !== -1) out.push(d)
  return out
}

describe('PolarGrid rings', () => {
  it('puts one cell in the middle', () => {
    expect(g.cellsIn(0)).toBe(1)
    expect(g.ringAt(0)).toBe(0)
    expect(g.indexOf(0)).toBe(0)
  })

  it('never shrinks a ring, and only ever multiplies it', () => {
    for (let r = 1; r <= 8; r++) {
      const inner = g.cellsIn(r - 1)
      const here = g.cellsIn(r)
      expect(here).toBeGreaterThanOrEqual(inner)
      expect(here % inner).toBe(0)
    }
  })

  it('keeps cells roughly square all the way out', () => {
    // The reason a ring subdivides at all: a fixed count gives slivers in the
    // middle and rooms at the rim.
    for (let r = 1; r <= 8; r++) {
      const mid = (r + 0.5) * 9
      const arc = (2 * Math.PI * mid) / g.cellsIn(r)
      expect(arc).toBeGreaterThan(9 * 0.55)
      expect(arc).toBeLessThan(9 * 2.1)
    }
  })

  it('refuses a grid too small to be a maze', () => {
    expect(() => new PolarGrid(1, 9)).toThrow(/too small/)
  })
})

describe('PolarGrid topology', () => {
  it('has a symmetric neighbour relation', () => {
    for (let c = 0; c < g.cellCount; c++) {
      for (const d of facesOf(g, c)) {
        const nb = g.neighbourAcross(c, d)
        // Whatever face looks back, it must be this cell on the other side.
        const back = facesOf(g, nb).filter((e) => g.neighbourAcross(nb, e) === c)
        expect(back.length).toBeGreaterThan(0)
      }
    }
  })

  it('counts each adjacency exactly once', () => {
    const seen = new Set<string>()
    for (let e = 0; e < g.edgeCount; e++) {
      const [a, b] = g.endpoints(e)
      expect(a).not.toBe(b)
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('agrees with edgesOf about which cells an edge joins', () => {
    for (let c = 0; c < g.cellCount; c++) {
      for (const e of g.edgesOf(c)) {
        const [a, b] = g.endpoints(e)
        expect(a === c || b === c).toBe(true)
        expect(g.other(e, c)).toBe(a === c ? b : a)
      }
    }
  })

  it('joins the middle to every cell of the first ring', () => {
    const first = new Set<CellId>()
    for (const e of g.edgesOf(0)) first.add(g.other(e, 0))
    expect(first.size).toBe(g.cellsIn(1))
  })

  it('gives every cell a way inward except the middle', () => {
    for (let c = 1; c < g.cellCount; c++) {
      expect(g.neighbourAcross(c, IN)).not.toBe(-1)
    }
    expect(g.neighbourAcross(0, IN)).toBe(-1)
  })

  it('wraps each ring round on itself', () => {
    for (let r = 1; r <= 8; r++) {
      const n = g.cellsIn(r)
      const first = g.cellCount - 1
      void first
      // Walking clockwise n times from any cell comes back to it.
      let c: CellId = -1
      for (let i = 0; i < g.cellCount; i++) if (g.ringAt(i) === r) { c = i; break }
      let at = c
      for (let step = 0; step < n; step++) at = g.neighbourAcross(at, CW)
      expect(at).toBe(c)
    }
  })

  it('leaves only the outermost ring on the boundary', () => {
    for (let c = 0; c < g.cellCount; c++) {
      const open = g.faces - facesOf(g, c).length
      if (g.ringAt(c) < 8) {
        // Inner cells may have unused face slots, but no outward face missing.
        expect(g.neighbourAcross(c, OUT)).not.toBe(-1)
      }
      void open
    }
  })
})

describe('PolarGrid geometry', () => {
  it('puts every cell centre inside its own ring', () => {
    const mid = g.width / 2
    for (let c = 0; c < g.cellCount; c++) {
      const p = g.cellCenter(c)
      const r = Math.hypot(p.x - mid, p.y - mid)
      const ring = g.ringAt(c)
      expect(r).toBeGreaterThanOrEqual(ring * 9 - 1e-9)
      expect(r).toBeLessThanOrEqual((ring + 1) * 9 + 1e-9)
    }
  })

  it('makes two cells name the same two vertices for the wall between them', () => {
    // Without a shared lattice the walls will not chain into polylines, and a
    // jittered style tears them apart at every junction.
    for (let e = 0; e < g.edgeCount; e++) {
      const [a, b] = g.endpoints(e)
      const mine = [...g.wallSegment(e)].sort((x, y) => x - y)
      const back = facesOf(g, b).find((d) => g.neighbourAcross(b, d) === a) as number
      const theirs = [...g.faceSegment(b, back)].sort((x, y) => x - y)
      expect(mine).toEqual(theirs)
    }
  })

  it('points each face normal at the neighbour across it', () => {
    for (let c = 0; c < g.cellCount; c++) {
      const a = g.cellCenter(c)
      for (const d of facesOf(g, c)) {
        const b = g.cellCenter(g.neighbourAcross(c, d))
        const n = g.faceNormal(c, d)
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        const dot = ((b.x - a.x) / len) * n.x + ((b.y - a.y) / len) * n.y
        // Not exact — a chord's normal and the line between two centres differ
        // by a little — but it must point the same way, not the other.
        expect(dot).toBeGreaterThan(0.7)
      }
    }
  })

  it('keeps every vertex inside the stated bounding box', () => {
    for (let v = 0; v < g.vertexCount; v++) {
      const p = g.vertexPos(v)
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(g.width + 1e-9)
      expect(p.y).toBeLessThanOrEqual(g.height + 1e-9)
    }
  })

  it('finds the cell under a point', () => {
    for (let c = 0; c < g.cellCount; c++) {
      expect(g.cellAtPoint(g.cellCenter(c))).toBe(c)
    }
  })

  it('reports nothing outside the disc', () => {
    const mid = g.width / 2
    expect(g.cellAtPoint({ x: mid, y: mid - g.width })).toBe(-1)
    expect(g.cellAtPoint({ x: mid + g.width, y: mid })).toBe(-1)
    // Just past the last ring, inside the bounding box but off the maze.
    expect(g.cellAtPoint({ x: mid + 8.9 * 9 + 9.5, y: mid })).toBe(-1)
  })

  it('declines to offer rows', () => {
    expect((g as { rowStructured?: unknown }).rowStructured).toBeUndefined()
  })
})

describe('passageGap on a polar grid', () => {
  /** The closest two passage segments that share no cell actually come. */
  function measure(grid: PolarGrid): number {
    const segs: { a: Point2; b: Point2; cells: [number, number] }[] = []
    for (let e = 0; e < grid.edgeCount; e++) {
      const [a, b] = grid.endpoints(e)
      segs.push({ a: grid.cellCenter(a), b: grid.cellCenter(b), cells: [a, b] })
    }
    let best = Infinity
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i] as (typeof segs)[number]
        const t = segs[j] as (typeof segs)[number]
        if (s.cells.some((c) => t.cells.includes(c))) continue
        best = Math.min(best, near(s.a, t), near(s.b, t), near(t.a, s), near(t.b, s))
      }
    }
    return best
  }

  it('is a bound the real geometry keeps, at every size that fits a page', () => {
    // The Cave style sizes its tunnels from this; claim too much and two
    // passages merge into one, which makes the maze wrong rather than ugly.
    // Twenty rings is already more than fits a sheet at the finest pitch.
    for (const rings of [3, 5, 8, 12, 20]) {
      const grid = new PolarGrid(rings, 9)
      expect(measure(grid)).toBeGreaterThanOrEqual(grid.passageGap - 1e-9)
    }
  })

  it('is nearer than a whole cell, unlike a square grid', () => {
    // The tight spot is a ring where the count doubles: a radial passage
    // running alongside an arc in the finer ring beyond it.
    const grid = new PolarGrid(12, 9)
    expect(grid.passageGap).toBeLessThan(grid.pitch)
    expect(measure(grid)).toBeLessThan(grid.pitch)
  })
})

interface Point2 {
  x: number
  y: number
}

function near(p: Point2, s: { a: Point2; b: Point2 }): number {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const len2 = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2))
  return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy))
}

describe('polarGridSize', () => {
  it('fits the disc inside the space it is given', () => {
    for (const pitch of [12, 9, 6, 4]) {
      const rings = polarGridSize(190.5, 254, pitch)
      const grid = new PolarGrid(rings, pitch)
      expect(grid.width).toBeLessThanOrEqual(190.5)
      expect(grid.width).toBeGreaterThan(190.5 - 2 * pitch)
    }
  })
})

describe('a polar maze', () => {
  const base = new PolarGrid(10, 9)
  const grid = new MaskedGrid(base, rectangleMask)
  const [start, end] = grid.farthestBoundaryPair()
  const maze = carveAtLevel(grid, makeRng('polar'), 3, start, end)

  it('carves with no change to any carver', () => {
    const route = solve(maze)
    expect(route).not.toBeNull()
    expect((route as CellId[]).length).toBeGreaterThan(10)
  })

  it('reaches every cell', () => {
    const seen = new Uint8Array(grid.cellCount)
    const stack = [start]
    seen[start] = 1
    let n = 1
    while (stack.length > 0) {
      const cur = stack.pop() as CellId
      for (const e of grid.edgesOf(cur)) {
        if (maze.open[e] === 0) continue
        const nb = grid.other(e, cur)
        if (seen[nb] === 1) continue
        seen[nb] = 1
        n++
        stack.push(nb)
      }
    }
    expect(n).toBe(grid.cellCount)
  })

  it('opens onto the rim, never into the middle', () => {
    // Only the outermost ring has a face with nothing across it, so both
    // openings land on the rim where a marker can be drawn outside them.
    for (const c of grid.boundaryCells()) {
      expect(grid.openingNormal(c)).not.toBeNull()
    }
    expect(grid.boundaryCells().length).toBe(base.cellsIn(10))
  })

  it('chains its walls into far fewer polylines than segments', () => {
    const segments = grid.boundarySegments([start, end])
    for (let e = 0; e < grid.edgeCount; e++) {
      if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
    }
    const chained = chainSegments(segments, grid.vertexCount)
    expect(chained.length).toBeLessThan(segments.length / 2)
    const total = chained.reduce((n, poly) => n + poly.length - 1, 0)
    expect(total).toBe(segments.length)
  })

  it('falls back off sidewinder, which needs rows it does not have', () => {
    expect(grid.rowStructured()).toBeNull()
    expect(solve(carveAtLevel(grid, makeRng('gentle'), 1, start, end))).not.toBeNull()
  })
})
