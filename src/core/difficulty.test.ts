import { describe, expect, it } from 'vitest'
import { SquareGrid } from './grid/square'
import { carveBacktracker } from './carve/backtracker'
import { carveKruskal } from './carve/kruskal'
import { carveWilson } from './carve/wilson'
import { carveSidewinder } from './carve/sidewinder'
import { braid, capDeadEndRun } from './braid'
import { measure, openDegree } from './metrics'
import { reachableCount, solve } from './analyze'
import { makeRng } from './rng'
import { LEVELS, carveAtLevel, recipeFor, type Level } from './difficulty'
import { A4, LETTER, PENS, gridSizeFor } from '../render/page'
import type { Maze } from './types'

function mazeOf(open: Uint8Array, grid: SquareGrid): Maze {
  return { topo: grid, open, start: 0, end: grid.cellCount - 1 }
}

const CARVERS = [
  ['backtracker', (g: SquareGrid, s: string) => carveBacktracker(g, makeRng(s))],
  ['kruskal', (g: SquareGrid, s: string) => carveKruskal(g, makeRng(s))],
  ['wilson', (g: SquareGrid, s: string) => carveWilson(g, makeRng(s))],
  ['sidewinder', (g: SquareGrid, s: string) => carveSidewinder(g, makeRng(s))],
] as const

describe('every carver', () => {
  it.each(CARVERS)('%s produces a spanning tree', (_name, carve) => {
    for (const [cols, rows] of [
      [2, 2],
      [15, 21],
      [31, 42],
    ] as const) {
      const grid = new SquareGrid(cols, rows, 10)
      const maze = mazeOf(carve(grid, `${_name}-${cols}`), grid)
      const openCount = maze.open.reduce((n, v) => n + v, 0)
      expect(openCount).toBe(grid.cellCount - 1)
      expect(reachableCount(maze)).toBe(grid.cellCount)
    }
  })

  it.each(CARVERS)('%s is deterministic', (_name, carve) => {
    const grid = new SquareGrid(21, 28, 9)
    expect(Array.from(carve(grid, 'seed'))).toEqual(Array.from(carve(grid, 'seed')))
  })
})

describe('carver character', () => {
  it('sidewinder leaves the top row as one open corridor', () => {
    const grid = new SquareGrid(21, 28, 9)
    const open = carveSidewinder(grid, makeRng('top'))
    for (let c = 0; c < grid.cols - 1; c++) {
      expect(open[grid.edgeEast(grid.cellAt(c, 0))]).toBe(1)
    }
  })

  it('kruskal leaves more dead ends than the backtracker', () => {
    const grid = new SquareGrid(31, 42, 6)
    const deadEnds = (open: Uint8Array): number => {
      const maze = mazeOf(open, grid)
      return measure(maze, solve(maze) as number[]).deadEnds
    }
    // The backtracker's long corridors mean far fewer branch tips than
    // Kruskal's bushy growth. This is the texture difference difficulty rests
    // on, so it is worth pinning down.
    expect(deadEnds(carveKruskal(grid, makeRng('k')))).toBeGreaterThan(
      deadEnds(carveBacktracker(grid, makeRng('b'))),
    )
  })

  it('scores the backtracker harder than sidewinder', () => {
    const grid = new SquareGrid(21, 28, 9)
    const meanScore = (carve: (s: string) => Uint8Array): number => {
      let total = 0
      for (let i = 0; i < 12; i++) {
        const maze = mazeOf(carve(`run-${i}`), grid)
        total += measure(maze, solve(maze) as number[]).score
      }
      return total / 12
    }
    // The premise of the whole difficulty model: the carver's character shows
    // up in the metrics, not just in how the maze looks.
    expect(meanScore((s) => carveBacktracker(grid, makeRng(s)))).toBeGreaterThan(
      meanScore((s) => carveSidewinder(grid, makeRng(s))),
    )
  })
})

