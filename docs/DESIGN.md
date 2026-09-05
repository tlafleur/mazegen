# mazegen — technical plan

Printable black-and-white mazes, 8.5×11", generated on an iPad.

## 1. What the app has to do

- Produce a maze that prints correctly on US Letter, in black and white, at real vector quality.
- Let a user vary difficulty, cell size, outline shape, grid type, and line style.
- Be operable by a child: no blank states, no small targets, no way to lose work, no dead-end frustration.
- Run on an iPad, primarily in landscape and portrait, offline.

Phone support is out of scope for v1 and tracked in the backlog.

### Decisions settled

- **Platform:** web app / PWA. No native build.
- **Primary user: the child.** An adult sets things up and handles the printer, but the child is who chooses and operates. This is the decision with the widest consequences — it changes the v1 aesthetic, removes numbers from the interface, and moves on-screen play forward.
- **Paper: US Letter and A4.** Page size is a parameter from the start.

## 2. Platform decision: static web app

Recommendation: **Vite + React + TypeScript, no backend, installable as a PWA.**

Reasons:

- **Print quality.** The output is line art. SVG in a browser prints as vector at printer resolution. A native app would need its own PDF pipeline to match this.
- **Distribution.** No App Store review, no signing, no update lag. "Add to Home Screen" on iPad gives a full-screen app icon.
- **Phone reuse.** The same code covers the backlog phone target with layout work only.
- **No server means no data.** A children's app with no accounts, no network calls, and no storage beyond the device avoids an entire category of privacy and compliance work.

The cost is Safari's print behaviour, which is the main technical risk. See §7.

## 3. Core architecture

The whole feature space comes from three independent axes. Keeping them separate is what makes the customization list cheap to build.

```
Cell complex  →  Carver  →  Maze  →  Renderer  →  SVG / PDF
 (topology)     (algorithm)  (graph +   (style)
                             solution)
```

- **Cell complex** — which cells exist and which are adjacent. Square, hex, triangle, polar (concentric rings), and any of those restricted by a mask.
- **Carver** — chooses which adjacencies become passages. Operates on an abstract graph and knows nothing about geometry.
- **Renderer** — turns the wall set into drawable paths. Knows nothing about how the maze was generated.

A shape is a mask over the cell complex. A line style is a function of the wall geometry. Neither touches generation. So "star-shaped hex maze with wobbly walls at difficulty 3" needs no special-case code — it is one value on each of three axes.

### Package layout

```
src/
  core/                 zero dependencies, no DOM, fully unit tested
    rng.ts              seeded PRNG (sfc32 or mulberry32)
    grid/               square, hex, triangle, polar, mask application
    carve/              backtracker, prim, wilson, sidewinder, eller, kruskal
    braid.ts            dead-end removal and depth capping
    analyze.ts          solve, metrics, difficulty scoring
    shape/              masks from SVG path, from text glyph, from image threshold
  render/
    chain.ts            wall segments → maximal polylines
    styles/             straight, rounded, jitter, sketch, cave
    svg.ts
    pdf.ts
  ui/
```

`core/` having no dependencies and no DOM access is a deliberate constraint. It means the engine is testable in Node, can run in a Web Worker unchanged, can back a command-line batch generator, and could be ported if a native app ever happens.

### Determinism

Every maze is a pure function of `(settings, seed)`. This is required, not optional:

- "Print that one again" works.
- Settings plus seed encode to a short string in the URL hash, so a maze is shareable and bookmarkable.
- Golden-file regression tests become possible.
- The undo history in §6 is a list of seeds, not a list of bitmaps.

## 4. Difficulty and density are two different things

The user's question mark next to "density" is worth answering directly, because these are separate concerns and separating them in the UI is a real improvement over how most maze generators work.

- **Cell size** controls *motor* demand — can a crayon fit down the corridor?
- **Difficulty** controls *cognitive* demand — how many wrong turns, and how far do they run?

### Cell size, expressed in drawing tools

Live area on Letter with 0.5" margins is 190.5 × 254 mm. Grid dimensions follow from the cell pitch:

| Setting | Pitch | Grid | Cells |
|---|---|---|---|
| Crayon | 12 mm | 15 × 21 | 315 |
| Marker | 9 mm | 21 × 28 | 588 |
| Pencil | 6 mm | 31 × 42 | 1302 |
| Fine pen | 4 mm | 47 × 63 | 2961 |

A4 is 210 × 297 mm, so its live area is 184.6 × 271.6 mm — narrower and taller:

| Setting | Pitch | Grid (A4) | Cells |
|---|---|---|---|
| Crayon | 12 mm | 15 × 22 | 330 |
| Marker | 9 mm | 20 × 30 | 600 |
| Pencil | 6 mm | 30 × 45 | 1350 |
| Fine pen | 4 mm | 46 × 67 | 3082 |

