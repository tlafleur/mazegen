import type { CellId, EdgeId } from '../types'
import type { BaseGrid, Point, Segment } from './planar'

/** Face directions, clockwise from the upper right. */
export const NE = 0
export const E = 1
export const SE = 2
export const SW = 3
export const W = 4
export const NW = 5

const ROOT3 = Math.sqrt(3)
const H = ROOT3 / 2

/** Outward normals, in the same order, y growing downward. */
const HEX_NORMALS: readonly Point[] = [
  { x: 0.5, y: -H },
  { x: 1, y: 0 },
  { x: 0.5, y: H },
  { x: -0.5, y: H },
  { x: -1, y: 0 },
  { x: -0.5, y: -H },
]

/** Column and row offsets to each neighbour, for even rows and for odd ones. */
const STEP: readonly (readonly [number, number])[][] = [
  // even rows, in face order
  [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ],
  // odd rows are shifted half a cell right, so the diagonal steps differ
  [
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 0],
    [0, -1],
  ],
]

/**
 * A grid of pointy-top hexagons, in offset rows.
 *
 * The reason to have one is not novelty. A hexagonal cell has six neighbours
 * and no four-way junctions, so a maze on it has no long straight corridors and
 * every choice is a real one — it reads as a different puzzle rather than the
 * same puzzle drawn differently. Diagonal walls also flatter the wobbly line
 * styles, which on a square grid only ever bend at right angles.
 *
 * It exists as a `BaseGrid`, so masking, shapes, entrances, markers, every
 * carver and both output formats work on it without change. The one thing it
 * cannot offer is rows in the sense sidewinder means: a hexagon has two cells
 * above it rather than one, so "carve east along a run, then north out of it"
 * has no single answer. It declines `rowStructured`, and the difficulty recipe
 * for the gentlest level falls back on its own.
 *
 * `pitch` is centre-to-centre spacing, the same as on the square grid, so a
 * corridor is the same width in millimetres and the cell sizes named after
 * drawing tools keep their meaning.
 */
export class HexGrid implements BaseGrid {
  readonly faces = 6
  readonly cellCount: number
  readonly edgeCount: number
  readonly vertexCount: number
  readonly width: number
  readonly height: number

  /** Circumradius: centre to any corner. */
  private readonly r: number
  /** Lattice columns per vertex row. */
  private readonly vStride: number

