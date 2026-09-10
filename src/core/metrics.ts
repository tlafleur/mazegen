import type { CellId, Maze } from './types'

/**
 * What makes a maze hard, measured rather than assumed.
 *
 * See docs/DESIGN.md §4. Most generators change the grid size and call that
 * difficulty; the numbers here describe the thing a solver actually
 * experiences — how often a wrong turn is available, and how far it runs
 * before the mistake becomes obvious.
 */
export interface MazeMetrics {
  readonly cellCount: number
  /** Cells on the shortest route from start to end. */
  readonly solutionLength: number
  /** Cells on the route offering at least one turn that leaves it. */
  readonly decisionPoints: number
  /** Mean depth of the wrong-turn regions hanging off the route. */
  readonly meanBranchDepth: number
  /** Deepest any single wrong turn runs. */
  readonly maxBranchDepth: number
  /** Cells with exactly one way in or out, entrance and exit aside. */
  readonly deadEnds: number
  /**
   * Longest corridor that ends in a wall, measured from its dead end back to
   * the first junction.
   *
   * Distinct from `maxBranchDepth`, and the distinction matters. Branch depth
   * says how far off the route a solver can wander; this says how far they must
   * retrace once they discover they are wrong. The second is what actually
   * frustrates a child — being blocked and having to erase — so it, not branch
   * depth, is what `capDeadEndRun` bounds.
   */
  readonly maxDeadEndRun: number
  readonly meanDeadEndRun: number
  /** Route length against grid scale; higher means more winding. */
  readonly tortuosity: number
  /** Composite difficulty, normalized by size. See `score` below. */
  readonly score: number
}

/**
 * Difficulty as expected work, per cell of maze.
 *
 * `solutionLength` is the route that has to be traced whatever happens;
 * `decisionPoints * meanBranchDepth` is how much wrong turning is on offer
 * along the way. Their sum is roughly the number of cells a solver passes
 * through before finishing.
 *
 * docs/DESIGN.md originally sketched this as `J * log(1 + mean depth)`, which
 * measurement showed ranks the carvers backwards: the recursive backtracker
 * yields a long route with few branches (L 210, J 17) and Kruskal a short route
 * with many (L 77, J 39), so a formula built on J alone calls the bushy maze
 * the hard one. Dropping route length also discards the most concrete work
 * there is for a child with a crayon.
 *
 * Dividing by cell count is deliberate. Cell size and difficulty are separate
 * controls — motor demand and cognitive demand — so "level 3" has to mean the
 * same thing on a 315-cell crayon sheet as on a 2961-cell fine-pen one. Left
 * unnormalized, a toddler-sized grid could never reach the top levels and a
 * dense one could never sit at the bottom, which gets both ends wrong.
 *
 * What this does not capture is strategy. Sidewinder's unbroken top row hands
 * a solver an obvious plan, and no structural measure sees that; it scores only
 * a little below Wilson's. Carver choice therefore stays an explicit input to
 * the difficulty mapping rather than something the score is asked to discover.
 */
function scoreOf(
  solutionLength: number,
  decisionPoints: number,
  meanBranchDepth: number,
  cellCount: number,
): number {
  return (solutionLength + decisionPoints * meanBranchDepth) / cellCount
}

/**
 * Distance from the solution route for every cell that is off it; -1 on the
 * route itself and in any part of the maze the route cannot see.
 *
 * Multi-source, so a region reachable from several points on the route is
 * measured from the nearest one. Exported because dead-end depth capping needs
 * the same numbers the metrics do.
 */
