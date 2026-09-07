# mazegen — technical plan

Printable black-and-white mazes on US Letter and A4, generated on an iPad.

## 1. What the app has to do

- Produce a maze that prints correctly on US Letter or A4, in black and white, at real vector quality.
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
- The history filmstrip in §8 is a list of seeds, not a list of bitmaps.

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

Most generators change the grid size and call that difficulty. Better: define difficulty from
properties of the generated maze, then verify it. Everything below was measured during phase 1
and corrects the sketch this section originally carried.

Given the solution path `P` from start to end:

- `L` — cells on the solution path
- `J` — cells on `P` where at least one opening *leaves* `P`. Stricter than "degree ≥ 3": a
  third opening that rejoins the route is a shortcut, not a chance to go wrong.
- `D̄` — mean depth of the off-route regions hanging off `P`, measured per connected region
- `maxDeadEndRun` — longest corridor from a dead end back to the first junction

**The score is expected work, normalized by size:**

```
score = (L + J · D̄) / cells
```

The original sketch, `J · log(1 + D̄)`, ranks the carvers backwards. Measured over 20 mazes on a
21×28 grid, the recursive backtracker gives a long route with few branches (L 210, J 17) and
Kruskal a short route with many (L 77, J 39). `J` swings 2.3× while `log(1 + D̄)` swings 1.6×, so
decision count dominates and the formula calls the bushy maze the hard one. It also discards
route length, which for a child with a crayon is the most concrete work on the page. With the
corrected formula: backtracker 0.755, Kruskal 0.464, Wilson's 0.455, sidewinder 0.410.

**Two different depth measures, and the difference matters.** *Branch depth* is how far off the
route a solver can wander. *Dead-end run* is how far they must retrace once they discover they
are wrong. The second is what frustrates a child, so it is the one that gets capped.

### Algorithm choice is a difficulty input

| Algorithm | Character | Use |
|---|---|---|
| Sidewinder | Unbroken top row, so an obvious strategy | Level 1 |
| Kruskal | Bushy, short dead ends everywhere | Level 2 |
| Wilson's | Uniform spanning tree, no bias or texture | Held back as a user choice |
| Recursive backtracker | Long winding corridors, deep dead ends | Levels 3–5, by braid amount |

Sidewinder, Kruskal and Wilson's score within a few percent of one another, so they cannot supply
five separated levels between them. The usable range comes from the backtracker braided by
varying amounts, which spans 0.35 to 0.64 at fine-pen size on its own.

Sidewinder's real easiness is invisible to any structural measure — its top corridor hands the
solver a plan — so it is pinned to level 1 by name rather than chosen by score.

### The levels

| Level | Carver | Braid | Dead-end cap |
|---|---|---|---|
| 1 Gentle | Sidewinder | 0.3 | 3 |
| 2 Easy | Kruskal | 0 | 4 |
| 3 Medium | Backtracker | 0.3 | — |
| 4 Hard | Backtracker | 0.1 | — |
| 5 Fiendish | Backtracker | 0 | — |

### "Hard to get stuck", concretely

1. **Braiding.** Open a fraction of dead ends so there is a way onward.
2. **Dead-end depth capping.** Open a wall at the tip of any corridor longer than `k`, so there
   is never much to retrace. Level 1 caps at three cells.

**Braiding is U-shaped, not monotonic** — the plan originally had this wrong. Measured on a 21×28
grid, sidewinder scores 0.430 unbraided, falls to 0.357 at braid 0.2, and climbs back to 0.569 at
0.8. Kruskal does the same. Opening a few dead ends shortens the route and thins the choices;
opening most of them merges the whole off-route area into one connected mass a solver can wander
deep into, and `D̄` nearly doubles.

The reason is worth stating plainly: **dead ends are feedback.** A wall tells a child they are
wrong. Remove them all and the signal goes with them, leaving open space and no sense of
progress. The measured minimum sits near 0.2–0.4, so no level braids beyond that — the opposite
of this plan's original "braid heavily for the youngest".

### What difficulty cannot promise

