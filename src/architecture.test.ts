import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourcesUnder(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

/**
 * The one architectural rule the whole plan rests on.
 *
 * `core/` is meant to have no dependencies and no DOM, so the engine can be
 * tested in Node, run in a worker unchanged, and back a batch generator later.
 * That is easy to state and easy to erode one convenient import at a time, so
 * it is checked rather than remembered — a mistake already caught once while
 * wiring up line styles.
 *
 * This file sits outside core/ deliberately: it reads the filesystem, and a
 * test that needs node:fs has no business living in the directory whose whole
 * point is having no dependencies.
 */
describe('core stays self-contained', () => {
  const files = sourcesUnder('src/core')

  it('finds the core sources', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  it.each(files)('%s imports nothing outside core', (file) => {
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1] as string
      // Relative paths must stay inside src/core; bare specifiers would be
      // third-party packages, which core is not allowed either.
      if (spec.startsWith('.')) {
        expect(join(file, '..', spec).replace(/\\/g, '/')).toContain('src/core')
      } else {
        expect(spec).toBe('__no_external_dependencies__')
      }
    }
  })

  it.each(files)('%s never touches the DOM', (file) => {
    const source = readFileSync(file, 'utf8')
    for (const global of ['document', 'window', 'navigator', 'localStorage']) {
      expect(source).not.toMatch(new RegExp(`\\b${global}\\.`))
    }
  })
})
