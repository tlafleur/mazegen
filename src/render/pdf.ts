import type { Point } from '../core/grid/planar'
import { toPdfPath, type PathCommand } from './path'

/** 72 points to the inch, 25.4 millimetres to the inch. */
const MM_TO_PT = 72 / 25.4

export interface SheetStroke {
  readonly commands: readonly PathCommand[]
  /** Line width in millimetres, or the fill flag makes this unused. */
  readonly width: number
  readonly dash?: readonly [number, number]
  /** Fill the path solidly instead of stroking its outline. */
  readonly fill?: boolean
}

export interface SheetLabel {
  readonly text: string
  /** Baseline start, in millimetres from the top-left of the page. */
  readonly at: Point
  /** Cap height in millimetres. */
  readonly size: number
}

/**
 * A page, described once, in millimetres from the top-left corner.
 *
 * Both outputs render this same structure, so what a printed PDF contains
 * cannot drift from what the preview showed.
 */
export interface Sheet {
  readonly width: number
  readonly height: number
  readonly strokes: readonly SheetStroke[]
  readonly labels: readonly SheetLabel[]
}

function n2(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/**
 * Six decimals, for the page transform only.
 *
 * The scale factor is 2.834645669...; rounded to two decimals it is 2.83, which
 * is 0.16% small — a 100 mm ruler line printing as 99.84 mm, and the bottom of
 * a Letter page landing 1.3 pt above where the MediaBox says it is. Since the
 * reason this writer exists is 1:1 sizing, the matrix carries enough digits to
 * be exact to well under a micron.
 */
function n6(v: number): string {
  return v.toFixed(6)
}

/**
 * Latin-1, because the font below is declared with WinAnsiEncoding and this
 * file is assembled a byte at a time. The captions use a middle dot and a
 * multiplication sign, both of which live in that range; anything outside it
 * would corrupt the byte count the cross-reference table depends on.
 */
function pdfText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63
    const byte = code > 255 ? 63 : code
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\'
    out += String.fromCharCode(byte)
  }
  return out
}

function contentStream(sheet: Sheet): string {
  const parts: string[] = []
  const heightPt = sheet.height * MM_TO_PT

  // PDF measures from the bottom-left in points; everything upstream measures
  // from the top-left in millimetres. One transform reconciles both, so the
  // geometry below is written in exactly the units it was computed in — and
  // line widths and dash lengths, which the same matrix scales, come out right
  // without separate conversion.
  parts.push('q')
  parts.push(`${n6(MM_TO_PT)} 0 0 ${n6(-MM_TO_PT)} 0 ${n6(heightPt)} cm`)
  parts.push('1 J 1 j 0 G 0 g')

  for (const stroke of sheet.strokes) {
    parts.push('q')
    if (stroke.fill !== true) {
      parts.push(`${n2(stroke.width)} w`)
      if (stroke.dash) parts.push(`[${n2(stroke.dash[0])} ${n2(stroke.dash[1])}] 0 d`)
    }
    parts.push(toPdfPath(stroke.commands))
    parts.push(stroke.fill === true ? 'f' : 'S')
    parts.push('Q')
  }
  parts.push('Q')

  // Text sits outside the flipped block: the mirrored matrix above would print
  // it back to front.
  for (const label of sheet.labels) {
    parts.push('BT')
    parts.push(`/F1 ${n2(label.size * MM_TO_PT)} Tf`)
    parts.push(
      `1 0 0 1 ${n6(label.at.x * MM_TO_PT)} ${n6(heightPt - label.at.y * MM_TO_PT)} Tm`,
    )
    parts.push(`(${pdfText(label.text)}) Tj`)
    parts.push('ET')
  }

  return parts.join('\n')
}

/**
 * Assemble one or more sheets into a PDF file.
 *
 * Written directly rather than through a library. The drawing is lines, cubic
 * curves, one stroke width and black — a vocabulary a PDF content stream
 * already speaks — so the translation is close to one-to-one, and jsPDF at
 * ~350 kB or pdf-lib at ~1 MB would both be larger than the thing they replace.
 *
 * The point of doing it at all: a PDF states its page size in its own MediaBox,
 * so nothing downstream reinterprets it. Safari's web print shrinks a page by
 * about 7% while reporting 100%; a PDF prints at the size it claims. See
 * docs/DESIGN.md §7.
 *
 * Takes an array so the booklet export in phase 3 needs no second writer.
 */
export function buildPdf(sheets: readonly Sheet[]): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) throw new Error('a PDF needs at least one page')

  const chunks: string[] = []
  let length = 0
  const offsets: number[] = []

  const push = (s: string): void => {
    chunks.push(s)
    length += s.length
  }
  const openObject = (num: number): void => {
    offsets[num] = length
    push(`${num} 0 obj\n`)
  }

  // The binary comment tells anything reading this that the file is not text,
  // which stops well-meaning transports from rewriting its line endings.
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')

  const pageCount = sheets.length
  const fontNumber = 3 + pageCount * 2
  const kids = sheets.map((_, i) => `${3 + i * 2} 0 R`).join(' ')

  openObject(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  openObject(2)
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`)

  sheets.forEach((sheet, i) => {
    const pageNumber = 3 + i * 2
    const contentNumber = pageNumber + 1
    const content = contentStream(sheet)

    openObject(pageNumber)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ` +
        `${n2(sheet.width * MM_TO_PT)} ${n2(sheet.height * MM_TO_PT)}]` +
        ` /Contents ${contentNumber} 0 R` +
        ` /Resources << /Font << /F1 ${fontNumber} 0 R >> >> >>\nendobj\n`,
    )

    openObject(contentNumber)
    // Every character is one byte after pdfText, so string length is byte
    // length — which /Length has to be exactly right about.
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  })

  openObject(fontNumber)
  push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica' +
      ' /Encoding /WinAnsiEncoding >>\nendobj\n',
  )

  const xrefAt = length
  const total = fontNumber + 1
  push(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let i = 1; i < total; i++) {
    push(String(offsets[i] ?? 0).padStart(10, '0') + ' 00000 n \n')
  }
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  const text = chunks.join('')
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)
}
