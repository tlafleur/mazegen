import type { CellId, Maze } from '../core/types'
import type { PlanarGrid, Point, Segment } from '../core/grid/planar'
import { chainSegments } from './chain'
import { DEFAULT_MARGIN, type Paper } from './page'
import { CLASSIC, MAX_JITTER, jitterOffset, polylinePath, type Style } from './style'

export interface RenderOptions {
  readonly paper: Paper
  readonly stroke: number
  readonly margin?: number
  readonly showSolution?: boolean
  readonly style?: Style
  /** Varies the jitter without changing the maze. */
  readonly styleSeed?: number
  /** Draw a 100 mm reference line and a caption in the bottom margin. */
  readonly calibration?: boolean
  /** Caption text beside the reference line. */
  readonly caption?: string
}

/** Trim float noise; keeps the document small and diffable. */
function f(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Midpoint of a cell's opening, following the same displacement as the walls. */
function openingPoint(
  grid: PlanarGrid,
  cell: CellId,
  place: (vertex: number) => Point,
  ox: number,
  oy: number,
): Point {
  const seg = grid.openingSegment(cell)
  if (seg === null) {
    const p = grid.cellCenter(cell)
    return { x: p.x + ox, y: p.y + oy }
  }
  const a = place(seg[0])
  const b = place(seg[1])
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Render a maze as a standalone SVG document sized to the sheet in real
 * millimetres.
 *
 * The viewBox is in millimetres, so stroke widths are millimetres too and the
 * drawing is physically correct at any output resolution — which is the whole
 * reason the output is SVG rather than a canvas bitmap. See docs/DESIGN.md §7.
 */
export function renderSvg(
  grid: PlanarGrid,
  maze: Maze,
  solution: CellId[] | null,
  opts: RenderOptions,
): string {
  const margin = opts.margin ?? DEFAULT_MARGIN
  const { paper } = opts

  // Centre the maze in the live area: flooring cols/rows to whole cells leaves
  // up to one cell of slack in each direction.
  const ox = margin + (paper.width - 2 * margin - grid.width) / 2
  const oy = margin + (paper.height - 2 * margin - grid.height) / 2

  // The outline, minus the two openings the maze enters and leaves through.
  const segments: Segment[] = grid.boundarySegments([maze.start, maze.end])
  for (let e = 0; e < maze.topo.edgeCount; e++) {
    if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
  }

  const style = opts.style ?? CLASSIC
  const radius = style.rounding * grid.pitch
  // Clamped here rather than trusted from the style, so no style can define
  // away the corridor-width guarantee.
  const jitter = Math.min(style.jitter, MAX_JITTER) * grid.pitch
  const styleSeed = opts.styleSeed ?? 0

  /** A lattice vertex, displaced and moved onto the page. */
  const place = (v: number): Point => {
    const p = grid.vertexPos(v)
    const j = jitterOffset(v, styleSeed, jitter)
    return { x: p.x + j.x + ox, y: p.y + j.y + oy }
  }

  let walls = ''
  for (const poly of chainSegments(segments, grid.vertexCount)) {
    walls += polylinePath(poly.map(place), radius)
  }

  let solutionPath = ''
  if (opts.showSolution && solution && solution.length > 0) {
    // Cell centres are not lattice vertices, so they do not move; only the two
    // ends, which have to follow their gaps in the wall.
    const points: Point[] = [
      openingPoint(grid, maze.start, place, ox, oy),
      ...solution.map((c) => {
        const p = grid.cellCenter(c)
        return { x: p.x + ox, y: p.y + oy }
      }),
      openingPoint(grid, maze.end, place, ox, oy),
    ]
    const dash = f(grid.pitch * 0.3)
    solutionPath =
      `<path d="${polylinePath(points, radius)}" fill="none" stroke="#000"` +
      ` stroke-width="${f(opts.stroke * 0.6)}" stroke-linecap="round"` +
      ` stroke-linejoin="round" stroke-dasharray="${dash} ${dash}"/>`
  }

  // Phase 0 exists to prove the print path, so the sheet carries its own test
  // instrument: measure the line, and any scaling Safari applied is obvious.
  let rule = ''
  if (opts.calibration) {
    const y = paper.height - 8
    const x0 = margin
    const x1 = margin + 100
    rule =
      `<path d="M${f(x0)} ${f(y - 1.5)}L${f(x0)} ${f(y + 1.5)}M${f(x0)} ${f(y)}` +
      `L${f(x1)} ${f(y)}M${f(x1)} ${f(y - 1.5)}L${f(x1)} ${f(y + 1.5)}"` +
      ` fill="none" stroke="#000" stroke-width="0.4"/>` +
      `<text x="${f(x1 + 4)}" y="${f(y + 1)}" font-family="sans-serif"` +
      ` font-size="3" fill="#000">${esc(opts.caption ?? '100 mm')}</text>`
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(paper.width)}mm"` +
    ` height="${f(paper.height)}mm" viewBox="0 0 ${f(paper.width)} ${f(paper.height)}">` +
    `<rect width="${f(paper.width)}" height="${f(paper.height)}" fill="#fff"/>` +
    `<path d="${walls}" fill="none" stroke="#000" stroke-width="${f(opts.stroke)}"` +
    ` stroke-linecap="round" stroke-linejoin="round"/>` +
    solutionPath +
    rule +
    `</svg>`
  )
}
