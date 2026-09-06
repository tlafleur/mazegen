import type { CellId, EdgeId, RowStructured, Topology } from '../types'
import type { Rng } from '../rng'

/**
 * Sidewinder.
 *
 * Runs east along a row, closing the run at random and carving north out of one
 * cell of it. The top row never closes, so it becomes one unbroken corridor.
 *
 * That corridor is the point: it hands the solver an obvious strategy — get to
 * the top, then run along it — which makes this the easiest of the carvers and
 * the right one for the youngest levels. The bias is plainly visible in the
 * finished maze, and for a child that is a feature. See docs/DESIGN.md §4.
 *
 * Needs rows and columns, not just a graph, so it takes `RowStructured` too.
 */
export function carveSidewinder(
  grid: Topology & RowStructured,
  rng: Rng,
  /** Chance of closing a run at each cell; higher makes shorter horizontal runs. */
  closeChance = 0.5,
): Uint8Array {
  const open = new Uint8Array(grid.edgeCount)

  for (let r = 0; r < grid.rows; r++) {
    let run: CellId[] = []

    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(c, r)
      run.push(cell)

      const atEastEdge = c === grid.cols - 1
      const atTopRow = r === 0
      // Nothing to carve north into on the top row, so it runs the full width.
      const close = atEastEdge || (!atTopRow && rng.next() < closeChance)

      if (!close) {
        open[grid.edgeEast(cell) as EdgeId] = 1
        continue
      }

      if (!atTopRow) {
        const member = run[rng.int(run.length)] as CellId
        open[grid.edgeNorth(member) as EdgeId] = 1
      }
      run = []
    }
  }

  return open
}
