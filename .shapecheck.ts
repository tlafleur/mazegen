import { SquareGrid } from './src/core/grid/square'
import { MaskedGrid } from './src/core/grid/masked'
import { shapeLibrary } from './src/core/grid/mask'
import { A4, PENS, gridSizeFor } from './src/render/page'

console.log('shape       ' + [...PENS.map(p=>p.id), 'spurs@crayon', 'spurs@fine'].map(h=>h.padStart(13)).join(''))
const rows: Record<string, string[]> = {}
for (const pen of PENS) {
  const { cols, rows: r } = gridSizeFor(A4, pen.pitch)
  const base = new SquareGrid(cols, r, pen.pitch)
  for (const shape of shapeLibrary(base.height / base.width)) {
    let cov = 'THREW', sp = 0
    try {
      const g = new MaskedGrid(base, shape.mask)
      cov = (g.cellCount / base.cellCount).toFixed(3)
      for (let c = 0; c < g.cellCount; c++) {
        let n = 0
        for (let d = 0; d < 4; d++) if (g.neighbourAcross(c, d) !== -1) n++
        if (n <= 1) sp++
      }
    } catch { /* keeps THREW */ }
    ;(rows[shape.id] ??= []).push(cov.padStart(13))
    if (pen.id === 'crayon' || pen.id === 'fine') rows[shape.id]!.push(String(sp).padStart(13))
  }
}
// Reorder so the two spur columns land at the end.
for (const [id, cells] of Object.entries(rows)) {
  const cov = cells.filter((_, i) => i !== 1 && i !== 5)
  const spur = [cells[1], cells[5]]
  console.log(id.padEnd(12) + cov.join('') + spur.join(''))
}
