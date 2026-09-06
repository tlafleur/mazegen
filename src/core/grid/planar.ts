import type { CellId, EdgeId, RowStructured, Topology } from '../types'

export interface Point {
  readonly x: number
  readonly y: number
}

/** A wall segment, as a pair of lattice-vertex ids. */
export type Segment = readonly [number, number]

/** Face directions, in the order used for outward normals below. */
export const NORTH = 0
export const EAST = 1
export const SOUTH = 2
export const WEST = 3

/** Outward normal of each face, in page coordinates where y grows downward. */
export const FACE_NORMALS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

/**
 * A grid of cells before any shape is cut out of it.
 *
 * `MaskedGrid` is written against this rather than against a rectangle, which
 * is what lets a second cell complex — hexagons — reuse masking, shapes,
 * openings, markers, every carver and both renderers without any of them
 * knowing it exists. A cell has `faces` sides; which face is which is the
 * grid's own business, and the only thing anyone outside asks is where a face
 * is and what lies across it.
 */
export interface BaseGrid extends Topology {
  readonly pitch: number
  readonly width: number
  readonly height: number
  readonly vertexCount: number
  /** Sides per cell: four for squares, six for hexagons. */
  readonly faces: number
  vertexPos(vertex: number): Point
  cellCenter(cell: CellId): Point
  /** The cell containing a point, or -1 outside the grid. */
  cellAtPoint(p: Point): CellId
  /** The cell across a face, or -1 when the grid ends there. */
  neighbourAcross(cell: CellId, dir: number): CellId
  /** The two lattice vertices bounding one face of a cell. */
  faceSegment(cell: CellId, dir: number): Segment
  /** Midpoint of one face of a cell. */
  faceMidpoint(cell: CellId, dir: number): Point
  /** Outward unit normal of a face, in page coordinates where y grows down. */
  faceNormal(dir: number): Point
  /** The wall this edge draws when left closed. */
  wallSegment(edge: EdgeId): Segment
  /** Rows and columns, for the carvers that need them; null when there are none. */
  rowStructured?(): (Topology & RowStructured) | null
}

/**
 * The geometric half of a grid: what the renderer needs, and nothing a carver
 * is allowed to see.
 *
 * `Topology` says which cells are adjacent; this says where they are. Keeping
 * them apart is what lets a carver run unchanged on a rectangle, a masked
 * shape, or a future hex grid.
 */
export interface PlanarGrid {
  readonly pitch: number
  /** Bounding box of the whole grid, in millimetres. */
  readonly width: number
  readonly height: number
  readonly vertexCount: number
  vertexPos(vertex: number): Point
  cellCenter(cell: CellId): Point
  /**
   * The cell containing a point, or -1 for a point outside the shape.
   *
   * The inverse of `cellCenter`, and what turns a finger on a screen into a
   * move: solving on screen is "which cell is this, and is there a passage to
   * it from the last one".
   */
  cellAtPoint(p: Point): CellId
  /** The wall this edge draws when left closed. */
  wallSegment(edge: EdgeId): Segment
  /**
   * The outline: every cell face with nothing on the other side. Faces chosen
   * as openings for the listed cells are left out.
   */
  boundarySegments(openAt?: readonly CellId[]): Segment[]
  /** Midpoint of a cell's opening face, where the solution line crosses out. */
  openingPoint(cell: CellId): Point
  /**
   * The two lattice vertices bounding that opening face, or null for a cell
   * that is not on the outline.
   *
   * The renderer needs the vertices rather than the midpoint so it can displace
   * them the same way it displaces the walls; taking a fixed midpoint would
   * leave the solution line detached from its own gap once jitter is on.
   */
  openingSegment(cell: CellId): Segment | null
  /**
   * Which way the opening faces, as a unit vector, or null for a cell that is
   * not on the outline. Decoration is placed along it, outside the maze, which
   * is how it stays clear of the walls without any collision test.
   */
  openingNormal(cell: CellId): Point | null
}
