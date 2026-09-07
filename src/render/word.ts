import type { Mask, Shape } from '../core/grid/mask'

/** A one-bit image, row major. */
export interface Bitmap {
  readonly width: number
  readonly height: number
  /** Non-zero where the shape is. */
  readonly on: Uint8Array
}

/**
 * A mask that reads a bitmap laid over the grid's box.
 *
 * The mask's coordinates are the ones `MaskedGrid` uses: the shorter axis spans
 * [-1, 1] and the longer one spans [-aspect, aspect], uniformly scaled so a
 * circle stays a circle. The bitmap is assumed to cover exactly that box.
 */
export function bitmapMask(bmp: Bitmap, aspect: number): Mask {
  const sx = bmp.width / 2
  const sy = bmp.height / (2 * aspect)
  return (x, y) => {
    const i = Math.floor((x + 1) * sx)
    const j = Math.floor((y + aspect) * sy)
    if (i < 0 || j < 0 || i >= bmp.width || j >= bmp.height) return false
    return (bmp.on[j * bmp.width + i] as number) !== 0
  }
}

/**
 * Widen a bitmap by a radius, in pixels.
 *
 * A letter drawn at its natural weight has limbs one or two cells thick, which
 * is not a corridor — it is a line. Dilating is what turns a glyph into
 * something a maze can live inside. Done here rather than by stroking the text
 * on the canvas so it is testable without a browser, and so the radius can be
 * stated in cells.
 *
 * Two passes of a separable box maximum, which is a square dilation. A round
 * one would be prettier and this is invisible under a maze.
 */
export function dilate(bmp: Bitmap, radius: number): Bitmap {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return bmp
  const { width: w, height: h } = bmp
  const mid = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let hit = 0
      for (let k = Math.max(0, i - r); k <= Math.min(w - 1, i + r); k++) {
        if ((bmp.on[j * w + k] as number) !== 0) {
          hit = 1
          break
        }
      }
      mid[j * w + i] = hit
    }
  }
  const out = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let hit = 0
      for (let k = Math.max(0, j - r); k <= Math.min(h - 1, j + r); k++) {
        if ((mid[k * w + i] as number) !== 0) {
          hit = 1
          break
        }
      }
      out[j * w + i] = hit
    }
  }
  return { width: w, height: h, on: out }
}

/**
 * Join everything the bitmap contains into one connected shape.
 *
 * Separate letters are separate components, and `MaskedGrid` keeps only the
 * largest — so without this a three-letter name becomes a maze of one letter.
 * Each band of ink gets a bar along its foot, where every capital already ends,
 * so it reads as a line the word stands on; consecutive bands are then bridged
 * down the middle.
 *
 * Written against bands of ink rather than against letters, so it does not need
 * to know how the word was laid out.
 */
export function underline(bmp: Bitmap, thickness: number, bridge = thickness): Bitmap {
  const { width: w, height: h } = bmp
  const t = Math.max(1, Math.round(thickness))
  const b = Math.max(1, Math.round(bridge))
  const out = Uint8Array.from(bmp.on)

  // Rows that hold ink, grouped into bands separated by blank rows.
  const bands: { top: number; bottom: number; left: number; right: number }[] = []
  let cur: { top: number; bottom: number; left: number; right: number } | null = null
  for (let j = 0; j < h; j++) {
    let left = w
    let right = -1
    for (let i = 0; i < w; i++) {
      if ((bmp.on[j * w + i] as number) === 0) continue
      if (i < left) left = i
      if (i > right) right = i
    }
    if (right === -1) {
      if (cur !== null) bands.push(cur)
      cur = null
      continue
    }
    if (cur === null) cur = { top: j, bottom: j, left, right }
    else {
      cur.bottom = j
      cur.left = Math.min(cur.left, left)
      cur.right = Math.max(cur.right, right)
    }
  }
  if (cur !== null) bands.push(cur)
  if (bands.length === 0) return bmp

  for (const band of bands) {
    // Inside the foot of the ink, not below it: a bar hanging in space would be
    // a separate component of its own, which is the opposite of the point.
    const top = Math.max(band.top, band.bottom - t + 1)
    for (let j = top; j <= band.bottom; j++) {
      for (let i = band.left; i <= band.right; i++) out[j * w + i] = 1
    }
  }

  // A stem between one band and the next, placed where the two are closest.
  //
  // Not simply down the middle, and not simply as far as the next band's first
  // row: SAM set as "SA" over "M" put the stem at the centre, where an M's top
  // row is the notch between its stems and there is no ink at all — so the stem
  // ended in space, the M stayed a separate component, and MaskedGrid dropped
  // it. Choosing the column where the next band's ink reaches highest lands the
  // joint on a stroke of the letter instead.
  const half = Math.max(0, Math.floor((b - 1) / 2))
  for (let k = 1; k < bands.length; k++) {
    const above = bands[k - 1] as (typeof bands)[number]
    const below = bands[k] as (typeof bands)[number]
    const from = Math.max(above.left + half, below.left + half)
    const to = Math.min(above.right - half, below.right - half)

    let mid = Math.round((below.left + below.right) / 2)
    let reach = below.bottom
    for (let i = Math.max(0, from); i <= Math.min(w - 1, to); i++) {
      for (let j = below.top; j < reach; j++) {
        if ((bmp.on[j * w + i] as number) === 0) continue
        reach = j
        mid = i
        break
      }
    }

    // The bar along `above`'s foot already spans its full width, so the stem
    // meets ink at both ends whatever column it lands in.
    for (let j = above.bottom; j <= reach; j++) {
      for (let i = Math.max(0, mid - half); i <= Math.min(w - 1, mid + half); i++) {
        out[j * w + i] = 1
      }
    }
  }

  return { width: w, height: h, on: out }
}

