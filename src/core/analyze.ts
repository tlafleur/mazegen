import type { CellId, Maze } from './types'

/**
 * Shortest path from start to end through open edges, as a list of cells.
 *
 * Breadth-first, so the result is the shortest route even once braiding
 * introduces loops (docs/DESIGN.md §4). Returns null if no route exists, which
 * a correctly carved maze never does — the tests rely on that.
 */
export function solve(maze: Maze): CellId[] | null {
  const { topo, open, start, end } = maze
  const prev = new Int32Array(topo.cellCount).fill(-1)
  const seen = new Uint8Array(topo.cellCount)
  const queue: CellId[] = [start]
  seen[start] = 1

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as CellId
    if (cur === end) break
    for (const e of topo.edgesOf(cur)) {
      if (open[e] === 0) continue
      const nb = topo.other(e, cur)
      if (seen[nb] === 1) continue
      seen[nb] = 1
      prev[nb] = cur
      queue.push(nb)
    }
  }

  if (seen[end] === 0) return null

  const path: CellId[] = []
  for (let c: CellId = end; c !== -1; c = prev[c] as CellId) path.push(c)
  return path.reverse()
}

/** How many cells are reachable from `start` through open edges. */
export function reachableCount(maze: Maze): number {
  const { topo, open, start } = maze
  const seen = new Uint8Array(topo.cellCount)
  const queue: CellId[] = [start]
  seen[start] = 1
  let n = 1
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as CellId
    for (const e of topo.edgesOf(cur)) {
      if (open[e] === 0) continue
      const nb = topo.other(e, cur)
      if (seen[nb] === 1) continue
      seen[nb] = 1
      n++
      queue.push(nb)
    }
  }
  return n
}
