import type { CellId, Maze } from '../core/types'
import type { PlanarGrid, Point, Segment } from '../core/grid/planar'
import { chainSegments } from './chain'
import { polylineCommands } from './path'
import { DEFAULT_MARGIN, type Paper } from './page'
import { CLASSIC, MAX_JITTER, jitterOffset, type Style } from './style'
import { CHEESE, MOUSE, placeMarker } from './marker'
import type { Sheet, SheetLabel, SheetStroke } from './pdf'

export interface SheetOptions {
  readonly paper: Paper
  readonly stroke: number
  readonly margin?: number
  readonly showSolution?: boolean
  readonly style?: Style
  /** Varies the jitter without changing the maze. */
  readonly styleSeed?: number
  /** Draw a mouse at the entrance and cheese at the exit. */
  readonly markers?: boolean
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

  // The outline, minus the two openings the maze is entered and left through.
  const segments: Segment[] = grid.boundarySegments([maze.start, maze.end])
  for (let e = 0; e < maze.topo.edgeCount; e++) {
    if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
  }

  for (const poly of chainSegments(segments, grid.vertexCount)) {
    strokes.push({ commands: polylineCommands(poly.map(at), radius), width: opts.stroke })
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
  if (opts.markers === true) {
    for (const [cell, marker] of [
      [maze.start, MOUSE],
      [maze.end, CHEESE],
    ] as const) {
      const outward = grid.openingNormal(cell)
      if (outward === null) continue
      for (const part of placeMarker(
        {
          marker,
          at: openingAt(cell),
          outward,
          size: 10,
          gap: 1.5,
          // Lighter than the walls: at this scale a wall-weight stroke closes
          // the cheese wedge into a solid triangle.
          stroke: Math.max(opts.stroke * 0.5, 0.35),
        },
        paper,
      )) {
        strokes.push({
          commands: part.commands,
          width: part.width,
          ...(part.fill === true ? { fill: true } : {}),
        })
      }
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
