export type { CellId, EdgeId, Maze, RowStructured, Topology } from './types'
export { hashSeed, makeRng, type Rng } from './rng'
export { SquareGrid } from './grid/square'
export { MaskedGrid } from './grid/masked'
export {
  EAST,
  FACE_NORMALS,
  NORTH,
  SOUTH,
  WEST,
  type PlanarGrid,
  type Point,
  type Segment,
} from './grid/planar'
export {
  circleMask,
  cupcakeMask,
  dinosaurMask,
  ellipseMask,
  fishMask,
  heartMask,
  polygonMask,
  rectangleMask,
  rocketMask,
  roundedRectMask,
  shapeLibrary,
  starMask,
  type Mask,
  type Shape,
} from './grid/mask'

export { carveBacktracker } from './carve/backtracker'
export { carveKruskal } from './carve/kruskal'
export { carveSidewinder } from './carve/sidewinder'
export { carveWilson } from './carve/wilson'

export { braid, capDeadEndRun } from './braid'
export { edgeBetween, follow, startTrail, step, type Trail } from './trail'
export { reachableCount, solve } from './analyze'
export {
  deadEndRuns,
  distanceFromPath,
  measure,
  openDegree,
  type DeadEndRun,
  type MazeMetrics,
} from './metrics'
export {
  LEVELS,
  RECIPES,
  carveAtLevel,
  recipeFor,
  type CarvableGrid,
  type CarverName,
  type Level,
  type LevelRecipe,
} from './difficulty'

