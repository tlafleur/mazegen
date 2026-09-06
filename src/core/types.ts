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

/**
 * Extra structure some carvers need beyond a bare graph.
 *
 * Sidewinder and Eller's are defined in terms of rows and columns — they carve
 * east along a run and then north out of it — so they cannot run on a topology
 * that has neither, such as the polar grid planned for phase 2. Declaring that
 * as a separate interface keeps `Topology` honest: a carver that takes only
 * `Topology` really does work on any cell complex, and one that needs more says
 * so in its signature.
 */
export interface RowStructured {
  readonly rows: number
  readonly cols: number
  cellAt(col: CellId, row: CellId): CellId
  /** Edge to the cell on the right, or -1 at the right-hand edge. */
  edgeEast(cell: CellId): EdgeId
  /** Edge to the cell above, or -1 on the top row. */
  edgeNorth(cell: CellId): EdgeId
}
