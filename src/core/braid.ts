import type { CellId, EdgeId, Maze } from './types'
import type { Rng } from './rng'
import { deadEndRuns, openDegree } from './metrics'

/** Closed edges incident to a cell. */
function closedEdges(maze: Maze, cell: CellId): EdgeId[] {
  const out: EdgeId[] = []
  for (const e of maze.topo.edgesOf(cell)) if (maze.open[e] === 0) out.push(e)
  return out
}

/**
 * Remove a fraction of dead ends by opening one extra wall at each.
 *
 * A braided maze always offers a way forward, which takes away the main source
 * of frustration for a young child: being blocked and having to erase. It also
 * makes the maze harder to solve optimally, since dead-end filling stops
 * working — both effects are wanted here. See docs/DESIGN.md §4.
 *
 * `ratio` is 0 (a perfect maze, untouched) to 1 (no dead ends left).
 */
export function braid(maze: Maze, rng: Rng, ratio: number): void {
  if (ratio <= 0) return

  const deadEnds: CellId[] = []
  for (let c = 0; c < maze.topo.cellCount; c++) {
    if (openDegree(maze, c) === 1) deadEnds.push(c)
  }

  rng.shuffle(deadEnds)
  const target = Math.floor(deadEnds.length * Math.min(ratio, 1))

  let done = 0
  for (const cell of deadEnds) {
    if (done >= target) break
    // Opening one dead end can retire a neighbouring one, so re-check rather
    // than trusting the list we started from.
    if (openDegree(maze, cell) !== 1) continue
    const options = closedEdges(maze, cell)
    if (options.length === 0) continue
    maze.open[options[rng.int(options.length)] as EdgeId] = 1
    done++
  }
}

/**
 * Open a way onward at the tip of every dead-end corridor longer than `k`.
 *
 * This is the mechanism behind the promise that a child cannot get badly stuck.
 * At level 1 the cap is three cells, so a wrong turn is blocked almost as soon
 * as it is taken and there is never much to retrace.
 *
 * It bounds `maxDeadEndRun`, not `maxBranchDepth` — the distinction is the
 * whole point. Opening a wall at a tip lets a solver carry on through instead
 * of reversing, but it does nothing to bring that part of the maze closer to
 * the solution route, so branch depth is largely unchanged. Retracing is what
 * frustrates a child; wandering, within reason, is the game.
 *
 * Converges quickly: opening an edge only ever raises a cell's degree, so dead
 * ends can only disappear. `maxPasses` is a guard, not an expected cost.
 */
export function capDeadEndRun(maze: Maze, rng: Rng, k: number, maxPasses = 20): void {
  for (let pass = 0; pass < maxPasses; pass++) {
    const tooLong = deadEndRuns(maze).filter((r) => r.length > k)
    if (tooLong.length === 0) return

    let opened = 0
    for (const run of tooLong) {
      // Re-check: an earlier opening this pass may have already resolved it.
      if (openDegree(maze, run.tip) !== 1) continue
      const options = closedEdges(maze, run.tip)
      if (options.length === 0) continue
      maze.open[options[rng.int(options.length)] as EdgeId] = 1
      opened++
    }
    // Every remaining tip is walled in on all sides; nothing further to do.
    if (opened === 0) return
  }
}
