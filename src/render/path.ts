import type { Point } from '../core/grid/planar'

/**
 * One drawing, in a form neither output format owns.
 *
 * SVG and PDF both have to draw exactly the same maze, and the fastest way to
 * get that wrong is to build the geometry twice. The renderer produces these
 * commands once; each backend only decides how to spell them.
 */
export type PathCommand =
  | { readonly op: 'M'; readonly x: number; readonly y: number }
  | { readonly op: 'L'; readonly x: number; readonly y: number }
  | { readonly op: 'Q'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | {
      readonly op: 'C'
      readonly c1x: number
      readonly c1y: number
      readonly c2x: number
      readonly c2y: number
      readonly x: number
      readonly y: number
    }
  | { readonly op: 'Z' }

/**
 * A circle as four cubic arcs.
 *
 * 0.5522847 is the usual constant: the control-point distance, as a fraction of
 * the radius, that makes a cubic hug a quarter circle to within about a
 * thousandth of it — far below anything a printer resolves.
 *
 * Needed because the marker drawings use circles, and everything on the sheet
 * has to exist in this one representation or it silently goes missing from
 * whichever output was not thought about.
 */
export function circleCommands(cx: number, cy: number, r: number): PathCommand[] {
  const k = 0.5522847498307936 * r
  return [
    { op: 'M', x: cx + r, y: cy },
    { op: 'C', c1x: cx + r, c1y: cy + k, c2x: cx + k, c2y: cy + r, x: cx, y: cy + r },
    { op: 'C', c1x: cx - k, c1y: cy + r, c2x: cx - r, c2y: cy + k, x: cx - r, y: cy },
    { op: 'C', c1x: cx - r, c1y: cy - k, c2x: cx - k, c2y: cy - r, x: cx, y: cy - r },
    { op: 'C', c1x: cx + k, c1y: cy - r, c2x: cx + r, c2y: cy - k, x: cx + r, y: cy },
    { op: 'Z' },
  ]
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
  // path down to one command per straight stretch.
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
 * One polyline as drawing commands, with its corners rounded.
 *
 * A closed run — one whose last point repeats its first — is rounded all the
 * way round, including the join, so the outline of a shape has no flat spot
 * where the walk happened to start.
 */
export function polylineCommands(points: readonly Point[], radius: number): PathCommand[] {
  if (points.length < 2) return []

  const first = points[0] as Point
  const last = points[points.length - 1] as Point
  const closed =
    points.length > 3 && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9
  const ring = closed ? points.slice(0, -1) : points
  const n = ring.length
  const out: PathCommand[] = []

  if (radius <= 0) {
    out.push({ op: 'M', x: first.x, y: first.y })
    for (let i = 1; i < points.length; i++) {
      const p = points[i] as Point
      out.push({ op: 'L', x: p.x, y: p.y })
    }
    return out
  }

  const start = closed ? 0 : 1
  const stop = closed ? n : n - 1
  if (!closed) out.push({ op: 'M', x: first.x, y: first.y })

  for (let i = start; i < stop; i++) {
    const cur = ring[i] as Point
    const prev = ring[(i - 1 + n) % n] as Point
    const next = ring[(i + 1) % n] as Point
    const c = corner(prev, cur, next, radius)

    if (c === null) {
      out.push({ op: out.length === 0 ? 'M' : 'L', x: cur.x, y: cur.y })
      continue
    }
    out.push({ op: out.length === 0 ? 'M' : 'L', x: c.in.x, y: c.in.y })
    out.push({ op: 'Q', cx: cur.x, cy: cur.y, x: c.out.x, y: c.out.y })
  }

  if (closed) out.push({ op: 'Z' })
  else out.push({ op: 'L', x: last.x, y: last.y })
  return out
}

function n3(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

export function toSvgPath(commands: readonly PathCommand[]): string {
  let d = ''
  for (const c of commands) {
    if (c.op === 'M') d += 'M' + n3(c.x) + ' ' + n3(c.y)
    else if (c.op === 'L') d += 'L' + n3(c.x) + ' ' + n3(c.y)
    else if (c.op === 'Q') d += 'Q' + n3(c.cx) + ' ' + n3(c.cy) + ' ' + n3(c.x) + ' ' + n3(c.y)
    else if (c.op === 'C') {
      d +=
        'C' + n3(c.c1x) + ' ' + n3(c.c1y) + ' ' + n3(c.c2x) + ' ' + n3(c.c2y) +
        ' ' + n3(c.x) + ' ' + n3(c.y)
    } else d += 'Z'
  }
  return d
}

/**
 * The same commands as a PDF content-stream fragment.
 *
 * PDF has no quadratic curve, so each one is raised to the equivalent cubic:
 * the control points sit two thirds of the way from each end toward the
 * quadratic's single control point, which reproduces the curve exactly rather
 * than approximating it.
 */
export function toPdfPath(commands: readonly PathCommand[]): string {
  const parts: string[] = []
  let cx = 0
  let cy = 0

  for (const c of commands) {
    if (c.op === 'M') {
      parts.push(`${n3(c.x)} ${n3(c.y)} m`)
      cx = c.x
      cy = c.y
    } else if (c.op === 'L') {
      parts.push(`${n3(c.x)} ${n3(c.y)} l`)
      cx = c.x
      cy = c.y
    } else if (c.op === 'Q') {
      const c1x = cx + (2 / 3) * (c.cx - cx)
      const c1y = cy + (2 / 3) * (c.cy - cy)
      const c2x = c.x + (2 / 3) * (c.cx - c.x)
      const c2y = c.y + (2 / 3) * (c.cy - c.y)
      parts.push(
        `${n3(c1x)} ${n3(c1y)} ${n3(c2x)} ${n3(c2y)} ${n3(c.x)} ${n3(c.y)} c`,
      )
      cx = c.x
      cy = c.y
    } else if (c.op === 'C') {
      parts.push(
        `${n3(c.c1x)} ${n3(c.c1y)} ${n3(c.c2x)} ${n3(c.c2y)} ${n3(c.x)} ${n3(c.y)} c`,
      )
      cx = c.x
      cy = c.y
    } else {
      parts.push('h')
    }
  }
  return parts.join('\n')
}
