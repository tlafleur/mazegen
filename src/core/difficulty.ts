import type { Maze, RowStructured, Topology } from './types'
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
  { level: 1, label: 'Gentle', carver: 'sidewinder', braid: 0.3, deadEndCap: 3 },
  { level: 2, label: 'Easy', carver: 'kruskal', braid: 0, deadEndCap: 4 },
  { level: 3, label: 'Medium', carver: 'backtracker', braid: 0.3, deadEndCap: 0 },
  { level: 4, label: 'Hard', carver: 'backtracker', braid: 0.1, deadEndCap: 0 },
  { level: 5, label: 'Fiendish', carver: 'backtracker', braid: 0, deadEndCap: 0 },
]

export function recipeFor(level: Level): LevelRecipe {
  const found = RECIPES.find((r) => r.level === level)
  if (found === undefined) throw new Error(`no recipe for level ${level}`)
  return found
}

/**
 * Carve a maze to a level's recipe.
 *
 * Takes `Topology & RowStructured` because sidewinder needs rows and columns;
 * a topology without them cannot offer level 1 as written.
 */
export function carveAtLevel(
  grid: Topology & RowStructured,
  rng: Rng,
  level: Level,
  start = 0,
  end = grid.cellCount - 1,
): Maze {
  const recipe = recipeFor(level)

  const open =
    recipe.carver === 'sidewinder'
      ? carveSidewinder(grid, rng)
      : recipe.carver === 'kruskal'
        ? carveKruskal(grid, rng)
        : recipe.carver === 'wilson'
          ? carveWilson(grid, rng)
          : carveBacktracker(grid, rng)

  const maze: Maze = { topo: grid, open, start, end }

  if (recipe.braid > 0) braid(maze, rng, recipe.braid)
  if (recipe.deadEndCap > 0) capDeadEndRun(maze, rng, recipe.deadEndCap)

  return maze
}
