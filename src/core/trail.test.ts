import { describe, expect, it } from 'vitest'
import { REACH, edgeBetween, follow, startTrail, step, type Trail } from './trail'
import { SquareGrid } from './grid/square'
import { MaskedGrid } from './grid/masked'
import { rectangleMask } from './grid/mask'
import { carveAtLevel } from './difficulty'
import { makeRng } from './rng'
import { solve } from './analyze'
import type { CellId, Maze } from './types'

function build(cols = 8, rows = 8, seed = 'trail') {
  const grid = new MaskedGrid(new SquareGrid(cols, rows, 10), rectangleMask)
  const [start, end] = grid.farthestBoundaryPair()
  const maze = carveAtLevel(grid, makeRng(seed), 5, start, end)
  return { grid, maze, start, end }
}

/** Walk the trail along the real solution, one cell at a time. */
function walk(maze: Maze, route: readonly CellId[]): Trail {
  let t = startTrail(maze)
  for (const c of route) t = step(t, maze, c)
  return t
}

describe('step', () => {
  const { maze, grid, start } = build()

  it('starts at the entrance', () => {
    expect(startTrail(maze).cells).toEqual([start])
    expect(startTrail(maze).done).toBe(false)
  })

  it('takes a move through an open passage', () => {
    const open = maze.topo.edgesOf(start).find((e) => maze.open[e] === 1) as number
    const next = maze.topo.other(open, start)
    expect(step(startTrail(maze), maze, next).cells).toEqual([start, next])
  })

  it('ignores a move through a wall', () => {
    // Every level except the easiest leaves walls; find one off the start.
    const walled = maze.topo.edgesOf(start).find((e) => maze.open[e] === 0)
    if (walled === undefined) return
    const blocked = maze.topo.other(walled, start)
    expect(step(startTrail(maze), maze, blocked).cells).toEqual([start])
  })

  it('ignores a jump to a cell that is not adjacent', () => {
    const far = (start + 20) % grid.cellCount
    expect(edgeBetween(maze, start, far)).toBe(-1)
    expect(step(startTrail(maze), maze, far).cells).toEqual([start])
  })

  it('retraces when the finger comes back over the previous cell', () => {
    const route = solve(maze) as CellId[]
    const t = walk(maze, route.slice(0, 4))
    expect(t.cells.length).toBeGreaterThan(2)
    const back = step(t, maze, t.cells[t.cells.length - 2] as CellId)
    expect(back.cells).toEqual(t.cells.slice(0, -1))
  })

  it('retraces several cells at once', () => {
    const route = solve(maze) as CellId[]
    const t = walk(maze, route.slice(0, 6))
    const back = step(t, maze, t.cells[1] as CellId)
    expect(back.cells).toEqual(t.cells.slice(0, 2))
  })

  it('never leaves a loop in the trail', () => {
    // Walking a route, retracing into it, and walking it again must still
    // leave each cell in the trail at most once.
    const route = solve(maze) as CellId[]
    let t = startTrail(maze)
    for (const c of [...route.slice(0, 6), ...route.slice(0, 3), ...route.slice(0, 6)]) {
      t = step(t, maze, c)
    }
    expect(new Set(t.cells).size).toBe(t.cells.length)
  })

  it('finishes at the exit and then holds still', () => {
    const route = solve(maze) as CellId[]
    const t = walk(maze, route)
    expect(t.done).toBe(true)
    expect(t.cells[t.cells.length - 1]).toBe(maze.end)

    // A finger still moving after the win does not unwind it.
    const after = step(t, maze, t.cells[0] as CellId)
    expect(after).toBe(t)
  })

  it('is not done partway, even at a cell next to the exit', () => {
    const route = solve(maze) as CellId[]
    expect(walk(maze, route.slice(0, -1)).done).toBe(false)
  })
})

