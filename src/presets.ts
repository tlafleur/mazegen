import type { Level } from './core/difficulty'
import { CRAYON, FINE, HEXAGONS, MARKER, PENCIL, SQUARES, type CellKind, type Pen } from './render/page'

/**
 * The primary control: one tap sets everything about how hard the maze is.
 *
 * Those are separate axes in the engine — cognitive demand, motor demand, what
 * a cell is shaped like, and the extras below — deliberately independent. A
 * child should not have to reason about four things to get a maze. Pairing them
 * here and exposing them apart in the grown-up area is the "presets first,
 * controls second" split from docs/DESIGN.md §8.
 *
 * The labels are for an adult scanning the list. A child picks by the picture:
 * each card shows a real maze generated at these settings, so the difference
 * between crayon-sized and fine-pen-sized is visible rather than described.
 */
export interface Preset {
  readonly id: string
  readonly label: string
  readonly level: Level
  readonly pen: Pen
  readonly cells: CellKind
  /** Entrance and exit at the two ends of the longest corridor. */
  readonly farEnds: boolean
  readonly loops: boolean
  readonly decoys: boolean
}

const plain = { cells: SQUARES, farEnds: false, loops: false, decoys: false } as const

/**
 * Ordered easiest to hardest, which is also the order the cards are drawn in
 * and what the dots on each card count.
 *
 * The top two exist because level 5 is the ceiling of the difficulty model in
 * §4 — a plain backtracker, nothing left to braid or cap — so a sixth rung of
 * the same shape would have had nothing to vary. What they vary instead is
 * measured, on a Letter sheet at a 4 mm pitch, over 20 seeds each:
 *
 *     Fiendish  squares   2961 cells  route  864  work 1943
 *     Brutal    squares   2961 cells  route 1265  work 2289
 *     Bonkers   hexagons  3384 cells  route 1339  work 2499
 *
 * Running the maze between the two ends of its longest corridor is worth 46%
 * on the route and 18% on the work. Hexagons then add 9% more on top: 14% more
 * cells at the same pitch, at a slightly lower score per cell. That last step
 * is the smaller of the two on the measure, and it rests partly on something
 * no measure here captures — a hexagon grid has no four-way junctions, so
 * there are no free choices and no straight corridors to sight down.
 *
 * `loops` is deliberately not up here. It makes a maze harder to be sure about
 * and easier to escape — measured, it halves the score — and a card claiming to
 * be the hardest on the list had better be harder. It stays an option under
 * Advanced, labelled for what it does.
 */
export const PRESETS: readonly Preset[] = [
  { id: 'tiny', label: 'Tiny', level: 1, pen: CRAYON, ...plain },
  { id: 'little', label: 'Little', level: 2, pen: MARKER, ...plain },
  { id: 'big', label: 'Big kid', level: 3, pen: PENCIL, ...plain },
  { id: 'tricky', label: 'Tricky', level: 4, pen: PENCIL, ...plain },
  { id: 'fiendish', label: 'Fiendish', level: 5, pen: FINE, ...plain },
  {
    id: 'brutal',
    label: 'Brutal',
    level: 5,
    pen: FINE,
    cells: SQUARES,
    farEnds: true,
    loops: false,
    decoys: true,
  },
  {
    id: 'bonkers',
    label: 'Bonkers',
    level: 5,
    pen: FINE,
    cells: HEXAGONS,
    farEnds: true,
    loops: false,
    decoys: true,
  },
]

/** Everything a preset decides, so a screen can ask whether one is still on. */
export interface PresetChoice {
  readonly level: Level
  readonly penId: string
  readonly cellsId: string
  readonly farEnds: boolean
  readonly loops: boolean
  readonly decoys: boolean
}

/**
 * The preset matching a set of choices, or null once any of them is changed.
 *
 * Every field has to agree, not just difficulty and cell size. A preset that
 * stayed lit while the thing it set had been turned off by hand would be
 * telling the reader something untrue about what they are about to print.
 */
export function presetFor(choice: PresetChoice): Preset | null {
  return (
    PRESETS.find(
      (p) =>
        p.level === choice.level &&
        p.pen.id === choice.penId &&
        p.cells.id === choice.cellsId &&
        p.farEnds === choice.farEnds &&
        p.loops === choice.loops &&
        p.decoys === choice.decoys,
    ) ?? null
  )
}
