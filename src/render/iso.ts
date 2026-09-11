import type { CellId, Maze } from '../core/types'
import type { PlanarGrid, Point, Segment } from '../core/grid/planar'
import { DEFAULT_MARGIN, type Paper } from './page'
import type { PathCommand } from './path'
import type { SheetStroke } from './pdf'

/**
 * True isometric: the three axes are equally foreshortened, so a millimetre
 * along x, y or z is the same length on the page whichever one it runs along.
 * That is the property that makes the drawing measurable rather than merely
 * three-dimensional-looking, and it is why this is not the 2:1 projection games
 * use — that one squashes the ground plane to make tiles line up on a pixel
 * grid, which is a screen problem this does not have.
 */
const COS30 = Math.sqrt(3) / 2
const SIN30 = 0.5

/**
 * Wall height, as a fraction of the cell pitch.
 *
 * The one number that decides whether an isometric maze is solvable. A wall
 * hides the floor behind it for `height / SIN30` millimetres — at 0.3 × pitch
 * that is 0.6 of a cell, so a corridor running away from the viewer is still
 * more than half visible past the wall in front of it. At 0.5 it would be a
 * whole cell and such corridors would disappear entirely.
 *
 * So these are curbs rather than hedges. Measured by rendering, not chosen.
 */
export const ISO_HEIGHT = 0.3

/**
 * Grid millimetres to page millimetres, and back again.
 *
 * `z` is height above the floor. Nothing in the app raises anything off the
 * floor yet, but the parameter is here rather than added later on purpose: a
 * weave maze's bridges are exactly a wall whose base is not at zero, and the
 * projection is where that first has to be expressible. See docs/DESIGN.md §13.
 */
export interface IsoView {
  /** Page millimetres per grid millimetre. One, unless the grid overflows. */
  readonly scale: number
  /** Wall height in grid millimetres. */
  readonly wallHeight: number
  to(p: Point, z?: number): Point
  /** A page point back onto the floor plane, for solving on screen. */
  from(p: Point): Point
}

/**
 * Fit a grid's projection to the page.
 *
 * The projected bounding box of a `w` by `h` grid is always
 * `(w + h) · cos30` wide by `(w + h) · sin30` tall, whatever the split between
 * the two — rotating a rectangle 45° and squashing it does not care which side
 * was which. That fixed 1.73:1 shape is why an isometric sheet leaves a band
 * of paper empty above and below, and why `isoGridSize` sizes the grid to fill
 * the page's *width*.
 */
export function isoView(
  paper: Paper,
  grid: { width: number; height: number; pitch: number },
  margin: number = DEFAULT_MARGIN,
): IsoView {
  const wallHeight = grid.pitch * ISO_HEIGHT
  const span = grid.width + grid.height
  const boxW = span * COS30
  const boxH = span * SIN30 + wallHeight
  const liveW = paper.width - 2 * margin
  const liveH = paper.height - 2 * margin

  // Normally 1: `isoGridSize` picks a grid that already fits. The clamp is for
  // anything that arrives at a size it did not choose — a word maze, a grid
  // built for a different sheet — which should come out small rather than off
  // the edge of the paper.
  const scale = Math.min(1, liveW / boxW, liveH / boxH)

  // Where unprojected (0, 0, 0) lands, once the box is centred in the live area.
  const tx = margin + (liveW - scale * boxW) / 2 + scale * grid.height * COS30
  const ty = margin + (liveH - scale * boxH) / 2 + scale * wallHeight

  return {
    scale,
    wallHeight,
    to(p: Point, z = 0): Point {
      return {
        x: tx + scale * (p.x - p.y) * COS30,
        y: ty + scale * ((p.x + p.y) * SIN30 - z),
      }
    },
    from(p: Point): Point {
      const u = (p.x - tx) / scale / COS30
      const v = (p.y - ty) / scale / SIN30
      return { x: (u + v) / 2, y: (v - u) / 2 }
    },
  }
}

/**
 * The largest grid whose projection fits the page, in grid millimetres.
 *
 * Returned as a box for the existing sizing functions to fill, so hexagons and
 * rings get the isometric view for nothing: only the space they are given
 * changes, not how they divide it.
 *
 * An isometric sheet holds far fewer cells than a flat one — a quarter, near
 * enough. That is not a defect to tune away. The projection spends most of the
 * page on the two empty bands the 1.73:1 bounding box leaves, and corridors
 * come out `cos30` of their width besides, so keeping the cell count would mean
 * breaking the promise cell size makes about how wide a corridor is.
 */
