import { SquareGrid } from '../core/grid/square'
import { HexGrid } from '../core/grid/hex'
import { MaskedGrid } from '../core/grid/masked'
import type { Shape } from '../core/grid/mask'
import { carveAtLevel } from '../core/difficulty'
import { makeRng } from '../core/rng'
import { solve } from '../core/analyze'
import { chainSegments } from './chain'
import { polylinePath, type Style } from './style'
import { buildSheet } from './sheet'
import { sheetToSvg } from './svg'
import type { BaseGrid, Segment } from '../core/grid/planar'
import { HEXAGONS, type CellKind, type Paper } from './page'

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
 * Built by the real renderer on a tiny sheet, not by a second copy of the
 * drawing code. It used to be a copy, and the copy knew only about rounding and
 * jitter — so the moment Sketch and Cave arrived, their icons both showed a
 * plain Classic maze. An icon that can disagree with what it is picking is
 * worse than no icon.
 */
export function styleThumbnail(style: Style, seed = 4): string {
  const grid = new MaskedGrid(new SquareGrid(6, 6, 10), () => true)
  const [start, end] = grid.farthestBoundaryPair()
  const maze = carveAtLevel(grid, makeRng('style-icon'), 5, start, end)
  if (solve(maze) === null) throw new Error('style thumbnail unsolvable')

  // Enough margin for Sketch's overshoot and Wonky's wander to stay on the card.
  const margin = 2.5
  const paper: Paper = {
    id: 'icon',
    label: 'icon',
    width: grid.width + margin * 2,
    height: grid.height + margin * 2,
  }
  const sheet = buildSheet(grid, maze, null, {
    paper,
    stroke: 1.6,
    style,
    styleSeed: seed,
    margin,
  })
  return sheetToSvg(sheet, undefined, 'currentColor')
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
