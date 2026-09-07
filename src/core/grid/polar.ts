import type { CellId, EdgeId } from '../types'
import type { BaseGrid, Point, Segment } from './planar'

/** Face directions. Anything from OUT upward is one of a cell's outward faces. */
export const IN = 0
export const CW = 1
export const CCW = 2
export const OUT = 3

const TAU = Math.PI * 2

/**
 * How close two passages that share no cell come, as a fraction of the pitch.
 *
 * Not a whole cell, as it is on squares. The tight spot is always a ring where
 * the count doubles: a radial passage crossing outward runs alongside an arc
 * passage in the finer ring beyond it. Measured by brute force over every pair
 * of passages at 3, 5, 8, 12 and 20 rings, the closest approach falls from
 * 0.827 to 0.756 and settles there — twenty rings is already more than fits a
 * sheet at the finest pitch. This is a safe bound below all of them, and a test
 * measures the real thing against it rather than trusting the number here.
 */
const POLAR_GAP = 0.75

/**
 * Concentric rings, each subdivided into cells.
 *
 * The one grid here whose cells are not all the same shape. A ring's cells get
 * physically wider the further out they sit, so a fixed subdivision would give
 * slivers at the middle and rooms at the rim; instead each ring keeps the
 * previous ring's count until a cell has grown about twice as wide as it is
 * deep, then doubles. Every cell therefore stays roughly square in the only
 * sense that matters — a corridor a crayon fits down, all the way out.
 *
 * Two consequences that the other grids do not have. A cell has a variable
 * number of faces (three, four, or five, and the middle has as many as its
 * first ring has cells), so `faces` is the largest any cell has and
 * `neighbourAcross` answers -1 for the rest. And its walls are arcs; they are
 * drawn as one chord per cell face, which the corner rounding in every style
 * except Classic turns back into a curve.
 *
 * `pitch` is the depth of a ring and roughly the width of a cell, so it means
 * the same thing here as on the other grids and the cell sizes named after
 * drawing tools keep their meaning.
 */
export class PolarGrid implements BaseGrid {
  readonly faces: number
  readonly cellCount: number
  readonly edgeCount: number
  readonly vertexCount: number
  readonly width: number
  readonly height: number
  readonly passageGap: number

  /** Cells in each ring; ring 0 is the single cell in the middle. */
  private readonly count: Int32Array
  /** First cell id of each ring. */
  private readonly ringStart: Int32Array
  /** Ring each cell belongs to. */
  private readonly ringOf: Int32Array
  /** First vertex id on each circle; circle r has radius r * pitch. */
  private readonly circleStart: Int32Array
  /** Vertices on each circle — the finer of the two rings that meet there. */
  private readonly circleCount: Int32Array

  private readonly edgeCell: Int32Array
  private readonly edgeDir: Int32Array
  private readonly edgeEnds: Int32Array
  private readonly cellEdge: Int32Array

