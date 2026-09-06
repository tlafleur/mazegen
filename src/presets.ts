import type { Level } from './core/difficulty'
import { CRAYON, FINE, MARKER, PENCIL, type Pen } from './render/page'

/**
 * The primary control: one tap sets both difficulty and cell size.
 *
 * Those are separate axes in the engine — cognitive demand and motor demand,
 * deliberately independent — but a child should not have to reason about two
 * things to get a maze. Pairing them here and exposing them apart in the
 * grown-up area is the "presets first, controls second" split from
 * docs/DESIGN.md §8.
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
}

export const PRESETS: readonly Preset[] = [
  { id: 'tiny', label: 'Tiny', level: 1, pen: CRAYON },
  { id: 'little', label: 'Little', level: 2, pen: MARKER },
  { id: 'big', label: 'Big kid', level: 3, pen: PENCIL },
  { id: 'tricky', label: 'Tricky', level: 4, pen: PENCIL },
  { id: 'fiendish', label: 'Fiendish', level: 5, pen: FINE },
]

export function presetFor(level: Level, penId: string): Preset | null {
  return PRESETS.find((p) => p.level === level && p.pen.id === penId) ?? null
}
