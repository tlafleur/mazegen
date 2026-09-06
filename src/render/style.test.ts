import { describe, expect, it } from 'vitest'
import { CLASSIC, MAX_JITTER, STYLES, jitterOffset, polylinePath } from './style'
import { renderSvg } from './svg'
import { generateMaze, shapesFor } from '../generate'
import { LETTER, MARKER } from './page'
import { solve } from '../core/analyze'
import type { Point } from '../core/grid/planar'

describe('jitterOffset', () => {
  it('never moves a vertex further than allowed', () => {
    // The corridor-width guarantee rests entirely on this bound: two parallel
    // walls are one pitch apart and each may move this far toward the other.
    for (let v = 0; v < 20000; v++) {
      const p = jitterOffset(v, 7, 0.2)
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(0.2 + 1e-12)
    }
  })

  it('gives the same vertex the same displacement every time', () => {
    // Why walls stay joined: the four walls meeting at a vertex all ask this
    // and must get one answer.
    for (const v of [0, 1, 97, 4096]) {
      expect(jitterOffset(v, 3, 0.5)).toEqual(jitterOffset(v, 3, 0.5))
    }
  })

  it('moves different vertices differently', () => {
    const a = jitterOffset(10, 3, 0.5)
    const b = jitterOffset(11, 3, 0.5)
    expect(a).not.toEqual(b)
  })

  it('follows the seed', () => {
    expect(jitterOffset(10, 1, 0.5)).not.toEqual(jitterOffset(10, 2, 0.5))
  })

  it('does nothing at zero', () => {
    expect(jitterOffset(42, 1, 0)).toEqual({ x: 0, y: 0 })
  })

  it('spreads over the disc rather than bunching at the rim', () => {
    let inner = 0
    const n = 4000
    for (let v = 0; v < n; v++) {
      if (Math.hypot(...Object.values(jitterOffset(v, 1, 1)) as [number, number]) < 0.707) inner++
    }
    // Half the area of a unit disc lies inside radius 1/sqrt(2).
    expect(inner / n).toBeGreaterThan(0.44)
    expect(inner / n).toBeLessThan(0.56)
  })
})

describe('polylinePath', () => {
  const line = (...xs: number[]): Point[] => xs.map((x) => ({ x, y: 0 }))

  it('draws nothing from fewer than two points', () => {
    expect(polylinePath([], 1)).toBe('')
    expect(polylinePath([{ x: 0, y: 0 }], 1)).toBe('')
  })

  it('emits plain lines when rounding is off', () => {
    expect(polylinePath(line(0, 1, 2), 0)).toBe('M0 0L1 0L2 0')
  })

  it('leaves a straight run straight, with no corner commands', () => {
    // Collinear vertices need no rounding, and skipping them keeps a Classic
    // maze's path data to one command per straight stretch.
    const d = polylinePath(line(0, 1, 2, 3, 4), 0.3)
    expect(d).not.toContain('Q')
  })

  it('rounds a real corner', () => {
    const d = polylinePath([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ], 0.5)
    expect(d).toContain('Q')
    // Cut back by the radius along each arm, never reaching the corner itself.
    expect(d).toContain('L1.5 0')
    expect(d).toContain('Q2 0 2 0.5')
  })

  it('never cuts back past the midpoint of a short arm', () => {
    // A radius wider than the segment would pull the wall away from where it
    // belongs and let adjacent corners eat into each other.
    const d = polylinePath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ], 10)
    expect(d).toContain('L0.5 0')
    expect(d).toContain('Q1 0 1 0.5')
  })

  it('closes a ring without leaving a flat spot at the join', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 0 },
    ]
    const d = polylinePath(square, 1)
    expect(d.endsWith('Z')).toBe(true)
    // One rounded corner per vertex of the square, the join included.
    expect(d.match(/Q/g)).toHaveLength(4)
  })
})

describe('styled rendering', () => {
  const gen = (seed: string) =>
    generateMaze({
      paper: LETTER,
      pen: MARKER,
      level: 3,
      shape: shapesFor(LETTER, MARKER)[0] as never,
      seed,
    })

  it('never changes the maze, only how it is drawn', () => {
    // The invariant the whole style layer rests on: pick a different look and
    // the answer is still the answer.
    const g = gen('invariant')
    const before = solve(g.maze) as number[]
    for (const style of STYLES) {
      renderSvg(g.grid, g.maze, g.solution, {
        paper: LETTER,
        stroke: MARKER.stroke,
        style,
        styleSeed: 9,
      })
      expect(solve(g.maze)).toEqual(before)
    }
  })

  it('clamps a style that asks for more jitter than is safe', () => {
    const g = gen('clamp')
    const opts = { paper: LETTER, stroke: MARKER.stroke, styleSeed: 4 }
    const atLimit = renderSvg(g.grid, g.maze, g.solution, {
      ...opts,
      style: { id: 'a', label: 'a', rounding: 0, jitter: MAX_JITTER },
    })
    const wayOver = renderSvg(g.grid, g.maze, g.solution, {
      ...opts,
      style: { id: 'b', label: 'b', rounding: 0, jitter: 5 },
    })
    expect(wayOver).toBe(atLimit)
  })

  it('keeps every style inside the page', () => {
    const g = gen('bounds')
    for (const style of STYLES) {
      const svg = renderSvg(g.grid, g.maze, g.solution, {
        paper: LETTER,
        stroke: MARKER.stroke,
        style,
        styleSeed: 2,
        showSolution: true,
      })
      for (const m of svg.matchAll(/[MLQ]\s*(-?[\d.]+) (-?[\d.]+)/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(0)
        expect(Number(m[2])).toBeGreaterThanOrEqual(0)
        expect(Number(m[1])).toBeLessThanOrEqual(LETTER.width)
        expect(Number(m[2])).toBeLessThanOrEqual(LETTER.height)
      }
    }
  })

  it('draws Classic without any curves at all', () => {
    const g = gen('classic')
    const svg = renderSvg(g.grid, g.maze, g.solution, {
      paper: LETTER,
      stroke: MARKER.stroke,
      style: CLASSIC,
    })
    expect(svg).not.toContain('Q')
  })

  it('is deterministic for a given style seed', () => {
    const g = gen('repeat')
    const opts = {
      paper: LETTER,
      stroke: MARKER.stroke,
      style: STYLES[2] as never,
      styleSeed: 11,
    }
    expect(renderSvg(g.grid, g.maze, g.solution, opts)).toBe(
      renderSvg(g.grid, g.maze, g.solution, opts),
    )
  })
})
