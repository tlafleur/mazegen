import type { CellId, EdgeId, RowStructured, Topology } from '../types'

export interface Point {
  readonly x: number
  readonly y: number
}

/** A wall segment, as a pair of lattice-vertex ids. */
export type Segment = readonly [number, number]

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
export class SquareGrid implements Topology, RowStructured {
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

  /**
   * The outer rectangle, one segment per boundary cell face, minus the two
   * openings.
   *
   * Phase 0 is rectangles only, so start and end are the top-left and
   * bottom-right corners. Arbitrary outlines need the double-BFS placement
   * described in docs/DESIGN.md §6.
   */
  boundarySegments(): Segment[] {
    const out: Segment[] = []
    for (let c = 0; c < this.cols; c++) {
      if (c !== 0) out.push([this.vertexAt(c, 0), this.vertexAt(c + 1, 0)])
      if (c !== this.cols - 1) {
        out.push([this.vertexAt(c, this.rows), this.vertexAt(c + 1, this.rows)])
      }
    }
    for (let r = 0; r < this.rows; r++) {
      out.push([this.vertexAt(0, r), this.vertexAt(0, r + 1)])
      out.push([this.vertexAt(this.cols, r), this.vertexAt(this.cols, r + 1)])
    }
    return out
  }

  /** Where the solution line crosses the entrance, on the top edge. */
  entrancePoint(): Point {
    return { x: 0.5 * this.pitch, y: 0 }
  }

  /** Where the solution line crosses the exit, on the bottom edge. */
  exitPoint(): Point {
    return { x: (this.cols - 0.5) * this.pitch, y: this.height }
  }
}