Normalizing by cell count does not make levels comparable across cell sizes, and no other
normalizer does either. Sidewinder's route length scales with the perimeter (√cells) and the
backtracker's with the area, so dividing by cell count over-corrects the first and roughly fits
the second: sidewinder at braid 0.3 scores 0.474 on crayon and 0.170 on fine pen, while the
backtracker scores 0.814 and 0.682.

So the promise is narrower and honest: **at whatever cell size you picked, level 1 < 2 < 3 < 4 < 5.**
That holds at all eight paper × cell-size combinations and is enforced by test.

One limit falls out of it. On the crayon grid (315 cells) the braid lever saturates — the
backtracker scores the same at braid 0.2 and 0.3, because there are too few dead ends to open and
too little route to shorten — so levels 3 to 5 compress. Level 5 is 4.1× level 1 at fine pen but
only 1.75× on crayon. That is a limit of how much maze fits on a page at that corridor width, not
a defect in the recipes.

## 5. Line styles

All styles are pure functions of the wall geometry plus a style seed. Changing style never changes
the maze topology, so the solution stays identical — stated as an invariant and held by test.

**Shared primitive: polyline chaining.** Walls start as segments between lattice vertices. Chaining
them into maximal polylines collapses a maze from ~3070 loose segments into ~1180 subpaths in a
single `<path>` with correct joins. Every style below operates on those polylines.

### Shipped in phase 1

| Style | Rounding | Jitter | Look |
|---|---|---|---|
| Classic | 0 | 0 | Crisp and square |
| Soft | 0.35 | 0 | Rounded corners, nothing else |
| Doodle | 0.35 | 0.14 | Hand-drawn — the v1 default |
| Wonky | 0.25 | 0.20 | As loose as the corridor guarantee allows |

Classic falls out as the case where both settings are zero, exactly as planned: it ships as an
alternate style rather than as separate work.

**Rounding.** At each interior vertex `a→b→c`, cut back by `r = min(radius, |ab|/2, |bc|/2)` and
insert a quadratic Bézier. The half-length cap matters — a radius wider than the segment pulls the
wall away from where it belongs and lets adjacent corners eat into each other.

Collinear runs are skipped rather than rounded. Chaining emits every lattice vertex a wall passes
through, so a straight stretch arrives as several collinear points; rounding each would spend three
path commands per cell drawing a straight line.

Closed rings — the outline of a shape — are rounded all the way round including the join, or the
outline has one flat corner wherever the walk happened to start.

**Jitter displaces lattice vertices, not wall segments.** The displacement is a pure function of the
vertex id and the seed, so the four walls meeting at a vertex all ask the same question and get the
same answer. Perturbing segments independently would tear the maze open at every corner.

The magnitude is capped at **0.2 × pitch, clamped in the renderer rather than trusted from the
style**, so no style can define away the guarantee. Two parallel walls sit one pitch apart and each
may move that far toward the other, so the narrowest a corridor becomes is `0.6 × pitch` minus the
stroke — 6.2 mm of clear space at crayon size. Guaranteed by construction; the clamp is what the
test checks.

One consequence worth noting: the entrance and exit are midpoints of boundary faces, so they have
to be computed from the *displaced* vertices. Taking the fixed midpoint leaves the solution line
detached from its own gap in the wall.

**Cost.** Rounding roughly doubles the path data and jitter adds a little more: a fine-pen maze goes
from 62 kB (Classic) to 144 kB (Doodle), rendering in 8 ms. Inline in the DOM that is not a problem,
and it stays well inside a frame.

### Shipped in phase 2

**Sketch** — every line drawn twice, each pass wandering on its own, with the ends run slightly past
their junctions. Note that this is the *opposite* of the jitter rule above: jitter is keyed on the
vertex so walls meeting there agree, and a sketch pass is keyed on the pass so the two lines
deliberately do *not*. Both wanders are charged against the same 0.2 × pitch budget, so no
combination narrows a corridor past what the guarantee says.

Two numbers came from looking at the output rather than from reasoning. A pass has to move further
than the stroke is wide, or the two lines land on top of each other and it reads as one fat line —
0.055 × pitch was invisible at marker size, 0.1 works. And each pass is drawn at 0.8 × the stroke
width, because two full-weight lines half a millimetre apart still read as one line.

