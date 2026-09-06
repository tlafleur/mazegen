import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard the offline build.
 *
 * A broken service worker fails silently: the build succeeds, the app works
 * online, and only someone on a plane finds out. Narrowing `globPatterns` or
 * renaming an asset is all it takes, so the precache list is checked against
 * what was actually built.
 */
const dist = 'dist'
const problems = []

for (const required of ['sw.js', 'index.html', 'manifest.webmanifest', 'registerSW.js']) {
  if (!existsSync(join(dist, required))) problems.push(`missing ${required}`)
}

if (problems.length === 0) {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
  const assets = readdirSync(join(dist, 'assets'))

  // Every hashed bundle has to be in the precache list, or the app cannot boot
  // without a network.
  for (const asset of assets) {
    if (!sw.includes(asset)) problems.push(`asset not precached: assets/${asset}`)
  }
  for (const shell of ['index.html', 'icon-192.png', 'apple-touch-icon.png']) {
    if (!sw.includes(shell)) problems.push(`not precached: ${shell}`)
  }
  // Without this, an old build's caches survive every deploy.
  if (!sw.includes('cleanupOutdatedCaches')) problems.push('outdated caches are not cleaned up')

  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'))
  if (manifest.display !== 'standalone') problems.push(`display is ${manifest.display}`)
  if (!manifest.icons?.some((i) => i.sizes === '512x512')) problems.push('no 512px icon')
}

if (problems.length > 0) {
  console.error('PWA build check failed:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('PWA build check passed')
