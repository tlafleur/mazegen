import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { baseGridFor, generateMaze, shapesFor } from './generate'
import { renderPdf, renderSvg } from './render/svg'
import { sheetOrigin } from './render/sheet'
import { polylineCommands, toSvgPath } from './render/path'
import { follow, startTrail, type Trail } from './core/trail'
import type { Point } from './core/grid/planar'
import { cellsThumbnail, shapeIcon, styleThumbnail } from './render/thumbnail'
import { wordShape } from './render/word'
import { STYLES } from './render/style'
import { RECIPES, type Level } from './core/difficulty'
import { hashSeed } from './core/rng'
import { PRESETS, presetFor } from './presets'
import {
  CELL_KINDS,
  MARKER,
  PAPERS,
  PENS,
  SQUARES,
  defaultPaperFor,
  oriented,
  type Paper,
} from './render/page'
import { MARKER_SETS } from './render/marker'

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
  readonly cellsId: string
  readonly wide: boolean
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
  const [sheetSize, setSheetSize] = useState<Paper>(() => defaultPaperFor(navigator.language))
  const [wide, setWide] = useState(false)
  const [level, setLevel] = useState<Level>(2)
  const [penId, setPenId] = useState(MARKER.id)
  const [shapeId, setShapeId] = useState('rectangle')
  const [cellsId, setCellsId] = useState(SQUARES.id)
  const [word, setWord] = useState('')
  const [styleId, setStyleId] = useState('doodle')
  const [seed, setSeed] = useState(newSeed)
  const [showSolution, setShowSolution] = useState(false)
  const [calibration, setCalibration] = useState(false)
  const [markers, setMarkers] = useState('mouse')
  const [inkOutside, setInkOutside] = useState(false)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [playing, setPlaying] = useState(false)

  const paper = useMemo(() => oriented(sheetSize, wide), [sheetSize, wide])
  const pen = PENS.find((p) => p.id === penId) ?? MARKER
  const cells = CELL_KINDS.find((c) => c.id === cellsId) ?? SQUARES
  const shapes = useMemo(() => shapesFor(paper, pen, cells), [paper, pen, cells])
  const picked = shapes.find((s) => s.id === shapeId) ?? (shapes[0] as (typeof shapes)[number])

  // A word, when there is one, is a shape like any other — nothing downstream
  // learns that this one came from typing. Sized against the bare grid rather
  // than a carved maze, since all it needs is how many cells fit across.
  const box = useMemo(() => baseGridFor(paper, pen, cells), [paper, pen, cells])
  const fromWord = useMemo(() => {
    if (word.trim() === '') return null
    return wordShape(word, {
      cellsAcross: box.width / box.pitch,
      aspect: box.height / box.width,
    })
  }, [word, box])

  // Falls back to the picked shape for an empty box, and for a word the browser
  // could not draw.
  const shape = fromWord ?? picked
  const style = STYLES.find((s) => s.id === styleId) ?? (STYLES[0] as (typeof STYLES)[number])
  const activePreset = presetFor(level, penId)

  const maze = useMemo(
    () => generateMaze({ paper, pen, level, shape, seed, cells }),
    [paper, pen, level, shape, seed, cells],
  )

  const styleSeed = hashSeed(seed)
  const base = { paper, stroke: pen.stroke, style, styleSeed, markers, inkOutside }
  const caption =
    `100 mm · ${paper.label} · ${pen.label} · ${cells.label} · ${shape.label} · ` +
    `${style.label} · seed ${seed}`

  const svg = useMemo(
    () => renderSvg(maze.grid, maze.maze, maze.solution, { ...base, showSolution, calibration, caption }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maze, paper, pen, style, styleSeed, seed, showSolution, calibration, markers, inkOutside],
  )

  /**
   * Hand the sheet over as a PDF.
   *
   * Not the browser's own print: Safari shrinks a web page by about 7% while
   * reporting 100%, where a PDF carries its page size inside the file and comes
   * out at the size it claims. Measured; see docs/DESIGN.md §7.
   */
  const savePdf = (): void => {
    const bytes = renderPdf(maze.grid, maze.maze, maze.solution, {
      ...base,
      showSolution,
      calibration,
      caption,
    })
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const name = `maze-${shape.id}-${seed}.pdf`

    // A tab shows the PDF with the system's own print button one tap away,
    // which is fewer steps than saving it and finding it again. If opening a
    // tab is refused — a blocker, or a standalone window with no tabs — fall
    // back to handing over the file.
    if (window.open(url, '_blank') === null) {
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
    }
    // Long enough for the viewer to have loaded it; after that the tab holds
    // its own copy and the URL is only taking up memory.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  // --- solving on screen ---

  // A trail is only ever a legal walk from the entrance; the rules live in
  // core/trail.ts, which knows nothing about pointers or pixels.
  const [trail, setTrail] = useState<Trail>(() => startTrail(maze.maze))
  const overlay = useRef<SVGSVGElement>(null)
  const last = useRef<Point | null>(null)

  // A new maze means a new trail. Keyed on the maze itself rather than on the
  // settings, so anything that regenerates one also clears the old route.
  useEffect(() => {
    setTrail(startTrail(maze.maze))
    last.current = null
  }, [maze])

  const origin = sheetOrigin(paper, maze.grid)

  /** A pointer, in millimetres from the maze's top-left corner. */
  const gridPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point | null => {
      const el = overlay.current
      if (el === null) return null
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      return {
        x: ((e.clientX - r.left) / r.width) * paper.width - origin.x,
        y: ((e.clientY - r.top) / r.height) * paper.height - origin.y,
      }
    },
    [paper, origin.x, origin.y],
  )

  const onTrailDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    // Only where the finger went down is remembered. Nothing moves until it
    // reaches a cell next to the head of the trail, so touching the far side of
    // the sheet cannot teleport the route there.
    last.current = gridPoint(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onTrailMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const from = last.current
    if (from === null) return
    const to = gridPoint(e)
    if (to === null) return
    last.current = to
    setTrail((t) => follow(t, maze.maze, maze.grid, from, to))
  }

  const onTrailUp = (): void => {
    last.current = null
  }

  // Where the trail is drawn, in page millimetres: cell centres, starting at
  // the gap in the wall so the line comes in from outside like the mouse does.
  const trailPath = useMemo(() => {
    const at = (c: number): Point => {
      const p = maze.grid.cellCenter(c)
      return { x: p.x + origin.x, y: p.y + origin.y }
    }
    const opening = maze.grid.openingPoint(maze.maze.start)
    const points: Point[] = [
      { x: opening.x + origin.x, y: opening.y + origin.y },
      ...trail.cells.map(at),
    ]
    if (trail.done) {
      const out = maze.grid.openingPoint(maze.maze.end)
      points.push({ x: out.x + origin.x, y: out.y + origin.y })
    }
    return toSvgPath(polylineCommands(points, style.rounding * maze.grid.pitch))
  }, [trail, maze, origin.x, origin.y, style])

  // A second render without the answer or the ruler, so the filmstrip shows the
  // maze rather than whatever happened to be toggled when it was made.
  const plate = useMemo(
    () => renderSvg(maze.grid, maze.maze, maze.solution, base),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maze, paper, pen, style, styleSeed, markers, inkOutside],
  )

  const key = `${sheetSize.id}|${wide}|${penId}|${level}|${shape.id}|${styleId}|${cellsId}|${seed}`
  useEffect(() => {
    setHistory((prev) => {
      // Never reorder: a maze a child is looking for should stay where they
      // last saw it, not jump to the front because they revisited it.
      if (prev.some((h) => h.key === key)) return prev
      const entry: Snapshot = {
        key,
        paperId: sheetSize.id,
        penId,
        level,
        shapeId,
        styleId,
        cellsId,
        wide,
        seed,
        svg: plate,
      }
      return [entry, ...prev].slice(0, HISTORY_LIMIT)
    })
  }, [key, plate, sheetSize.id, wide, penId, level, shapeId, styleId, cellsId, seed])

  const restore = (s: Snapshot): void => {
    setSheetSize(PAPERS.find((p) => p.id === s.paperId) ?? sheetSize)
    setWide(s.wide)
    setPenId(s.penId)
    setLevel(s.level)
    setShapeId(s.shapeId)
    setStyleId(s.styleId)
    setCellsId(s.cellsId)
    setSeed(s.seed)
  }

  // Icons: cheap, and independent of the maze on screen.
  const aspect = maze.grid.height / maze.grid.width
  const shapeIcons = useMemo(
    () => new Map(shapes.map((s) => [s.id, shapeIcon(s, aspect)])),
    [shapes, aspect],
  )
  const styleIcons = useMemo(() => new Map(STYLES.map((s) => [s.id, styleThumbnail(s)])), [])
  const cellIcons = useMemo(
    () => new Map(CELL_KINDS.map((c) => [c.id, cellsThumbnail(c)])),
    [],
  )

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
        const g = generateMaze({ paper, pen: p.pen, level: p.level, shape, seed: 'card', cells })
        return [
          p.id,
          renderSvg(g.grid, g.maze, g.solution, { paper, stroke: p.pen.stroke, style, crop }),
        ]
      }),
    )
  }, [paper, shape, style, cells])

  const printCss =
    `@page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }\n` +
    `@media print { .sheet svg { width: ${paper.width}mm !important;` +
    ` height: ${paper.height}mm !important; } }`

  return (
    <div className={playing ? 'app playing' : 'app'}>
      <style>{printCss}</style>

      <div className="stage">
        <div
          className="sheet"
          style={
            {
              '--sheet-ratio': `${paper.width} / ${paper.height}`,
              '--sheet-aspect': paper.width / paper.height,
            } as React.CSSProperties
          }
        >
          <Svg markup={svg} className="sheet-art" />

          {playing && (
            <svg
              ref={overlay}
              className={trail.done ? 'trail done' : 'trail'}
              viewBox={`0 0 ${paper.width} ${paper.height}`}
              onPointerDown={onTrailDown}
              onPointerMove={onTrailMove}
              onPointerUp={onTrailUp}
              onPointerCancel={onTrailUp}
            >
              <path d={trailPath} strokeWidth={pen.pitch * 0.34} />
              {trail.cells.length === 1 && !trail.done && (
                <circle
                  cx={maze.grid.cellCenter(maze.maze.start).x + origin.x}
                  cy={maze.grid.cellCenter(maze.maze.start).y + origin.y}
                  r={pen.pitch * 0.42}
                  strokeWidth={pen.pitch * 0.16}
                />
              )}
            </svg>
          )}

          {playing && trail.done && <div className="win">You did it!</div>}
        </div>
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

        <label className="word">
          <span className="group-label">Or a word</span>
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value.slice(0, 12))}
            placeholder="type a name"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Make a maze out of a word"
          />
        </label>

        <Group label="Cells" columns={2}>
          {CELL_KINDS.map((c) => (
            <Chip
              key={c.id}
              on={c.id === cells.id}
              onClick={() => setCellsId(c.id)}
              label={c.label}
            >
              <Svg markup={cellIcons.get(c.id) ?? ''} className="icon" />
            </Chip>
          ))}
        </Group>

        <Group label="Lines" columns={3}>
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
              <Chip key={p.id} on={p.id === sheetSize.id} onClick={() => setSheetSize(p)}>
                {p.label}
              </Chip>
            ))}
          </Group>

          <Group label="Turned" columns={2}>
            <Chip on={!wide} onClick={() => setWide(false)}>
              Tall
            </Chip>
            <Chip on={wide} onClick={() => setWide(true)}>
              Wide
            </Chip>
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
            <Chip on={inkOutside} onClick={() => setInkOutside((v) => !v)}>
              Filled
            </Chip>
          </Group>

          <Group label="Start and finish" columns={3}>
            {MARKER_SETS.map((m) => (
              <Chip key={m.id} on={m.id === markers} onClick={() => setMarkers(m.id)}>
                {m.label}
              </Chip>
            ))}
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
            <b>Filled</b> inks the page around the maze, which is what makes a word readable — at
            cell scale the letters are corridors like any other, and it is the outside that says
            where they end. It uses a great deal of toner on a whole sheet.
          </p>

          <p className="note">
            The ruler prints a 100 mm line. Measure it: any difference is scaling applied between
            here and the paper. Pick the paper your printer actually holds — the other size gets
            scaled down to fit, which shrinks the cells with it.
          </p>

          <button type="button" className="plain" onClick={() => window.print()}>
            Print from the browser instead
          </button>
          <p className="note">
            Quicker by a tap, but Safari shrinks the page about 7% on the way to the printer while
            still reporting 100%. Print the PDF if the size has to be right.
          </p>
        </details>
        </div>

        <div className="actions">
          {playing ? (
            <>
              <button
                type="button"
                className="big"
                onClick={() => setTrail(startTrail(maze.maze))}
              >
                Start over
              </button>
              <button type="button" className="big primary" onClick={() => setPlaying(false)}>
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" className="big" onClick={() => setSeed(newSeed())}>
                New maze
              </button>
              <button type="button" className="big" onClick={() => setPlaying(true)}>
                Play
              </button>
              <button type="button" className="big primary" onClick={savePdf}>
                Print
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