describe('measure', () => {
  it('reports a route with no wrong turns as trivial', () => {
    // A 2x2 with three of four walls open: the route has no branches at all.
    const grid = new SquareGrid(2, 2, 10)
    const maze = mazeOf(carveBacktracker(grid, makeRng('tiny')), grid)
    const m = measure(maze, solve(maze) as number[])
    expect(m.cellCount).toBe(4)
    expect(m.solutionLength).toBeGreaterThanOrEqual(3)
    expect(m.score).toBeGreaterThanOrEqual(0)
  })

  it('counts only turns that leave the route as decision points', () => {
    const grid = new SquareGrid(21, 28, 9)
    const maze = mazeOf(carveBacktracker(grid, makeRng('dp')), grid)
    const solution = solve(maze) as number[]
    const m = measure(maze, solution)
    expect(m.decisionPoints).toBeLessThanOrEqual(solution.length)
    expect(m.decisionPoints).toBeGreaterThan(0)
  })

  it('sees no branches at all when the maze is one corridor', () => {
    // Open a single path along the top row and down the last column, nothing else.
    const grid = new SquareGrid(5, 5, 10)
    const open = new Uint8Array(grid.edgeCount)
    for (let c = 0; c < grid.cols - 1; c++) open[grid.edgeEast(grid.cellAt(c, 0))] = 1
    for (let r = 1; r < grid.rows; r++) open[grid.edgeNorth(grid.cellAt(grid.cols - 1, r))] = 1
    const maze = mazeOf(open, grid)
    const m = measure(maze, solve(maze) as number[])
    expect(m.decisionPoints).toBe(0)
    expect(m.maxBranchDepth).toBe(0)
    expect(m.meanBranchDepth).toBe(0)
    // No wrong turns on offer, so the score is purely the route to be traced.
    expect(m.score).toBeCloseTo(m.solutionLength / m.cellCount)
  })
})

describe('braid', () => {
  it('leaves the maze untouched at ratio 0', () => {
    const grid = new SquareGrid(21, 28, 9)
    const open = carveBacktracker(grid, makeRng('b0'))
    const before = Array.from(open)
    braid(mazeOf(open, grid), makeRng('x'), 0)
    expect(Array.from(open)).toEqual(before)
  })

  it('removes every dead end at ratio 1', () => {
    const grid = new SquareGrid(21, 28, 9)
    const maze = mazeOf(carveBacktracker(grid, makeRng('b1')), grid)
    braid(maze, makeRng('x'), 1)
    let deadEnds = 0
    for (let c = 0; c < grid.cellCount; c++) {
      if (openDegree(maze, c) === 1) deadEnds++
    }
    expect(deadEnds).toBe(0)
  })

  it('keeps the maze solvable and fully connected', () => {
    const grid = new SquareGrid(21, 28, 9)
    const maze = mazeOf(carveBacktracker(grid, makeRng('b2')), grid)
    braid(maze, makeRng('x'), 0.6)
    expect(reachableCount(maze)).toBe(grid.cellCount)
    expect(solve(maze)).not.toBeNull()
  })

  it('adds loops, so it is no longer a perfect maze', () => {
    const grid = new SquareGrid(21, 28, 9)
    const maze = mazeOf(carveBacktracker(grid, makeRng('b3')), grid)
    braid(maze, makeRng('x'), 0.5)
    const openCount = maze.open.reduce((n, v) => n + v, 0)
    expect(openCount).toBeGreaterThan(grid.cellCount - 1)
  })
})

describe('capDeadEndRun', () => {
  it.each([1, 3, 6])('holds every dead-end corridor to %i cells or fewer', (k) => {
    const grid = new SquareGrid(31, 42, 6)
    const maze = mazeOf(carveBacktracker(grid, makeRng(`cap-${k}`)), grid)
    expect(measure(maze, solve(maze) as number[]).maxDeadEndRun).toBeGreaterThan(k)

    capDeadEndRun(maze, makeRng('x'), k)

    const m = measure(maze, solve(maze) as number[])
    expect(m.maxDeadEndRun).toBeLessThanOrEqual(k)
    expect(reachableCount(maze)).toBe(grid.cellCount)
    expect(solve(maze)).not.toBeNull()
  })

  it('is idempotent once the cap is met', () => {
    const grid = new SquareGrid(15, 21, 12)
    const maze = mazeOf(carveBacktracker(grid, makeRng('shallow')), grid)
    capDeadEndRun(maze, makeRng('x'), 3)
    const before = Array.from(maze.open)
    capDeadEndRun(maze, makeRng('y'), 3)
    expect(Array.from(maze.open)).toEqual(before)
  })

  it('bounds retracing without flattening how far a solver can wander', () => {
    const grid = new SquareGrid(31, 42, 6)
    const maze = mazeOf(carveBacktracker(grid, makeRng('wander')), grid)
    capDeadEndRun(maze, makeRng('x'), 3)
    const m = measure(maze, solve(maze) as number[])
    // The two measures are independent by design: corridors are short, but the
    // maze is still open enough to get a long way from the route.
    expect(m.maxDeadEndRun).toBeLessThanOrEqual(3)
    expect(m.maxBranchDepth).toBeGreaterThan(3)
  })
})