**Cave** — the maze rendered inside out. A wide black stroke along the passage graph, then a
narrower white one over the top: the white covers the middle and leaves the edges showing, which is
an outlined tunnel with no boolean geometry anywhere and two paths for the whole sheet.

The tunnel width cannot be taken from the pitch, which is the trap. On squares two parallel
corridors are a whole cell apart, but on hexagons the nearest parallel pair is only √3/2 of one — so
a tunnel sized from the pitch leaves 0.046 × pitch of white between neighbours, which is 0.18 mm at
fine-pen density and merges two passages into one. `BaseGrid` therefore carries `passageGap`, the
closest two passages sharing no cell can come, and a test measures it by brute force over every pair
of segments rather than trusting the arithmetic.

Adding these also caught a copy: `styleThumbnail` had its own miniature version of the drawing code,
which knew only about rounding and jitter — so the moment Sketch and Cave existed, both icons showed
a plain Classic maze. The icons are built by the real renderer now. An icon that can disagree with
what it is picking is worse than no icon at all.


### Rings: the third grid, and the two things it does not fit

Concentric rings, each subdivided into cells. A ring's cells get physically wider the further out
they sit, so a fixed subdivision would give slivers at the middle and rooms at the rim; each ring
keeps the previous ring's count until a cell has grown about twice as wide as it is deep, then
multiplies. Every cell stays roughly square in the only sense that matters — a corridor a crayon
fits down, at every radius.

Hexagons cost one honest refactor. Rings cost two smaller ones, both because a polar cell is not
like the others:

**A cell's faces are not all the same, and there are not always the same number of them.** A ring
cell has three, four or five; the middle has as many as the first ring. `faces` is the largest any
cell has, and `BaseGrid` gained `hasFace(cell, dir)` so a grid can say which of the slots are real.
Without it an unused slot looks exactly like a face with nothing across it — which is to say, like
the edge of the maze: the first render reported 331 cells on the rim of a maze whose outer ring has
48, and every one of those phantom faces drew a wall from a wrongly-wrapped vertex.

**Which way is out depends on where the cell is**, not only on which face you name, so `faceNormal`
takes the cell. Squares and hexagons ignore it.

Two things it shares with the rest by construction. Its walls are arcs, drawn as one chord per cell
face — the deviation is at most an eighth of the pitch at the middle and less further out, and
every style except Classic rounds the joints back into curves, so it reads as circular rather than
polygonal. And the entrance and exit come out where they always do, from `farthestBoundaryPair` on
the rim, so both ends have somewhere outside for a marker; a classic polar maze puts the goal at
the centre, and that would have needed a special case for no gain.

**`passageGap` is not a whole cell here.** The tight spot is always a ring where the count doubles:
a radial passage crossing outward runs alongside an arc in the finer ring beyond it. Measured by
brute force over every pair of passages at 3, 5, 8, 12 and 20 rings, the closest approach falls
from 0.827 × pitch to 0.756 and settles; the grid claims 0.75, and a test measures the real thing
against that claim at every size rather than trusting the constant.

Difficulty stays calibrated without retuning: averaged over five seeds at pencil density, the five
levels score 0.30, 0.34, 0.48, 0.73, 0.72 on rings against 0.24, 0.35, 0.47, 0.53, 0.72 on squares.
Levels 4 and 5 land on top of each other — braiding is U-shaped (§4) and its bottom sits elsewhere
on this grid — so the top two steps are not distinguishable here. Worth knowing; not worth a second
calibration table.

The one real cost is the page: a disc on a rectangle leaves the ends of the sheet empty, and there
is no arrangement that does not.

## 6a. Word mazes

Type a name; the maze is carved into its letters. The word becomes a `Shape` like any other, so
nothing downstream learns that this one came from typing.

Drawn with a canvas rather than 26 hand-authored glyphs, because a child should be able to type any
word rather than pick from a list. Only the rasterising touches the DOM; the mask, the dilation, the
joining and the line-breaking are pure and tested without a browser.

Four things had to be got right, and three of them were found by looking at the output rather than
by reasoning about it.

