import type { CellId, Maze } from '../core/types'
import type { Point, Segment, SquareGrid } from '../core/grid/square'
import { chainSegments } from './chain'
import { DEFAULT_MARGIN, type Paper } from './page'

export interface RenderOptions {
  readonly paper: Paper
  readonly stroke: number
  readonly margin?: number
  readonly showSolution?: boolean
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

function pathFromPoints(points: readonly Point[]): string {
  let d = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point
    d += (i === 0 ? 'M' : 'L') + f(p.x) + ' ' + f(p.y)
  }
  return d
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
  grid: SquareGrid,
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

  const segments: Segment[] = grid.boundarySegments()
  for (let e = 0; e < grid.edgeCount; e++) {
    if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
  }

  let walls = ''
  for (const poly of chainSegments(segments, grid.vertexCount)) {
    walls += pathFromPoints(
      poly.map((v) => {
        const p = grid.vertexPos(v)
        return { x: p.x + ox, y: p.y + oy }
      }),
    )
  }

  let solutionPath = ''
  if (opts.showSolution && solution && solution.length > 0) {
    const entry = grid.entrancePoint()
    const exit = grid.exitPoint()
    const points: Point[] = [
      { x: entry.x + ox, y: entry.y + oy },
      ...solution.map((c) => {
        const p = grid.cellCenter(c)
        return { x: p.x + ox, y: p.y + oy }
      }),
      { x: exit.x + ox, y: exit.y + oy },
    ]
    const dash = f(grid.pitch * 0.3)
    solutionPath =
      `<path d="${pathFromPoints(points)}" fill="none" stroke="#000"` +
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
