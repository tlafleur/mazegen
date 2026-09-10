import { SquareGrid } from './core/grid/square'
import { HexGrid, hexGridSize } from './core/grid/hex'
import { PolarGrid, polarGridSize } from './core/grid/polar'
import { MaskedGrid } from './core/grid/masked'
import { shapeLibrary, type Shape } from './core/grid/mask'
import { carveAtLevel, type CarverName, type Extras, type Level } from './core/difficulty'
import { measure, type MazeMetrics } from './core/metrics'
import { makeRng } from './core/rng'
import { solve } from './core/analyze'
import type { CellId, Maze } from './core/types'
import {
  DEFAULT_MARGIN,
  HEXAGONS,
  RINGS,
  gridSizeFor,
  type CellKind,
  type Paper,
  type Pen,
} from './render/page'
import type { BaseGrid } from './core/grid/planar'

export interface MazeSettings {
  readonly paper: Paper
  readonly pen: Pen
  readonly level: Level
  readonly shape: Shape
  readonly seed: string
  /** Squares by default; the rest of the pipeline does not care which. */
  readonly cells?: CellKind
  /**
   * Run the maze between the two ends of its longest corridor.
   *
   * Off, the entrance and exit are a property of the outline and stay put
   * however the maze is carved — worth more at the easy end, where a child
   * comes back to the same page. On, they move to wherever the carving left
   * the longest route, which measures a quarter to two thirds longer.
   */
  readonly farEnds?: boolean
  /** Open every dead end. See `Extras.loops` — not simply harder. */
  readonly loops?: boolean
  /** Put false gaps in the outline as well as the real two. */
  readonly decoys?: boolean
  /** Override the level's carver. Undefined leaves the recipe alone. */
  readonly carver?: CarverName | undefined
}

/**
 * False gaps to cut, when asked for.
 *
 * Four is enough that scanning the border stops being a shortcut and few
 * enough that every one of them still clears the markers and its neighbours on
 * the shortest perimeter the app can produce.
 */
const DECOY_COUNT = 4

export interface GeneratedMaze {
  readonly grid: MaskedGrid
  readonly maze: Maze
  readonly solution: CellId[]
  readonly metrics: MazeMetrics
  /** Boundary cells to cut a false gap at; empty unless asked for. */
  readonly decoys: readonly CellId[]
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
  if (cells?.id === RINGS.id) {
    // A disc, so the shorter side of the sheet is what it can fill.
    return new PolarGrid(polarGridSize(live.width, live.height, pen.pitch), pen.pitch)
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
 * stay put however the maze is carved — unless `farEnds` asks for the opposite,
 * which is the one setting that lets the carving decide where the maze begins.
 */
export function generateMaze(settings: MazeSettings): GeneratedMaze {
  const { paper, pen, level, shape, seed, cells } = settings

  const grid = new MaskedGrid(baseGridFor(paper, pen, cells), shape.mask)

  const extras: Extras = { loops: settings.loops === true, carver: settings.carver }
  const [start, end] = grid.farthestBoundaryPair()
  const carved = carveAtLevel(grid, makeRng(seed), level, start, end, extras)

  // Re-choosing the ends is a separate step from carving on purpose: it needs
  // to know where cells sit on the page, in order to put the entrance at the
  // top, and a carver is not allowed to know that. See §3.
  const maze =
    settings.farEnds === true
      ? { ...carved, ...pairOf(grid.farthestOpenPair(carved)) }
      : carved

  // Its own stream, so that turning any other option on or off does not move
  // the decoys: they are chosen from the finished maze, not carved into it.
  const decoys =
    settings.decoys === true ? grid.decoyExits(maze, makeRng(`${seed}:decoy`), DECOY_COUNT) : []

  const solution = solve(maze)
  // Every carver spans the graph and neither braiding nor capping ever closes a
  // wall, so this cannot happen — and printing an unsolvable maze would be the
  // worst failure this app has.
  if (solution === null) throw new Error('carved maze has no solution')

  return { grid, maze, solution, metrics: measure(maze, solution), decoys }
}

function pairOf([start, end]: readonly [CellId, CellId]): { start: CellId; end: CellId } {
  return { start, end }
}
