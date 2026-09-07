import type { CellId, Maze } from '../core/types'
import type { PlanarGrid, Point, Segment } from '../core/grid/planar'
import { chainSegments } from './chain'
import { polylineCommands, type PathCommand } from './path'
import { DEFAULT_MARGIN, type Paper } from './page'
import { CAVE_GAP, CLASSIC, MAX_JITTER, jitterOffset, sketchOffset, type Style } from './style'
import { markerSet, placeMarker } from './marker'
import type { Sheet, SheetLabel, SheetStroke } from './pdf'

/** Twice the area a closed ring encloses, signed. Sign is not used, only size. */
function enclosedArea(ring: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point
    const b = ring[(i + 1) % ring.length] as Point
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** The box a marker is drawn in, and its clearance from the outline, in mm. */
const MARKER_SIZE = 10
const MARKER_GAP = 1.5

export interface SheetOptions {
  readonly paper: Paper
  readonly stroke: number
  readonly margin?: number
  readonly showSolution?: boolean
  readonly style?: Style
  /** Varies the jitter without changing the maze. */
  readonly styleSeed?: number
  /** Which drawings to put at the two ends: "mouse", "arrows" or "none". */
  readonly markers?: string
  /**
   * Ink the page around the maze, leaving the maze itself white.
   *
   * What makes a word maze readable: at cell scale the letters are a field of
   * corridors like any other, and it is the *outside* that says where they end.
   * Costs a great deal of toner, so it is off unless asked for.
   */
  readonly inkOutside?: boolean
  /** Draw a 100 mm reference line and a caption in the bottom margin. */
  readonly calibration?: boolean
  readonly caption?: string
}

/**
 * Where the maze's top-left corner sits on the page, in millimetres.
 *
 * Exported because solving on screen needs the same answer in reverse: a
 * finger's position on the sheet has to become a position in the grid, and it
 * would be no use if the two disagreed by a millimetre.
 */
export function sheetOrigin(
  paper: Paper,
  grid: { width: number; height: number },
  margin: number = DEFAULT_MARGIN,
): Point {
  // Centre the maze in the live area: flooring cols and rows to whole cells
  // leaves up to one cell of slack in each direction.
  return {
    x: margin + (paper.width - 2 * margin - grid.width) / 2,
    y: margin + (paper.height - 2 * margin - grid.height) / 2,
  }
}

/**
 * Everything on one page, described once.
 *
 * Both outputs render this same structure. Building the geometry separately for
 * screen and for print is the fastest way to have a printed sheet quietly
 * disagree with the preview it came from.
 */
export function buildSheet(
  grid: PlanarGrid,
  maze: Maze,
  solution: readonly CellId[] | null,
  opts: SheetOptions,
): Sheet {
  const margin = opts.margin ?? DEFAULT_MARGIN
  const { paper } = opts
  const strokes: SheetStroke[] = []
  const labels: SheetLabel[] = []

  const { x: ox, y: oy } = sheetOrigin(paper, grid, margin)

  const style = opts.style ?? CLASSIC
  const radius = style.rounding * grid.pitch
  // Clamped here rather than trusted from the style, so no style can define
  // away the corridor-width guarantee.
  const jitter = Math.min(style.jitter, MAX_JITTER) * grid.pitch
  const styleSeed = opts.styleSeed ?? 0

  /** A lattice vertex, displaced and moved onto the page. */
  const at = (v: number): Point => {
    const p = grid.vertexPos(v)
    const j = jitterOffset(v, styleSeed, jitter)
    return { x: p.x + j.x + ox, y: p.y + j.y + oy }
  }

  // Wide enough to hold a marker, so the mouse has black to sit on.
  const halo = Math.max(grid.pitch * 3, MARKER_SIZE + MARKER_GAP + 1)

  // Before anything else, so every wall is drawn over the top of it.
  if (opts.inkOutside === true) {
    // Displaced the same way the walls are, or the ink and the outline part
    // company wherever a style has any jitter.
    const rings = chainSegments(grid.boundarySegments(), grid.vertexCount).map((r) => r.map(at))

    // A masked grid keeps only its largest connected component, so it has
    // exactly one outer boundary; every other ring is a hole in the shape —
    // the counter of an A, the middle of an O.
    let outer = 0
    let widest = -1
    rings.forEach((ring, i) => {
      const a = Math.abs(enclosedArea(ring))
      if (a > widest) {
        widest = a
        outer = i
      }
    })

    const paths = rings.map((ring) => polylineCommands(ring, radius))
    const outline = paths[outer] as PathCommand[]

    // Outside the shape, a band rather than the whole sheet: inking margin to
    // margin reads beautifully and puts about 85% coverage on the paper, which
    // curls a sheet and empties a cartridge in two of them. Drawn without
    // offsetting any polygon — stroke the outline at twice the band width, then
    // fill the same outline white, which covers the half of that stroke lying
    // inside. Two paths, and they agree exactly because they are the same path.
    strokes.push({ commands: outline, width: halo * 2 })
    strokes.push({ commands: outline, width: 0, fill: true, light: true })

    // Holes are filled solid, not banded. A band leaves white in the middle of
    // anything bigger than twice its width, which is most counters at the size
    // a word maze is set — and the enclosed space inside an A is exactly what
    // has to go dark for the letter to read.
    for (let i = 0; i < paths.length; i++) {
      if (i !== outer) strokes.push({ commands: paths[i] as PathCommand[], width: 0, fill: true })
    }
  }

  if (style.cave === true) {
    strokes.push(...caveStrokes(grid, maze, radius, opts.stroke, ox, oy))
  } else {
    // The outline, minus the two openings the maze is entered and left through.
    const segments: Segment[] = grid.boundarySegments([maze.start, maze.end])
    for (let e = 0; e < maze.topo.edgeCount; e++) {
      if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
    }

    // Sketch draws each line twice. Its wander is charged against the same
    // budget as the shared jitter, so no combination of the two can narrow a
    // corridor past what §5 guarantees.
    const wander = Math.min(style.sketch ?? 0, MAX_JITTER - jitter / grid.pitch) * grid.pitch
    const passes = wander > 0 ? 2 : 1
    let n = 0

    for (const poly of chainSegments(segments, grid.vertexCount)) {
      const points = poly.map(at)
      const first = points[0] as Point
      const last = points[points.length - 1] as Point
      const closed =
        points.length > 3 &&
        Math.abs(first.x - last.x) < 1e-9 &&
        Math.abs(first.y - last.y) < 1e-9

      for (let pass = 0; pass < passes; pass++) {
        const base = n
        const drawn =
          passes === 1
            ? points
            : points.map((p, i) => {
                const d = sketchOffset(pass, base + i, styleSeed, wander)
                return { x: p.x + d.x, y: p.y + d.y }
              })
        strokes.push({
          commands: polylineCommands(
            passes === 1 || closed ? drawn : overshoot(drawn, grid.pitch * 0.09),
            radius,
          ),
          // Each pass is lighter than a single line would be. Two full-weight
          // strokes half a millimetre apart read as one fat line, not as a line
          // drawn twice.
          width: passes === 1 ? opts.stroke : opts.stroke * 0.8,
        })
      }
      n += points.length
    }
  }

  /** Midpoint of a cell's opening, following the same displacement as the walls. */
  const openingAt = (cell: CellId): Point => {
    const seg = grid.openingSegment(cell)
    if (seg === null) {
      const p = grid.cellCenter(cell)
      return { x: p.x + ox, y: p.y + oy }
    }
    const a = at(seg[0])
    const b = at(seg[1])
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  if (opts.showSolution === true && solution !== null && solution.length > 0) {
    // Cell centres are not lattice vertices, so they do not move; only the two
    // ends, which have to follow their gaps in the wall.
    const points: Point[] = [
      openingAt(maze.start),
      ...solution.map((c) => {
        const p = grid.cellCenter(c)
        return { x: p.x + ox, y: p.y + oy }
      }),
      openingAt(maze.end),
    ]
    const dash = grid.pitch * 0.3
    strokes.push({
      commands: polylineCommands(points, radius),
      width: opts.stroke * 0.6,
      dash: [dash, dash],
    })
  }

  // Drawn outside the outline, along the direction the opening faces, so they
  // never collide with a wall and need no test that they have not.
  const set = markerSet(opts.markers)
  for (const [cell, marker, inward] of [
    [maze.start, set.start, true],
    [maze.end, set.end, false],
  ] as const) {
    if (marker === null) continue
    const outward = grid.openingNormal(cell)
    if (outward === null) continue
    for (const part of placeMarker(
      {
        marker,
        at: openingAt(cell),
        outward,
        // Both arrows show the direction of travel, so the one at the entrance
        // points into the maze and the one at the exit points out of it.
        facing: inward ? { x: -outward.x, y: -outward.y } : outward,
        size: MARKER_SIZE,
        gap: MARKER_GAP,
        // Lighter than the walls: at this scale a wall-weight stroke closes
        // the cheese wedge into a solid triangle. On an inked sheet that goes
        // the other way — a half-weight white line on black is a hairline — so
        // there it keeps the full weight.
        stroke: opts.inkOutside === true ? opts.stroke : Math.max(opts.stroke * 0.5, 0.35),
      },
      paper,
    )) {
      strokes.push({
        commands: part.commands,
        width: part.width,
        // On an inked sheet the marker sits on black, so it has to be drawn in
        // the paper's colour or it is simply not there.
        ...(opts.inkOutside === true ? { light: true } : {}),
        ...(part.fill === true ? { fill: true } : {}),
      })
    }
  }

  // The sheet carries its own test instrument: measure the line, and any
  // scaling applied on the way to paper is obvious. See docs/DESIGN.md §7.
  if (opts.calibration === true) {
    const y = paper.height - 8
    const x0 = margin
    const x1 = margin + 100
    strokes.push({
      width: 0.4,
      commands: [
        { op: 'M', x: x0, y: y - 1.5 },
        { op: 'L', x: x0, y: y + 1.5 },
        { op: 'M', x: x0, y },
        { op: 'L', x: x1, y },
        { op: 'M', x: x1, y: y - 1.5 },
        { op: 'L', x: x1, y: y + 1.5 },
      ],
    })
    labels.push({ text: opts.caption ?? '100 mm', at: { x: x1 + 4, y: y + 1 }, size: 3 })
  }

  return { width: paper.width, height: paper.height, strokes, labels }
}

/**
 * Run the two ends of an open line a little past where they belong.
 *
 * The overshoot at a junction is most of what makes a drawn line look drawn; a
 * closed ring has no ends and gets none.
 */
function overshoot(points: readonly Point[], by: number): Point[] {
  const out = [...points]
  const push = (from: Point, toward: Point): Point => {
    const dx = from.x - toward.x
    const dy = from.y - toward.y
    const len = Math.hypot(dx, dy)
    if (len === 0) return from
    return { x: from.x + (dx / len) * by, y: from.y + (dy / len) * by }
  }
  out[0] = push(points[0] as Point, points[1] as Point)
  out[out.length - 1] = push(
    points[points.length - 1] as Point,
    points[points.length - 2] as Point,
  )
  return out
}

/**
 * The maze rendered inside out: tunnels rather than walls.
 *
 * A wide black stroke along the passage graph, then a narrower white one over
 * the top of it. The white pass covers the middle of the black one and leaves
 * its edges showing, which is an outlined tunnel — with no boolean geometry
 * anywhere and two paths for the whole sheet. Every black stroke has to be laid
 * down before any white one, or a later tunnel would paint over an earlier
 * one's inside.
 */
function caveStrokes(
  grid: PlanarGrid,
  maze: Maze,
  radius: number,
  stroke: number,
  ox: number,
  oy: number,
): SheetStroke[] {
  const at = (cell: CellId): Point => {
    const p = grid.cellCenter(cell)
    return { x: p.x + ox, y: p.y + oy }
  }

  const links: Segment[] = []
  for (let e = 0; e < maze.topo.edgeCount; e++) {
    if (maze.open[e] === 1) links.push(maze.topo.endpoints(e) as Segment)
  }

  const paths: PathCommand[][] = chainSegments(links, maze.topo.cellCount).map((run) =>
    polylineCommands(run.map(at), radius),
  )

  // Stubs out through the two gaps in the outline, so the tunnels have a mouth
  // rather than stopping a cell short of one.
  for (const cell of [maze.start, maze.end]) {
    const p = grid.openingPoint(cell)
    paths.push(polylineCommands([at(cell), { x: p.x + ox, y: p.y + oy }], 0))
  }

  // Measured from the passage gap, not the pitch: on hexagons the nearest
  // parallel pair of tunnels is closer than a whole cell, and sizing from the
  // pitch would very nearly merge them.
  const tunnel = grid.passageGap * (1 - CAVE_GAP)
  return [
    ...paths.map((commands) => ({ commands, width: tunnel })),
    ...paths.map((commands) => ({ commands, width: tunnel - 2 * stroke, light: true })),
  ]
}
