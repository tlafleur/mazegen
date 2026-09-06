import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { generateMaze, shapesFor } from './generate'
import { renderSvg } from './render/svg'
import { shapeIcon, styleThumbnail } from './render/thumbnail'
import { STYLES } from './render/style'
import { RECIPES, type Level } from './core/difficulty'
import { hashSeed } from './core/rng'
import { PRESETS, presetFor } from './presets'
import { MARKER, PAPERS, PENS, defaultPaperFor, type Paper } from './render/page'

const HISTORY_LIMIT = 6

function newSeed(): string {
  return Math.floor(Math.random() * 0x100000000).toString(36)
}

interface Snapshot {
  readonly key: string
  readonly paperId: string
  readonly penId: string
  readonly level: Level
  readonly shapeId: string
  readonly styleId: string
  readonly seed: string
  readonly svg: string
}

/** Inline SVG produced by this app; no user input reaches it. */
function Svg({ markup, className }: { markup: string; className: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: markup }} />
}

/** Difficulty as filled dots. A picture, so a pre-reader can compare two cards. */
function Dots({ level }: { level: Level }) {
  return (
    <span className="dots" aria-label={`difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= level ? 'dot on' : 'dot'} />
      ))}
    </span>
  )
}

function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  label?: string
}) {
  return (
    <button
      type="button"
      className={on ? 'chip on' : 'chip'}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Group({
  label,
  columns,
  children,
}: {
  label: string
  columns: number
  children: ReactNode
}) {
  return (
    <div className="group">
      <div className="group-label">{label}</div>
      <div className="chips" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {children}
      </div>
    </div>
  )
}

export default function App() {
  const [paper, setPaper] = useState<Paper>(() => defaultPaperFor(navigator.language))
  const [level, setLevel] = useState<Level>(2)
  const [penId, setPenId] = useState(MARKER.id)
  const [shapeId, setShapeId] = useState('rectangle')
  const [styleId, setStyleId] = useState('doodle')
  const [seed, setSeed] = useState(newSeed)
  const [showSolution, setShowSolution] = useState(false)
  const [calibration, setCalibration] = useState(false)
  const [markers, setMarkers] = useState(true)
  const [history, setHistory] = useState<Snapshot[]>([])

  const pen = PENS.find((p) => p.id === penId) ?? MARKER
  const shapes = useMemo(() => shapesFor(paper, pen), [paper, pen])
  const shape = shapes.find((s) => s.id === shapeId) ?? (shapes[0] as (typeof shapes)[number])
  const style = STYLES.find((s) => s.id === styleId) ?? (STYLES[0] as (typeof STYLES)[number])
  const activePreset = presetFor(level, penId)

  const maze = useMemo(
    () => generateMaze({ paper, pen, level, shape, seed }),
    [paper, pen, level, shape, seed],
  )

  const styleSeed = hashSeed(seed)
  const base = { paper, stroke: pen.stroke, style, styleSeed, markers }

  const svg = useMemo(
    () =>
      renderSvg(maze.grid, maze.maze, maze.solution, {
        ...base,
        showSolution,
        calibration,
        caption:
          `100 mm · ${paper.label} · ${pen.label} · ${shape.label} · ` +
          `${style.label} · seed ${seed}`,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maze, paper, pen, style, styleSeed, seed, showSolution, calibration, markers],
  )

  // A second render without the answer or the ruler, so the filmstrip shows the
  // maze rather than whatever happened to be toggled when it was made.
  const plate = useMemo(
    () => renderSvg(maze.grid, maze.maze, maze.solution, base),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maze, paper, pen, style, styleSeed, markers],
  )

  const key = `${paper.id}|${penId}|${level}|${shapeId}|${styleId}|${seed}`
  useEffect(() => {
    setHistory((prev) => {
      // Never reorder: a maze a child is looking for should stay where they
      // last saw it, not jump to the front because they revisited it.
      if (prev.some((h) => h.key === key)) return prev
      const entry: Snapshot = { key, paperId: paper.id, penId, level, shapeId, styleId, seed, svg: plate }
      return [entry, ...prev].slice(0, HISTORY_LIMIT)
    })
  }, [key, plate, paper.id, penId, level, shapeId, styleId, seed])

  const restore = (s: Snapshot): void => {
    setPaper(PAPERS.find((p) => p.id === s.paperId) ?? paper)
    setPenId(s.penId)
    setLevel(s.level)
    setShapeId(s.shapeId)
    setStyleId(s.styleId)
    setSeed(s.seed)
  }

  // Icons: cheap, and independent of the maze on screen.
  const aspect = maze.grid.height / maze.grid.width
  const shapeIcons = useMemo(
    () => new Map(shapes.map((s) => [s.id, shapeIcon(s, aspect)])),
    [shapes, aspect],
  )
  const styleIcons = useMemo(() => new Map(STYLES.map((s) => [s.id, styleThumbnail(s)])), [])

  // Preset cards show a real maze at those settings, which is how a child sees
  // the difference between crayon-sized and fine-pen-sized without being told.
  const presetCards = useMemo(() => {
    // A window onto the middle of the sheet, about half its width. Cells stay
    // at a size the eye can resolve, so the cards differ by density rather
    // than by shade of grey.
    const width = paper.width * 0.46
    const height = width * 1.3
    const crop = {
      x: (paper.width - width) / 2,
      y: (paper.height - height) / 2,
      width,
      height,
    }
    return new Map(
      PRESETS.map((p) => {
        const g = generateMaze({ paper, pen: p.pen, level: p.level, shape, seed: 'card' })
        return [
          p.id,
          renderSvg(g.grid, g.maze, g.solution, { paper, stroke: p.pen.stroke, style, crop }),
        ]
      }),
    )
  }, [paper, shape, style])

  const printCss =
    `@page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }\n` +
    `@media print { .sheet svg { width: ${paper.width}mm !important;` +
    ` height: ${paper.height}mm !important; } }`

  return (
    <div className="app">
      <style>{printCss}</style>

      <div className="stage">
        <Svg markup={svg} className="sheet" />
      </div>

      <div className="strip" role="group" aria-label="Recent mazes">
        {history.map((h) => (
          <button
            key={h.key}
            type="button"
            className={h.key === key ? 'plate on' : 'plate'}
            aria-label="Go back to this maze"
            aria-pressed={h.key === key}
            onClick={() => restore(h)}
          >
            <Svg markup={h.svg} className="plate-art" />
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel-body">
        <div className="cards">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={activePreset?.id === p.id ? 'card on' : 'card'}
              aria-pressed={activePreset?.id === p.id}
              onClick={() => {
                setLevel(p.level)
                setPenId(p.pen.id)
              }}
            >
              <Svg markup={presetCards.get(p.id) ?? ''} className="card-art" />
              <span className="card-name">{p.label}</span>
              <Dots level={p.level} />
            </button>
          ))}
        </div>

        <Group label="Shape" columns={3}>
          {shapes.map((s) => (
            <Chip
              key={s.id}
              on={s.id === shape.id}
              onClick={() => setShapeId(s.id)}
              label={s.label}
            >
              <Svg markup={shapeIcons.get(s.id) ?? ''} className="icon" />
            </Chip>
          ))}
        </Group>

        <Group label="Lines" columns={4}>
          {STYLES.map((s) => (
            <Chip
              key={s.id}
              on={s.id === style.id}
              onClick={() => setStyleId(s.id)}
              label={s.label}
            >
              <Svg markup={styleIcons.get(s.id) ?? ''} className="icon" />
            </Chip>
          ))}
        </Group>

        <details className="grown-up">
          <summary>Grown-up settings</summary>

          <Group label="Paper" columns={2}>
            {PAPERS.map((p) => (
              <Chip key={p.id} on={p.id === paper.id} onClick={() => setPaper(p)}>
                {p.label}
              </Chip>
            ))}
          </Group>

          <Group label="Difficulty" columns={3}>
            {RECIPES.map((r) => (
              <Chip key={r.level} on={r.level === level} onClick={() => setLevel(r.level)}>
                {r.label}
              </Chip>
            ))}
          </Group>

          <Group label="Cell size" columns={2}>
            {PENS.map((p) => (
              <Chip key={p.id} on={p.id === penId} onClick={() => setPenId(p.id)}>
                {p.label}
              </Chip>
            ))}
          </Group>

          <Group label="Show" columns={3}>
            <Chip on={showSolution} onClick={() => setShowSolution((v) => !v)}>
              Answer
            </Chip>
            <Chip on={calibration} onClick={() => setCalibration((v) => !v)}>
              Ruler
            </Chip>
            <Chip on={markers} onClick={() => setMarkers((v) => !v)}>
              Mouse
            </Chip>
          </Group>

          <div className="meta">
            {maze.grid.cellCount} cells · {pen.pitch} mm pitch · score{' '}
            {maze.metrics.score.toFixed(2)}
            <br />
            route {maze.metrics.solutionLength} · {maze.metrics.decisionPoints} turns · longest
            dead end {maze.metrics.maxDeadEndRun}
            <br />
            seed <code>{seed}</code>
          </div>

          <p className="note">
            The ruler prints a 100 mm line. Measure it: any difference is scaling applied between
            here and the paper. Pick the paper your printer actually holds — the other size gets
            scaled down to fit, which shrinks the cells with it.
          </p>
        </details>
        </div>

        <div className="actions">
          <button type="button" className="big" onClick={() => setSeed(newSeed())}>
            New maze
          </button>
          <button type="button" className="big primary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
    </div>
  )
}
