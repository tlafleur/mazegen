# mazegen

Printable maze generator — customizable black-and-white mazes sized for US Letter and A4.

Built for an iPad, aimed at a child operating it directly. See [docs/DESIGN.md](docs/DESIGN.md)
for the full plan: architecture, the difficulty model, line styles, and the creative direction.

## Status: phase 0

Phase 0 exists to prove the print path and nothing else. It is deliberately style-free —
square grid, one carving algorithm, plain straight lines. The look comes in phase 1.

What works:

- Square grids on Letter and A4, at four cell sizes named by what you would draw with
- Recursive backtracker carving, seeded and reproducible
- Breadth-first solver, with the answer as an optional dashed overlay
- SVG output sized to the sheet in real millimetres
- Browser print via `@page`

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # 37 tests, no browser needed
npm run build
```

## The print test

This is the point of phase 0, and it needs real hardware — an iPad and a printer.

Each sheet carries a 100 mm reference line and a caption naming the paper, cell size, grid
and seed. Print one, measure the line with a ruler, and any difference is scaling applied
somewhere between the page and the paper. Safari on iOS applies its own scaling and margins
depending on the print sheet settings, and CSS cannot fully override it — which is exactly
the risk this phase is here to measure. Check both Letter and A4, and check that nothing
spills onto a second page.

If the line does not measure 100 mm, that is the signal to bring the hand-rolled PDF writer
forward from phase 2 and make it the primary output. See docs/DESIGN.md §7.

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
