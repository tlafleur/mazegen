import { describe, expect, it } from 'vitest'
import { E, HexGrid, NE, NW, SE, SW, W, hexGridSize } from './hex'
import { MaskedGrid } from './masked'
import { circleMask, rectangleMask } from './mask'
import { carveAtLevel } from '../difficulty'
import { makeRng } from '../rng'
import { solve } from '../analyze'
import { chainSegments } from '../../render/chain'
import type { CellId } from '../types'

const FACES = [NE, E, SE, SW, W, NW]
const opposite = (d: number): number => (d + 3) % 6

describe('HexGrid topology', () => {
  const g = new HexGrid(7, 9, 9)

  it('gives every cell six faces, minus the ones off the grid', () => {
    for (let c = 0; c < g.cellCount; c++) {
      let n = 0
      for (const d of FACES) if (g.neighbourAcross(c, d) !== -1) n++
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBe(g.edgesOf(c).length)
    }
  })

  it('has a symmetric neighbour relation', () => {
    for (let c = 0; c < g.cellCount; c++) {
      for (const d of FACES) {
        const nb = g.neighbourAcross(c, d)
        if (nb === -1) continue
        expect(g.neighbourAcross(nb, opposite(d))).toBe(c)
      }
    }
  })

  it('counts each adjacency exactly once', () => {
    const seen = new Set<string>()
    for (let e = 0; e < g.edgeCount; e++) {
      const [a, b] = g.endpoints(e)
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe(g.edgeCount)
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

  it('declines to offer rows, because a hexagon has two cells above it', () => {
    // Sidewinder's "carve east along a run, then north out of it" has no single
    // answer here, and the type is what says so.
    expect((g as { rowStructured?: unknown }).rowStructured).toBeUndefined()
  })
})

describe('HexGrid geometry', () => {
  const pitch = 9
  const g = new HexGrid(7, 9, pitch)

  it('puts every corner one circumradius from the centre', () => {
    const r = pitch / Math.sqrt(3)
    for (let c = 0; c < g.cellCount; c++) {
      const mid = g.cellCenter(c)
      for (const d of FACES) {
        for (const v of g.faceSegment(c, d)) {
          const p = g.vertexPos(v)
          expect(Math.hypot(p.x - mid.x, p.y - mid.y)).toBeCloseTo(r, 9)
        }
      }
    }
  })

  it('spaces neighbouring centres exactly one pitch apart', () => {
    for (let c = 0; c < g.cellCount; c++) {
      const a = g.cellCenter(c)
      for (const d of FACES) {
        const nb = g.neighbourAcross(c, d)
        if (nb === -1) continue
        const b = g.cellCenter(nb)
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(pitch, 9)
      }
    }
  })

  it('makes two cells name the same two vertices for the wall between them', () => {
    // The whole point of a shared lattice. Without it the walls will not chain
    // into polylines, and a jittered style tears them apart at every corner.
    for (let c = 0; c < g.cellCount; c++) {
      for (const d of FACES) {
        const nb = g.neighbourAcross(c, d)
        if (nb === -1) continue
        const mine = [...g.faceSegment(c, d)].sort((x, y) => x - y)
        const theirs = [...g.faceSegment(nb, opposite(d))].sort((x, y) => x - y)
        expect(mine).toEqual(theirs)
      }
    }
  })

  it('points each face normal at the neighbour across it', () => {
    for (let c = 0; c < g.cellCount; c++) {
      const a = g.cellCenter(c)
      for (const d of FACES) {
        const nb = g.neighbourAcross(c, d)
        if (nb === -1) continue
        const b = g.cellCenter(nb)
        const n = g.faceNormal(d)
        expect((b.x - a.x) / pitch).toBeCloseTo(n.x, 9)
        expect((b.y - a.y) / pitch).toBeCloseTo(n.y, 9)
      }
    }
  })

  it('keeps every vertex inside the stated bounding box', () => {
    let maxX = 0
    let maxY = 0
    for (let c = 0; c < g.cellCount; c++) {
      for (const d of FACES) {
        for (const v of g.faceSegment(c, d)) {
          const p = g.vertexPos(v)
          expect(p.x).toBeGreaterThanOrEqual(-1e-9)
          expect(p.y).toBeGreaterThanOrEqual(-1e-9)
          maxX = Math.max(maxX, p.x)
          maxY = Math.max(maxY, p.y)
        }
      }
    }
    expect(maxX).toBeCloseTo(g.width, 9)
    expect(maxY).toBeCloseTo(g.height, 9)
  })

  it('finds the cell under a point, including near the corners', () => {
    for (let c = 0; c < g.cellCount; c++) {
      const mid = g.cellCenter(c)
      expect(g.cellAtPoint(mid)).toBe(c)
      // Nine tenths of the way to each corner is still unambiguously this cell,
      // and it is where naive per-axis rounding picks the wrong hexagon.
      for (const d of FACES) {
        for (const v of g.faceSegment(c, d)) {
          const p = g.vertexPos(v)
          const near = { x: mid.x + (p.x - mid.x) * 0.9, y: mid.y + (p.y - mid.y) * 0.9 }
          expect(g.cellAtPoint(near)).toBe(c)
        }
      }
    }
  })

  it('reports nothing outside the grid', () => {
    expect(g.cellAtPoint({ x: -5, y: 5 })).toBe(-1)
    expect(g.cellAtPoint({ x: 5, y: -5 })).toBe(-1)
    expect(g.cellAtPoint({ x: g.width + 5, y: 5 })).toBe(-1)
    expect(g.cellAtPoint({ x: 5, y: g.height + 5 })).toBe(-1)
  })

  it('refuses a grid too small to be a maze', () => {
    expect(() => new HexGrid(1, 5, 9)).toThrow(/too small/)
  })
})

describe('hexGridSize', () => {
  it('fits inside the space it is given', () => {
    for (const pitch of [12, 9, 6, 4]) {
      const { cols, rows } = hexGridSize(190.5, 254, pitch)
      const g = new HexGrid(cols, rows, pitch)
      expect(g.width).toBeLessThanOrEqual(190.5)
      expect(g.height).toBeLessThanOrEqual(254)
      // And is not leaving a whole cell of space unused.
      expect(g.width).toBeGreaterThan(190.5 - pitch)
      expect(g.height).toBeGreaterThan(254 - pitch)
    }
  })
})

describe('a hex maze', () => {
  const g = new MaskedGrid(new HexGrid(15, 20, 9), rectangleMask)
  const [start, end] = g.farthestBoundaryPair()
  const maze = carveAtLevel(g, makeRng('hex'), 3, start, end)

  it('carves with no change to any carver', () => {
    const route = solve(maze)
    expect(route).not.toBeNull()
    expect((route as CellId[]).length).toBeGreaterThan(20)
  })

  it('reaches every cell', () => {
    const seen = new Uint8Array(g.cellCount)
    const stack = [start]
    seen[start] = 1
    let n = 1
    while (stack.length > 0) {
      const cur = stack.pop() as CellId
      for (const e of g.edgesOf(cur)) {
        if (maze.open[e] === 0) continue
        const nb = g.other(e, cur)
        if (seen[nb] === 1) continue
        seen[nb] = 1
        n++
        stack.push(nb)
      }
    }
    expect(n).toBe(g.cellCount)
  })

  it('chains its walls into far fewer polylines than segments', () => {
    const segments = g.boundarySegments([start, end])
    for (let e = 0; e < g.edgeCount; e++) {
      if (maze.open[e] === 0) segments.push(g.wallSegment(e))
    }
    const chained = chainSegments(segments, g.vertexCount)
    expect(chained.length).toBeLessThan(segments.length / 2)
    // Every segment survives: chaining joins, it does not drop.
    const total = chained.reduce((n, poly) => n + poly.length - 1, 0)
    expect(total).toBe(segments.length)
  })

  it('takes a shape mask like any other grid', () => {
    const circle = new MaskedGrid(new HexGrid(20, 20, 9), circleMask)
    expect(circle.cellCount).toBeLessThan(400)
    expect(circle.cellCount).toBeGreaterThan(200)
    const [s, e] = circle.farthestBoundaryPair()
    expect(solve(carveAtLevel(circle, makeRng('c'), 3, s, e))).not.toBeNull()
    // An opening on every boundary cell, facing outward.
    for (const c of circle.boundaryCells()) {
      expect(circle.openingNormal(c)).not.toBeNull()
    }
  })

  it('falls back off sidewinder, which needs rows it does not have', () => {
    expect(g.rowStructured()).toBeNull()
    // Level 1 asks for sidewinder; carving must still produce a solvable maze.
    const gentle = carveAtLevel(g, makeRng('gentle'), 1, start, end)
    expect(solve(gentle)).not.toBeNull()
  })
})