export function distanceFromPath(maze: Maze, solution: readonly CellId[]): Int32Array {
  const { topo, open } = maze
  const n = topo.cellCount

  const onPath = new Uint8Array(n)
  for (const c of solution) onPath[c] = 1

  const dist = new Int32Array(n).fill(-1)
  const queue: CellId[] = []

  for (const c of solution) {
    for (const e of topo.edgesOf(c)) {
      if (open[e] === 0) continue
      const nb = topo.other(e, c)
      if (onPath[nb] === 1 || dist[nb] !== -1) continue
      dist[nb] = 1
      queue.push(nb)
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as CellId
    for (const e of topo.edgesOf(cur)) {
      if (open[e] === 0) continue
      const nb = topo.other(e, cur)
      if (onPath[nb] === 1 || dist[nb] !== -1) continue
      dist[nb] = (dist[cur] as number) + 1
      queue.push(nb)
    }
  }

  return dist
}

/** Open edges incident to a cell. */
export function openDegree(maze: Maze, cell: CellId): number {
  let d = 0
  for (const e of maze.topo.edgesOf(cell)) if (maze.open[e] === 1) d++
  return d
}

export interface DeadEndRun {
  /** The walled-off cell at the end of the corridor. */
  readonly tip: CellId
  /** Cells from the tip back to the first junction, inclusive of the tip. */
  readonly length: number
}

/**
 * Length of every corridor that ends in a wall, from its tip back to the first
 * junction. Entrance and exit are excluded: their single opening is the way in,
 * not a dead end.
 */
export function deadEndRuns(maze: Maze): DeadEndRun[] {
  const { topo, open, start, end } = maze
  const runs: DeadEndRun[] = []

  const openNeighbours = (cell: CellId): CellId[] => {
    const out: CellId[] = []
    for (const e of topo.edgesOf(cell)) if (open[e] === 1) out.push(topo.other(e, cell))
    return out
  }

  for (let tip = 0; tip < topo.cellCount; tip++) {
    if (tip === start || tip === end || openDegree(maze, tip) !== 1) continue

    let length = 1
    let prev: CellId = tip
    let cur = openNeighbours(tip)[0] as CellId

    // Walk the corridor until it opens out at a junction, or runs into the
    // entrance, the exit, or another dead end.
    while (cur !== start && cur !== end && openDegree(maze, cur) === 2) {
      length++
      const next = openNeighbours(cur).find((c) => c !== prev)
      if (next === undefined) break
      prev = cur
      cur = next
    }
    runs.push({ tip, length })
  }

  return runs
}

export function measure(maze: Maze, solution: readonly CellId[]): MazeMetrics {
  const { topo, open } = maze
  const n = topo.cellCount

  const onPath = new Uint8Array(n)
  for (const c of solution) onPath[c] = 1

  const lengths = deadEndRuns(maze).map((r) => r.length)
  const maxDeadEndRun = lengths.length === 0 ? 0 : Math.max(...lengths)
  const meanDeadEndRun =
    lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length

  // A decision point is a cell on the route where a turn leaves it. That is
  // stricter than "degree 3 or more": a third opening that rejoins the route
  // is a shortcut, not a chance to go wrong.
  let decisionPoints = 0
  for (const c of solution) {
    for (const e of topo.edgesOf(c)) {
      if (open[e] === 1 && onPath[topo.other(e, c)] === 0) {
        decisionPoints++
        break
      }
    }
  }

  const dist = distanceFromPath(maze, solution)

  // A wrong turn is only as bad as the whole region it opens into, so depth is
  // measured per connected off-path region rather than per opening.
  const seen = new Uint8Array(n)
  const depths: number[] = []
  for (let c = 0; c < n; c++) {
    if (onPath[c] === 1 || seen[c] === 1 || dist[c] === -1) continue
    let deepest = 0
    const region: CellId[] = [c]
    seen[c] = 1
    for (let head = 0; head < region.length; head++) {
      const cur = region[head] as CellId
      const d = dist[cur] as number
      if (d > deepest) deepest = d
      for (const e of topo.edgesOf(cur)) {
        if (open[e] === 0) continue
        const nb = topo.other(e, cur)
        if (onPath[nb] === 1 || seen[nb] === 1) continue
        seen[nb] = 1
        region.push(nb)
      }
    }
    depths.push(deepest)
  }

  const maxBranchDepth = depths.length === 0 ? 0 : Math.max(...depths)
  const meanBranchDepth =
    depths.length === 0 ? 0 : depths.reduce((a, b) => a + b, 0) / depths.length

  return {
    cellCount: n,
    solutionLength: solution.length,
    decisionPoints,
    meanBranchDepth,
    maxBranchDepth,
    deadEnds: lengths.length,
    maxDeadEndRun,
    meanDeadEndRun,
    // sqrt(cellCount) stands in for (rows + cols) so this stays usable on grids
    // that have no rows or columns, such as the polar grid planned for phase 2.
    tortuosity: solution.length / Math.sqrt(n),
    score: scoreOf(solution.length, decisionPoints, meanBranchDepth, n),
  }
}

/**
 * Cells left after repeatedly rubbing out every dead end.
 *
 * The shortcut a solver learns first: a corridor that ends in a wall cannot be
 * on the route, so cross it off — and crossing it off may expose another. On a
 * perfect maze this terminates with exactly the solution, which is the thing
 * worth knowing about it. Braiding takes the shortcut away: at ratio 1 there
 * are no dead ends to start from, so filling removes nothing and every cell
 * stays live from the first mark to the last.
 *
 * Deliberately not part of `measure`. `score` is expected work, and this is not
 * work — it is how much of the page can be dismissed without doing any. The two
 * disagree about braiding on purpose, and folding one into the other would hide
 * that rather than report it. See docs/DESIGN.md §4.
 */
export function fillDeadEnds(maze: Maze): number {
  const { topo } = maze
  const degree = new Int32Array(topo.cellCount)
  const filled = new Uint8Array(topo.cellCount)
  for (let c = 0; c < topo.cellCount; c++) {
    for (const e of topo.edgesOf(c)) if (maze.open[e] === 1) degree[c] = (degree[c] as number) + 1
  }

  // The entrance and the exit are never crossed off, however few ways out they
  // have: the route runs through them by definition.
  const fillable = (c: CellId): boolean =>
    filled[c] === 0 && c !== maze.start && c !== maze.end && (degree[c] as number) <= 1

  const stack: CellId[] = []
  for (let c = 0; c < topo.cellCount; c++) if (fillable(c)) stack.push(c)

  while (stack.length > 0) {
    const cell = stack.pop() as CellId
    if (!fillable(cell)) continue
    filled[cell] = 1
    for (const e of topo.edgesOf(cell)) {
      if (maze.open[e] === 0) continue
      const nb = topo.other(e, cell)
      degree[nb] = (degree[nb] as number) - 1
      if (fillable(nb)) stack.push(nb)
    }
  }

  let left = 0
  for (let c = 0; c < topo.cellCount; c++) if (filled[c] === 0) left++
  return left
}
