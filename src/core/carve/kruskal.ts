import type { CellId, EdgeId, Topology } from '../types'
import type { Rng } from '../rng'

/**
 * Randomised Kruskal's algorithm.
 *
 * Shuffle every adjacency, then open the ones that join two cells not already
 * connected. Produces a bushy maze: dead ends everywhere, but short ones, so a
 * wrong turn dies quickly. Busy to look at and forgiving to solve, which puts
 * it at the easy-to-middle end of the range. See docs/DESIGN.md §4.
 */
export function carveKruskal(topo: Topology, rng: Rng): Uint8Array {
  const open = new Uint8Array(topo.edgeCount)

  const parent = new Int32Array(topo.cellCount)
  for (let i = 0; i < parent.length; i++) parent[i] = i

  // Union-find with path halving; no union-by-rank, since the shuffle already
  // keeps the trees shallow enough at these sizes.
  const find = (x: CellId): CellId => {
    let cur = x
    while ((parent[cur] as number) !== cur) {
      parent[cur] = parent[parent[cur] as number] as number
      cur = parent[cur] as number
    }
    return cur
  }

  const edges: EdgeId[] = Array.from({ length: topo.edgeCount }, (_, i) => i)
  rng.shuffle(edges)

  for (const e of edges) {
    const [a, b] = topo.endpoints(e)
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) continue
    parent[ra] = rb
    open[e] = 1
  }

  return open
}