/**
 * How thick the shape's limbs already are, in pixels.
 *
 * Every row of ink is a set of runs; a capital letter's rows are mostly its
 * stems, so the median run length is close to the stem width. Measured rather
 * than assumed, because it depends on the typeface, the word and how large the
 * word had to be drawn — and dilating by a guess is what turns SAM into a slab.
 */
export function limbWidth(bmp: Bitmap): number {
  const runs: number[] = []
  for (let j = 0; j < bmp.height; j++) {
    let run = 0
    for (let i = 0; i < bmp.width; i++) {
      if ((bmp.on[j * bmp.width + i] as number) !== 0) run++
      else {
        if (run > 0) runs.push(run)
        run = 0
      }
    }
    if (run > 0) runs.push(run)
  }
  if (runs.length === 0) return 0
  runs.sort((a, b) => a - b)
  return runs[runs.length >> 1] as number
}

/** Everything the word mask needs that a browser has to provide. */
export interface WordOptions {
  /** How many cells fit across the grid; sets how much dilation is needed. */
  readonly cellsAcross: number
  /** Grid height over grid width. */
  readonly aspect: number
  /** Thinnest limb the word may have, in cells. */
  readonly minLimb?: number
}

const RASTER_WIDTH = 480

/**
 * Draw a word into a bitmap covering the grid's box.
 *
 * Uses a canvas because the alternative is authoring 26 glyphs by hand, and a
 * child should be able to type any word rather than pick from a list. Returns
 * null where there is no canvas — the caller falls back to a plain shape.
 */
export function rasterizeWord(text: string, aspect: number): Bitmap | null {
  const w = RASTER_WIDTH
  const h = Math.max(1, Math.round(w * aspect))

  let ctx: CanvasRenderingContext2D | null = null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  } catch {
    return null
  }
  if (ctx === null) return null

  ctx.fillStyle = '#000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const face = '900 100px "Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.font = face
  // Measuring rather than computing: how wide a word is depends on which
  // letters are in it, and how tall a capital is depends on the typeface that
  // actually loaded.
  const cap = capHeight(ctx)

  // A word set on one line across a portrait page leaves four fifths of it
  // blank and the letters too small to hold a maze. Try every number of lines
  // and take whichever gives a block closest to the shape of the page.
  const lines = bestLayout(text, aspect, (t) => ctx.measureText(t).width / 100, cap)
  const widest = Math.max(...lines.map((t) => ctx.measureText(t).width / 100))
  const blockH = blockHeight(lines.length, cap)

  const size = Math.min((w * 0.94) / widest, (h * 0.94) / blockH)
  ctx.font = face.replace('100px', `${Math.max(8, size)}px`)

  const step = cap * LINE_SPACING * size
  const top = h / 2 - (step * (lines.length - 1)) / 2
  lines.forEach((line, i) => ctx.fillText(line, w / 2, top + i * step))

  const px = ctx.getImageData(0, 0, w, h).data
  const on = new Uint8Array(w * h)
  for (let i = 0; i < on.length; i++) on[i] = (px[i * 4 + 3] as number) > 128 ? 1 : 0
  return { width: w, height: h, on }
}

