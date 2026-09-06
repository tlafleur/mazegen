# mazegen

Printable maze generator — customizable black-and-white mazes sized for US Letter and A4.

Built for an iPad, aimed at a child operating it directly. See [docs/DESIGN.md](docs/DESIGN.md)
for the full plan: architecture, the difficulty model, line styles, and the creative direction.

## Status: phase 1

Live at **https://tlafleur.github.io/mazegen/** — installable, and works offline once loaded.

- Square grids on US Letter and A4, at four cell sizes named after what you would draw with
- Five difficulty levels, calibrated by measurement rather than assumption
- Six shapes: page, rounded, oval, circle, heart, star
- Four line styles: Classic, Soft, Doodle, Wonky
- Picture-led preset cards, a filmstrip of recent mazes, and a grown-up area for the rest
- Optional answer overlay and a 100 mm calibration ruler

Still to come in phase 1: object shapes (rocket, dinosaur, fish, cupcake) and illustrated start and
end markers.

## Printing, and what is known about it

**Safari shrinks the page.** Printed from an iPad with the print sheet reporting US Letter and
Scaling 100%, the 100 mm reference line measures about 93 mm. "100%" there means the *user* applied
no scaling; Safari still fits the sheet into the printer's printable area.

**A PDF prints at 1:1.** The same sheet as a PDF, printed from the iPad through the share sheet,
comes out the right size — so the fault is Safari's web print, not the print system. The next thing
being built is a PDF writer that emits the page directly, which routes around the component doing
the scaling.

Until then, printed cells are about 7% smaller than the label says.

The ruler exists for exactly this. Turn it on under Grown-up settings, print a sheet, and measure
the line: any difference is scaling applied between the screen and the paper. Two earlier prints
reported 100% and were believed without measuring — the dialog agreeing with you is not evidence.

Pick the paper your printer actually holds. There is no page size that prints 1:1 on both Letter
and A4, so the other one gets scaled down to fit, which shrinks the cells with it.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # 169 tests, no browser needed
npm run build    # includes a check that the offline build is intact
```

## Layout

```
src/
  core/          zero dependencies, no DOM, fully unit tested
    rng.ts       seeded PRNG — every maze is a pure function of (settings, seed)
    grid/        cell topology and geometry
    carve/       carving algorithms; operate on an abstract graph, no geometry
    analyze.ts   solver
  render/
    page.ts      paper sizes, cell sizes, how many cells fit on a sheet
    chain.ts     wall segments into maximal polylines
    svg.ts       SVG at exact page dimensions
  App.tsx        controls and preview
```

`core/` has no dependencies and never touches the DOM. That keeps it testable in Node,
runnable in a Web Worker unchanged, and reusable by a batch generator later.