Cell counts land within ~10% of Letter at every tier, so a single difficulty calibration covers both — the score in the next section uses cell count, not page dimensions.

Two consequences of supporting both sizes: page dimensions and margins are parameters everywhere rather than constants, and **shape masks are authored in normalized coordinates** and fitted to the live area preserving aspect ratio. Letter's live area is 0.75 wide-to-tall, A4's is 0.68, so a mask hardcoded to one will distort on the other.

Labelling these by drawing tool rather than by a number is more useful to a parent and to a child, and it caps the grid size honestly.

### Difficulty, measured rather than assumed

Most generators change the grid size and call that difficulty. Better: define difficulty from properties of the generated maze, then verify it.

Given the solution path `P` from start to end:

- `L` — cells on the solution path
- `J` — cells on `P` with degree ≥ 3, i.e. points where a wrong turn is available
- `d_i` — depth of each wrong branch hanging off `P`, until it dead-ends or rejoins
- `D̄`, `Dmax` — mean and maximum wrong-branch depth
- `T = L / (rows + cols)` — tortuosity

A maze with 30 decision points whose wrong branches die after two cells is easy. A maze with 12 decision points whose wrong branches run 20 cells deep is hard. So the primary term is roughly:

```
score = J · log(1 + D̄)      (plus a size term)
```

The weights need calibration, not guessing. Generate ~10k mazes across the parameter space offline, compute scores, take quintile boundaries, and store those as the level 1–5 thresholds.

Generation then becomes: sample parameters for the requested level, generate, score, accept if inside the band, otherwise retry. Cap at ~20 attempts and take the closest. Generation costs microseconds, so this is affordable, and it makes "difficulty 2" mean the same thing across every shape, grid, and cell size.

### Algorithm choice is a difficulty input

Carving algorithms have distinct characters, and this is the main non-size difficulty control:

| Algorithm | Character | Use |
|---|---|---|
| Sidewinder | Strong upward bias, obvious strategy | Easiest levels |
| Kruskal / Prim | Bushy, short dead ends everywhere | Easy–medium, busy texture |
| Wilson's | Uniform spanning tree, no bias or texture | Medium |
| Recursive backtracker | Long winding corridors, deep dead ends | Hard, and the most satisfying to draw |
| Eller's | Row-by-row, distinct horizontal texture | Variety |

### "Hard to get stuck", concretely

Two post-processing steps, both operating on the graph:

1. **Braiding.** Remove a fraction of dead ends by opening one extra wall at each. A braided maze always offers a way forward, which removes the main source of frustration — being blocked and having to erase. Braid ratio scales inversely with difficulty.
2. **Dead-end depth capping.** Repeatedly find the deepest dead-end branch and open a wall at its tip to a neighbour, until `Dmax ≤ k`. At level 1, set `k = 3`, so a child cannot go more than three cells wrong before finding a way on.

Note that braiding makes a maze *easier to move through* and *harder to solve optimally*, since dead-end-filling no longer works. Both effects are wanted here. The exact ratio for young children should be tuned against real children, not chosen from theory.

## 5. Line styles

All styles are pure functions of the wall geometry plus a style seed. Changing style never changes the maze topology, so the solution stays identical — worth stating as an invariant and testing.

**Shared primitive: polyline chaining.** Walls start as segments between lattice vertices. Chain them into maximal polylines by walking through degree-2 vertices. This is the single most useful geometry step: it cuts thousands of SVG elements down to a few hundred subpaths in one `<path>`, produces correct joins, and every style below operates on polylines rather than loose segments.

1. **Straight** — the polylines as-is. Optionally `stroke-linejoin: round` for a softer look.
2. **Rounded** — at each interior vertex `a→b→c`, cut back by `r = min(r_max, |ab|/2, |bc|/2)` and insert a quadratic Bézier. Robust, ~20 lines.
3. **Zigzag / jitter** — displace the **lattice vertices**, not the wall segments. Offset is a pure function of `(vx, vy, seed)`, so every wall touching a vertex moves identically and walls never separate. Clamp the offset to 0.2 × pitch; worst-case corridor is then `0.6 × pitch − stroke`, which at 12 mm pitch is 6.2 mm — still wide enough for a crayon. That bound is a guarantee by construction, and the clamp gets a test.
4. **Sketch** — draw each polyline twice with small independent perturbations and slight end overshoot. Hand-drawn look without a dependency, ~40 lines. Costs more ink.
5. **Cave** — render the *passages* instead of the walls. Stroke the passage graph (cell centre to cell centre) at width `pitch − gap` in black with round caps and joins, then stroke the same path at `pitch − gap − 2·strokeWidth` in white on top. The result is outlined organic tunnels with no boolean geometry required. Two paths total.

