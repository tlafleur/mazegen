import type { Point } from './planar'

/**
 * A test for whether a point is inside a shape.
 *
 * Coordinates are centred on the grid and scaled uniformly so the **shorter**
 * axis spans [-1, 1]; the longer axis runs past it. Uniform scaling is what
 * keeps a circle a circle: Letter's live area is 0.75 wide-to-tall and A4's is
 * 0.68, so a mask written against a unit square would come out visibly
 * different on the two papers. See docs/DESIGN.md §4.
 */
export type Mask = (x: number, y: number) => boolean

export interface Shape {
  readonly id: string
  readonly label: string
  readonly mask: Mask
}

/** Fills the whole page. */
export const rectangleMask: Mask = () => true

export function roundedRectMask(radius: number, aspect: number): Mask {
  // Corner rounding is measured in mask units, so the same radius reads the
  // same on both papers.
  const halfY = aspect
  return (x, y) => {
    const dx = Math.abs(x) - (1 - radius)
    const dy = Math.abs(y) - (halfY - radius)
    if (dx <= 0 || dy <= 0) return Math.abs(x) <= 1 && Math.abs(y) <= halfY
    return dx * dx + dy * dy <= radius * radius
  }
}

/** A true circle, inscribed in the shorter axis. */
export const circleMask: Mask = (x, y) => x * x + y * y <= 1

/** An ellipse filling the whole bounding box. */
export function ellipseMask(aspect: number): Mask {
  return (x, y) => x * x + (y / aspect) * (y / aspect) <= 1
}

/**
 * The classic implicit heart, `(x² + y² - 1)³ - x²y³ ≤ 0`.
 *
 * The curve's own bounding box, sampled, is x ±1.138 and y -1.0 to 1.2, so it
 * is neither centred on the origin nor a unit shape. Both constants below come
 * from that box: 1.138 scales it to span the page width exactly, and 0.1
 * recentres it vertically. Getting this wrong is not subtle — an unscaled heart
 * runs past the page edge and prints with its sides sliced off.
 *
 * The sign of y flips because the curve is written for y-up and page
 * coordinates grow downward.
 */
export const heartMask: Mask = (x, y) => {
  const px = x * 1.138
  const py = -y * 1.138 + 0.1
  const t = px * px + py * py - 1
  return t * t * t - px * px * py * py * py <= 0
}

/** Ray casting. Works for any simple polygon, convex or not. */
export function polygonMask(vertices: readonly Point[]): Mask {
  return (x, y) => {
    let inside = false
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i] as Point
      const b = vertices[j] as Point
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside
      }
    }
    return inside
  }
}

/**
 * A star, as a polygon rather than a polar radius test.
 *
 * The polygon gives genuinely straight edges between tip and valley; a radius
 * threshold interpolated over the angle bows them outward.
 *
 * The default inner radius is deliberately fat. A textbook five-point star uses
 * around 0.42, which at these cell sizes narrows the points to single cells:
 * they stop being maze and become forced corridors sticking out of the shape.
 * At 0.6 the star covers 34% of the page instead of 23% and has one such cell
 * instead of five, while still plainly reading as a star.
 */
export function starMask(points = 5, innerRatio = 0.6): Mask {
  const vertices: Point[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio
    // Start at -90° so a point faces up the page.
    const angle = (i * Math.PI) / points - Math.PI / 2
    vertices.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })
  }
  return polygonMask(vertices)
}

/**
 * Objects, as polygons.
 *
 * Coordinates are the mask system from the top of this file: centred, the
 * shorter axis spanning [-1, 1], y growing downward. On a portrait page that
 * leaves roughly [-1.33, 1.33] vertically, so tall subjects have room to spare
 * and wide ones do not — the fish below is drawn deliberately chunky for that
 * reason rather than in the proportions a fish actually has.
 *
 * Two constraints shape all of them, both enforced by test: a shape has to keep
 * enough of the page to still be a maze, and it must not narrow anywhere to a
 * single cell, which stops being maze and becomes a spike.
 */

/** Nose up, fins at the base. Suits a portrait page better than anything else here. */
export const rocketMask: Mask = polygonMask([
  { x: 0, y: -1.22 },
  { x: 0.32, y: -0.76 },
  { x: 0.48, y: -0.3 },
  { x: 0.48, y: 0.56 },
  { x: 0.95, y: 1.08 },
  { x: 0.52, y: 1.02 },
  { x: 0.48, y: 1.22 },
  { x: -0.48, y: 1.22 },
  { x: -0.52, y: 1.02 },
  { x: -0.95, y: 1.08 },
  { x: -0.48, y: 0.56 },
  { x: -0.48, y: -0.3 },
  { x: -0.32, y: -0.76 },
])

