import type { CellId, Maze } from '../core/types'
import type { PlanarGrid } from '../core/grid/planar'
import { toSvgPath } from './path'
import { buildSheet, type SheetOptions } from './sheet'
import { buildPdf, type Sheet } from './pdf'

export interface RenderOptions extends SheetOptions {
  /**
   * Show only part of the sheet, in millimetres.
   *
   * A whole page shrunk to thumbnail size is grey texture — every cell size
   * looks the same, which is exactly what a preset card must not do. Cropping
   * instead keeps cells at a legible scale, so chunky and dense are visibly
   * different rather than merely differently grey.
   */
  readonly crop?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

function f(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * A sheet as an SVG document, sized in real millimetres.
 *
 * The viewBox is in millimetres, so stroke widths are millimetres too and the
 * drawing is physically correct at any output resolution.
 */
export function sheetToSvg(sheet: Sheet, crop?: RenderOptions['crop']): string {
  const view = crop ?? { x: 0, y: 0, width: sheet.width, height: sheet.height }

  let body = `<rect x="${f(view.x)}" y="${f(view.y)}" width="${f(view.width)}"` +
    ` height="${f(view.height)}" fill="#fff"/>`

  for (const s of sheet.strokes) {
    const d = toSvgPath(s.commands)
    if (s.fill === true) {
      body += `<path d="${d}" fill="#000" stroke="none"/>`
      continue
    }
    const dash = s.dash ? ` stroke-dasharray="${f(s.dash[0])} ${f(s.dash[1])}"` : ''
    body +=
      `<path d="${d}" fill="none" stroke="#000" stroke-width="${f(s.width)}"` +
      ` stroke-linecap="round" stroke-linejoin="round"${dash}/>`
  }

  for (const l of sheet.labels) {
    body +=
      `<text x="${f(l.at.x)}" y="${f(l.at.y)}" font-family="sans-serif"` +
      ` font-size="${f(l.size)}" fill="#000">${esc(l.text)}</text>`
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(view.width)}mm"` +
    ` height="${f(view.height)}mm"` +
    ` viewBox="${f(view.x)} ${f(view.y)} ${f(view.width)} ${f(view.height)}">` +
    body +
    `</svg>`
  )
}

export function renderSvg(
  grid: PlanarGrid,
  maze: Maze,
  solution: readonly CellId[] | null,
  opts: RenderOptions,
): string {
  return sheetToSvg(buildSheet(grid, maze, solution, opts), opts.crop)
}

/**
 * The same sheet as a PDF file.
 *
 * The reason this exists rather than relying on the browser: Safari's web print
 * shrinks a page by about 7% while reporting 100%, where a PDF states its size
 * in its own MediaBox and prints at it. See docs/DESIGN.md §7.
 */
export function renderPdf(
  grid: PlanarGrid,
  maze: Maze,
  solution: readonly CellId[] | null,
  opts: SheetOptions,
): Uint8Array<ArrayBuffer> {
  return buildPdf([buildSheet(grid, maze, solution, opts)])
}
