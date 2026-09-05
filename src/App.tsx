import { useMemo, useState, type ReactNode } from 'react'
import { generateMaze } from './generate'
import { renderSvg } from './render/svg'
import { CRAYON, LETTER, PAPERS, PENS, type Paper, type Pen } from './render/page'

function newSeed(): string {
  return Math.floor(Math.random() * 0x100000000).toString(36)
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="group">
      <div className="group-label">{label}</div>
      <div className="chips">{children}</div>
    </div>
  )
}

export default function App() {
  const [paper, setPaper] = useState<Paper>(LETTER)
  const [pen, setPen] = useState<Pen>(CRAYON)
  const [showSolution, setShowSolution] = useState(false)
  const [calibration, setCalibration] = useState(true)
  const [seed, setSeed] = useState(newSeed)

  const { grid, svg } = useMemo(() => {
    const generated = generateMaze(paper, pen, seed)
    const g = generated.grid
    const caption = `100 mm · ${paper.label} · ${pen.label} · ${g.cols}×${g.rows} · seed ${seed}`
    return {
      grid: g,
      svg: renderSvg(g, generated.maze, generated.solution, {
        paper,
        stroke: pen.stroke,
        showSolution,
        calibration,
        caption,
      }),
    }
  }, [paper, pen, seed, showSolution, calibration])

  // @page cannot be driven by custom properties, so the rule is rebuilt
  // whenever the paper changes. Forcing explicit millimetres on the SVG at
  // print time undoes the preview's fit-to-screen scaling.
  const printCss =
    `@page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }\n` +
    `@media print { .sheet svg { width: ${paper.width}mm !important;` +
    ` height: ${paper.height}mm !important; } }`

  return (
    <div className="app">
      <style>{printCss}</style>

      <div className="stage">
        <div className="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      <div className="controls">
        <h1>
          mazegen <span className="phase">phase 0</span>
        </h1>

        <Group label="Paper">
          {PAPERS.map((p) => (
            <Chip key={p.id} on={p.id === paper.id} onClick={() => setPaper(p)}>
              {p.label}
            </Chip>
          ))}
        </Group>

        <Group label="Cell size">
          {PENS.map((p) => (
            <Chip key={p.id} on={p.id === pen.id} onClick={() => setPen(p)}>
              {p.label}
            </Chip>
          ))}
        </Group>

        <Group label="Show">
          <Chip on={showSolution} onClick={() => setShowSolution((v) => !v)}>
            Answer
          </Chip>
          <Chip on={calibration} onClick={() => setCalibration((v) => !v)}>
            Ruler
          </Chip>
        </Group>

        <div className="meta">
          {grid.cols} × {grid.rows} cells · {grid.cellCount} total · {pen.pitch} mm pitch
          <br />
          seed <code>{seed}</code>
        </div>

        <div className="actions">
          <button type="button" className="big" onClick={() => setSeed(newSeed())}>
            New maze
          </button>
          <button type="button" className="big primary" onClick={() => window.print()}>
            Print
          </button>
        </div>

        <p className="note">
          Phase 0 exists to prove the print path. Print a sheet, measure the 100 mm line, and
          compare — any difference is scaling applied between here and the paper.
        </p>
      </div>
    </div>
  )
}