/** Facing right, with a forked tail. Deeper-bodied than life, to fill the page. */
export const fishMask: Mask = polygonMask([
  { x: 1.0, y: 0.04 },
  { x: 0.6, y: -0.56 },
  { x: 0.05, y: -0.82 },
  { x: -0.45, y: -0.6 },
  { x: -0.63, y: -0.3 },
  { x: -0.98, y: -1.02 },
  { x: -0.8, y: 0 },
  { x: -0.98, y: 1.02 },
  { x: -0.63, y: 0.3 },
  { x: -0.45, y: 0.6 },
  { x: 0.05, y: 0.82 },
  { x: 0.6, y: 0.56 },
])

/**
 * Wrapper below, a swirl of frosting above.
 *
 * The swirl is deliberately shallow. Drawn with the swing a piped frosting
 * actually has, each bump tapers to a cell or two at fine-pen size and the spur
 * test rejects it; halving the horizontal swing keeps the silhouette readable
 * without the spikes.
 */
export const cupcakeMask: Mask = polygonMask([
  { x: -0.4, y: 1.24 },
  { x: 0.4, y: 1.24 },
  { x: 0.7, y: 0.24 },
  { x: 0.92, y: 0.1 },
  { x: 0.76, y: -0.24 },
  { x: 0.88, y: -0.46 },
  { x: 0.6, y: -0.72 },
  { x: 0.66, y: -0.92 },
  { x: 0.26, y: -1.02 },
  { x: 0, y: -1.18 },
  { x: -0.26, y: -1.02 },
  { x: -0.66, y: -0.92 },
  { x: -0.6, y: -0.72 },
  { x: -0.88, y: -0.46 },
  { x: -0.76, y: -0.24 },
  { x: -0.92, y: 0.1 },
  { x: -0.7, y: 0.24 },
])

/**
 * A long-neck facing right: the silhouette a child reads as "dinosaur" fastest.
 *
 * The legs are stubby and thick on purpose. Drawn in proportion they narrow to
 * a cell or two at crayon size, which the spur test rejects — correctly, since
 * a two-cell-wide leg offers no choices and reads as a spike.
 */
export const dinosaurMask: Mask = polygonMask([
  { x: 0.98, y: -1.0 },
  { x: 1.0, y: -0.64 },
  { x: 0.7, y: -0.54 },
  { x: 0.5, y: -0.1 },
  { x: 0.18, y: 0.18 },
  { x: -0.32, y: 0.12 },
  { x: -0.66, y: 0.2 },
  { x: -1.0, y: 0.46 },
  { x: -0.6, y: 0.56 },
  { x: -0.54, y: 0.66 },
  { x: -0.58, y: 1.24 },
  { x: -0.14, y: 1.24 },
  { x: -0.16, y: 0.88 },
  { x: 0.18, y: 0.9 },
  { x: 0.16, y: 1.24 },
  { x: 0.62, y: 1.24 },
  { x: 0.58, y: 0.66 },
  { x: 0.78, y: 0.22 },
  { x: 0.88, y: -0.42 },
  { x: 0.78, y: -0.98 },
])

/**
 * The shape library for v1.
 *
 * `aspect` is the grid's height divided by its width, needed by the shapes that
 * fill the page rather than inscribing in the shorter axis.
 */
export function shapeLibrary(aspect: number): readonly Shape[] {
  return [
    { id: 'rectangle', label: 'Page', mask: rectangleMask },
    { id: 'rounded', label: 'Rounded', mask: roundedRectMask(0.35, aspect) },
    { id: 'oval', label: 'Oval', mask: ellipseMask(aspect) },
    { id: 'circle', label: 'Circle', mask: circleMask },
    { id: 'heart', label: 'Heart', mask: heartMask },
    { id: 'star', label: 'Star', mask: starMask() },
    { id: 'rocket', label: 'Rocket', mask: rocketMask },
    { id: 'fish', label: 'Fish', mask: fishMask },
    { id: 'cupcake', label: 'Cupcake', mask: cupcakeMask },
    { id: 'dinosaur', label: 'Dinosaur', mask: dinosaurMask },
  ]
}
