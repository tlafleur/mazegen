import type { CellId, EdgeId, Topology } from '../types'
import type { Rng } from '../rng'

/**
 * Recursive backtracker (randomised depth-first search).
 *
 * Produces a perfect maze: exactly `cellCount - 1` open edges, no loops. Its
 * character is long winding corridors and deep dead ends, which makes it the
 * hardest of the common carvers and the most satisfying to draw — see
 * docs/DESIGN.md §4.
 *
 * Iterative rather than recursive: at fine-pen density a grid runs to a few
 * thousand cells and a corridor can be nearly that long, which is enough to
 * overflow the call stack.
 */
export function carveBacktracker(topo: Topology, rng: Rng, start: CellId = 0): Uint8Array {
  const open = new Uint8Array(topo.edgeCount)
  const visited = new Uint8Array(topo.cellCount)
  const stack: CellId[] = [start]
  visited[start] = 1

  const options: EdgeId[] = []
  while (stack.length > 0) {
    const cur = stack[stack.length - 1] as CellId

    options.length = 0
    for (const e of topo.edgesOf(cur)) {
      if (visited[topo.other(e, cur)] === 0) options.push(e)
    }

    if (options.length === 0) {
      stack.pop()
      continue
    }

    const edge = options[rng.int(options.length)] as EdgeId
    const next = topo.other(edge, cur)
    open[edge] = 1
    visited[next] = 1
    stack.push(next)
  }

  return open
}
