import { describe, expect, it } from 'vitest'
import { WeaveGrid } from './weave'
import { SquareGrid } from './square'
import { MaskedGrid } from './masked'
import { circleMask, rectangleMask } from './mask'
import { EAST, NORTH, SOUTH, WEST, type Point } from './planar'
import { carveAtLevel, LEVELS } from '../difficulty'
import { makeRng } from '../rng'
import { reachableCount, solve } from '../analyze'
import type { CellId } from '../types'

const DIRS = [NORTH, EAST, SOUTH, WEST]
const opposite = (d: number): number => (d + 2) % 4
const COLS = 25
const ROWS = 33
const PITCH = 6
const plain = new SquareGrid(COLS, ROWS, PITCH)
const build = (seed = 'w', density = 0.06): WeaveGrid =>
  new WeaveGrid(COLS, ROWS, PITCH, makeRng(seed), density)

/** The base cell whose centre a crossing sits on. */
const baseCellOf = (p: Point): CellId => plain.cellAtPoint(p)

describe('choosing where the crossings go', () => {
  const g = build()

  it('finds some, but nothing like everywhere', () => {
    expect(g.crossings().length).toBeGreaterThan(20)
    expect(g.crossings().length).toBeLessThan(plain.cellCount / 10)
  })

  it('never puts one on the border, where it would have nothing to join', () => {
    for (const x of g.crossings()) {
      for (const dir of DIRS) expect(plain.neighbourAcross(baseCellOf(x.at), dir)).not.toBe(-1)
    }
  })

  it('never puts two side by side', () => {
    // Each would need the other's place to land on, and the drawing would have
    // nowhere to show either.
    const taken = new Set(g.crossings().map((x) => baseCellOf(x.at)))
    for (const cell of taken) {
      for (const dir of DIRS) {
        const nb = plain.neighbourAcross(cell, dir)
        if (nb !== -1) expect(taken.has(nb)).toBe(false)
      }
    }
  })

  it('is deterministic', () => {
    expect(build('same').crossings()).toEqual(build('same').crossings())
    expect(build('other').crossings()).not.toEqual(build('same').crossings())
  })

  it('makes none at all when asked for none', () => {
    const none = new WeaveGrid(COLS, ROWS, PITCH, makeRng('w'), 0)
    expect(none.crossings()).toHaveLength(0)
    expect(none.cellCount).toBe(plain.cellCount)
    expect(none.edgeCount).toBe(plain.edgeCount)
  })
})

describe('WeaveGrid topology', () => {
  const g = build()
  const k = g.crossings().length

  it('spends a cell on each crossing', () => {
    // The whole design in one number: the place a crossing sits holds no cell,
    // which is what makes the corridor under it carved or not with no third
    // state to draw. See the note on the class.
    expect(g.cellCount).toBe(plain.cellCount - k)
  })

  it('trades a crossings four adjacencies for two that skip over it', () => {
    expect(g.edgeCount).toBe(plain.edgeCount - 2 * k)
  })

  it('joins each pair two apart, with the crossing exactly between them', () => {
    for (const x of g.crossings()) {
      for (const edge of [x.edge, x.under]) {
        const [a, b] = g.endpoints(edge)
        const pa = g.cellCenter(a)
        const pb = g.cellCenter(b)
        expect(Math.hypot(pb.x - pa.x, pb.y - pa.y)).toBeCloseTo(2 * PITCH, 9)
        expect((pa.x + pb.x) / 2).toBeCloseTo(x.at.x, 9)
        expect((pa.y + pb.y) / 2).toBeCloseTo(x.at.y, 9)
      }
      // And the two do not meet: that is what makes it a crossing rather than
      // a crossroads.
      const over = new Set(g.endpoints(x.edge))
      for (const c of g.endpoints(x.under)) expect(over.has(c)).toBe(false)
    }
  })

  it('leaves no cell anywhere a crossing sits', () => {
    for (const x of g.crossings()) expect(g.cellAtPoint(x.at)).toBe(-1)
  })

  it('has a symmetric neighbour relation', () => {
    for (let c = 0; c < g.cellCount; c++) {
      for (const dir of DIRS) {
        const nb = g.neighbourAcross(c, dir)
        if (nb === -1) continue
        expect(g.neighbourAcross(nb, opposite(dir))).toBe(c)
      }
    }
  })

  it('says a face onto a crossing is not a face at all', () => {
    // Otherwise an interior crossing looks exactly like the edge of the maze,
    // which is where `MaskedGrid` cuts the entrance and the exit.
    let hidden = 0
    for (let c = 0; c < g.cellCount; c++) {
      for (const dir of DIRS) {
        if (g.hasFace(c, dir)) continue
        hidden++
        expect(g.neighbourAcross(c, dir)).toBe(-1)
      }
    }
    expect(hidden).toBe(4 * k)
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

  it('declines to offer rows, because a bridge is not in any of them', () => {
    expect((g as { rowStructured?: unknown }).rowStructured).toBeUndefined()
  })
})

describe('a woven maze', () => {
  const base = build('maze')
  const grid = new MaskedGrid(base, rectangleMask)
  const [start, end] = grid.farthestBoundaryPair()

  it('carves with no change to any carver, at every level', () => {
    for (const level of LEVELS) {
      const maze = carveAtLevel(grid, makeRng(`w${level}`), level, start, end)
      expect(reachableCount(maze)).toBe(grid.cellCount)
      expect(solve(maze)).not.toBeNull()
    }
  })

  it('puts bridges on its solutions', () => {
    // If none of them were ever on the route they would be decoration.
    let used = 0
    for (let i = 0; i < 8; i++) {
      const maze = carveAtLevel(grid, makeRng(`route${i}`), 5, start, end)
      const route = solve(maze) as CellId[]
      for (let n = 1; n < route.length; n++) {
        const pa = grid.cellCenter(route[n - 1] as CellId)
        const pb = grid.cellCenter(route[n] as CellId)
        if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > PITCH * 1.5) used++
      }
    }
    expect(used).toBeGreaterThan(0)
  })

  it('keeps every entrance on the real border', () => {
    for (const c of grid.boundaryCells()) {
      const p = grid.cellCenter(c)
      const onBorder =
        p.x < PITCH || p.y < PITCH || p.x > base.width - PITCH || p.y > base.height - PITCH
      expect(onBorder).toBe(true)
    }
  })

  it('takes a shape mask like any other grid', () => {
    const circle = new MaskedGrid(build('circle'), circleMask)
    const [s, e] = circle.farthestBoundaryPair()
    const maze = carveAtLevel(circle, makeRng('c'), 3, s, e)
    expect(reachableCount(maze)).toBe(circle.cellCount)
    expect(solve(maze)).not.toBeNull()
    for (const c of circle.boundaryCells()) expect(circle.openingNormal(c)).not.toBeNull()
  })

  it('drops a crossing the mask cut in half, and keeps the half that survived', () => {
    const circle = new MaskedGrid(build('circle'), circleMask)
    const inner = circle.crossings()
    expect(inner.length).toBeGreaterThan(0)
    expect(inner.length).toBeLessThanOrEqual(build('circle').crossings().length)
    for (const x of inner) expect(x.edge >= 0 || x.under >= 0).toBe(true)
  })
})
