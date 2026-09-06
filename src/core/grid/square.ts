import type { CellId, EdgeId, RowStructured } from '../types'
import {
  EAST,
  FACE_NORMALS,
  NORTH,
  SOUTH,
  type BaseGrid,
  type Point,
  type Segment,
} from './planar'

export type { Point, Segment }

/**
 * A rectangular grid of square cells.
 *
 * Geometry lives here rather than in the carver or the renderer: the carver is
 * handed only the `Topology` half, and the renderer asks the grid where things
 * are. Adding hex or polar grids later means implementing this same pair of
 * responsibilities, not touching either neighbour.
 *
 * Coordinates are millimetres with the origin at the maze's top-left corner.
 * Placing the maze on a page is the renderer's job.
 */
export class SquareGrid implements BaseGrid, RowStructured {
  /** Four sides, in the order NORTH, EAST, SOUTH, WEST. */
  readonly faces = 4
  /** Two parallel corridors sit one whole cell apart. */
  readonly passageGap: number
  readonly cellCount: number
  readonly edgeCount: number
  readonly vertexCount: number
  readonly width: number
  readonly height: number

  /** Number of left-right adjacencies; edges below this index are horizontal. */
  private readonly hCount: number

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly pitch: number,
  ) {
    if (cols < 2 || rows < 2) throw new Error(`grid too small: ${cols}x${rows}`)
    this.cellCount = cols * rows
    this.hCount = (cols - 1) * rows
    this.edgeCount = this.hCount + cols * (rows - 1)
    this.vertexCount = (cols + 1) * (rows + 1)
    this.width = cols * pitch
    this.height = rows * pitch
    this.passageGap = pitch
  }

  cellAt(col: number, row: number): CellId {
    return row * this.cols + col
  }

  colOf(cell: CellId): number {
    return cell % this.cols
  }

  rowOf(cell: CellId): number {
    return Math.floor(cell / this.cols)
  }

  endpoints(edge: EdgeId): readonly [CellId, CellId] {
    if (edge < this.hCount) {
      const span = this.cols - 1
      const r = Math.floor(edge / span)
      const c = edge % span
      const a = this.cellAt(c, r)
      return [a, a + 1]
    }
    const j = edge - this.hCount
    const r = Math.floor(j / this.cols)
    const c = j % this.cols
    const a = this.cellAt(c, r)
    return [a, a + this.cols]
  }

  other(edge: EdgeId, from: CellId): CellId {
    const [a, b] = this.endpoints(edge)
    return a === from ? b : a
  }

  edgesOf(cell: CellId): readonly EdgeId[] {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    const out: EdgeId[] = []
    const span = this.cols - 1
    if (c > 0) out.push(r * span + (c - 1))
    if (c < this.cols - 1) out.push(r * span + c)
    if (r > 0) out.push(this.hCount + (r - 1) * this.cols + c)
    if (r < this.rows - 1) out.push(this.hCount + r * this.cols + c)
    return out
  }

  // --- RowStructured, for carvers that work in rows and columns ---

  edgeEast(cell: CellId): EdgeId {
    const c = this.colOf(cell)
    if (c === this.cols - 1) return -1
    return this.rowOf(cell) * (this.cols - 1) + c
  }

  edgeNorth(cell: CellId): EdgeId {
    const r = this.rowOf(cell)
    if (r === 0) return -1
    return this.hCount + (r - 1) * this.cols + this.colOf(cell)
  }

  // --- geometry ---

  vertexAt(vc: number, vr: number): number {
    return vr * (this.cols + 1) + vc
  }

  vertexPos(v: number): Point {
    const stride = this.cols + 1
    return { x: (v % stride) * this.pitch, y: Math.floor(v / stride) * this.pitch }
  }

  cellCenter(cell: CellId): Point {
    return {
      x: (this.colOf(cell) + 0.5) * this.pitch,
      y: (this.rowOf(cell) + 0.5) * this.pitch,
    }
  }

  cellAtPoint(p: Point): CellId {
    const col = Math.floor(p.x / this.pitch)
    const row = Math.floor(p.y / this.pitch)
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1
    return this.cellAt(col, row)
  }

  faceNormal(dir: number): Point {
    return FACE_NORMALS[dir] as Point
  }

  /** The wall this edge draws when it is left closed. */
  wallSegment(edge: EdgeId): Segment {
    if (edge < this.hCount) {
      const span = this.cols - 1
      const r = Math.floor(edge / span)
      const c = edge % span
      // Shared face is vertical, on the right-hand side of cell (c, r).
      return [this.vertexAt(c + 1, r), this.vertexAt(c + 1, r + 1)]
    }
    const j = edge - this.hCount
    const r = Math.floor(j / this.cols)
    const c = j % this.cols
    // Shared face is horizontal, along the bottom of cell (c, r).
    return [this.vertexAt(c, r + 1), this.vertexAt(c + 1, r + 1)]
  }

  /** The cell across a face, or -1 when that face is the edge of the grid. */
  neighbourAcross(cell: CellId, dir: number): CellId {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    if (dir === NORTH) return r > 0 ? cell - this.cols : -1
    if (dir === EAST) return c < this.cols - 1 ? cell + 1 : -1
    if (dir === SOUTH) return r < this.rows - 1 ? cell + this.cols : -1
    return c > 0 ? cell - 1 : -1
  }

  /** The edge across a face, or -1 when that face is the edge of the grid. */
  edgeAcross(cell: CellId, dir: number): EdgeId {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    if (dir === NORTH) return r > 0 ? this.hCount + (r - 1) * this.cols + c : -1
    if (dir === EAST) return c < this.cols - 1 ? r * (this.cols - 1) + c : -1
    if (dir === SOUTH) return r < this.rows - 1 ? this.hCount + r * this.cols + c : -1
    return c > 0 ? r * (this.cols - 1) + (c - 1) : -1
  }

  /** Always available here: a bare rectangle has nothing but full rows. */
  rowStructured(): SquareGrid {
    return this
  }

  /** The two lattice vertices bounding one face of a cell. */
  faceSegment(cell: CellId, dir: number): Segment {
    const c = this.colOf(cell)
    const r = this.rowOf(cell)
    if (dir === NORTH) return [this.vertexAt(c, r), this.vertexAt(c + 1, r)]
    if (dir === EAST) return [this.vertexAt(c + 1, r), this.vertexAt(c + 1, r + 1)]
    if (dir === SOUTH) return [this.vertexAt(c, r + 1), this.vertexAt(c + 1, r + 1)]
    return [this.vertexAt(c, r), this.vertexAt(c, r + 1)]
  }

  /** Midpoint of one face of a cell. */
  faceMidpoint(cell: CellId, dir: number): Point {
    const [a, b] = this.faceSegment(cell, dir)
    const pa = this.vertexPos(a)
    const pb = this.vertexPos(b)
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
  }
}