**Dilate by what the letters are short of, not by a fixed amount.** A letter at its natural weight
has limbs one or two cells thick, which is a line rather than a corridor. The first version dilated
by a radius derived from the cell size, and SAM at pencil density came out as a solid black slab —
the counters of A closed, the gaps between letters filled. It now measures the median run of ink per
row, which for capitals is close to the stem width, and grows only by the shortfall, never by more
than a third of what is already there.

**Letters are separate components, and `MaskedGrid` keeps only the largest.** Without joining them a
three-letter name is a maze of one letter. Each band of ink gets a thin bar along its foot, where a
capital already ends, so it reads as a line the word stands on.

**A connector has to be more than one cell across.** The mask is sampled at cell centres, so a
feature a single cell wide can fall between two of them and contribute nothing. MAZE came out as
"MA" with a stub hanging off it: the bridge to the second line existed in the bitmap and was one
pixel wide, because the loop index shadowed the variable holding its thickness. Bars are 1.4 cells
and bridges 2.6.

**One line wastes the page.** A four-letter word set across a portrait sheet leaves four fifths of
it blank and the letters too small to hold a maze. The word is broken into whichever number of lines
gives a block closest to the shape of the page — for MAZE that is two lines of two, which roughly
doubles the letter size.

The honest limit: word mazes want pencil or fine cells. At marker size a four-letter word has about
five cells per limb to work with, and at crayon size it has three.

## 6. Shape

A shape is a mask: a test for whether a point is inside, evaluated at each cell centre. Cells
outside it are removed from the graph *before* carving, so a carver sees a smaller graph rather
than a rectangle with holes and needs no knowledge of shapes at all. A rectangle is the same class
with a mask that admits everything, so there is one implementation of outlines and openings rather
than two.

Removing cells before carving also matters for difficulty: the score divides by cell count, and
that has to be the cells actually in the maze, not the bounding box.

**Mask coordinates** are centred on the grid and scaled uniformly so the *shorter* axis spans
[-1, 1]. Uniform scaling is what keeps a circle a circle — Letter's live area is 0.75 wide-to-tall
and A4's is 0.68, so a mask written against a unit square prints visibly different on the two
papers.

**Only the largest connected piece survives.** A thin shape can leave islands, and a maze in two
pieces is unsolvable.

**Entrance and exit** come from a double BFS over the outline cells, run on the *uncarved*
adjacency so they are a property of the shape and stay put however the maze is carved. The opening
is cut into whichever face of that cell points most directly away from the middle of the grid, so
it lands on the outside of a star's point rather than in its armpit. On a rectangle this reproduces
the obvious answer: opposite corners.

### The library, and what it costs

| Shape | Coverage of the page | Cells at marker (21×28) |
|---|---|---|
| Page | 100% | 588 |
| Rounded | 98% | 576 |
| Oval | 78% | 456 |
| Circle | 59% | 346 |
| Heart | 52% | 306 |
| Star | 34% | 200 |

Two things went wrong here and are worth recording.

**The heart was clipping.** The curve `(x² + y² - 1)³ - x²y³ ≤ 0` is neither centred nor a unit
shape: sampled, its bounding box is x ±1.138 and y −1.0 to 1.2. Scaled as though it were a unit
circle it runs past the page edge and prints with its sides sliced off — while *appearing* fine,
because clipping raised its page coverage to 75%. The scale and the vertical offset both come from
that measured box.

**A textbook star is too thin to be a maze.** At the usual inner radius of 0.42 the points narrow
to single cells: no choice to make, and visually a spike stuck on the side of the shape. At 0.6 the
star covers 34% of the page rather than 23%, with about one such cell per point instead of five,
and still plainly reads as a star. Both properties are held by test.

### Sidewinder cannot run on a shape

Sidewinder carves east along a whole row and then north out of it, so ragged rows rule it out — the
`RowStructured` interface exists to make that a compile-time fact rather than a runtime surprise.
Level 1 therefore carries a fallback, Kruskal at a higher braid, which measures below level 2 and
keeps the ladder intact on every shape.

