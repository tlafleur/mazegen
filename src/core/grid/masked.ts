import type { CellId, EdgeId, Maze, RowStructured, Topology } from '../types'
import type { Rng } from '../rng'
import { openDegree } from '../metrics'
import type { Mask } from './mask'
import type { BaseGrid, Crossing, PlanarGrid, Point, Segment } from './planar'

/**
 * Closest a decoy gap may come to a real opening or another decoy, in mm.
 *
 * Sized against the marker box in `render/marker.ts`: any nearer and the
 * mouse drawn outside the entrance would sit beside a hole it did not come
 * through. Widened to three cells on a coarse grid, where 14 mm is barely
 * one cell.
 */
const MIN_DECOY_GAP = 14

/**
 * A grid restricted to the cells inside a shape.
 *
 * The mask is applied once, at construction, and everything downstream sees a
 * smaller graph rather than a rectangle with holes. That matters in two places:
 * carvers need no knowledge of shapes at all, and `cellCount` — which the
 * difficulty score divides by — counts the cells actually in the maze rather
 * than the bounding box.
 *
 * A rectangle is this class with a mask that admits everything, so there is one
 * implementation of boundaries and openings rather than two.
 *
 * It is written against `BaseGrid`, not against squares, so hexagons get
 * masking, shapes, entrances, exits and markers for nothing.
 */
export class MaskedGrid implements Topology, PlanarGrid {
  readonly cellCount: number
  readonly edgeCount: number
  readonly vertexCount: number
  readonly pitch: number
  readonly passageGap: number
  readonly width: number
  readonly height: number
  /** True when the mask removed nothing, so the base rectangle is intact. */
  readonly isComplete: boolean

  /** Base cell id for each cell here, and the inverse (-1 where excluded). */
  private readonly toBase: Int32Array
  private readonly fromBase: Int32Array
  private readonly edgeToBase: Int32Array
  /** Endpoints of each edge, in local ids, flattened. */
  private readonly edgeEnds: Int32Array
  private readonly adjOffset: Int32Array
  private readonly adjEdges: Int32Array
  /** Face chosen as this cell's opening, or -1 for a cell not on the outline. */
  private readonly openFace: Int32Array
  /** Base edge id to local, built on first use and only where there are bridges. */
  private localEdges: Map<EdgeId, EdgeId> | null = null

  constructor(
    readonly base: BaseGrid,
    mask: Mask,
  ) {
    this.pitch = base.pitch
    this.passageGap = base.passageGap
    this.width = base.width
    this.height = base.height
    this.vertexCount = base.vertexCount

    const n = base.cellCount
    // Mask coordinates: centred, uniformly scaled so the shorter axis is [-1, 1].
    const half = Math.min(base.width, base.height) / 2
    const cx = base.width / 2
    const cy = base.height / 2

    const inside = new Uint8Array(n)
    for (let c = 0; c < n; c++) {
      const p = base.cellCenter(c)
      if (mask((p.x - cx) / half, (p.y - cy) / half)) inside[c] = 1
    }

    const keep = largestComponent(base, inside)
    if (keep.length < 4) {
      throw new Error(`mask leaves only ${keep.length} connected cells`)
    }

    this.isComplete = keep.length === n
    this.cellCount = keep.length
    this.toBase = Int32Array.from(keep)
    this.fromBase = new Int32Array(n).fill(-1)
    for (let i = 0; i < keep.length; i++) this.fromBase[keep[i] as number] = i

    // An edge survives only when both of its cells did.
    const edges: EdgeId[] = []
    for (let e = 0; e < base.edgeCount; e++) {
      const [a, b] = base.endpoints(e)
      if ((this.fromBase[a] as number) >= 0 && (this.fromBase[b] as number) >= 0) edges.push(e)
    }
    this.edgeCount = edges.length
    this.edgeToBase = Int32Array.from(edges)
    this.edgeEnds = new Int32Array(edges.length * 2)
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = base.endpoints(edges[i] as EdgeId)
      this.edgeEnds[i * 2] = this.fromBase[a] as number
      this.edgeEnds[i * 2 + 1] = this.fromBase[b] as number
    }

