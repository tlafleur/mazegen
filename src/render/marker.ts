import type { Point } from '../core/grid/planar'
import { circleCommands, type PathCommand } from './path'

export interface MarkerPart {
  readonly commands: readonly PathCommand[]
  readonly fill?: boolean
}

/** A part on the page, carrying the line width it is drawn at. */
export interface PlacedMarkerPart extends MarkerPart {
  readonly width: number
}

/**
 * A drawing placed at an opening, so a maze has somewhere to start and somewhere
 * to get to.
 *
 * This is the difference between Doodle World and Classic with wobbly lines: a
 * child should be able to see what the maze is for without reading the word
 * "start". See docs/DESIGN.md §11.
 *
 * Drawn inside a 10 by 10 box and placed centred, always upright — a mouse
 * rotated to match a left-hand opening reads as a mouse lying down. Held as
 * drawing commands rather than markup so the PDF contains them too; art written
 * as an SVG fragment would quietly be missing from every printed sheet.
 */
export interface Marker {
  readonly id: string
  readonly parts: readonly MarkerPart[]
}

/**
 * Bold on purpose. At 10 mm on paper, thin detail closes up or drops out, so
 * these are a few large shapes rather than an accurate drawing.
 */
export const MOUSE: Marker = {
  id: 'mouse',
  parts: [
    {
      // Body and head as one rounded form, snout to the right.
      commands: [
        { op: 'M', x: 2.4, y: 6.4 },
        { op: 'C', c1x: 2.4, c1y: 4.5, c2x: 4, c2y: 3.4, x: 5.7, y: 3.4 },
        { op: 'C', c1x: 7.5, c1y: 3.4, c2x: 9.4, c2y: 4.7, x: 9.4, y: 6.1 },
        { op: 'C', c1x: 9.4, c1y: 7.6, c2x: 7.6, c2y: 8.6, x: 5.7, y: 8.6 },
        { op: 'C', c1x: 3.8, c1y: 8.6, c2x: 2.4, c2y: 7.9, x: 2.4, y: 6.4 },
        { op: 'Z' },
      ],
    },
    // Ear, on the crown rather than crossing the body outline.
    { commands: circleCommands(4.5, 3.5, 1.7) },
    {
      // Tail, curling away behind.
      commands: [
        { op: 'M', x: 2.5, y: 7.2 },
        { op: 'C', c1x: 1.2, c1y: 7.6, c2x: 0.6, c2y: 8.8, x: 1.4, y: 9.5 },
      ],
    },
    // The one filled mark, so the face reads at a glance.
    { commands: circleCommands(7.4, 5.5, 0.45), fill: true },
  ],
}

export const CHEESE: Marker = {
  id: 'cheese',
  parts: [
    {
      // A wedge: flat base, sloping top, and a blunt point. A true triangle
      // narrows to nothing, and its last millimetre fills in solid as soon as
      // two stroke widths meet — which is what a marker shrunk to fit a margin
      // is made of.
      commands: [
        { op: 'M', x: 1.4, y: 8.8 },
        { op: 'L', x: 8.8, y: 8.8 },
        { op: 'L', x: 8.8, y: 3.6 },
        { op: 'L', x: 1.4, y: 7.6 },
        { op: 'Z' },
      ],
    },
    { commands: circleCommands(6.4, 7.2, 0.8) },
    { commands: circleCommands(7.8, 5.6, 0.5) },
    { commands: circleCommands(4, 7.9, 0.5) },
  ],
}

/** Scale about the origin, then shift. */
function place(commands: readonly PathCommand[], scale: number, dx: number, dy: number): PathCommand[] {
  const x = (v: number): number => v * scale + dx
  const y = (v: number): number => v * scale + dy
  return commands.map((c) => {
    if (c.op === 'Z') return c
    if (c.op === 'Q') return { op: 'Q', cx: x(c.cx), cy: y(c.cy), x: x(c.x), y: y(c.y) }
    if (c.op === 'C') {
      return {
        op: 'C',
        c1x: x(c.c1x),
        c1y: y(c.c1y),
        c2x: x(c.c2x),
        c2y: y(c.c2y),
        x: x(c.x),
        y: y(c.y),
      }
    }
    return { op: c.op, x: x(c.x), y: y(c.y) }
  })
}

export interface MarkerPlacement {
  readonly marker: Marker
  /** The opening the drawing belongs to. */
  readonly at: Point
  /** Unit vector pointing out of the maze. */
  readonly outward: Point
  /** Height of the drawing on paper, in millimetres. At most: see below. */
  readonly size: number
  /** Gap between the outline and the drawing, in millimetres. */
  readonly gap: number
  /** Line width at the full requested size; scaled down with the drawing. */
  readonly stroke: number
}

/**
 * How close to the paper edge anything may be drawn, in millimetres.
 *
 * Printers cannot print to the edge: the sheet is held by rollers that need
 * somewhere to grip. Consumer inkjets typically refuse the outer 3.2 mm and
 * lasers rather more, so a marker placed against the true page edge prints
 * clipped, or not at all. Five millimetres clears every hardware margin we can
 * expect without eating into the drawing.
 */
export const SAFE_INSET = 5

/** Below this a 10 by 10 drawing is a smudge, so it is better left out. */
const MIN_SIZE = 5

/**
 * Thinnest line worth printing, in millimetres.
 *
 * Below about a fifth of a millimetre a stroke starts dropping out on paper,
 * depending on the printer and how absorbent the sheet is.
 */
const MIN_STROKE = 0.2

/**
 * A marker's parts, positioned on the page, or nothing when it will not fit.
 *
 * The maze fills its margin, so a marker outside the outline is always drawn in
 * that margin — which means the size asked for is a maximum, not a promise. It
 * shrinks to the room between the opening and the printable edge, and is left
 * out entirely below the size at which it stops reading as a mouse. Omitting is
 * deliberate: a clipped drawing looks like a mistake, an absent one looks like
 * a plain maze.
 */
export function placeMarker(
  p: MarkerPlacement,
  page: { width: number; height: number },
): PlacedMarkerPart[] {
  // How far the drawing can reach before it runs into the printable edge. The
  // outward vector is axis-aligned, so only one component matters.
  const room =
    p.outward.x !== 0
      ? p.outward.x > 0
        ? page.width - SAFE_INSET - p.at.x
        : p.at.x - SAFE_INSET
      : p.outward.y > 0
        ? page.height - SAFE_INSET - p.at.y
        : p.at.y - SAFE_INSET

  const size = Math.min(p.size, room - p.gap)
  if (size < MIN_SIZE) return []

  const half = size / 2
  let cx = p.at.x + p.outward.x * (p.gap + half)
  let cy = p.at.y + p.outward.y * (p.gap + half)

  // Across the opening the drawing is centred, which near a corner would push
  // it off the sheet. Slide it back rather than dropping it.
  if (p.outward.x === 0) {
    cx = Math.min(Math.max(cx, SAFE_INSET + half), page.width - SAFE_INSET - half)
  } else {
    cy = Math.min(Math.max(cy, SAFE_INSET + half), page.height - SAFE_INSET - half)
  }

  // The line scales with the drawing. Held fixed, a wall-weight stroke closes
  // the cheese wedge into a solid triangle and fills in its holes as soon as
  // the marker shrinks to fit a margin.
  const scale = size / 10
  const width = Math.max(p.stroke * scale, MIN_STROKE)

  return p.marker.parts.map((part) => ({
    commands: place(part.commands, scale, cx - half, cy - half),
    width,
    ...(part.fill === true ? { fill: true } : {}),
  }))
}
