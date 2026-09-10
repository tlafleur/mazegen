import { describe, expect, it } from 'vitest'
import { PRESETS, presetFor, type PresetChoice } from './presets'
import { generateMaze } from './generate'
import { shapeLibrary } from './core/grid/mask'
import { LETTER, PENS, CELL_KINDS } from './render/page'
import { LEVELS } from './core/difficulty'

const rect = shapeLibrary(LETTER.height / LETTER.width)[0] as ReturnType<typeof shapeLibrary>[0]

const choiceOf = (p: (typeof PRESETS)[number]): PresetChoice => ({
  level: p.level,
  penId: p.pen.id,
  cellsId: p.cells.id,
  farEnds: p.farEnds,
  loops: p.loops,
  decoys: p.decoys,
})

describe('the preset list', () => {
  it('names each one once, and uses only real pens, cells and levels', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length)
    for (const p of PRESETS) {
      expect(PENS).toContain(p.pen)
      expect(CELL_KINDS).toContain(p.cells)
      expect(LEVELS).toContain(p.level)
    }
  })

  /**
   * Expected work: the score is per cell, so a maze twice the size at the same
   * score is twice the walk. That product is what a child experiences and what
   * the order of the cards claims, since the dots count position in this list.
   */
  const workOf = (p: (typeof PRESETS)[number], seeds = 8): number => {
    let total = 0
    for (let i = 0; i < seeds; i++) {
      const g = generateMaze({
        paper: LETTER,
        pen: p.pen,
        level: p.level,
        shape: rect,
        seed: `${p.id}-${i}`,
        cells: p.cells,
        farEnds: p.farEnds,
        loops: p.loops,
      })
      total += g.metrics.score * g.grid.cellCount
    }
    return total / seeds
  }

  it('climbs in expected work from first card to last', () => {
    const work = PRESETS.map((p) => workOf(p))
    for (let i = 1; i < work.length; i++) {
      expect(work[i] as number).toBeGreaterThan(work[i - 1] as number)
    }
  })

  it('makes the top three separate steps rather than relabelled ones', () => {
    // Level 5 is the ceiling of the model in §4, so all three of these carve
    // the same way. What separates them is route length and cell count.
    //
    // Measured over 20 seeds: Fiendish 1943, Brutal 2289, Bonkers 2499. The
    // first step is worth 18% and comes from running the maze between the ends
    // of its longest corridor, which is worth 46% on the route alone. The
    // second is worth 9% and comes from hexagons packing more cells onto the
    // sheet — and, in a way no measure here captures, from having no four-way
    // junctions and so no free choices and no straight corridor to sight down.
    // Claiming more than that of the last step would be claiming more than has
    // been measured, so the assertion here is only that it does not shrink.
    const [fiendish, brutal, bonkers] = PRESETS.slice(-3).map((p) => workOf(p)) as number[]
    expect(brutal as number).toBeGreaterThan((fiendish as number) * 1.1)
    expect(bonkers as number).toBeGreaterThan(brutal as number)
  })

  it('never puts loops on a card, because loops is not harder', () => {
    // Measured in core/difficulty.test.ts: opening every dead end lowers the
    // score. It stays an option under Advanced rather than a rung on the list.
    for (const p of PRESETS) expect(p.loops).toBe(false)
  })
})

describe('presetFor', () => {
  it('finds each preset from its own settings', () => {
    for (const p of PRESETS) expect(presetFor(choiceOf(p))?.id).toBe(p.id)
  })

  it('lets go the moment any single setting is changed by hand', () => {
    // A card left lit beside a setting it does not match would be telling the
    // reader something untrue about the sheet they are about to print.
    const base = choiceOf(PRESETS[0] as (typeof PRESETS)[number])
    const edits: Partial<PresetChoice>[] = [
      { level: 4 },
      { penId: 'fine' },
      { cellsId: 'polar' },
      { farEnds: true },
      { loops: true },
      { decoys: true },
    ]
    for (const edit of edits) expect(presetFor({ ...base, ...edit })).toBeNull()
  })
})
