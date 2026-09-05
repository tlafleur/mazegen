import type { Segment } from '../core/grid/square'

/**
 * Join loose wall segments into maximal polylines.
 *
 * This is the geometry step everything downstream depends on. Drawing walls as
 * individual segments means thousands of SVG elements, mitred corners that do
 * not meet, and a bloated PDF; chaining them first collapses a maze into a few
 * hundred subpaths inside a single `<path>` with correct joins. Every line
 * style in docs/DESIGN.md §5 — rounding, jitter, sketch — operates on the
 * polylines this produces rather than on separate segments.
 *
 * Returns lists of lattice-vertex ids. A closed loop comes back with its first
 * vertex repeated at the end.
 *
 * Implementation note: the typed-array reads below are cast to `number`. Under
 * `noUncheckedIndexedAccess` TypeScript widens every indexed read to
 * `number | undefined`, but each index here is in bounds by construction — the
 * CSR offsets are derived from the degree counts they index, and vertex ids
 * come from the segments themselves. The casts assert that, and compile away.
 */
export function chainSegments(segments: readonly Segment[], vertexCount: number): number[][] {
  const n = segments.length
  if (n === 0) return []

  // Flatten first: keeps the hot loops on typed arrays.
  const ends = new Int32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const s = segments[i] as Segment
    ends[i * 2] = s[0]
    ends[i * 2 + 1] = s[1]
  }

  const degree = new Int32Array(vertexCount)
  for (let i = 0; i < n * 2; i++) {
    const v = ends[i] as number
    degree[v] = (degree[v] as number) + 1
  }

  // Incident segments per vertex, in compressed-row form.
  const offset = new Int32Array(vertexCount + 1)
  for (let v = 0; v < vertexCount; v++) {
    offset[v + 1] = (offset[v] as number) + (degree[v] as number)
  }
  const cursor = Int32Array.from(offset.subarray(0, vertexCount))
  const incident = new Int32Array(n * 2)
  for (let i = 0; i < n * 2; i++) {
    const v = ends[i] as number
    incident[cursor[v] as number] = i >> 1
    cursor[v] = (cursor[v] as number) + 1
  }

  const used = new Uint8Array(n)
  const out: number[][] = []

  /** Follow a run from `from` outwards, consuming segments as it goes. */
  const walk = (from: number, first: number): number[] => {
    const poly = [from]
    let cur = from
    let seg = first
    for (;;) {
      used[seg] = 1
      const a = ends[seg * 2] as number
      const next = a === cur ? (ends[seg * 2 + 1] as number) : a
      poly.push(next)

      // Anything that is not a simple pass-through ends the run.
      if (degree[next] !== 2) break

      let onward = -1
      const stop = offset[next + 1] as number
      for (let k = offset[next] as number; k < stop; k++) {
        const cand = incident[k] as number
        if (used[cand] === 0) {
          onward = cand
          break
        }
      }
      if (onward === -1) break // walked back to where the loop started
      cur = next
      seg = onward
    }
    return poly
  }

  // Start from every endpoint and junction, so open runs come out whole.
  for (let v = 0; v < vertexCount; v++) {
    if (degree[v] === 2) continue
    const stop = offset[v + 1] as number
    for (let k = offset[v] as number; k < stop; k++) {
      const seg = incident[k] as number
      if (used[seg] === 0) out.push(walk(v, seg))
    }
  }

  // Whatever is left is a closed loop, every vertex on it being degree 2.
  for (let i = 0; i < n; i++) {
    if (used[i] === 0) out.push(walk(ends[i * 2] as number, i))
  }

  return out
}
