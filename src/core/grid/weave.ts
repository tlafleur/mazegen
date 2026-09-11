import type { CellId, EdgeId } from '../types'
import type { Rng } from '../rng'
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  type BaseGrid,
  type Crossing,
  type Point,
  type Segment,
} from './planar'
import { SquareGrid } from './square'

/** How much of a cell the bridge is wide. */
export const BRIDGE_WIDTH = 0.56

/**
 * What fraction of the cells that could carry a crossing do.
 *
 * Each one costs a cell and roughly half of them come out as a solid block, so
 * this is bounded by how much of the page may be spent rather than by how many
 * bridges look good. At 0.06 a fine-pen sheet gets about a hundred crossings,
 * half of them carried, and loses 3% of its cells.
 */
export const WEAVE_DENSITY = 0.06

/**
 * A square grid with bridges: corridors that cross over one another.
 *
 * The largest genuine step in difficulty available, and the reason is that it
 * breaks the one assumption a solver never questions — that two corridors
 * meeting on the page meet in the maze. Every carver, the braider, the solver,
 * the metrics and both output formats work on it untouched, because a bridge is
 * an ordinary adjacency in the graph; only its geometry is unusual.
 *
 * **A crossing position holds no cell.** It holds two edges instead: one
 * joining the cells above and below it, one joining the cells left and right,
 * and they do not meet. That is the whole design, and it was arrived at by
 * measuring the alternative.
 *
 * The obvious model gives the position a cell carrying the lower corridor and
 * adds the bridge beside it. It does not work. A carver knows nothing about
 * crossings, so it will happily leave that cell a dead end with a bridge over
 * it — and a bridge over a dead end can only be drawn as a sealed sliver of
 * white that means nothing. Forcing the corridor through costs a loop apiece,
 * and measured on a fine-pen sheet that was 237 loops: the shortest route fell
 * from 1189 cells to 146 and the difficulty score from 0.75 to 0.17. A feature
 * meant to be the hardest thing in the app was making the easiest mazes in it.
 *
 * With no cell there, the corridor underneath is one edge rather than two, so
 * it is carved or it is not and there is no third state to draw. The price is
 * that when neither edge is carved the position is a solid block, which is why
 * `WEAVE_DENSITY` is low: a few blocks read as deliberate, a few hundred read
 * as damage.
 */
export class WeaveGrid implements BaseGrid {
  readonly faces = 4
  readonly passageGap: number
  readonly cellCount: number
  readonly edgeCount: number
  readonly vertexCount: number
  readonly width: number
  readonly height: number
  readonly pitch: number

  private readonly grid: SquareGrid
  private readonly all: readonly WeaveCrossing[]
  /** Crossing index for each base cell, or -1. */
  private readonly crossingAt: Int32Array
  /** Local cell id for each base cell, or -1 where a crossing took the place. */
  private readonly fromBase: Int32Array
  private readonly toBase: Int32Array
  private readonly edgeEnds: Int32Array
  private readonly adjOffset: Int32Array
  private readonly adjEdges: Int32Array
  /** One wall each edge draws when closed. */
  private readonly edgeWall: Segment[]