describe('level recipes', () => {
  const sizes = [LETTER, A4].flatMap((paper) =>
    PENS.map((pen) => {
      const { cols, rows } = gridSizeFor(paper, pen.pitch)
      return { name: `${paper.id}/${pen.id}`, grid: new SquareGrid(cols, rows, pen.pitch) }
    }),
  )

  const meanScore = (grid: SquareGrid, level: Level, samples = 12): number => {
    let total = 0
    for (let i = 0; i < samples; i++) {
      const maze = carveAtLevel(grid, makeRng(`${grid.cols}-${level}-${i}`), level)
      total += measure(maze, solve(maze) as number[]).score
    }
    return total / samples
  }

  it('has a recipe for every level and rejects anything else', () => {
    for (const level of LEVELS) expect(recipeFor(level).level).toBe(level)
    expect(() => recipeFor(9 as Level)).toThrow()
  })

  it.each(sizes)('leaves $name solvable and fully connected at every level', ({ grid }) => {
    for (const level of LEVELS) {
      const maze = carveAtLevel(grid, makeRng(`conn-${level}`), level)
      expect(reachableCount(maze)).toBe(grid.cellCount)
      expect(solve(maze)).not.toBeNull()
    }
  })

  // The guarantee the whole difficulty model exists to make. Absolute scores
  // are not comparable across cell sizes — sidewinder's route scales with the
  // perimeter and the backtracker's with the area, so no single normalizer fits
  // both — but at any one size the levels must climb.
  //
  // The 2% tolerance is there for the crayon grid specifically. At 315 cells
  // the braid lever saturates: the backtracker scores the same at braid 0.2 and
  // 0.3 because there are too few dead ends to open and too little route to
  // shorten. Levels 3 to 5 genuinely compress on the smallest grid. That is a
  // real limit of the page, not a defect in the recipes, and it is worth
  // knowing rather than hiding behind a bigger sample.
  it.each(sizes)('has levels that climb at $name', ({ grid }) => {
    const scores = LEVELS.map((level) => meanScore(grid, level, 20))
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i] as number).toBeGreaterThan((scores[i - 1] as number) * 0.98)
    }
    // The rungs far enough apart to be felt are separated without tolerance.
    expect(scores[2] as number).toBeGreaterThan(scores[0] as number)
    expect(scores[4] as number).toBeGreaterThan(scores[2] as number)
    // And the ends are far enough apart for the range to mean something.
    expect(scores[4] as number).toBeGreaterThan((scores[0] as number) * 1.5)
  })

  // Pins the compression above so a future change has to acknowledge it.
  it('spans a wider difficulty range on a fine grid than a crayon one', () => {
    const span = (grid: SquareGrid): number =>
      meanScore(grid, 5, 20) / meanScore(grid, 1, 20)
    const crayon = span(new SquareGrid(15, 21, 12))
    const fine = span(new SquareGrid(47, 63, 4))
    expect(fine).toBeGreaterThan(crayon * 1.5)
  })

  it('holds level 1 to short dead ends', () => {
    const grid = new SquareGrid(31, 42, 6)
    for (let i = 0; i < 5; i++) {
      const maze = carveAtLevel(grid, makeRng(`l1-${i}`), 1)
      expect(measure(maze, solve(maze) as number[]).maxDeadEndRun).toBeLessThanOrEqual(3)
    }
  })

  it('is deterministic at every level', () => {
    const grid = new SquareGrid(21, 28, 9)
    for (const level of LEVELS) {
      const a = carveAtLevel(grid, makeRng('same'), level)
      const b = carveAtLevel(grid, makeRng('same'), level)
      expect(Array.from(a.open)).toEqual(Array.from(b.open))
    }
  })
})
