/**
 * Stage MapLibre's web worker where the app can serve it.
 *
 * MapLibre resolves its worker at RUNTIME as a sibling of its own module:
 *
 *     let t = import.meta.url.endsWith('-dev.mjs')
 *       ? 'maplibre-gl-worker-dev.mjs' : 'maplibre-gl-worker.mjs'
 *     return new URL(`./${t}`, import.meta.url).href
 *
 * No bundler can see that, so Vite never emits the worker and the built site
 * asks for /assets/maplibre-gl-worker.mjs, gets index.html back, and the map
 * silently never renders - MapLibre parses GeoJSON and vector tiles in that
 * worker. The worker in turn statically imports ./maplibre-gl-shared.mjs, so
 * both files have to land in the same directory.
 *
 * Copying them into public/ (gitignored, regenerated on every dev/build run)
 * keeps MapLibre a declared dependency rather than vendored source (C4), and
 * the files ship with the site so the map still works offline (C3).
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '..', 'node_modules', 'maplibre-gl', 'dist')
const to = join(here, '..', 'public', 'maplibre')

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

mkdirSync(to, { recursive: true })
for (const f of FILES) {
  const src = join(from, f)
  if (!existsSync(src)) {
    console.error(`[vendor-maplibre-worker] missing ${src} - is maplibre-gl installed?`)
    process.exit(1)
  }
  copyFileSync(src, join(to, f))
}
console.log(`[vendor-maplibre-worker] staged ${FILES.length} files -> public/maplibre/`)
