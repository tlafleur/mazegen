/** Index of a cell within a topology. */
export type CellId = number

/** Index of an undirected adjacency between two cells. */
export type EdgeId = number

/**
 * The abstract graph a carving algorithm works on.
 *
 * Deliberately geometry-free: a carver decides which adjacencies become
 * passages and must not be able to ask where a cell sits on the page. That
 * separation is what lets hex, triangle and polar grids reuse every carver
 * unchanged.
 */
export interface Topology {
  readonly cellCount: number
  readonly edgeCount: number
  /** Edges incident to `cell`. */
  edgesOf(cell: CellId): readonly EdgeId[]
  /** The cell on the far side of `edge` from `from`. */
  other(edge: EdgeId, from: CellId): CellId
  /** The two cells `edge` joins. */
  endpoints(edge: EdgeId): readonly [CellId, CellId]
}

/** A carved maze: a topology plus the set of adjacencies that are open. */
export interface Maze {
  readonly topo: Topology
  /** True at index `e` when edge `e` is a passage rather than a wall. */
  readonly open: Uint8Array
  readonly start: CellId
  readonly end: CellId
}