  constructor(
    readonly rings: number,
    readonly pitch: number,
  ) {
    if (rings < 2) throw new Error(`grid too small: ${rings} rings`)
    this.passageGap = pitch * POLAR_GAP
    this.width = 2 * (rings + 1) * pitch
    this.height = this.width

    // Ring 0 is the middle. Each ring afterwards keeps the previous count until
    // its cells have grown wide enough to split, which keeps them square.
    this.count = new Int32Array(rings + 1)
    this.count[0] = 1
    for (let r = 1; r <= rings; r++) {
      const previous = this.count[r - 1] as number
      const inner = r * pitch
      const wide = (TAU * inner) / (r === 1 ? 1 : previous)
      const split = r === 1 ? Math.max(4, Math.round(wide / pitch)) : Math.max(1, Math.round(wide / pitch))
      this.count[r] = r === 1 ? split : previous * split
    }

    this.ringStart = new Int32Array(rings + 2)
    for (let r = 0; r <= rings; r++) {
      this.ringStart[r + 1] = (this.ringStart[r] as number) + (this.count[r] as number)
    }
    this.cellCount = this.ringStart[rings + 1] as number

    this.ringOf = new Int32Array(this.cellCount)
    for (let r = 0; r <= rings; r++) {
      const stop = this.ringStart[r + 1] as number
      for (let c = this.ringStart[r] as number; c < stop; c++) this.ringOf[c] = r
    }

    // Circle r divides ring r-1 from ring r, so it carries the finer of the two
    // subdivisions — which is always ring r's, since counts only ever grow.
    this.circleCount = new Int32Array(rings + 2)
    this.circleStart = new Int32Array(rings + 3)
    for (let r = 1; r <= rings + 1; r++) {
      this.circleCount[r] = this.count[Math.min(r, rings)] as number
      this.circleStart[r + 1] = (this.circleStart[r] as number) + (this.circleCount[r] as number)
    }
    this.vertexCount = this.circleStart[rings + 2] as number

    // The middle touches every cell of the first ring, which is what makes the
    // face count uneven; it is the largest any cell has.
    let most = 0
    for (let r = 0; r < rings; r++) {
      most = Math.max(most, (this.count[r + 1] as number) / (this.count[r] as number))
    }
    this.faces = OUT + most

    // One edge per adjacency, counted from the inner or the counter-clockwise
    // side, so no pair is reached twice.
    const cells: number[] = []
    const dirs: number[] = []
    this.cellEdge = new Int32Array(this.cellCount * this.faces).fill(-1)
    for (let cell = 0; cell < this.cellCount; cell++) {
      const outward = this.outwardCount(cell)
      for (let k = 0; k < outward; k++) this.link(cells, dirs, cell, OUT + k)
      // A ring of one cell has no side walls; two cells share a single face.
      if (this.hasFace(cell, CW)) this.link(cells, dirs, cell, CW)
    }

    this.edgeCount = cells.length
    this.edgeCell = Int32Array.from(cells)
    this.edgeDir = Int32Array.from(dirs)
    this.edgeEnds = new Int32Array(cells.length * 2)
    for (let e = 0; e < cells.length; e++) {
      const from = cells[e] as CellId
      this.edgeEnds[e * 2] = from
      this.edgeEnds[e * 2 + 1] = this.neighbourAcross(from, dirs[e] as number)
    }
  }

  private link(cells: number[], dirs: number[], cell: CellId, dir: number): void {
    const nb = this.neighbourAcross(cell, dir)
    if (nb === -1) return
    const id = cells.length
    cells.push(cell)
    dirs.push(dir)
    this.cellEdge[cell * this.faces + dir] = id
    this.cellEdge[nb * this.faces + this.facing(dir)] = id
  }

  /** Which face of the neighbour looks back across the face `dir` of a cell. */
  private facing(dir: number): number {
    // An outward face of a cell is the inward face of the child across it.
    return dir === CW ? CCW : IN
  }

  /**
   * Whether this cell has a face in this slot.
   *
   * The middle has no inward face and no sides — it is one cell, so there is
   * nothing to either side of it — and a cell in the outermost ring has exactly
   * one outward face, the rim, however many children a cell further in would
   * have had. An unused slot is not an edge of the maze, and saying so is the
   * whole reason `BaseGrid` has this method.
   */
  hasFace(cell: CellId, dir: number): boolean {
    const r = this.ringOf[cell] as number
    if (dir === IN) return r > 0
    if (dir === CW || dir === CCW) return r > 0
    const k = dir - OUT
    return r === this.rings ? k === 0 : k < this.outwardCount(cell)
  }

  /** Cells of the next ring out that share a face with this one. */
  private outwardCount(cell: CellId): number {
    const r = this.ringOf[cell] as number
    if (r === this.rings) return 0
    return (this.count[r + 1] as number) / (this.count[r] as number)
  }

  /** Position of a cell within its ring. */
  indexOf(cell: CellId): number {
    return cell - (this.ringStart[this.ringOf[cell] as number] as number)
  }

  ringAt(cell: CellId): number {
    return this.ringOf[cell] as number
  }

  cellsIn(ring: number): number {
    return this.count[ring] as number
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
    const base = cell * this.faces
    for (let dir = 0; dir < this.faces; dir++) {
      const e = this.cellEdge[base + dir] as number
      if (e !== -1) out.push(e)
    }
    return out
  }

  neighbourAcross(cell: CellId, dir: number): CellId {
    const r = this.ringOf[cell] as number
    const i = this.indexOf(cell)
    const n = this.count[r] as number

    if (dir === IN) {
      if (r === 0) return -1
      if (r === 1) return 0
      const above = this.count[r - 1] as number
      return (this.ringStart[r - 1] as number) + Math.floor((i * above) / n)
    }
    if (dir === CW || dir === CCW) {
      if (r === 0) return -1
      const j = dir === CW ? (i + 1) % n : (i - 1 + n) % n
      return (this.ringStart[r] as number) + j
    }

    const k = dir - OUT
    const children = this.outwardCount(cell)
    if (k >= children) return -1
    return (this.ringStart[r + 1] as number) + i * children + k
  }

  // --- geometry ---

