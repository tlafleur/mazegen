/** Page geometry, in millimetres. */
export interface Paper {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
}

export const LETTER: Paper = { id: 'letter', label: 'US Letter', width: 215.9, height: 279.4 }
export const A4: Paper = { id: 'a4', label: 'A4', width: 210, height: 297 }
export const PAPERS: readonly Paper[] = [LETTER, A4]

/** 0.5 inch. Comfortably inside the unprintable border of every consumer printer. */
export const DEFAULT_MARGIN = 12.7

/**
 * Cell size named by what you would draw through it, rather than by a number.
 *
 * See docs/DESIGN.md §4 — this is motor demand, and it is deliberately a
 * separate control from difficulty, which is cognitive demand.
 */
export interface Pen {
  readonly id: string
  readonly label: string
  /** Cell pitch in mm, wall centre to wall centre. */
  readonly pitch: number
  /** Wall stroke width in mm. Corridor width is pitch minus this. */
  readonly stroke: number
}

export const CRAYON: Pen = { id: 'crayon', label: 'Crayon', pitch: 12, stroke: 1.2 }
export const MARKER: Pen = { id: 'marker', label: 'Marker', pitch: 9, stroke: 1.0 }
export const PENCIL: Pen = { id: 'pencil', label: 'Pencil', pitch: 6, stroke: 0.7 }
export const FINE: Pen = { id: 'fine', label: 'Fine pen', pitch: 4, stroke: 0.5 }

export const PENS: readonly Pen[] = [CRAYON, MARKER, PENCIL, FINE]

/**
 * Regions that use US Letter rather than A4.
 *
 * Paper choice has to match the printer, not taste: there is no page size that
 * prints 1:1 on both. Letter is 5.9 mm wider, A4 is 17.6 mm taller, so a sheet
 * declared as one gets scaled down to fit the other — and scaling silently
 * breaks the promise cell size makes, since a 12 mm crayon corridor printed at
 * 91% is a 10.9 mm corridor.
 */
const LETTER_REGIONS = new Set([
  'US', 'CA', 'MX', 'PH', 'CL', 'CO', 'CR', 'DO', 'GT', 'HN', 'NI', 'PA', 'PR', 'SV', 'VE',
])

/** Best guess at the right paper for a viewer, from their locale. */
export function defaultPaperFor(locale: string | undefined): Paper {
  if (locale === undefined || locale === '') return A4
  let region: string | undefined
  try {
    // maximize() fills in the implied region, so bare 'en' resolves to US.
    region = new Intl.Locale(locale).maximize().region
  } catch {
    region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]
  }
  return region !== undefined && LETTER_REGIONS.has(region.toUpperCase()) ? LETTER : A4
}

export interface GridSize {
  readonly cols: number
  readonly rows: number
}

/**
 * How many cells fit on a page at a given pitch.
 *
 * The epsilon guards the case where a division that should land exactly on an
 * integer comes back a hair under it; none of the shipped pitch/paper pairs do,
 * but the failure would be a silently missing row.
 */
export function gridSizeFor(paper: Paper, pitch: number, margin: number = DEFAULT_MARGIN): GridSize {
  return {
    cols: Math.floor((paper.width - 2 * margin) / pitch + 1e-9),
    rows: Math.floor((paper.height - 2 * margin) / pitch + 1e-9),
  }
}

/**
 * What a cell is shaped like.
 *
 * A separate axis from difficulty, cell size and outline: the same carver and
 * the same shape mask run on either, so this changes what the maze *is* rather
 * than how it is drawn.
 */
export interface CellKind {
  readonly id: string
  readonly label: string
}

/**
 * The same paper, turned on its side.
 *
 * Everything downstream reads width and height off the `Paper`, so swapping
 * them is the whole of it: the grid, the PDF's MediaBox, the `@page` rule and
 * the on-screen sheet all follow. Worth having for a word maze above all — a
 * word is wide, and on a portrait sheet it has to be broken into lines or set
 * small.
 */
export function landscape(paper: Paper): Paper {
  return { ...paper, width: paper.height, height: paper.width }
}

export function oriented(paper: Paper, wide: boolean): Paper {
  return wide ? landscape(paper) : paper
}

export const SQUARES: CellKind = { id: 'square', label: 'Squares' }
export const HEXAGONS: CellKind = { id: 'hex', label: 'Hexagons' }
export const CELL_KINDS: readonly CellKind[] = [SQUARES, HEXAGONS]
