import { SquareGrid, carveBacktracker, makeRng, solve } from './core'
import type { CellId, Maze } from './core/types'
import { gridSizeFor, type Paper, type Pen } from './render/page'

export interface GeneratedMaze {
  readonly grid: SquareGrid
  readonly maze: Maze
  readonly solution: CellId[]
}

/**
 * Build a maze sized to a sheet of paper.
 *
 * Pure in (paper, pen, seed): the same three values always give the same maze,
 * which is what makes a maze reprintable, shareable as a short code, and
 * testable against golden files. See docs/DESIGN.md §3.
 */
export function generateMaze(paper: Paper, pen: Pen, seed: string): GeneratedMaze {
  const { cols, rows } = gridSizeFor(paper, pen.pitch)
  const grid = new SquareGrid(cols, rows, pen.pitch)
  const open = carveBacktracker(grid, makeRng(seed))
  const maze: Maze = { topo: grid, open, start: 0, end: grid.cellCount - 1 }
  const solution = solve(maze)
  // A spanning tree connects every cell, so this cannot happen; if it ever
  // does, the carver is broken and silently printing an unsolvable maze would
  // be the worst possible failure.
  if (solution === null) throw new Error('carved maze has no solution')
  return { grid, maze, solution }
}