Phase 2 adds objects (rocket, dinosaur, fish, cupcake) and **letter mazes** — type a child's
initial and get a maze in that shape. Both are masks like any other; letters need only glyph
rasterization, and the polygon mask already in place covers the objects.

## 7. Printing — the main risk

Baseline: render the SVG at exactly 8.5 × 11 in with internal margins, and use

```css
@page { size: 8.5in 11in; margin: 0 }
```

Safari on iOS applies its own scaling and margins to printed web content depending on the print sheet settings. This cannot be fully controlled from CSS.

Mitigation, and the recommended primary output: **generate the PDF ourselves, client-side.** The drawing primitives are only lines, cubic Béziers, a stroke width, and black. A PDF content stream needs `w`, `J`, `j`, `m`, `l`, `c`, `S`, plus a minimal object table — roughly 200–250 lines with no dependencies, and far smaller than jsPDF (~350 KB) or pdf-lib (~1 MB). It gives byte-exact page geometry, and on iPad the resulting file goes to the share sheet, then to Files or directly to AirPrint.

### Measured: Safari shrinks the page by about 7%

Printed from Safari on an iPad to a Brother HL-L2350DW, with the print sheet reporting **US Letter,
Portrait, Scaling 100%**, the 100 mm reference line measures **about 93 mm**.

The dialog is not lying so much as answering a different question: "100%" means the *user* applied
no scaling. Safari still fits the sheet into the printer's printable area rather than onto the
physical sheet, and a roughly 8 mm unprintable border on a Letter page accounts for the ~0.93 seen.

This is why the sheet carries a ruler instead of trusting the print dialog. Two earlier prints —
one from a PDF, one from Safari on macOS — both *reported* 100% and were taken as fine; neither was
measured. The dialog agreeing with you is not evidence.

**Consequence: the hand-rolled PDF writer moves to the front of phase 2**, exactly the contingency
this section named. Nothing else in phase 2 matters while the output is the wrong size — a cell size
named after a drawing tool has to mean something physical, and at 93% a 12 mm crayon corridor prints
at 11.2 mm.

### Confirmed: a PDF prints at 1:1

The same sheet as a PDF, printed from the iPad through the share sheet, comes out the right size.

That places the fault precisely: **Safari's web print shrinks; the print system does not.** So the
PDF writer is a fix rather than a hope — it routes around the one component doing the scaling,
and the assumption the phase-2 ordering rests on has been measured rather than assumed.

### Built: the writer, and what measuring it found

About 180 lines in `src/render/pdf.ts`, no dependency, ~1.5 kB gzipped in the bundle — against
~350 kB for jsPDF. It takes an array of sheets, so the phase-3 booklet needs no second writer.

The page is described once, in `src/render/sheet.ts`, as millimetres from the top-left corner:
strokes as drawing commands, plus labels. SVG and PDF each only decide how to spell those commands
(`src/render/path.ts`). Building the geometry twice is the fastest way to have a printed sheet
quietly disagree with the preview it came from, so neither backend owns it.

Three things the writing turned up:

**Two decimal places is not enough for the page transform.** The whole content stream is written in
millimetres and placed by one matrix that scales by 72/25.4 and flips the y axis. Rounded to two
decimals that factor is 2.83 — 0.16% small. A 100 mm line would print at 99.84 mm and the bottom of
a Letter page would land 1.3 pt inside its own MediaBox. Since 1:1 is the entire point, the matrix
carries six decimals. Measured on the output with PyMuPDF: the reference line is **100.00001 mm**
and the MediaBox is exactly 612 × 792 pt.

**The markers were being printed into the strip printers cannot mark.** The maze fills its 12.7 mm
margin, so a drawing placed outside the outline is always in that margin — the mouse was landing
2.2 mm from the paper edge, inside the hardware margin of essentially every printer. `placeMarker`
now treats the requested 10 mm as a maximum: it shrinks to the room between the opening and a 5 mm
safe inset, slides sideways rather than falling off at a corner, and is left out below 5 mm, where
it stops reading as a mouse.

**A marker's stroke has to scale with it.** Held at wall weight, the cheese wedge closed into a
solid black triangle as soon as it shrank. The wedge also gained a blunt tip: a true triangle
narrows to nothing, and its last millimetre fills in wherever two stroke widths meet.

