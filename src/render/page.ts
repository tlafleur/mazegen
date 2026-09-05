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
