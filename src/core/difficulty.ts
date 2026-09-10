import type { CellId, Maze, RowStructured, Topology } from './types'
import type { Rng } from './rng'
import { carveBacktracker } from './carve/backtracker'
import { carveKruskal } from './carve/kruskal'
import { carveWilson } from './carve/wilson'
import { carveSidewinder } from './carve/sidewinder'
import { braid, capDeadEndRun } from './braid'

export type Level = 1 | 2 | 3 | 4 | 5
export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5]

export type CarverName = 'sidewinder' | 'kruskal' | 'wilson' | 'backtracker'

export interface LevelRecipe {
  readonly level: Level
  readonly label: string
  readonly carver: CarverName
  /** Fraction of dead ends to open. See the note on braiding below. */
  readonly braid: number
  /** Longest dead-end corridor allowed, or 0 to leave them alone. */
  readonly deadEndCap: number
  /**
   * What to carve with when the grid has no full rows.
   *
   * Sidewinder runs east along a whole row and carves north out of it, so a
   * masked shape with ragged rows rules it out. Level 1 is the only recipe that
   * needs this; the braid is raised to compensate for losing sidewinder's
   * give-away top corridor, keeping it below level 2.
   */
  readonly withoutRows?: { readonly carver: CarverName; readonly braid: number }
}

/** A grid that can say whether it has full rows to carve along. */
export type CarvableGrid = Topology & {
  rowStructured?(): (Topology & RowStructured) | null
}

/**
 * What each difficulty level is made of.
 *
 * Three findings from measurement shaped this; see docs/DESIGN.md §4.
 *
 * Braiding is U-shaped, not monotonic. Opening a few dead ends shortens the
 * route and thins the choices, which makes a maze easier — but opening most of
 * them merges the whole off-route area into one connected mass a solver can
 * wander deep into, which makes it harder again. Dead ends are feedback: a wall
 * tells a child they are wrong. Take them all away and nothing does. The
 * measured minimum sits near 0.2-0.4, which is why no level here braids beyond
 * that, contrary to the plan's original "braid heavily for the youngest".
 *
 * Sidewinder, Kruskal and Wilson's all score within a few percent of each
 * other, so they cannot supply five separated levels between them. The usable
 * range comes from the backtracker braided by varying amounts, which spans
 * 0.35 to 0.64 at fine-pen size on its own. Wilson's is kept and tested but
 * unused here: it is the neutral, texture-free carver, which makes it the right
 * one to expose as a choice later rather than a rung on this ladder.
 *
 * Sidewinder's real easiness is not visible in any structural measure: its
 * unbroken top row hands a solver an obvious plan. That is why it is pinned to
 * level 1 by name rather than chosen by score.
 */
export const RECIPES: readonly LevelRecipe[] = [
  {
    level: 1,
    label: 'Gentle',
    carver: 'sidewinder',
    braid: 0.3,
    deadEndCap: 3,
    withoutRows: { carver: 'kruskal', braid: 0.3 },
  },
  { level: 2, label: 'Easy', carver: 'kruskal', braid: 0, deadEndCap: 4 },
  { level: 3, label: 'Medium', carver: 'backtracker', braid: 0.3, deadEndCap: 0 },
  { level: 4, label: 'Hard', carver: 'backtracker', braid: 0.1, deadEndCap: 0 },
  { level: 5, label: 'Fiendish', carver: 'backtracker', braid: 0, deadEndCap: 0 },
]

/**
 * Modifiers that compose with any level rather than defining one.
 *
 * Kept off the ladder in §4 deliberately. A level is a claim about how much
 * work a maze is, checked by a test that the levels climb; these change what
 * kind of work it is, and one of them measurably lowers the score while making
 * the maze harder to solve by the usual method. Mixing the two would make the
 * ladder mean less, not more.
 */
export interface Extras {
  /**
   * Open every dead end, leaving a maze made entirely of loops.
   *
   * Measured, this cuts the composite score roughly in half — the shortest
   * route through a fully braided 2961-cell grid falls from 809 cells to 153,
   * because opening every dead end also opens every shortcut. It is offered
   * anyway, and honestly labelled, because of what the same measurement shows
   * about the other side: rubbing out dead ends is the shortcut a solver
   * learns first, and on a perfect maze it terminates with exactly the
   * solution. At braid 1 it removes nothing at all, because there is nothing
   * to remove. The maze stays 100% live from the first mark to the last.
   *
   * So it is harder for a child who wanders and easier for one who is
   * systematic, which is a real thing to want and not a rung on a ladder.
   */
  readonly loops?: boolean
  /** Carve with this instead of the level's own. See `RECIPES` on Wilson's. */
  readonly carver?: CarverName | undefined
}

export function recipeFor(level: Level): LevelRecipe {
  const found = RECIPES.find((r) => r.level === level)
  if (found === undefined) throw new Error(`no recipe for level ${level}`)
  return found
}

/**
 * Carve a maze to a level's recipe.
 *
 * Falls back to `withoutRows` when the recipe wants sidewinder but the grid
 * cannot offer full rows — which is what happens on every masked shape.
 */
export function carveAtLevel(
  grid: CarvableGrid,
  rng: Rng,
  level: Level,
  start: CellId = 0,
  end: CellId = grid.cellCount - 1,
  extras: Extras = {},
): Maze {
  const recipe = recipeFor(level)
  const rows = grid.rowStructured?.() ?? null

  let carver = extras.carver ?? recipe.carver
  let braidRatio = recipe.braid
  if (carver === 'sidewinder' && rows === null) {
    // A chosen carver falls back too, but must not drag the recipe's own
    // compensating braid along with it: that was tuned for level 1 losing
    // sidewinder, not for a grid the reader asked to carve some other way.
    const fallback = extras.carver === undefined ? recipe.withoutRows : { carver: 'kruskal' as const }
    if (fallback === undefined) throw new Error(`level ${level} needs full rows`)
    carver = fallback.carver
    if ('braid' in fallback) braidRatio = fallback.braid
  }

  const open =
    carver === 'sidewinder'
      ? carveSidewinder(rows as Topology & RowStructured, rng)
      : carver === 'kruskal'
        ? carveKruskal(grid, rng)
        : carver === 'wilson'
          ? carveWilson(grid, rng)
          : carveBacktracker(grid, rng)

  const maze: Maze = { topo: grid, open, start, end }

  if (braidRatio > 0) braid(maze, rng, braidRatio)
  if (recipe.deadEndCap > 0) capDeadEndRun(maze, rng, recipe.deadEndCap)
  // Last, and at full strength: whatever the level opened, this opens the rest.
  if (extras.loops === true) braid(maze, rng, 1)

  return maze
}
