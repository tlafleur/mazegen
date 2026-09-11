import { describe, expect, it } from 'vitest'
import { buildSheet, carved } from './sheet'
import { renderSvg } from './svg'
import { STYLES } from './style'
import { LETTER, MARKER, landscape } from './page'
import { generateMaze } from '../generate'
import { follow, startTrail } from '../core/trail'
import { solve } from '../core/analyze'
import { shapeLibrary } from '../core/grid/mask'
import { BRIDGE_WIDTH } from '../core/grid/weave'
import type { CellId } from '../core/types'
import type { Point } from '../core/grid/planar'

const shape = shapeLibrary(LETTER.height / LETTER.width)[0] as ReturnType<typeof shapeLibrary>[0]
const styleOf = (id: string): (typeof STYLES)[number] =>
  STYLES.find((s) => s.id === id) as (typeof STYLES)[number]

const woven = (seed = 'w', paper = LETTER, iso = false) =>
  generateMaze({ paper, pen: MARKER, level: 5, shape, seed, weave: true, iso })

describe('drawing a crossing', () => {
  const g = woven()
  const base = { paper: LETTER, stroke: MARKER.stroke, style: styleOf('classic') }

  it('finds bridges to draw, and blocks that are nobody way through', () => {
    const all = g.grid.crossings()
    expect(all.length).toBeGreaterThan(10)
    expect(all.filter((x) => carved(x, g.maze)).length).toBeGreaterThan(2)
  })

  it('draws more than the same maze would without them', () => {
    // Each carved bridge is a white cut plus two walls of its own, and each
    // crossing that is not one still has the walls closing whichever half was
    // left uncarved.
    const flat = generateMaze({ paper: LETTER, pen: MARKER, level: 5, shape, seed: 'w' })
    const withBridges = buildSheet(g.grid, g.maze, g.solution, base)
    const without = buildSheet(flat.grid, flat.maze, flat.solution, base)
    expect(withBridges.strokes.length).toBeGreaterThan(without.strokes.length)
  })

  it('cuts the corridor beneath open with a fill, not with a shorter wall', () => {
    // A wall is a pair of lattice vertices and half of one has no vertex to
    // name, so the break has to be painted over. Every bridge contributes
    // exactly one white fill.
    const sheet = buildSheet(g.grid, g.maze, g.solution, base)
    const fills = sheet.strokes.filter((s) => s.fill === true && s.light === true)
    expect(fills).toHaveLength(g.grid.crossings().filter((x) => carved(x, g.maze)).length)
  })

  it('makes the bridge narrower than the corridor it joins', () => {
    // Not decoration: the pieces of side wall left standing are what close the
    // step from one width to the other, and a full-width bridge would have its
    // walls land exactly on the faces the corridor beneath needs open.
    expect(BRIDGE_WIDTH).toBeLessThan(1)
    expect(BRIDGE_WIDTH).toBeGreaterThan(0.4)
  })

  it('draws nothing off the paper', () => {
    const sheet = buildSheet(g.grid, g.maze, g.solution, {
      ...base,
      markers: 'mouse',
      showSolution: true,
    })
    for (const s of sheet.strokes) {
      for (const c of s.commands) {
        if (!('x' in c)) continue
        expect(c.x).toBeGreaterThanOrEqual(-1e-6)
        expect(c.y).toBeGreaterThanOrEqual(-1e-6)
        expect(c.x).toBeLessThanOrEqual(LETTER.width + 1e-6)
        expect(c.y).toBeLessThanOrEqual(LETTER.height + 1e-6)
      }
    }
  })

  it('reaches every style, so none of them can quietly show a crossroads', () => {
    // The failure this guards against is not ugliness: a style that ignored
    // crossings would draw two corridors meeting where the maze says they do
    // not, and the picture would claim a way through that is not there.
    for (const id of ['classic', 'doodle', 'sketch', 'cave']) {
      const plain = generateMaze({ paper: LETTER, pen: MARKER, level: 5, shape, seed: 'w' })
      const a = renderSvg(g.grid, g.maze, g.solution, { ...base, style: styleOf(id) })
      const b = renderSvg(plain.grid, plain.maze, plain.solution, { ...base, style: styleOf(id) })
      expect(a).not.toBe(b)
    }
  })

  it('draws the tunnel that passes over last, in the Cave style', () => {
    // Cave has no walls to break, so a bridge is the same tunnel drawn again on
    // top: its black edge is what cuts the white out of the one beneath.
    const sheet = buildSheet(g.grid, g.maze, g.solution, {
      ...base,
      style: styleOf('cave'),
      markers: 'none',
    })
    const bridges = g.grid.crossings().filter((x) => carved(x, g.maze)).length
    const tail = sheet.strokes.slice(-2 * bridges)
    expect(tail.filter((s) => s.light === true)).toHaveLength(bridges)
    // And none of the flat style's white cuts, which would rub out a tunnel.
    expect(sheet.strokes.some((s) => s.fill === true)).toBe(false)
  })

  it('raises the bridge onto the wall tops in the isometric style', () => {
    // The one style where a crossing needs no convention at all, and what the
    // height in `IsoView.to` was put there for.
    const wide = landscape(LETTER)
    const iso = woven('i', wide, true)
    const n = iso.grid.crossings().filter((x) => carved(x, iso.maze)).length
    expect(n).toBeGreaterThan(0)
    const sheet = buildSheet(iso.grid, iso.maze, iso.solution, {
      paper: wide,
      stroke: MARKER.stroke,
      style: styleOf('iso'),
    })
    const flat = buildSheet(iso.grid, iso.maze, iso.solution, {
      paper: wide,
      stroke: MARKER.stroke,
      style: styleOf('classic'),
    })
    expect(sheet.strokes.length).toBeGreaterThan(flat.strokes.length)
  })
})

describe('solving a woven maze on screen', () => {
  const g = woven('play')

  it('reports no cell over a crossing, which is the truth about it', () => {
    for (const x of g.grid.crossings()) expect(g.grid.cellAtPoint(x.at)).toBe(-1)
  })

  it('follows a finger across a bridge all the same', () => {
    // A drag over a crossing lands on nothing for a sample or two and then on
    // the cell beyond, which is one step away through the bridge. Walking the
    // drawn answer is the check that the whole chain agrees.
    const route = solve(g.maze) as CellId[]
    const at = (c: CellId): Point => g.grid.cellCenter(c)
    let trail = startTrail(g.maze)
    for (let i = 1; i < route.length; i++) {
      trail = follow(trail, g.maze, g.grid, at(route[i - 1] as CellId), at(route[i] as CellId))
    }
    expect(trail.done).toBe(true)
  })
})
