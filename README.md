# mazegen

Printable maze generator — customizable black-and-white mazes sized for US Letter and A4.

Built for an iPad, aimed at a child operating it directly. See [docs/DESIGN.md](docs/DESIGN.md)
for the full plan: architecture, the difficulty model, line styles, and the creative direction.

## Status: phase 1

Live at **https://tlafleur.github.io/mazegen/** — installable, and works offline once loaded.

- Square grids on US Letter and A4, at four cell sizes named after what you would draw with
- Five difficulty levels, calibrated by measurement rather than assumption
- **Square or hexagonal cells** — six neighbours and no four-way junctions makes a different
  puzzle, not the same one drawn differently
- Ten shapes: page, rounded, oval, circle, heart, star, rocket, fish, cupcake, dinosaur
- **Word mazes** — type a name and the maze is carved into its letters
- Six line styles: Classic, Soft, Doodle, Wonky, Sketch, and Cave — which draws the passages
  rather than the walls, so the maze reads as tunnels
- A mouse at the entrance and cheese at the exit, so the maze says what it is for without words
- Picture-led preset cards, a filmstrip of recent mazes, and a grown-up area for the rest
- Optional answer overlay and a 100 mm calibration ruler
- **Prints as a PDF**, written directly, at exactly 612 × 792 pt for Letter
- **Solve it on screen**: press Play and trace the route with a finger; walls stop the line rather
  than rejecting the move, so there is nothing to undo and no way to get stuck

## Printing, and what is known about it

**Safari shrinks the page.** Printed from an iPad with the print sheet reporting US Letter and
Scaling 100%, the 100 mm reference line measures about 93 mm. "100%" there means the *user* applied
no scaling; Safari still fits the sheet into the printer's printable area.

**A PDF prints at 1:1.** The same sheet as a PDF, printed from the iPad through the share sheet,
comes out the right size — so the fault is Safari's web print, not the print system.

**So the app makes the PDF itself.** Print hands over a PDF rather than printing the web page: it
opens in a tab, where the system's own print button is one tap away. A PDF states its page size
inside the file, in the MediaBox, and nothing downstream reinterprets it. Measured on the output,
the 100 mm reference line is 100.00001 mm and a Letter page is exactly 612 × 792 pt. Browser
printing is still there under Grown-up settings, labelled with what it costs.

The ruler exists for exactly this. Turn it on under Grown-up settings, print a sheet, and measure
the line: any difference is scaling applied between the screen and the paper. Two earlier prints
reported 100% and were believed without measuring — the dialog agreeing with you is not evidence.

Pick the paper your printer actually holds. There is no page size that prints 1:1 on both Letter
and A4, so the other one gets scaled down to fit, which shrinks the cells with it.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # 269 tests, no browser needed
npm run build    # includes a check that the offline build is intact
```

## Layout

```
src/
  core/          zero dependencies, no DOM, fully unit tested
    rng.ts       seeded PRNG — every maze is a pure function of (settings, seed)
    grid/        cell topology and geometry — squares, hexagons, and shape masks
    carve/       carving algorithms; operate on an abstract graph, no geometry
    analyze.ts   solver
    trail.ts     the rules for tracing a route by finger
  render/
    page.ts      paper sizes, cell sizes, how many cells fit on a sheet
    chain.ts     wall segments into maximal polylines
    sheet.ts     the page as strokes and labels, in millimetres — built once
    path.ts      drawing commands neither output format owns
    word.ts      a typed word as a shape a maze fits inside
    svg.ts       a sheet as SVG, at exact page dimensions
    pdf.ts       a sheet as PDF, written directly; no library
  App.tsx        controls and preview
```

`core/` has no dependencies and never touches the DOM. That keeps it testable in Node,
runnable in a Web Worker unchanged, and reusable by a batch generator later.
