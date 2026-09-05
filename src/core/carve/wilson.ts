import type { CellId, EdgeId, Topology } from '../types'
import type { Rng } from '../rng'

/**
 * Wilson's algorithm — loop-erased random walk.
 *
 * Alone among the carvers here it samples uniformly from all possible spanning
 * trees, so the result carries no directional bias and no visible texture. That
 * makes it the neutral middle of the difficulty range: nothing about the
 * picture hints at the way through. See docs/DESIGN.md §4.
 *
 * The cost is an unpredictable start — the first walks wander a long way before
 * finding the single seeded cell — so it is the slowest of the four. Still
 * comfortably sub-second at the sizes that fit on a page.
 */
export function carveWilson(topo: Topology, rng: Rng): Uint8Array {
  const n = topo.cellCount
  const open = new Uint8Array(topo.edgeCount)
  const inTree = new Uint8Array(n)

  const remaining: CellId[] = Array.from({ length: n }, (_, i) => i)
  rng.shuffle(remaining)

  // Seed the tree with one cell; every walk terminates when it reaches the tree.
  inTree[remaining.pop() as CellId] = 1

  // The edge each cell currently walks out along. Overwriting it is what erases
  // a loop: revisiting a cell simply replaces its recorded exit.
  const exit = new Int32Array(n).fill(-1)

  while (remaining.length > 0) {
    const from = remaining[remaining.length - 1] as CellId
    if (inTree[from] === 1) {
      remaining.pop()
      continue
    }

    let walk = from
    while (inTree[walk] === 0) {
      const options = topo.edgesOf(walk)
      const e = options[rng.int(options.length)] as EdgeId
      exit[walk] = e
      walk = topo.other(e, walk)
    }

    // Retrace from the start, following the surviving exits.
    let cur = from
    while (inTree[cur] === 0) {
      const e = exit[cur] as EdgeId
      open[e] = 1
      inTree[cur] = 1
      cur = topo.other(e, cur)
    }
  }

  return open
}
