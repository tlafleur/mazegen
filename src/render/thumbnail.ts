import { SquareGrid } from '../core/grid/square'
import { HexGrid } from '../core/grid/hex'
import { MaskedGrid } from '../core/grid/masked'
import type { Shape } from '../core/grid/mask'
import { carveAtLevel } from '../core/difficulty'
import { makeRng } from '../core/rng'
import { solve } from '../core/analyze'
import { chainSegments } from './chain'
import { polylinePath, type Style } from './style'
import type { BaseGrid, Point, Segment } from '../core/grid/planar'
import { HEXAGONS, type CellKind } from './page'

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * The outline of a shape, filled, as a picker icon.
 *
 * Drawn from a coarse grid of its own rather than the maze on screen: an icon
 * only has to say "heart" at 40 pixels, and rebuilding it from a 2961-cell grid
 * every time the cell size changes would cost far more than it shows.
 */
export function shapeIcon(shape: Shape, aspect: number, span = 24): string {
  const grid = new MaskedGrid(
    new SquareGrid(span, Math.max(2, Math.round(span * aspect)), 1),
    shape.mask,
  )
  const rings = chainSegments(grid.boundarySegments(), grid.vertexCount)
  const d = rings.map((r) => polylinePath(r.map((v) => grid.vertexPos(v)), 0)).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(grid.width)} ${fmt(grid.height)}"` +
    ` preserveAspectRatio="xMidYMid meet">` +
    `<path d="${d}" fill="currentColor" fill-rule="evenodd"/></svg>`
  )
}

/**
 * A few cells of maze drawn in one style, as a picker icon.
 *
 * Small enough that the difference between sharp, rounded and wobbly is the
 * only thing visible, which is the point.
 */
export function styleThumbnail(style: Style, seed = 4): string {
  return miniMaze(new SquareGrid(6, 6, 10), style, seed, 'style-icon')
}

/**
 * The bare tiling, as a picker icon.
 *
 * A maze drawn on three cells is a scribble at chip size, and "squares" against
 * "hexagons" is not a difference a word carries to a child. The cells
 * themselves, uncarved, say it in one look.
 */
export function cellsThumbnail(kind: CellKind): string {
  const hex = kind.id === HEXAGONS.id
  const base: BaseGrid = hex ? new HexGrid(3, 3, 10) : new SquareGrid(3, 3, 10)
  const grid = new MaskedGrid(base, () => true)

  const segments: Segment[] = grid.boundarySegments()
  for (let e = 0; e < grid.edgeCount; e++) segments.push(grid.wallSegment(e))

  const d = chainSegments(segments, grid.vertexCount)
    .map((poly) => polylinePath(poly.map((v) => grid.vertexPos(v)), 0))
    .join('')

  const pad = 1.4
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="${-pad} ${-pad} ${fmt(grid.width + pad * 2)} ${fmt(grid.height + pad * 2)}">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7"` +
    ` stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}

function miniMaze(base: BaseGrid, style: Style, seed: number, rngSeed: string): string {
  const grid = new MaskedGrid(base, () => true)
  const [start, end] = grid.farthestBoundaryPair()
  const maze = carveAtLevel(grid, makeRng(rngSeed), 5, start, end)
  if (solve(maze) === null) throw new Error('thumbnail unsolvable')

  const segments: Segment[] = grid.boundarySegments([start, end])
  for (let e = 0; e < grid.edgeCount; e++) {
    if (maze.open[e] === 0) segments.push(grid.wallSegment(e))
  }

  const radius = style.rounding * grid.pitch
  const jitter = style.jitter * grid.pitch
  const place = (v: number): Point => {
    const p = grid.vertexPos(v)
    if (jitter === 0) return p
    const angle = ((Math.sin(v * 12.9898 + seed) * 43758.5453) % 1) * Math.PI * 2
    return { x: p.x + Math.cos(angle) * jitter, y: p.y + Math.sin(angle) * jitter }
  }

  const d = chainSegments(segments, grid.vertexCount)
    .map((poly) => polylinePath(poly.map(place), radius))
    .join('')

  // Padded by the stroke so wobble at the edge is not clipped.
  const pad = 3
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="${-pad} ${-pad} ${fmt(grid.width + pad * 2)} ${fmt(grid.height + pad * 2)}">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6"` +
    ` stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}