## 6. Shape

A shape is a mask: a predicate over cell centres, derived from an SVG path, a text glyph, or a thresholded image. Cells outside the mask are removed from the graph before carving. After masking, keep only the largest connected component and discard strays.

Start and end placement for arbitrary shapes: run double-BFS to find the graph diameter and open the boundary at those two cells. That gives a sensible, far-apart pair for any outline without hand-authoring.

Shape library for v1: rectangle, rounded rectangle, circle, oval, heart, star. Phase 2 adds objects (rocket, dinosaur, fish, cupcake) and **letter mazes** — type a child's initial or name and get a maze in that shape. Letter masks are near-free once glyph rasterization exists, and they are a strong reason for a child to want a particular maze.

## 7. Printing — the main risk

Baseline: render the SVG at exactly 8.5 × 11 in with internal margins, and use

```css
@page { size: 8.5in 11in; margin: 0 }
```

Safari on iOS applies its own scaling and margins to printed web content depending on the print sheet settings. This cannot be fully controlled from CSS.

Mitigation, and the recommended primary output: **generate the PDF ourselves, client-side.** The drawing primitives are only lines, cubic Béziers, a stroke width, and black. A PDF content stream needs `w`, `J`, `j`, `m`, `l`, `c`, `S`, plus a minimal object table — roughly 200–250 lines with no dependencies, and far smaller than jsPDF (~350 KB) or pdf-lib (~1 MB). It gives byte-exact page geometry, and on iPad the resulting file goes to the share sheet, then to Files or directly to AirPrint.

Sequencing: ship browser print first because it is ten lines, and **test it on a real iPad and a real printer in the first week**. This is the highest-risk unknown in the project, so it gets de-risked before any UI work. Add the PDF writer in phase 2 and make it the default once it is proven.

Also needed: a solution toggle (no answer / answer overlaid / answer on page 2).

## 8. UI, with the child as the operator

Principles, each with a concrete mechanism:

1. **Never a blank state.** The app opens with a finished, printable maze already on screen. No configuration form stands between the user and a result.
2. **Pictures, not words, and no numbers at all.** Preset cards show a real thumbnail generated at those settings. Difficulty is shown as one to five stars or as character sizes, never as a number. Cell size is shown as a picture of a crayon, marker, pencil, or pen. A pre-reader should be able to operate the entire primary flow.
3. **Stepped chips, not sliders.** Sliders are precision instruments and children are not precise. Every control is 3–5 large discrete options at a minimum of 60 pt, well above the 44 pt HIG floor, with generous spacing.
4. **Nothing is destructive.** A large "New maze" button reshuffles the seed, and a filmstrip of the last ~10 mazes lets a child recover one they liked. The main way to lose in a generator app is losing the good result; this removes it.
5. **Live preview.** Settings apply immediately. Generation is sub-millisecond at these sizes; move to a Web Worker only if measurement shows a dropped frame.
6. **No typing** anywhere in the primary flow. Keyboards cover half the screen and children type slowly. The optional name-maze feature is the one exception, and it belongs in the grown-up area.
7. **Both orientations.** Landscape puts the preview beside the controls; portrait puts it above them.
8. **Touch-resistant preview.** The preview ignores drags outside of play mode, so a hand resting on the screen does nothing.
9. **Standalone PWA display mode.** `display: standalone` in the manifest removes Safari's chrome, so there is no address bar for a child to tap out of the app.
10. **A grown-up area, unobtrusive rather than locked.** Paper size, margins, printer settings, and name mazes live behind a small, plainly-labelled entry point. Not a password gate — just somewhere a child will not wander by accident.

### The print sheet is not child-operable

Worth stating plainly, because it constrains the design: tapping print hands control to the iOS system print sheet, which is dense, text-heavy, and requires choosing a printer. No amount of work on our side changes that. So the realistic division of labour is that the child designs and an adult completes the print. Two implications:

- The print button should produce a queued, obviously-finished result the adult can act on later, not require the adult to be standing there at the moment of choice. A "print queue" of chosen mazes the adult flushes in one go fits the actual household situation better than one-tap-print-now, and it feeds directly into the booklet export in §10.
- Because printing needs an adult and a printer, **on-screen solving is what the child will actually do most of the time.** That moves it from a nice-to-have to a phase 2 feature. Mechanically it is easy and naturally forgiving: track which cell the finger is in and only permit movement to adjacent cells sharing a passage, snapping the drawn line to cell centres with rounded joins. The cell itself is the tap target, so at crayon size that is a 12 mm target — larger than any button in the app.