/** Gap from one baseline to the next, as a multiple of cap height. */
const LINE_SPACING = 1.25

/**
 * How tall a block of n lines is, in cap heights.
 *
 * The gaps go *between* the lines: counting n of them adds a gap below the last
 * line that is not there, which for a single-line word left a quarter of the
 * page empty and the letters a quarter too small.
 */
function blockHeight(lines: number, cap: number): number {
  return cap * (1 + (lines - 1) * LINE_SPACING)
}

function capHeight(ctx: CanvasRenderingContext2D): number {
  const m = ctx.measureText('H')
  const cap = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 100
  return cap > 0 ? cap : 0.72
}

/**
 * How much stacking has to gain before it is worth doing.
 *
 * Comparing the shape of the block to the shape of the page is the obvious rule
 * and it is wrong: on a landscape sheet it set SAM as "SA" over "M", which uses
 * the middle third of a wide page and is not how anyone writes a name. Sizing
 * decides it instead, with a bias toward the fewest lines — an extra line has to
 * make the letters at least a quarter bigger to earn itself.
 */
const STACK_GAIN = 0.8

/**
 * Break a word into lines, and pick the number that makes the letters biggest.
 *
 * Pure, and exported for its own test: the layout decides how large the letters
 * get, and their size decides whether the word survives having a maze carved
 * into it.
 */
export function bestLayout(
  text: string,
  aspect: number,
  widthOf: (s: string) => number,
  cap: number,
): string[] {
  if (text.length === 0) return [text]

  // Relative type size for each layout, on a page one unit wide and `aspect`
  // tall: whichever of the two constraints binds first.
  const scored: { rows: string[]; size: number }[] = []
  for (let n = 1; n <= text.length; n++) {
    const rows = split(text, n)
    if (rows.length !== n) continue
    const widest = Math.max(...rows.map(widthOf))
    if (widest <= 0) continue
    scored.push({ rows, size: Math.min(1 / widest, aspect / blockHeight(n, cap)) })
  }
  if (scored.length === 0) return [text]

  const best = Math.max(...scored.map((s) => s.size))
  const chosen = scored.find((s) => s.size >= best * STACK_GAIN) ?? scored[0]
  return (chosen as { rows: string[] }).rows
}

/** Split into n lines as evenly as possible, longest lines first. */
function split(text: string, n: number): string[] {
  const per = Math.ceil(text.length / n)
  const out: string[] = []
  for (let i = 0; i < text.length; i += per) out.push(text.slice(i, i + per))
  return out
}

/**
 * A word as a shape a maze can be carved into.
 *
 * Dilation is stated in cells, not in pixels or points: the thing that has to
 * be true is that the thinnest limb holds a corridor a child can follow, and
 * that is a number of cells however large the word is drawn.
 */
export function wordShape(text: string, opts: WordOptions): Shape | null {
  const word = text.trim().toUpperCase()
  if (word === '') return null

  const raw = rasterizeWord(word, opts.aspect)
  if (raw === null) return null

  const cellPx = RASTER_WIDTH / opts.cellsAcross
  const minLimb = opts.minLimb ?? 2.4

  // Dilate only by what the letters are actually short of, and never by more
  // than a third of what they already have. Past that the counters of A, O and
  // R close up and the gaps between letters fill in, and a word nobody can read
  // is not a word maze — measured on SAM at pencil size, where a fixed radius
  // produced a solid slab.
  const have = limbWidth(raw)
  const want = minLimb * cellPx
  const grow = Math.min(Math.max(0, (want - have) / 2), have / 3)

  // A thin bar under each line, and a wider link between lines. Both have to be
  // more than a cell across or they can fall between two columns of cell
  // centres and contribute no cells at all — which is how MAZE first came out
  // as MA with a stub hanging off it, the second line having quietly become a
  // separate component and been dropped.
  const thick = underline(dilate(raw, grow), Math.max(1, cellPx * 1.4), Math.max(1, cellPx * 2.6))

  return { id: `word:${word}`, label: word, mask: bitmapMask(thick, opts.aspect) }
}
