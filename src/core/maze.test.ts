import { describe, expect, it } from 'vitest'
import { SquareGrid } from './grid/square'
import { carveBacktracker } from './carve/backtracker'
import { reachableCount, solve } from './analyze'
import { makeRng } from './rng'
import type { Maze } from './types'

function build(cols: number, rows: number, seed: string): { grid: SquareGrid; maze: Maze } {
  const grid = new SquareGrid(cols, rows, 10)
  const open = carveBacktracker(grid, makeRng(seed))
  return { grid, maze: { topo: grid, open, start: 0, end: grid.cellCount - 1 } }
}

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [15, 21],
  [21, 28],
  [31, 42],
  [47, 63],
]

describe('SquareGrid', () => {
  it('counts cells, edges and vertices consistently', () => {
    const g = new SquareGrid(15, 21, 12)
    expect(g.cellCount).toBe(315)
    // (cols-1)*rows horizontal + cols*(rows-1) vertical
    expect(g.edgeCount).toBe(14 * 21 + 15 * 20)
    expect(g.vertexCount).toBe(16 * 22)
    expect(g.width).toBe(180)
    expect(g.height).toBe(252)
  })

  it('rejects degenerate grids', () => {
    expect(() => new SquareGrid(1, 10, 10)).toThrow()
    expect(() => new SquareGrid(10, 1, 10)).toThrow()
  })

  it('agrees with itself about adjacency', () => {
    const g = new SquareGrid(9, 7, 10)
    for (let e = 0; e < g.edgeCount; e++) {
      const [a, b] = g.endpoints(e)
      expect(g.other(e, a)).toBe(b)
      expect(g.other(e, b)).toBe(a)
      expect(g.edgesOf(a)).toContain(e)
      expect(g.edgesOf(b)).toContain(e)
    }
  })

  it('gives every cell the expected number of edges', () => {
    const g = new SquareGrid(9, 7, 10)
    let total = 0
    for (let c = 0; c < g.cellCount; c++) {
      const col = g.colOf(c)
      const row = g.rowOf(c)
      const expected =
        (col > 0 ? 1 : 0) +
        (col < g.cols - 1 ? 1 : 0) +
        (row > 0 ? 1 : 0) +
        (row < g.rows - 1 ? 1 : 0)
      expect(g.edgesOf(c)).toHaveLength(expected)
      total += expected
    }
    // Every edge counted from both ends.
    expect(total).toBe(g.edgeCount * 2)
  })

  it('exposes every face of a cell', () => {
    const g = new SquareGrid(15, 21, 12)
    const topLeft = g.cellAt(0, 0)
    // North and west are the edge of the grid; east and south are not.
    expect(g.neighbourAcross(topLeft, 0)).toBe(-1)
    expect(g.neighbourAcross(topLeft, 3)).toBe(-1)
    expect(g.neighbourAcross(topLeft, 1)).toBe(g.cellAt(1, 0))
    expect(g.neighbourAcross(topLeft, 2)).toBe(g.cellAt(0, 1))
  })
})

describe('carveBacktracker', () => {
  it.each(SIZES)('produces a spanning tree at %ix%i', (cols, rows) => {
    const { grid, maze } = build(cols, rows, `tree-${cols}x${rows}`)
    const openCount = maze.open.reduce((n, v) => n + v, 0)
    // Connected with exactly cellCount-1 edges is precisely a tree, so this
    // pair of assertions rules out both isolated cells and loops.
    expect(openCount).toBe(grid.cellCount - 1)
    expect(reachableCount(maze)).toBe(grid.cellCount)
  })

  it('is deterministic for a given seed', () => {
    const a = build(21, 28, 'same')
    const b = build(21, 28, 'same')
    expect(Array.from(a.maze.open)).toEqual(Array.from(b.maze.open))
  })

  it('gives different mazes for different seeds', () => {
    const a = build(21, 28, 'one')
    const b = build(21, 28, 'two')
    expect(Array.from(a.maze.open)).not.toEqual(Array.from(b.maze.open))
  })
})

describe('solve', () => {
  it.each(SIZES)('returns a walkable route at %ix%i', (cols, rows) => {
    const { grid, maze } = build(cols, rows, `solve-${cols}x${rows}`)
    const path = solve(maze)
    expect(path).not.toBeNull()
    const cells = path as number[]

    expect(cells[0]).toBe(maze.start)
    expect(cells[cells.length - 1]).toBe(maze.end)

    // Every step crosses an edge that is actually open.
    for (let i = 1; i < cells.length; i++) {
      const from = cells[i - 1] as number
      const to = cells[i] as number
      const walkable = grid
        .edgesOf(from)
        .some((e) => maze.open[e] === 1 && grid.other(e, from) === to)
      expect(walkable).toBe(true)
    }

    // No cell visited twice.
    expect(new Set(cells).size).toBe(cells.length)
  })

  it('returns null when the end is walled off', () => {
    const grid = new SquareGrid(5, 5, 10)
    const maze: Maze = {
      topo: grid,
      open: new Uint8Array(grid.edgeCount),
      start: 0,
      end: grid.cellCount - 1,
    }
    expect(solve(maze)).toBeNull()
  })
})

describe('makeRng', () => {
  it('repeats for the same seed and diverges for different ones', () => {
    const draw = (seed: string) => Array.from({ length: 8 }, () => makeRng(seed).int(1000))
    expect(makeRng('x').next()).toBe(makeRng('x').next())
    expect(draw('x')).not.toEqual(draw('y'))
  })

  it('stays inside range', () => {
    const rng = makeRng('range')
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('shuffles without losing or duplicating items', () => {
    const items = Array.from({ length: 200 }, (_, i) => i)
    const shuffled = makeRng('shuffle').shuffle([...items])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
    expect(shuffled).not.toEqual(items)
  })
})
