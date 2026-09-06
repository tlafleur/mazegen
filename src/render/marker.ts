import type { Point } from '../core/grid/planar'

/**
 * A drawing placed at an opening, so a maze has somewhere to start and somewhere
 * to get to.
 *
 * This is the difference between Doodle World and Classic with wobbly lines: a
 * child should be able to see what the maze is for without reading the word
 * "start". See docs/DESIGN.md §11.
 *
 * Art is drawn inside a 10 by 10 box and placed centred, always upright — a
 * mouse rotated to match a left-hand opening reads as a mouse lying down. The
 * placement is outside the outline, which is how it keeps clear of the walls
 * without any collision test.
 */
export interface Marker {
  readonly id: string
  /** SVG fragment in a 0..10 box. Uses `currentColor` so one colour rule fits all. */
  readonly art: string
}

function n(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/**
 * Bold on purpose. At 8 mm on paper, thin detail closes up or drops out, so
 * these are a few large shapes rather than an accurate drawing.
 */
export const MOUSE: Marker = {
  id: 'mouse',
  art:
    // Body and head as one rounded form, snout to the right.
    '<path d="M2.4 6.4C2.4 4.5 4 3.4 5.7 3.4C7.5 3.4 9.4 4.7 9.4 6.1' +
    'C9.4 7.6 7.6 8.6 5.7 8.6C3.8 8.6 2.4 7.9 2.4 6.4Z" fill="none"/>' +
    // Ear, sitting on the crown rather than crossing the body outline.
    '<circle cx="4.5" cy="3.5" r="1.7" fill="none"/>' +
    // Tail, curling away behind.
    '<path d="M2.5 7.2C1.2 7.6 0.6 8.8 1.4 9.5" fill="none"/>' +
    // Eye, the one filled mark, so the face reads at a glance.
    '<circle cx="7.4" cy="5.5" r="0.45" fill="currentColor" stroke="none"/>',
}

export const CHEESE: Marker = {
  id: 'cheese',
  art:
    // A wedge: flat base, sloping top.
    '<path d="M1.2 8.6L9 8.6L9 4.6Z" fill="none"/>' +
    '<circle cx="6.6" cy="7.2" r="0.75" fill="none"/>' +
    '<circle cx="7.9" cy="5.9" r="0.5" fill="none"/>' +
    '<circle cx="4.6" cy="8" r="0.45" fill="none"/>',
}

export interface MarkerPlacement {
  readonly marker: Marker
  /** The opening the drawing belongs to. */
  readonly at: Point
  /** Unit vector pointing out of the maze. */
  readonly outward: Point
  /** Height of the drawing on paper, in millimetres. */
  readonly size: number
  /** Gap between the outline and the drawing, in millimetres. */
  readonly gap: number
  /** Stroke width on paper, in millimetres. */
  readonly stroke: number
}

/**
 * One marker as an SVG group, or the empty string when it will not fit.
 *
 * Omitting is deliberate: a drawing clipped by the edge of the page looks like
 * a mistake, where its absence looks like a plain maze.
 */
export function renderMarker(p: MarkerPlacement, page: { width: number; height: number }): string {
  const scale = p.size / 10
  const half = p.size / 2
  const cx = p.at.x + p.outward.x * (p.gap + half)
  const cy = p.at.y + p.outward.y * (p.gap + half)

  if (cx - half < 0 || cy - half < 0 || cx + half > page.width || cy + half > page.height) {
    return ''
  }

  return (
    `<g transform="translate(${n(cx - half)} ${n(cy - half)}) scale(${n(scale)})"` +
    ` fill="none" stroke="currentColor" stroke-width="${n(p.stroke / scale)}"` +
    ` stroke-linecap="round" stroke-linejoin="round">${p.marker.art}</g>`
  )
}