  private vertexAt(circle: number, index: number): number {
    const n = this.circleCount[circle] as number
    return (this.circleStart[circle] as number) + ((index % n) + n) % n
  }

  vertexPos(v: number): Point {
    let circle = 1
    while (circle <= this.rings + 1 && v >= (this.circleStart[circle + 1] as number)) circle++
    const index = v - (this.circleStart[circle] as number)
    const angle = (index / (this.circleCount[circle] as number)) * TAU
    const radius = circle * this.pitch
    const mid = this.width / 2
    return { x: mid + Math.cos(angle) * radius, y: mid + Math.sin(angle) * radius }
  }

  cellCenter(cell: CellId): Point {
    const mid = this.width / 2
    const r = this.ringOf[cell] as number
    if (r === 0) return { x: mid, y: mid }
    const n = this.count[r] as number
    const angle = ((this.indexOf(cell) + 0.5) / n) * TAU
    const radius = (r + 0.5) * this.pitch
    return { x: mid + Math.cos(angle) * radius, y: mid + Math.sin(angle) * radius }
  }

  cellAtPoint(p: Point): CellId {
    const mid = this.width / 2
    const dx = p.x - mid
    const dy = p.y - mid
    const r = Math.floor(Math.hypot(dx, dy) / this.pitch)
    if (r < 0 || r > this.rings) return -1
    if (r === 0) return 0
    const n = this.count[r] as number
    const angle = Math.atan2(dy, dx)
    const i = Math.floor((((angle % TAU) + TAU) % TAU / TAU) * n) % n
    return (this.ringStart[r] as number) + i
  }

  faceNormal(cell: CellId, dir: number): Point {
    const r = this.ringOf[cell] as number
    if (r === 0) {
      // Every face of the middle looks out along its own child's direction.
      const n = this.count[1] as number
      const a = ((dir - OUT + 0.5) / n) * TAU
      return { x: Math.cos(a), y: Math.sin(a) }
    }
    const n = this.count[r] as number
    const i = this.indexOf(cell)
    if (dir === IN || dir >= OUT) {
      const children = Math.max(1, this.outwardCount(cell))
      const a =
        dir === IN
          ? ((i + 0.5) / n) * TAU
          : ((i + (dir - OUT + 0.5) / children) / n) * TAU
      const sign = dir === IN ? -1 : 1
      return { x: Math.cos(a) * sign, y: Math.sin(a) * sign }
    }
    // Along the ring: tangent at the shared radial wall, pointing the way round.
    const a = ((dir === CW ? i + 1 : i) / n) * TAU
    const sign = dir === CW ? 1 : -1
    return { x: -Math.sin(a) * sign, y: Math.cos(a) * sign }
  }

  /**
   * The two lattice vertices bounding one face of a cell.
   *
   * Arcs are drawn as a single chord per face. The deviation is at most an
   * eighth of the pitch at the middle and far less further out, and every style
   * but Classic rounds the joints back into a curve.
   */
  faceSegment(cell: CellId, dir: number): Segment {
    const r = this.ringOf[cell] as number
    const i = this.indexOf(cell)

    if (r === 0) {
      const k = dir - OUT
      return [this.vertexAt(1, k), this.vertexAt(1, k + 1)]
    }

    const n = this.count[r] as number
    const outer = this.circleCount[r + 1] as number
    const step = outer / n

    if (dir === IN) return [this.vertexAt(r, i), this.vertexAt(r, i + 1)]
    if (dir >= OUT) {
      const k = dir - OUT
      const children = Math.max(1, this.outwardCount(cell))
      const span = step / children
      return [this.vertexAt(r + 1, i * step + k * span), this.vertexAt(r + 1, i * step + (k + 1) * span)]
    }
    // A radial wall, from the inner circle straight out to the outer one.
    const at = dir === CW ? i + 1 : i
    return [this.vertexAt(r, at), this.vertexAt(r + 1, at * step)]
  }

  faceMidpoint(cell: CellId, dir: number): Point {
    const [a, b] = this.faceSegment(cell, dir)
    const pa = this.vertexPos(a)
    const pb = this.vertexPos(b)
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
  }

  wallSegment(edge: EdgeId): Segment {
    return this.faceSegment(this.edgeCell[edge] as CellId, this.edgeDir[edge] as number)
  }
}

/** How many rings fit in a space, at a given ring depth. */
export function polarGridSize(width: number, height: number, pitch: number): number {
  return Math.max(2, Math.floor(Math.min(width, height) / (2 * pitch)) - 1)
}