The app's Print button now hands over a PDF — opened in a tab, where the system's own print button
is one tap away, falling back to a download if a tab is refused. Browser printing stays available
under the grown-up settings, labelled with what it costs.

Also needed: a solution toggle (no answer / answer overlaid / answer on page 2).

## 8. UI, with the child as the operator

Principles, each with a concrete mechanism:

1. **Never a blank state.** The app opens with a finished, printable maze already on screen.
2. **Pictures, not words, and no numbers.** Preset cards show a real maze generated at those
   settings; difficulty is filled dots; shapes and line styles are drawn, not named. A pre-reader
   can operate the whole primary flow. The words on the cards are for whoever is helping.
3. **One tap sets difficulty and cell size together.** They are separate axes in the engine, and
   deliberately so, but a child should not have to reason about two things to get a maze. The
   Advanced area exposes them apart.
4. **Stepped chips, not sliders**, at a 60 px minimum — above the 44 pt HIG floor.
5. **Nothing is destructive.** A filmstrip keeps the last six mazes, and tapping one restores it
   whole. It never reorders: a maze a child is looking for should stay where they last saw it.
6. **No typing** anywhere in the primary flow.
7. **Both orientations.** Landscape puts the controls beside the maze; portrait puts them below and
   spreads the cards across the width.
8. **The preview ignores pointers**, so a hand resting on it does nothing.
9. **Standalone display**, so there is no address bar to tap out of.
10. **An Advanced area** — paper, orientation, difficulty and cell size, background, markers,
    answer, ruler, metrics — behind a plainly labelled disclosure. Not a lock; an adult should
    never have to hunt for it.

### Saying which controls overlap

The five preset cards set two things at once, difficulty and cell size, and both of those are also
controls of their own. Left unlabelled that reads as three competing scales — "Fiendish" appearing
in two places, meaning two different things in each.

The cards are headed **Preset**, with a line saying what they are a shortcut for; inside Advanced
the two controls sit together under **What a preset sets**, apart from the page setup above them
and the print options below. Filled moved out of Show, where it never belonged, into **Background:
Plain or Filled**. Nothing changed about what any control does. What changed is that the overlap is
stated rather than left to be inferred, which is the cheapest fix available and was worth more here
than any rearrangement.

### Three things the build corrected

**A preset card cannot show a whole page.** Shrunk to thumbnail size, every cell size becomes the
same grey texture, so "Big kid", "Tricky" and "Fiendish" were indistinguishable — which defeats the
one job a picture-led card has. The cards show a *cropped window* onto the middle of the sheet
instead, at a scale where individual cells resolve, so chunky and dense differ visibly rather than
by shade.

**The primary actions cannot be sticky over the scroll area.** Pinning New maze and Print with
`position: sticky` hid whatever scrolled under them — the line-style picker sat permanently behind
the Print button. The panel is a scrolling body with a fixed footer instead.

**iOS ignores the manifest for home-screen behaviour.** `display: standalone` alone still opens in
Safari with an address bar. The `apple-mobile-web-app-*` meta tags are what actually launch it
chrome-free, and the touch icon has to be a PNG — iOS will not take the SVG.

### Solving on screen

A child has an iPad far more often than a printer and an adult, so the sheet is also the game.
Press Play, and a finger traces the route from the mouse to the cheese.

The rules are in `src/core/trail.ts`, with no notion of pointers or pixels, which is what makes
them testable without a browser:

- A trail is only ever a **legal walk from the entrance**. `step` is the only way to extend one,
  and it refuses anything that is not an adjacent cell with an open wall between.
- An illegal move is **ignored, not rejected**. Drag across a wall and the line simply stops —
  nothing to dismiss, nothing to undo. This is the concrete form of "hard to get stuck": there is
  no state a child can reach that they cannot back out of.
- Dragging back over a cell already in the trail **retraces to it**. One rule covers backing out of
  a dead end a step at a time and a finger swept back across half the maze, and it is why the trail
  can never contain a loop.
- A drag is **sampled along its length**, not taken at its endpoint. Pointer events arrive far
  apart when a finger moves quickly; at fine-pen density a single event can span several cells, and
  without sampling a fast swipe would jump straight through a wall.
