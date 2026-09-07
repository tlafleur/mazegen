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
 * How far ahead of the trail a finger may land and still be followed.
 *
 * One cell is unforgiving in exactly the place it matters. Rounding a corner,
 * a finger cuts across the inside of the turn and its next sample lands in the
 * cell *after* the corner — which is diagonal from the head, so a one-step rule
 * ignores it and the line stalls until you go back and trace the corner
 * squarely. Three cells covers a cut corner and a clipped U-bend.
 *
 * It cannot become a cheat: every cell of the path is walked through open
 * passages, so the trail only ever advances along a route the maze allows.
 */
export const REACH = 3

/**
 * Extend a trail to a cell, if there is a short legal way there.
 *
 * Illegal moves are ignored rather than rejected, which is the whole design:
 * a child dragging a finger across a wall sees the line simply stop, with no
 * error to dismiss and nothing to undo. Getting stuck is not possible, because
 * the trail is never in a state you cannot back out of.
 */
export function step(trail: Trail, maze: Maze, to: CellId, reach = REACH): Trail {
  if (trail.done) return trail

  const { cells } = trail
  const head = cells[cells.length - 1] as CellId
  if (to === head) return trail

  // Somewhere behind us: retrace to it. One rule covers backing out of a dead
  // end a step at a time and a finger dragged back across several cells at
  // once, and it keeps the trail free of loops without a special case.
  const seen = cells.lastIndexOf(to)
  if (seen !== -1) return { cells: cells.slice(0, seen + 1), done: false }

  const path = openPath(maze, head, to, reach, cells)
  if (path === null) return trail

  return { cells: [...cells, ...path], done: to === maze.end }
}

/**
 * The shortest walk from one cell to another through open passages, within a
 * step limit, without revisiting the trail. Excludes the starting cell.
 *
 * Breadth-first and bounded, so it stays a few dozen cells however long the
 * maze is; the whole point is a short hop, not a route finder.
 */
function openPath(
  maze: Maze,
  from: CellId,
  to: CellId,
  limit: number,
  taken: readonly CellId[],
): CellId[] | null {
  if (limit < 1) return null

  const closed = new Set<CellId>(taken)
  const prev = new Map<CellId, CellId>()
  let frontier: CellId[] = [from]

  for (let depth = 0; depth < limit; depth++) {
    const next: CellId[] = []
    for (const cur of frontier) {
      for (const e of maze.topo.edgesOf(cur)) {
        if (maze.open[e] === 0) continue
        const nb = maze.topo.other(e, cur)
        if (closed.has(nb) || prev.has(nb)) continue
        prev.set(nb, cur)
        if (nb === to) {
          const path: CellId[] = []
          for (let at = to; at !== from; at = prev.get(at) as CellId) path.unshift(at)
          return path
        }
        next.push(nb)
      }
    }
    frontier = next
  }
  return null
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
  reach = REACH,
): Trail {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (grid.pitch / 3)))

  let out = trail
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const cell = grid.cellAtPoint({ x: from.x + dx * t, y: from.y + dy * t })
    if (cell !== -1) out = step(out, maze, cell, reach)
  }
  return out
}