  private readonly edgeCell: Int32Array
  private readonly edgeDir: Int32Array
  private readonly edgeEnds: Int32Array
  /** Edge id for each (cell, face), or -1 where the grid ends. */
  private readonly cellEdge: Int32Array

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly pitch: number,
  ) {
    if (cols < 2 || rows < 2) throw new Error(`grid too small: ${cols}x${rows}`)
    this.r = pitch / ROOT3
    this.cellCount = cols * rows
    // Odd rows sit half a cell to the right, so the grid is that much wider
    // than a plain multiple of the pitch.
    this.width = pitch * (cols + 0.5)
    this.height = this.r * (1.5 * rows + 0.5)

    this.vStride = 2 * cols + 2
    this.vertexCount = (2 * rows + 2) * this.vStride

    // One edge per adjacency, counted from the cell on the west side of it:
    // taking only E, SE and SW covers every pair exactly once.
    const cells: number[] = []
    const dirs: number[] = []
    this.cellEdge = new Int32Array(this.cellCount * 6).fill(-1)
    for (let cell = 0; cell < this.cellCount; cell++) {
      for (const dir of [E, SE, SW]) {
        const nb = this.neighbourAcross(cell, dir)
        if (nb === -1) continue
        const id = cells.length
        cells.push(cell)
        dirs.push(dir)
        this.cellEdge[cell * 6 + dir] = id
        this.cellEdge[nb * 6 + opposite(dir)] = id
      }
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

  colOf(cell: CellId): number {
    return cell % this.cols
  }

  rowOf(cell: CellId): number {
    return Math.floor(cell / this.cols)
  }

  cellAt(col: number, row: number): CellId {
    return row * this.cols + col
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
    for (let dir = 0; dir < 6; dir++) {
      const e = this.cellEdge[cell * 6 + dir] as number
      if (e !== -1) out.push(e)
    }
    return out
  }

  neighbourAcross(cell: CellId, dir: number): CellId {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    const [dc, dr] = STEP[r & 1]?.[dir] as readonly [number, number]
    const nc = c + dc
    const nr = r + dr
    if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) return -1
    return this.cellAt(nc, nr)
  }

  // --- geometry ---

  vertexPos(v: number): Point {
    const vr = Math.floor(v / this.vStride)
    const vc = v % this.vStride
    // Vertex rows alternate: the flat step from one hexagon's waist to the
    // next row's, then the short step up to its point.
    const y = 1.5 * this.r * Math.floor(vr / 2) + (vr & 1 ? 0.5 * this.r : 0)
    return { x: (vc * this.pitch) / 2, y }
  }

  cellCenter(cell: CellId): Point {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    return {
      x: this.pitch * (c + 0.5 + 0.5 * (r & 1)),
      y: this.r * (1 + 1.5 * r),
    }
  }

  /**
   * The cell containing a point, by rounding in cube coordinates.
   *
   * Rounding each axis separately would pick the wrong hexagon near a corner,
   * because the three cube coordinates must sum to zero; the fix is to round
   * all three and then discard whichever moved furthest.
   */
  cellAtPoint(p: Point): CellId {
    const xs = p.x - this.pitch / 2
    const ys = p.y - this.r
    const qf = ((ROOT3 / 3) * xs - ys / 3) / this.r
    const rf = ((2 / 3) * ys) / this.r
    const sf = -qf - rf

    let q = Math.round(qf)
    let r = Math.round(rf)
    const s = Math.round(sf)
    const dq = Math.abs(q - qf)
    const dr = Math.abs(r - rf)
    const ds = Math.abs(s - sf)
    if (dq > dr && dq > ds) q = -r - s
    else if (dr > ds) r = -q - s

    const col = q + (r - (r & 1)) / 2
    if (col < 0 || r < 0 || col >= this.cols || r >= this.rows) return -1
    // `| 0` for the sake of cell 0: rounding a small negative gives -0, which
    // is === 0 but not Object.is 0, and would be a poor thing to key a map on.
    return this.cellAt(col, r) | 0
  }

  faceNormal(dir: number): Point {
    return HEX_NORMALS[dir] as Point
  }

  /**
   * The six corners of a cell, as lattice-vertex ids, clockwise from the top.
   *
   * Shared ids rather than shared coordinates: two hexagons meeting at a corner
   * must name the same vertex, or the walls will not chain into polylines and
   * a jittered style will tear them apart at every junction.
   */
  private corners(cell: CellId): readonly number[] {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    const base = 2 * c + (r & 1)
    const v = (vr: number, vc: number): number => vr * this.vStride + vc
    return [
      v(2 * r, base + 1), // top
      v(2 * r + 1, base + 2), // upper right
      v(2 * r + 2, base + 2), // lower right
      v(2 * r + 3, base + 1), // bottom
      v(2 * r + 2, base), // lower left
      v(2 * r + 1, base), // upper left
    ]
  }

  faceSegment(cell: CellId, dir: number): Segment {
    const k = this.corners(cell)
    // Faces are named by the direction they face; corner `dir` and the next one
    // round bound it, which is why both lists run clockwise from the top.
    return [k[dir] as number, k[(dir + 1) % 6] as number]
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

function opposite(dir: number): number {
  return (dir + 3) % 6
}

/** How many hexagons fit in a space, at a given centre-to-centre spacing. */
export function hexGridSize(
  width: number,
  height: number,
  pitch: number,
): { cols: number; rows: number } {
  const r = pitch / ROOT3
  return {
    cols: Math.max(2, Math.floor(width / pitch - 0.5)),
    rows: Math.max(2, Math.floor((height / r - 0.5) / 1.5)),
  }
}