export function isoLiveArea(
  paper: Paper,
  pitch: number,
  margin: number = DEFAULT_MARGIN,
): { width: number; height: number } {
  const wallHeight = pitch * ISO_HEIGHT
  const span = Math.min(
    (paper.width - 2 * margin) / COS30,
    (paper.height - 2 * margin - wallHeight) / SIN30,
  )
  // Split evenly: a square grid projects to a symmetric rhombus, where a
  // lopsided one leans across the page without fitting any more of itself on it.
  const side = Math.max(2 * pitch, span / 2)
  return { width: side, height: side }
}

/** Grid-space depth: larger is nearer the viewer, so drawn later. */
function depth(a: Point, b: Point): number {
  return a.x + a.y + b.x + b.y
}

/** Two directions lying on the same line, whichever way round each one runs. */
function parallel(a: Point, b: Point): boolean {
  const la = Math.hypot(a.x, a.y)
  const lb = Math.hypot(b.x, b.y)
  if (la === 0 || lb === 0) return false
  return Math.abs((a.x * b.y - a.y * b.x) / (la * lb)) < 1e-9
}

interface Panel {
  readonly a: Point
  readonly b: Point
  /** Whether to draw the upright edge at that end, or let the wall run on. */
  readonly capA: boolean
  readonly capB: boolean
  readonly z: number
}

/**
 * Walls as upright panels, drawn back to front.
 *
 * A wall has no thickness — it is a card standing on the floor — so there is no
 * top face to draw and the whole thing is one quadrilateral: along the base,
 * up, back along the top, down. Filled white before it is outlined, which is
 * the entire occlusion model: a nearer panel simply paints over the one behind
 * it. Sorting by the sum of the endpoints' grid coordinates is enough to order
 * them, because every wall in a grid lies on a cell boundary and no two of them
 * cross.
 *
 * The upright edge where one wall meets the next one in line is left undrawn.
 * It is not a real edge — the two panels are coplanar — and rendering it turned
 * every long wall into a row of bricks, which read as hatching and buried the
 * maze under its own texture. Corners and ends keep theirs, because there the
 * two panels genuinely turn away from each other.
 */
export function isoStrokes(
  grid: PlanarGrid,
  maze: Maze,
  view: IsoView,
  stroke: number,
  decoys: readonly CellId[],
): SheetStroke[] {
  const segments: Segment[] = grid.boundarySegments([maze.start, maze.end, ...decoys])
  for (let e = 0; e < maze.topo.edgeCount; e++) {
    if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
  }

  // Which walls meet at each lattice vertex, so a wall can ask whether another
  // one carries on from its end.
  const meeting = new Map<number, number[]>()
  const join = (v: number, i: number): void => {
    const at = meeting.get(v)
    if (at === undefined) meeting.set(v, [i])
    else at.push(i)
  }
  segments.forEach(([u, v], i) => {
    join(u, i)
    join(v, i)
  })

  const ends = segments.map(([u, v]) => ({ a: grid.vertexPos(u), b: grid.vertexPos(v) }))
  const runsOn = (i: number, vertex: number): boolean => {
    const here = ends[i] as { a: Point; b: Point }
    const mine = { x: here.b.x - here.a.x, y: here.b.y - here.a.y }
    for (const j of meeting.get(vertex) ?? []) {
      if (j === i) continue
      const other = ends[j] as { a: Point; b: Point }
      if (parallel(mine, { x: other.b.x - other.a.x, y: other.b.y - other.a.y })) return true
    }
    return false
  }

  const panels: Panel[] = segments.map(([u, v], i) => {
    const { a, b } = ends[i] as { a: Point; b: Point }
    return { a, b, capA: !runsOn(i, u), capB: !runsOn(i, v), z: depth(a, b) }
  })
  panels.sort((p, q) => p.z - q.z)

  const h = view.wallHeight
  const out: SheetStroke[] = []
  for (const panel of panels) {
    const base = [view.to(panel.a), view.to(panel.b)]
    const top = [view.to(panel.a, h), view.to(panel.b, h)]
    const corners = [base[0] as Point, base[1] as Point, top[1] as Point, top[0] as Point]

    const line = (from: Point, to: Point): PathCommand[] => [
      { op: 'M', x: from.x, y: from.y },
      { op: 'L', x: to.x, y: to.y },
    ]
    const edges: PathCommand[] = [
      ...line(base[0] as Point, base[1] as Point),
      ...line(top[0] as Point, top[1] as Point),
      ...(panel.capA ? line(base[0] as Point, top[0] as Point) : []),
      ...(panel.capB ? line(base[1] as Point, top[1] as Point) : []),
    ]

    // Fill first, outline second, one wall at a time: batching every fill and
    // then every outline would put the whole back of the maze on top of its
    // front.
    out.push({
      commands: [
        ...corners.map((c, i) => ({ op: i === 0 ? ('M' as const) : ('L' as const), x: c.x, y: c.y })),
        { op: 'Z' as const },
      ],
      width: 0,
      fill: true,
      light: true,
    })
    out.push({ commands: edges, width: stroke })
  }
  return out
}
