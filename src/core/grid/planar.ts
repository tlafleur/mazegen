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
  /**
   * The closest two passages that share no cell can come, in millimetres.
   *
   * Not the same as the pitch. On squares two parallel corridors are a whole
   * cell apart, but on hexagons the nearest parallel pair is only √3/2 of one —
   * so a Cave tunnel sized from the pitch would very nearly touch its
   * neighbour, and at fine-pen density would merge with it. Anything that draws
   * *between* cells rather than along their faces has to measure from this.
   */
  readonly passageGap: number
  readonly width: number
  readonly height: number
  readonly vertexCount: number
  /**
   * Face slots per cell — the most any cell has.
   *
   * On squares and hexagons every cell has exactly this many. On a polar grid a
   * cell has three, four or five and the middle has as many as the first ring,
   * so `faces` is the largest and `hasFace` says which of the slots are real
   * for a given cell. Without that, an unused slot looks exactly like a face
   * with nothing across it — which is to say, like the edge of the maze.
   */
  readonly faces: number
  /** Whether this cell has a face in this slot at all. Default: all of them. */
  hasFace?(cell: CellId, dir: number): boolean
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
  /**
   * Outward unit normal of one face of a cell, y growing down.
   *
   * Takes the cell because on a polar grid it has to: the outward face of a
   * ring cell points away from the centre, so which way "out" is depends on
   * where the cell sits, not only on which of its faces you name.
   */
  faceNormal(cell: CellId, dir: number): Point
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
  /** See `BaseGrid.passageGap`. */
  readonly passageGap: number
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
