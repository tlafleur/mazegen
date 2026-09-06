import { writeFileSync } from 'node:fs'
import { generateMaze, shapesFor } from './src/generate'
import { renderSvg } from './src/render/svg'
import { shapeIcon } from './src/render/thumbnail'
import { STYLES } from './src/render/style'
import { LETTER, MARKER, CRAYON } from './src/render/page'

const shapes = shapesFor(LETTER, MARKER).filter((s) =>
  ['rocket', 'fish', 'cupcake', 'dinosaur'].includes(s.id))
const doodle = STYLES.find((s) => s.id === 'doodle')!

const icons = shapes.map((s) => {
  const grid = shapesFor(LETTER, MARKER)
  void grid
  return `<figure><div class="icon">${shapeIcon(s, 254 / 190.5, 40)}</div><figcaption>${s.label} icon</figcaption></figure>`
})

const mazes = shapes.map((s) => {
  const g = generateMaze({ paper: LETTER, pen: MARKER, level: 3, shape: s, seed: 'look' })
  return `<figure><div class="sheet">${renderSvg(g.grid, g.maze, g.solution, { paper: LETTER, stroke: MARKER.stroke, style: doodle, styleSeed: 3 })}</div><figcaption>${s.label} · ${g.grid.cellCount} cells</figcaption></figure>`
})

const crayon = shapes.map((s) => {
  const g = generateMaze({ paper: LETTER, pen: CRAYON, level: 1, shape: s, seed: 'look' })
  return `<figure><div class="sheet">${renderSvg(g.grid, g.maze, g.solution, { paper: LETTER, stroke: CRAYON.stroke, style: doodle, styleSeed: 3 })}</div><figcaption>${s.label} · crayon · ${g.grid.cellCount} cells</figcaption></figure>`
})

writeFileSync('.preview.html', `<style>
body{margin:0;padding:16px;background:#eceef1;font:13px system-ui}
section{display:flex;gap:12px;margin-bottom:18px;align-items:flex-start}
figure{margin:0;flex:1}
.sheet{background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.2)}
.icon{background:#fff;padding:14px;border-radius:12px;color:#16181d;display:flex;justify-content:center}
.icon svg{width:70px;height:90px}
svg{display:block;width:100%;height:auto}
figcaption{padding-top:5px;text-align:center;color:#444;font-size:12px}
h2{margin:0 0 6px;font-size:13px}
</style>
<h2>Picker icons</h2><section>${icons.join('')}</section>
<h2>Marker size, level 3</h2><section>${mazes.join('')}</section>
<h2>Crayon size, level 1</h2><section>${crayon.join('')}</section>`)