- A finger may land **up to three cells ahead**, and the trail walks the passages between. One cell
  is unforgiving in exactly the place it matters: rounding a corner, a finger cuts across the inside
  of the turn and its next sample lands in the cell *after* the corner, which is diagonal from the
  head — so a one-step rule ignores it and the line stalls until you trace the corner squarely. It
  cannot become a cheat, because every cell of the hop is walked through open passages. Measured: a
  drag visiting only every other cell of the route completes at three and stalls at one.

The trail is a second SVG laid exactly over the sheet. That needed the preview to have a real box
rather than `display: contents`, so the sheet is now sized from the stage's own dimensions with a
container query — `min(100cqw, 100cqh * aspect)` — which pins the two together whichever way round
the screen is. Playing also hides the controls: at iPad-portrait size that takes the maze from
about 310 px wide to 760, which is the difference between a 15 px corridor and a 36 px one.

Verified end to end by turning on the drawn answer, reading its path back out of the rendered SVG,
and driving a pointer along it: the trail follows it to the exit. That one check exercises the
overlay's coordinates, the page origin, the cell lookup and the rules at once — if any of them
disagreed with the renderer, the finger would hit a wall that is not there.

### Cost

The preset cards, the filmstrip and the preview together put roughly 700 kB of SVG in the DOM at
the default settings. Comfortable, but it is the reason the cards are cropped and the filmstrip is
capped at six.

### Offline

The whole app is a few hundred kilobytes and makes no network calls of its own, so it precaches
entirely — genuine offline use rather than partial. `vite-plugin-pwa` generates the worker;
hand-rolling one risks getting cache versioning wrong, which strands people on a stale build.

`registerType: 'autoUpdate'`, so there is no update prompt. Asking a child whether to install a new
version is noise, and the alternative — leaving an old build in the cache — is the failure the
worker exists to prevent.

Verified end to end rather than assumed: with the network cut and a hard reload, the app renders a
maze from cache, and a fetch to an uncached URL fails, which proves the worker is serving rather
than the HTTP layer.

A broken worker fails silently — the build succeeds, the app works online, and only someone without
a network finds out. `scripts/check-pwa.mjs` runs as part of `npm run build` and fails if any
hashed bundle is missing from the precache list, if the app shell or icons are absent, if outdated
caches are not cleaned up, or if the manifest stops declaring `standalone`. Its own failure path was
checked by tampering with a built worker.

## 9. Testing

- **Structural properties**, across every combination of grid, algorithm, mask, and braid setting: the maze graph is connected; a non-braided maze has exactly `cells − 1` edges and no cycles; start and end are reachable; no cell is isolated; masking leaves exactly one component in use.
- **Style invariance**: for a fixed seed, the solution path is byte-identical across all five render styles.
- **Corridor width**: the jitter clamp is enforced, so minimum corridor width is guaranteed analytically; test the clamp rather than sampling geometry.
- **Difficulty calibration**: generated mazes at level *n* fall in the expected metric band across a large sample.
- **Print geometry**: rendered bounding box fits the printable area for every shape and grid.
- **Golden files** on a fixed seed set.
- **Architectural boundaries**: `core/` imports nothing outside itself and never names a DOM global.
  The rule is easy to state and easy to erode one convenient import at a time, so it is checked
  rather than remembered — it caught a mistake during the line-style work.

Vitest, running against `core/` in Node with no browser needed.

## 10. Phasing

**Phase 0 — de-risk. Done.**
Square grid, recursive backtracker, solver, plain SVG, browser print. Deliberately style-free: it
proved the pipeline, not the look.

**Phase 1 — Doodle World. Substantially done.**
Difficulty model with measured calibration. Cell sizes. Six shapes. Four line styles. Picture-led
preset cards, drawn shape and style pickers, a filmstrip of recent mazes, a grown-up area. Answer
toggle. Seeds and regeneration. PWA install and full offline. Deployed.

Ten shapes, including rocket, fish, cupcake and dinosaur. A mouse at the entrance and cheese at the
exit, drawn outside the outline along the direction the opening faces — which is how decoration
keeps clear of the walls without any collision test.

