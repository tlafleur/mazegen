import { SquareGrid } from './core/grid/square'
import { HexGrid, hexGridSize } from './core/grid/hex'
import { MaskedGrid } from './core/grid/masked'
import { shapeLibrary, type Shape } from './core/grid/mask'
import { carveAtLevel, type Level } from './core/difficulty'
import { measure, type MazeMetrics } from './core/metrics'
import { makeRng } from './core/rng'
import { solve } from './core/analyze'
import type { CellId, Maze } from './core/types'
import { DEFAULT_MARGIN, HEXAGONS, gridSizeFor, type CellKind, type Paper, type Pen } from './render/page'
import type { BaseGrid } from './core/grid/planar'

export interface MazeSettings {
  readonly paper: Paper
  readonly pen: Pen
  readonly level: Level
  readonly shape: Shape
  readonly seed: string
  /** Squares by default; the rest of the pipeline does not care which. */
  readonly cells?: CellKind
}

export interface GeneratedMaze {
  readonly grid: MaskedGrid
  readonly maze: Maze
  readonly solution: CellId[]
  readonly metrics: MazeMetrics
}

/**
 * The largest grid of the given kind that fits the printable area.
 *
 * Hexagons need their own arithmetic — offset rows are three quarters of a cell
 * apart, not a whole one — but the answer is in the same units, so nothing
 * downstream has to know which it got.
 */
export function baseGridFor(paper: Paper, pen: Pen, cells?: CellKind): BaseGrid {
  const live = { width: paper.width - 2 * DEFAULT_MARGIN, height: paper.height - 2 * DEFAULT_MARGIN }
  if (cells?.id === HEXAGONS.id) {
    const { cols, rows } = hexGridSize(live.width, live.height, pen.pitch)
    return new HexGrid(cols, rows, pen.pitch)
  }
  const { cols, rows } = gridSizeFor(paper, pen.pitch)
  return new SquareGrid(cols, rows, pen.pitch)
}

/** The shapes available on a given sheet, sized to its proportions. */
export function shapesFor(paper: Paper, pen: Pen, cells?: CellKind): readonly Shape[] {
  const grid = baseGridFor(paper, pen, cells)
  return shapeLibrary(grid.height / grid.width)
}

/**
 * Build a maze from settings and a seed.
 *
 * Pure in its inputs: the same settings and seed always give the same maze,
 * which is what makes one reprintable, shareable as a short code, and testable
 * against golden files. See docs/DESIGN.md §3.
 *
 * The order matters. Masking happens before carving, so the carver sees a
 * smaller graph rather than a rectangle with holes; and the entrance and exit
 * are chosen from the shape's own geometry before any wall is opened, so they
 * stay put however the maze is carved.
 */
export function generateMaze(settings: MazeSettings): GeneratedMaze {
  const { paper, pen, level, shape, seed, cells } = settings

  const grid = new MaskedGrid(baseGridFor(paper, pen, cells), shape.mask)

  const [start, end] = grid.farthestBoundaryPair()
  const maze = carveAtLevel(grid, makeRng(seed), level, start, end)

  const solution = solve(maze)
  // Every carver spans the graph and neither braiding nor capping ever closes a
  // wall, so this cannot happen — and printing an unsolvable maze would be the
  // worst failure this app has.
  if (solution === null) throw new Error('carved maze has no solution')

  return { grid, maze, solution, metrics: measure(maze, solution) }
}