    // Adjacency in compressed-row form, so edgesOf is a slice walk rather than
    // a scan over every edge.
    const degree = new Int32Array(this.cellCount)
    for (let i = 0; i < this.edgeEnds.length; i++) {
      const v = this.edgeEnds[i] as number
      degree[v] = (degree[v] as number) + 1
    }
    this.adjOffset = new Int32Array(this.cellCount + 1)
    for (let c = 0; c < this.cellCount; c++) {
      this.adjOffset[c + 1] = (this.adjOffset[c] as number) + (degree[c] as number)
    }
    const cursor = Int32Array.from(this.adjOffset.subarray(0, this.cellCount))
    this.adjEdges = new Int32Array(edges.length * 2)
    for (let i = 0; i < this.edgeEnds.length; i++) {
      const v = this.edgeEnds[i] as number
      this.adjEdges[cursor[v] as number] = i >> 1
      cursor[v] = (cursor[v] as number) + 1
    }

    this.openFace = new Int32Array(this.cellCount).fill(-1)
    for (let c = 0; c < this.cellCount; c++) this.openFace[c] = this.chooseOpenFace(c, cx, cy)
  }

  /**
   * Which face of a boundary cell an opening should be cut into.
   *
   * Picks the one facing most directly away from the middle of the grid, so an
   * opening lands on the outside of a star's point rather than in its armpit.
   * On a rectangle this reproduces the obvious answer: the top face at the
   * top-left corner, the bottom face at the bottom-right.
   */
  private chooseOpenFace(cell: CellId, cx: number, cy: number): number {
    const p = this.cellCenter(cell)
    const ox = p.x - cx
    const oy = p.y - cy
    let best = -1
    let bestDot = -Infinity
    for (let dir = 0; dir < this.base.faces; dir++) {
      if (!this.isFace(cell, dir) || this.neighbourAcross(cell, dir) !== -1) continue
      const nrm = this.base.faceNormal(this.toBase[cell] as CellId, dir)
      const dot = ox * nrm.x + oy * nrm.y
      if (dot > bestDot) {
        bestDot = dot
        best = dir
      }
    }
    return best
  }

  /** Whether the base grid gives this cell a face in this slot at all. */
  private isFace(cell: CellId, dir: number): boolean {
    return this.base.hasFace?.(this.toBase[cell] as CellId, dir) ?? true
  }

  /** The cell across a face, or -1 when the shape ends there. */
  neighbourAcross(cell: CellId, dir: number): CellId {
    const nb = this.base.neighbourAcross(this.toBase[cell] as CellId, dir)
    return nb === -1 ? -1 : (this.fromBase[nb] as CellId)
  }

  // --- Topology ---

  endpoints(edge: EdgeId): readonly [CellId, CellId] {
    return [this.edgeEnds[edge * 2] as CellId, this.edgeEnds[edge * 2 + 1] as CellId]
  }

  other(edge: EdgeId, from: CellId): CellId {
    const a = this.edgeEnds[edge * 2] as CellId
    return a === from ? (this.edgeEnds[edge * 2 + 1] as CellId) : a
  }

  edgesOf(cell: CellId): readonly EdgeId[] {
    const out: EdgeId[] = []
    const stop = this.adjOffset[cell + 1] as number
    for (let k = this.adjOffset[cell] as number; k < stop; k++) out.push(this.adjEdges[k] as EdgeId)
    return out
  }

  // --- PlanarGrid ---

  vertexPos(vertex: number): Point {
    return this.base.vertexPos(vertex)
  }

  cellCenter(cell: CellId): Point {
    return this.base.cellCenter(this.toBase[cell] as CellId)
  }

  cellAtPoint(p: Point): CellId {
    const c = this.base.cellAtPoint(p)
    // Outside the mask reads the same as outside the grid: there is no cell
    // there, so a finger over it is not a move.
    return c === -1 ? -1 : (this.fromBase[c] as CellId)
  }

  wallSegment(edge: EdgeId): Segment {
    return this.base.wallSegment(this.edgeToBase[edge] as EdgeId)
  }

  boundarySegments(openAt: readonly CellId[] = []): Segment[] {
    const out: Segment[] = []
    for (let c = 0; c < this.cellCount; c++) {
      const opening = openAt.includes(c) ? (this.openFace[c] as number) : -1
      for (let dir = 0; dir < this.base.faces; dir++) {
        if (!this.isFace(c, dir) || this.neighbourAcross(c, dir) !== -1 || dir === opening) continue
        out.push(this.base.faceSegment(this.toBase[c] as CellId, dir))
      }
    }
    return out
  }

  openingPoint(cell: CellId): Point {
    const dir = this.openFace[cell] as number
    if (dir === -1) return this.cellCenter(cell)
    return this.base.faceMidpoint(this.toBase[cell] as CellId, dir)
  }

  openingSegment(cell: CellId): Segment | null {
    const dir = this.openFace[cell] as number
    if (dir === -1) return null
    return this.base.faceSegment(this.toBase[cell] as CellId, dir)
  }

  openingNormal(cell: CellId): Point | null {
    const dir = this.openFace[cell] as number
    return dir === -1 ? null : this.base.faceNormal(this.toBase[cell] as CellId, dir)
  }

  /** Cells with at least one face on the outline. */
  boundaryCells(): CellId[] {
    const out: CellId[] = []
    for (let c = 0; c < this.cellCount; c++) if ((this.openFace[c] as number) !== -1) out.push(c)
    return out
  }

  /**
   * The two outline cells furthest apart, by double BFS.
   *
   * Measured on the uncarved adjacency rather than on a finished maze, so the
   * entrance and exit are a property of the shape and stay put however the maze
   * is carved. On a rectangle it picks opposite corners. See docs/DESIGN.md §6.
   */
  farthestBoundaryPair(): readonly [CellId, CellId] {
    return this.farthestPair(null)
  }

  /**
   * The two outline cells furthest apart *along the corridors*, once carved.
   *
   * The same search over the passages the carver left open, so the answer is
   * the longest route the maze actually contains between two points a marker
   * can be drawn outside. Measured, it lengthens the route by a quarter to two
   * thirds and lifts the difficulty score above anything the recipes in §4
   * reach on their own — the one axis found that goes past a plain backtracker.
   *
   * The cost is that the entrance moves when the maze is recarved, which is
   * exactly what `farthestBoundaryPair` was written to avoid. That is why it is
   * an option rather than the default: stability is worth more at the easy end,
   * and length is worth more at the hard end.
   */
  farthestOpenPair(maze: Maze): readonly [CellId, CellId] {
    return this.farthestPair(maze.open)
  }

  /**
   * The base grid's crossings, in this grid's own ids.
   *
   * A crossing survives the mask only if its cell and its bridge both did:
   * cut either away and what is left is an ordinary corridor, which is exactly
   * what the geometry then describes, so there is nothing to draw.
   */
  crossings(): readonly Crossing[] {
    const from = this.base.crossings?.() ?? []
    if (from.length === 0) return []
    if (this.localEdges === null) {
      this.localEdges = new Map()
      for (let e = 0; e < this.edgeCount; e++) {
        this.localEdges.set(this.edgeToBase[e] as EdgeId, e)
      }
    }
    const out: Crossing[] = []
    for (const x of from) {
      const edge = this.localEdges.get(x.edge) ?? -1
      const under = this.localEdges.get(x.under) ?? -1
      // Both gone means the mask cut the whole position away, and there is
      // nothing at that place to draw. One gone leaves a corridor, and the
      // renderer draws the walls for the side that is no longer there.
      if (edge < 0 && under < 0) continue
      out.push({ ...x, edge, under })
    }
    return out
  }

  /**
   * Boundary cells to put a false gap in the outline at.
   *
   * A solver reading a printed maze has one shortcut nobody intends: the two
   * gaps in the border are visible from across the room, so the exit can be
   * found before the route is. Extra gaps take that away. They are not extra
   * ways out — the goal is whichever one the cheese is drawn at — so a decoy
   * costs nothing in solvability and does not change the difficulty score. It
   * changes what the page gives away at a glance, which no measure here
   * captures.
   *
   * Dead ends are preferred as the cells to open, so that following one to the
   * border really is a wasted trip rather than a shortcut past a wall. Where
   * there are not enough — a maze carved with `loops` on has none at all —
   * any boundary cell will do.
   *
   * Every choice is held apart from the real entrance and exit and from the
   * other decoys, both so the markers have room to be drawn and because two
   * gaps a cell apart read as one wide gap.
   */
  decoyExits(maze: Maze, rng: Rng, count: number): CellId[] {
    if (count <= 0) return []
    const apart = Math.max(MIN_DECOY_GAP, 3 * this.pitch)
    const chosen: CellId[] = []
    const taken = [maze.start, maze.end].map((c) => this.cellCenter(c))

    const farEnough = (cell: CellId): boolean => {
      const p = this.cellCenter(cell)
      return taken.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= apart)
    }

    const candidates = this.boundaryCells().filter((c) => c !== maze.start && c !== maze.end)
    rng.shuffle(candidates)
    // Dead ends first, then anything, so a short perimeter still gets its
    // decoys rather than silently getting none.
    const byPreference = [
      candidates.filter((c) => openDegree(maze, c) === 1),
      candidates,
    ]

    for (const pool of byPreference) {
      for (const cell of pool) {
        if (chosen.length >= count) return chosen
        if (chosen.includes(cell) || !farEnough(cell)) continue
        chosen.push(cell)
        taken.push(this.cellCenter(cell))
      }
    }
    return chosen
  }

  /**
   * Double BFS over the boundary, through every adjacency or only open ones.
   *
   * `open` null means the bare grid: every neighbour is reachable.
   */
  private farthestPair(open: Uint8Array | null): readonly [CellId, CellId] {
    const onBoundary = new Uint8Array(this.cellCount)
    for (const c of this.boundaryCells()) onBoundary[c] = 1

    const sweep = (from: CellId): CellId => {
      const dist = new Int32Array(this.cellCount).fill(-1)
      dist[from] = 0
      const queue: CellId[] = [from]
      let best = from
      let bestDist = -1
      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head] as CellId
        const d = dist[cur] as number
        if (onBoundary[cur] === 1 && d > bestDist) {
          bestDist = d
          best = cur
        }
        for (const e of this.edgesOf(cur)) {
          if (open !== null && open[e] === 0) continue
          const nb = this.other(e, cur)
          if ((dist[nb] as number) !== -1) continue
          dist[nb] = d + 1
          queue.push(nb)
        }
      }
      return best
    }

    const a = sweep(this.boundaryCells()[0] as CellId)
    const b = sweep(a)

    // Order them, rather than returning whichever the search happened to reach
    // first. The double BFS starts from cell 0 and walks away from it, so `a` is
    // the *far* end — returning the pair unordered puts the entrance at the
    // bottom of the page and sends the solution upward, and puts the mouse at
    // the finish and the cheese at the start.
    const pa = this.cellCenter(a)
    const pb = this.cellCenter(b)
    const aFirst = pa.y !== pb.y ? pa.y < pb.y : pa.x <= pb.x
    return aFirst ? [a, b] : [b, a]
  }

  /**
   * The underlying rows, when there are any and nothing was masked away.
   *
   * Sidewinder carves along whole rows, so it can run on neither a shape with
   * ragged ones nor a hexagonal grid, where a cell has two neighbours above it
   * rather than one. This is how a caller finds out.
   */
  rowStructured(): (Topology & RowStructured) | null {
    if (!this.isComplete) return null
    return this.base.rowStructured?.() ?? null
  }
}

/**
 * Largest run of cells connected to each other through the base grid.
 *
 * A thin shape can leave islands — the points of a star pinch off at coarse
 * cell sizes — and a maze in two pieces is unsolvable, so only the biggest
 * piece survives.
 */
function largestComponent(base: BaseGrid, inside: Uint8Array): CellId[] {
  const seen = new Uint8Array(base.cellCount)
  let best: CellId[] = []

  for (let seed = 0; seed < base.cellCount; seed++) {
    if (inside[seed] === 0 || seen[seed] === 1) continue
    const group: CellId[] = [seed]
    seen[seed] = 1
    for (let head = 0; head < group.length; head++) {
      const cur = group[head] as CellId
      for (const e of base.edgesOf(cur)) {
        const nb = base.other(e, cur)
        if (inside[nb] === 0 || seen[nb] === 1) continue
        seen[nb] = 1
        group.push(nb)
      }
    }
    if (group.length > best.length) best = group
  }

  return best.sort((a, b) => a - b)
}