Two things that only showed up on screen. Both object silhouettes needed correcting after being
rendered: a vertex list reads as plausible long after the shape has stopped being recognisable. And
the markers came out on the wrong ends, because `farthestBoundaryPair` returned the pair in search
order and the double BFS walks *away* from cell 0 — so the far corner came back first, starting the
maze at the bottom of the page and putting the cheese where the mouse belongs. The pair is ordered
now, which fixes the solution's direction as well as the drawings.

**Phase 2 — reordered by measurement.**

1. ~~**The PDF writer, first.**~~ **Done.** Safari shrinks a printed page to about 93% while
   reporting 100% (§7); nothing else was worth building while the output was the wrong size. The
   writer emits the content stream directly and the result measures 100.00001 mm on a 100 mm line.
   What it cost, and the two placement bugs it exposed, are in §7.
2. ~~**On-screen solving.**~~ **Done.** Printing needs an adult *and* a printer, so most of the
   time what a child does with an iPad is play. See §8 for what the rules turned out to be.
3. ~~Hex grid. Polar grid. Sketch and Cave styles. Letter and name mazes.~~ **Done** — see above.
   Print queue is what remains.

**Phase 3**
Batch booklet export — "20 pages, increasing difficulty" as one PDF, nearly free once the writer
exists and the real use case for an adult before a car trip. Phone layout. Share codes. Objective
mazes.

### Deployment, and one way it goes wrong

Pages must be set to **Source: GitHub Actions**. Left on "Deploy from a branch", GitHub's built-in
`pages build and deployment` workflow also runs on every push and publishes the repository root
verbatim — including the source `index.html`, which points at `/src/main.tsx`, a file that exists
only during development. Both deployments then race, and the site works or shows nothing depending
on which finished last.

It presented as an intermittent blank page in Safari and took four rounds to find, because every
plausible theory — a stale cache, the subpath, a syntax cliff, CORS on the module script — was
wrong. What found it was making the failure page report the bundle URL it had tried to load.

### Hexagons, and what they cost

A second cell complex was the real test of §3's claim that topology, carving and drawing are
separable. The result: **HexGrid is 250 lines and nothing else changed.** Every carver, the
braider, the solver, the metrics, the difficulty recipes, the shape masks, the entrance and exit
search, the markers, the wall chaining, both output formats and the on-screen solving all work on
it untouched.

What it did cost was one honest refactor. `MaskedGrid` had been written against `SquareGrid`
specifically; it is now written against a `BaseGrid` interface — a cell has `faces` sides, and the
only questions anyone asks are where a face is, what lies across it, and which way it points. Two
smaller things fell out of that: `placeMarker` had been checking the printable margin one axis at
a time, which is only correct for faces that point along an axis, and is now a ray against the box;
and `rowStructured` moved from "is this a rectangle" to "does this grid have rows at all".

Hexagons are worth having for the puzzle, not the novelty. Six neighbours and no four-way junctions
means no long straight corridors and no free choices — every junction is a real fork. The diagonal
walls also suit the wobbly line styles, which on a square grid only ever bend at right angles.

Two things had to be got right or nothing would have worked:

**Adjacent cells must name the same lattice vertices**, not merely vertices at the same
coordinates. Walls chain into polylines by vertex id, and the jitter styles displace by vertex id
too, so a duplicate id at a shared corner would both fragment the path and tear the walls apart at
every junction. There is a test that walks every cell, every face, and asserts the pair matches
what the neighbour calls it.

**A point has to resolve to a hexagon**, for solving on screen. Rounding each axis separately picks
the wrong cell near a corner; the fix is cube coordinates — round all three, then discard whichever
moved furthest. Tested at nine tenths of the way to every corner of every cell, which is exactly
where the naive version fails.

Sidewinder is the one thing that cannot follow. "Carve east along a run, then north out of it" has
no single answer when a cell has two neighbours above it, so `HexGrid` declines `rowStructured` and
the gentlest difficulty falls back to Kruskal on its own — which is what that interface was
introduced for in §3, working as intended without a special case anywhere.

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
