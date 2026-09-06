import type { CellId, EdgeId } from '../types'

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