  constructor(cols: number, rows: number, pitch: number, rng: Rng, density: number) {
    const grid = new SquareGrid(cols, rows, pitch)
    this.grid = grid
    this.pitch = pitch
    this.passageGap = pitch
    this.vertexCount = grid.vertexCount
    this.width = grid.width
    this.height = grid.height

    this.crossingAt = new Int32Array(grid.cellCount).fill(-1)
    const chosen: { cell: CellId; acrossX: boolean }[] = []

    // Interior cells only: a crossing needs a cell on all four sides to join.
    const candidates: CellId[] = []
    for (let c = 0; c < grid.cellCount; c++) {
      const col = grid.colOf(c)
      const r = grid.rowOf(c)
      if (col > 0 && r > 0 && col < cols - 1 && r < rows - 1) candidates.push(c)
    }
    rng.shuffle(candidates)

    const want = Math.floor(candidates.length * Math.max(0, Math.min(1, density)))
    for (const cell of candidates) {
      if (chosen.length >= want) break
      // Two crossings side by side would each need the other's cell to land on.
      let clear = true
      for (const dir of [NORTH, EAST, SOUTH, WEST]) {
        const nb = grid.neighbourAcross(cell, dir)
        if (nb !== -1 && (this.crossingAt[nb] as number) !== -1) clear = false
      }
      if (!clear) continue
      this.crossingAt[cell] = chosen.length
      chosen.push({ cell, acrossX: rng.int(2) === 0 })
    }

    // Cells, minus the places the crossings took.
    const keep: CellId[] = []
    this.fromBase = new Int32Array(grid.cellCount).fill(-1)
    for (let c = 0; c < grid.cellCount; c++) {
      if ((this.crossingAt[c] as number) !== -1) continue
      this.fromBase[c] = keep.length
      keep.push(c)
    }
    this.toBase = Int32Array.from(keep)
    this.cellCount = keep.length

    const ends: number[] = []
    const walls: Segment[] = []
    const add = (a: CellId, b: CellId, wall: Segment): EdgeId => {
      const id = ends.length / 2
      ends.push(a, b)
      walls.push(wall)
      return id
    }

    for (let e = 0; e < grid.edgeCount; e++) {
      const [a, b] = grid.endpoints(e)
      const la = this.fromBase[a] as number
      const lb = this.fromBase[b] as number
      if (la < 0 || lb < 0) continue
      add(la, lb, grid.wallSegment(e))
    }

    // Then the pairs a crossing joins. `sides` closes the corridor that passes
    // over, `blocks` the one that passes under — naming the faces rather than
    // the axes, because which axis is which is the crossing's own business.
    this.all = chosen.map((x) => {
      const overPair = x.acrossX ? [WEST, EAST] : [NORTH, SOUTH]
      const underPair = x.acrossX ? [NORTH, SOUTH] : [WEST, EAST]
      const face = (d: number): Segment => grid.faceSegment(x.cell, d)
      const sides: readonly [Segment, Segment] = [
        face(overPair[0] as number),
        face(overPair[1] as number),
      ]
      const blocks: readonly [Segment, Segment] = [
        face(underPair[0] as number),
        face(underPair[1] as number),
      ]
      const cellAt = (d: number): CellId =>
        this.fromBase[grid.neighbourAcross(x.cell, d) as CellId] as CellId
      const over = add(cellAt(overPair[0] as number), cellAt(overPair[1] as number), sides[0])
      const under = add(cellAt(underPair[0] as number), cellAt(underPair[1] as number), blocks[0])
      return { at: grid.cellCenter(x.cell), acrossX: x.acrossX, edge: over, under, sides, blocks }
    })

    this.edgeCount = walls.length
    this.edgeEnds = Int32Array.from(ends)
    this.edgeWall = walls

    const degree = new Int32Array(this.cellCount)
    for (const v of this.edgeEnds) degree[v] = (degree[v] as number) + 1
    this.adjOffset = new Int32Array(this.cellCount + 1)
    for (let c = 0; c < this.cellCount; c++) {
      this.adjOffset[c + 1] = (this.adjOffset[c] as number) + (degree[c] as number)
    }
    const cursor = Int32Array.from(this.adjOffset.subarray(0, this.cellCount))
    this.adjEdges = new Int32Array(this.edgeEnds.length)
    for (let i = 0; i < this.edgeEnds.length; i++) {
      const v = this.edgeEnds[i] as number
      this.adjEdges[cursor[v] as number] = i >> 1
      cursor[v] = (cursor[v] as number) + 1
    }
  }

  crossings(): readonly WeaveCrossing[] {
    return this.all
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
    const from = this.adjOffset[cell] as number
    const to = this.adjOffset[cell + 1] as number
    return Array.from(this.adjEdges.subarray(from, to))
  }

  /**
   * The cell across a face, or -1.
   *
   * A crossing is never across a face: the cells it joins are two apart, and
   * the face between them belongs to nothing. That is what makes every wall the
   * renderer draws at a crossing the crossing's own business rather than a
   * neighbour's, and it is why `hasFace` says the face is not there at all —
   * otherwise an interior crossing would look like the edge of the maze, which
   * is where `MaskedGrid` cuts entrances.
   */
  neighbourAcross(cell: CellId, dir: number): CellId {
    const nb = this.grid.neighbourAcross(this.toBase[cell] as CellId, dir)
    if (nb === -1) return -1
    const local = this.fromBase[nb] as number
    return local < 0 ? -1 : local
  }

  hasFace(cell: CellId, dir: number): boolean {
    const nb = this.grid.neighbourAcross(this.toBase[cell] as CellId, dir)
    return nb === -1 || (this.crossingAt[nb] as number) === -1
  }

  // --- geometry, all of it the plain grid's ---

  vertexPos(v: number): Point {
    return this.grid.vertexPos(v)
  }

  cellCenter(cell: CellId): Point {
    return this.grid.cellCenter(this.toBase[cell] as CellId)
  }

  /** A point over a crossing belongs to no cell, which is the truth about it. */
  cellAtPoint(p: Point): CellId {
    const base = this.grid.cellAtPoint(p)
    return base === -1 ? -1 : (this.fromBase[base] as CellId)
  }

  faceNormal(cell: CellId, dir: number): Point {
    return this.grid.faceNormal(this.toBase[cell] as CellId, dir)
  }

  faceSegment(cell: CellId, dir: number): Segment {
    return this.grid.faceSegment(this.toBase[cell] as CellId, dir)
  }

  faceMidpoint(cell: CellId, dir: number): Point {
    return this.grid.faceMidpoint(this.toBase[cell] as CellId, dir)
  }

  wallSegment(edge: EdgeId): Segment {
    return this.edgeWall[edge] as Segment
  }
}

/**
 * A crossing, plus the edge running under it and the walls that close each.
 *
 * `edge` is the bridge and `under` the corridor beneath. `sides` closes the
 * bridge and `blocks` closes the corridor — each a pair, of which the grid
 * returns the first from `wallSegment` and the renderer draws whichever of the
 * rest the four combinations call for. See `weaveWalls` in render/sheet.ts.
 */
export interface WeaveCrossing extends Crossing {
  readonly under: EdgeId
  readonly blocks: readonly [Segment, Segment]
}