## 9. Testing

- **Structural properties**, across every combination of grid, algorithm, mask, and braid setting: the maze graph is connected; a non-braided maze has exactly `cells − 1` edges and no cycles; start and end are reachable; no cell is isolated; masking leaves exactly one component in use.
- **Style invariance**: for a fixed seed, the solution path is byte-identical across all five render styles.
- **Corridor width**: the jitter clamp is enforced, so minimum corridor width is guaranteed analytically; test the clamp rather than sampling geometry.
- **Difficulty calibration**: generated mazes at level *n* fall in the expected metric band across a large sample.
- **Print geometry**: rendered bounding box fits the printable area for every shape and grid.
- **Golden files** on a fixed seed set.

Vitest, running against `core/` in Node with no browser needed.

## 10. Phasing

**Phase 0 — de-risk (days)**
Square grid, recursive backtracker, solver, plain straight-line SVG, browser print. Print it on a real iPad to a real printer, on both Letter and A4. Nothing else matters until this works. Deliberately style-free: this phase proves the pipeline, not the look.

**Phase 1 — v1, Doodle World**
Difficulty model with verification and calibration. Cell-size setting. Rectangle, circle, heart, star, plus three or four object shapes. Rounded and jitter styles, with Classic available as the degenerate case (no jitter, no rounding). Illustrated start and end markers. Picture-based preset cards, no numbers. Solution toggle. Seeds, regenerate, history filmstrip. Grown-up area. PWA install in standalone mode. Deploy static.

**Phase 2**
On-screen solving mode — promoted from phase 3, since it is what the child does when no adult is at the printer. Hand-rolled PDF export as the default output. Print queue. Hex and polar grids. Sketch and Cave styles. More object shapes and letter/name mazes.

**Phase 3**
Batch booklet export — "20 pages, increasing difficulty" as a single PDF, which is nearly free once phase 2 lands and is the real use case for an adult before a car trip. Phone layout. Share codes. Objective mazes (collect three stars in order).

## 11. Three creative directions

These share one engine. The architecture in §3 makes the aesthetic a late choice, so this is not a permanent commitment — each is a style pack.

### A. Classic Maze Book
Clean and crisp, like a maze book from a shop. Uniform stroke, square or hex grids, simple geometric outlines, tidy start and end arrows, and page furniture: title, difficulty shown as stars, maze number, footer. Parents recognize and trust the format. Technically the simplest and the fastest to good quality.

### B. Doodle World
Every maze looks hand-drawn. Wobbly lines, rounded corners, varying stroke weight, and outlines that are things rather than shapes — rocket, dinosaur, octopus, cupcake. The start and end are illustrated: a mouse at one end, cheese at the other. Children choose by picture, not by the word "difficulty". Needs the jitter and rounding styles, a mask library, and a slot system that places decorations at the entrance and exit without colliding with walls.

### C. Cave
Render the passages rather than the walls, using the two-pass stroke from §5. The maze reads as a network of tunnels or a river delta rather than a grid. Distinctive — very few generators do this — and it is the same data with a different renderer.

**Recommendation, given that the child is the primary user: build B for v1.**

The earlier draft of this plan put A first on the grounds that it reaches a good printed page fastest. With the child operating the app, that ordering is wrong — the aesthetic *is* the interface for someone who cannot read the labels, and a child picks a dinosaur maze over a rectangle every time.

The cost of starting at B is smaller than it looks. Phase 0 already proves the pipeline with plain straight lines, so the print risk is retired before any style work begins. On top of that, B needs corner rounding (~20 lines), lattice jitter (~30 lines), a mask library that is mostly SVG authoring rather than code, and a decoration slot system. Call it two or three days beyond A. And A comes out of it free: Classic is Doodle World with jitter and rounding set to zero, so it ships as an alternate style rather than as separate work.

C follows in phase 2 — it is a second renderer over data that already exists.

A fourth direction for later: mazes with objectives — collect three stars in order, or a maze whose solution path draws a hidden picture.

## 12. Remaining questions

Platform, primary user, and paper size are settled (§1). Still open, none of them blocking:

1. **How much play versus how much printing?** If on-screen solving turns out to be the main activity, the app is a toy that happens to print, and that would argue for pulling it into phase 1. Worth revisiting after the first build is in front of a child.
2. **Braid ratio for young children.** The mechanism in §4 is sound; the specific ratio that keeps a five-year-old moving without letting them circle indefinitely should be tuned against real children rather than chosen from theory.
3. **How many shapes before variety stops mattering?** Mask authoring is the one part of this that scales linearly with effort rather than being a one-time cost. Six good shapes may beat twenty mediocre ones.
