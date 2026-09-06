import type { Point } from '../core/grid/planar'

export interface Style {
  readonly id: string
  readonly label: string
  /** Corner rounding, as a fraction of the cell pitch. 0 draws sharp corners. */
  readonly rounding: number
  /** Vertex displacement, as a fraction of the cell pitch. 0 keeps a true lattice. */
  readonly jitter: number
  /**
   * Draw the passages rather than the walls.
   *
   * The same maze, rendered inside out: a wide black stroke along the passage
   * graph with a narrower white one on top of it, which leaves outlined tunnels
   * and no boolean geometry anywhere. Two paths for the whole sheet.
   */
  readonly cave?: boolean
  /**
   * Draw every line twice, each pass wandering on its own, as a fraction of
   * pitch. What a person does with a pen; nothing else in this file is
   * per-stroke rather than per-vertex.
   */
  readonly sketch?: number
}

/**
 * The most a vertex may move, as a fraction of pitch.
 *
 * Two parallel walls sit one pitch apart and each may move this far toward the
 * other, so the narrowest a corridor can become is `pitch * (1 - 2 * MAX) minus
 * the stroke` — at 0.2 that is 0.6 × pitch, or 6.2 mm of clear space at crayon
 * size. Wide enough to draw through, and guaranteed by construction rather than
 * by hoping. See docs/DESIGN.md §5.
 */
export const MAX_JITTER = 0.2

export const CLASSIC: Style = { id: 'classic', label: 'Classic', rounding: 0, jitter: 0 }

/**
 * How much of a tunnel's width the wall between two of them takes.
 *
 * At 0.18 the black band is 0.82 × pitch and the white gap between two
 * neighbouring tunnels is 0.18 × pitch — 1.6 mm at marker size, 2.2 mm at
 * crayon. Thick enough to read as a wall, thin enough to leave the tunnel
 * wider than the pen drawing in it.
 */
export const CAVE_GAP = 0.18

export const STYLES: readonly Style[] = [
  CLASSIC,
  { id: 'soft', label: 'Soft', rounding: 0.35, jitter: 0 },
  { id: 'doodle', label: 'Doodle', rounding: 0.35, jitter: 0.14 },
  { id: 'wonky', label: 'Wonky', rounding: 0.25, jitter: MAX_JITTER },
  // Sketch keeps its shared jitter small so its two passes have room to wander
  // separately: measured, a pass has to move further than the stroke is wide or
  // the two land on top of each other and the line looks drawn once. The sum is
  // still what the corridor guarantee has to hold.
  { id: 'sketch', label: 'Sketch', rounding: 0.3, jitter: 0.06, sketch: 0.1 },
  { id: 'cave', label: 'Cave', rounding: 0.5, jitter: 0, cave: true },
]

/**
 * How far one pass of a sketched line wanders at a given point.
 *
 * Keyed on the pass and on position along the line rather than on a vertex id,
 * which is the opposite of `jitterOffset` and deliberately so: two passes over
 * the same wall must *not* agree, or they would land on top of each other and
 * the line would look drawn once.
 */
export function sketchOffset(pass: number, index: number, seed: number, amount: number): Point {
  if (amount === 0) return { x: 0, y: 0 }
  const angle = hash(index * 2 + pass, seed + pass * 0x9e37, 0x51ed270b) * Math.PI * 2
  const radius = Math.sqrt(hash(index, seed + pass * 0x85eb, 0xc2b2ae35)) * amount
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

/** Two independent values in [0, 1) from a pair of integers. */
function hash(a: number, b: number, salt: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ b ^ salt, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x2545f491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * How far a lattice vertex is displaced.
 *
 * A pure function of the vertex id and the seed, which is the whole trick: the
 * four walls meeting at a vertex all ask this same question and get the same
 * answer, so they move together and never come apart. Perturbing wall segments
 * independently instead would tear the maze open at every corner.
 */
export function jitterOffset(vertex: number, seed: number, amount: number): Point {
  if (amount === 0) return { x: 0, y: 0 }
  const angle = hash(vertex, seed, 0x1b873593) * Math.PI * 2
  // sqrt keeps the displacement uniform over the disc rather than clustered
  // at its centre.
  const radius = Math.sqrt(hash(vertex, seed, 0x6b43a9b5)) * amount
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

/** Turns sharper than this get a rounded corner; anything flatter stays straight. */
const STRAIGHT_EPSILON = 1e-6

function corner(
  prev: Point,
  cur: Point,
  next: Point,
  radius: number,
): { in: Point; out: Point } | null {
  const ax = prev.x - cur.x
  const ay = prev.y - cur.y
  const bx = next.x - cur.x
  const by = next.y - cur.y
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (la === 0 || lb === 0) return null

  // Collinear runs need no corner, and skipping them keeps a Classic maze's
  // path data down to one command per straight stretch.
  const cross = (ax * by - ay * bx) / (la * lb)
  if (Math.abs(cross) < STRAIGHT_EPSILON) return null

  // Never cut back past the midpoint of either arm, or adjacent corners eat
  // into each other and the wall pulls away from where it belongs.
  const r = Math.min(radius, la / 2, lb / 2)
  return {
    in: { x: cur.x + (ax / la) * r, y: cur.y + (ay / la) * r },
    out: { x: cur.x + (bx / lb) * r, y: cur.y + (by / lb) * r },
  }
}

/**
 * One polyline as SVG path data, with its corners rounded.
 *
 * A closed run — one whose last point repeats its first — is rounded all the
 * way round, including the join, so the outline of a shape has no flat spot
 * where the walk happened to start.
 */
export function polylinePath(points: readonly Point[], radius: number): string {
  if (points.length < 2) return ''

  const first = points[0] as Point
  const last = points[points.length - 1] as Point
  const closed =
    points.length > 3 && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9
  const ring = closed ? points.slice(0, -1) : points
  const n = ring.length

  if (radius <= 0) {
    let d = 'M' + fmt(first.x) + ' ' + fmt(first.y)
    for (let i = 1; i < points.length; i++) {
      const p = points[i] as Point
      d += 'L' + fmt(p.x) + ' ' + fmt(p.y)
    }
    return d
  }

  let d = ''
  const start = closed ? 0 : 1
  const stop = closed ? n : n - 1

  if (!closed) d = 'M' + fmt(first.x) + ' ' + fmt(first.y)

  for (let i = start; i < stop; i++) {
    const cur = ring[i] as Point
    const prev = ring[(i - 1 + n) % n] as Point
    const next = ring[(i + 1) % n] as Point
    const c = corner(prev, cur, next, radius)

    if (c === null) {
      d += (d === '' ? 'M' : 'L') + fmt(cur.x) + ' ' + fmt(cur.y)
      continue
    }
    d += (d === '' ? 'M' : 'L') + fmt(c.in.x) + ' ' + fmt(c.in.y)
    d += 'Q' + fmt(cur.x) + ' ' + fmt(cur.y) + ' ' + fmt(c.out.x) + ' ' + fmt(c.out.y)
  }

  if (closed) return d + 'Z'
  return d + 'L' + fmt(last.x) + ' ' + fmt(last.y)
}
