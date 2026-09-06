import type { PlanarGrid, Point } from './grid/planar'
import type { CellId, EdgeId, Maze } from './types'

/**
 * The route a finger has traced so far.
 *
 * Always a legal walk from the entrance: consecutive cells are adjacent and the
 * wall between them is open. Nothing enforces that afterwards — `step` is the
 * only way to extend one, and it refuses anything else.
 */
export interface Trail {
  readonly cells: readonly CellId[]
  /** True once the trail has reached the exit. */
  readonly done: boolean
}

export function startTrail(maze: Maze): Trail {
  return { cells: [maze.start], done: false }
}

/** The edge joining two cells, or -1 when they are not adjacent. */
export function edgeBetween(maze: Maze, a: CellId, b: CellId): EdgeId {
  for (const e of maze.topo.edgesOf(a)) {
    if (maze.topo.other(e, a) === b) return e
  }
  return -1
}

/**
 * Extend a trail by one cell, if that move is legal.
 *
 * Illegal moves are ignored rather than rejected, which is the whole design:
 * a child dragging a finger across a wall sees the line simply stop, with no
 * error to dismiss and nothing to undo. Getting stuck is not possible, because
 * the trail is never in a state you cannot back out of.
 */
export function step(trail: Trail, maze: Maze, to: CellId): Trail {
  if (trail.done) return trail

  const { cells } = trail
  const head = cells[cells.length - 1] as CellId
  if (to === head) return trail

  // Somewhere behind us: retrace to it. One rule covers backing out of a dead
  // end a step at a time and a finger dragged back across several cells at
  // once, and it keeps the trail free of loops without a special case.
  const seen = cells.lastIndexOf(to)
  if (seen !== -1) return { cells: cells.slice(0, seen + 1), done: false }

  const e = edgeBetween(maze, head, to)
  if (e === -1 || maze.open[e] === 0) return trail

  return { cells: [...cells, to], done: to === maze.end }
}

/**
 * Extend a trail along a straight drag from one point to another.
 *
 * The sampling is not an optimisation: pointer events arrive far apart when a
 * finger moves quickly, and at fine cell sizes a single move can cross several
 * cells. Taking only the endpoint would let a fast swipe jump the trail
 * straight through a wall.
 *
 * Points are in grid coordinates — millimetres from the maze's top-left corner,
 * not from the corner of the page.
 */
export function follow(
  trail: Trail,
  maze: Maze,
  grid: PlanarGrid,
  from: Point,
  to: Point,
): Trail {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (grid.pitch / 3)))

  let out = trail
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const cell = grid.cellAtPoint({ x: from.x + dx * t, y: from.y + dy * t })
    if (cell !== -1) out = step(out, maze, cell)
  }
  return out
}