describe('follow', () => {
  const { maze, grid } = build()
  const at = (cell: CellId) => grid.cellCenter(cell)

  it('advances across cells a fast drag skipped', () => {
    const route = solve(maze) as CellId[]
    // A drag straight from the entrance to the fourth cell of the route only
    // reports its endpoint; without sampling, nothing would move.
    const straight = route.slice(0, 3)
    let t = startTrail(maze)
    let from = at(maze.start)
    for (const c of straight) {
      t = follow(t, maze, grid, from, at(c))
      from = at(c)
    }
    expect(t.cells.length).toBeGreaterThan(1)
  })

  it('stops at the wall rather than jumping through it', () => {
    // Drag from the entrance to the far corner in one move. Whatever it
    // reaches, every consecutive pair must share an open passage.
    const corner = grid.cellCount - 1
    const t = follow(startTrail(maze), maze, grid, at(maze.start), at(corner))
    for (let i = 1; i < t.cells.length; i++) {
      const e = edgeBetween(maze, t.cells[i - 1] as CellId, t.cells[i] as CellId)
      expect(e).not.toBe(-1)
      expect(maze.open[e]).toBe(1)
    }
    expect(t.cells[t.cells.length - 1]).not.toBe(corner)
  })

  it('ignores a finger dragged off the sheet', () => {
    const t = follow(startTrail(maze), maze, grid, at(maze.start), { x: -500, y: -500 })
    expect(t.cells).toEqual([maze.start])
  })

  it('traces the whole solution when dragged along it', () => {
    const route = solve(maze) as CellId[]
    let t = startTrail(maze)
    let from = at(maze.start)
    for (const c of route) {
      const p = at(c)
      t = follow(t, maze, grid, from, p)
      from = p
    }
    expect(t.done).toBe(true)
  })

  it('follows a finger that cuts the corners', () => {
    // The complaint this exists for. A pointer rounding a turn leaves the
    // corridor and its next sample lands in the cell *after* the corner, which
    // is diagonal from the head. Simulated by dragging between every other cell
    // of the route, so every corner is cut.
    const route = solve(maze) as CellId[]
    const sloppy = route.filter((_, i) => i % 2 === 0)
    if (sloppy[sloppy.length - 1] !== maze.end) sloppy.push(maze.end)

    const drag = (reach: number): Trail => {
      let t = startTrail(maze)
      let from = at(maze.start)
      for (const c of sloppy) {
        const p = at(c)
        t = follow(t, maze, grid, from, p, reach)
        from = p
      }
      return t
    }

    // One cell at a time cannot follow it; three can.
    expect(drag(1).done).toBe(false)
    expect(drag(REACH).done).toBe(true)
  })

  it('still refuses to cross a wall, however forgiving it is', () => {
    // Forgiveness is a longer legal path, never a shorter illegal one: every
    // consecutive pair must still share an open passage.
    const corner = grid.cellCount - 1
    const t = follow(startTrail(maze), maze, grid, at(maze.start), at(corner), 5)
    for (let i = 1; i < t.cells.length; i++) {
      const e = edgeBetween(maze, t.cells[i - 1] as CellId, t.cells[i] as CellId)
      expect(e).not.toBe(-1)
      expect(maze.open[e]).toBe(1)
    }
    expect(new Set(t.cells).size).toBe(t.cells.length)
  })

  it('works on a shape, where a point can be outside the maze', () => {
    const grid2 = new MaskedGrid(new SquareGrid(16, 16, 10), (x, y) => x * x + y * y <= 1)
    const [s, e] = grid2.farthestBoundaryPair()
    const maze2 = carveAtLevel(grid2, makeRng('circle'), 5, s, e)
    // The top-left corner of the bounding box is outside the circle.
    expect(grid2.cellAtPoint({ x: 1, y: 1 })).toBe(-1)
    const t = follow(startTrail(maze2), maze2, grid2, grid2.cellCenter(s), { x: 1, y: 1 })
    expect(t.cells).toEqual([s])
  })
})

describe('cellAtPoint', () => {
  const grid = new MaskedGrid(new SquareGrid(6, 6, 10), rectangleMask)

  it('is the inverse of cellCenter', () => {
    for (let c = 0; c < grid.cellCount; c++) {
      expect(grid.cellAtPoint(grid.cellCenter(c))).toBe(c)
    }
  })

  it('reports nothing outside the grid', () => {
    expect(grid.cellAtPoint({ x: -1, y: 5 })).toBe(-1)
    expect(grid.cellAtPoint({ x: 5, y: -1 })).toBe(-1)
    expect(grid.cellAtPoint({ x: 60.1, y: 5 })).toBe(-1)
    expect(grid.cellAtPoint({ x: 5, y: 60.1 })).toBe(-1)
  })

  it('puts a point on a wall in exactly one cell', () => {
    // Corners are shared by four cells; the rule has to be consistent or a
    // finger on a boundary would flicker between them.
    expect(grid.cellAtPoint({ x: 10, y: 10 })).toBe(grid.cellAtPoint({ x: 10.01, y: 10.01 }))
  })
})
