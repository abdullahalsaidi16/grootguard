/**
 * Stage the prepared datasets into the app's public directory.
 *
 * data/prepared/ is the pipeline's product and the committed source of truth.
 * Vite can only serve one publicDir, so the files are copied in on each dev or
 * build run rather than being kept in two places in the repository.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '..', '..', 'data', 'prepared')
const to = join(here, '..', 'public', 'data')

if (!existsSync(from)) {
  console.error(`[stage-data] ${from} does not exist - run the pipeline first`)
  process.exit(1)
}
rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
const files = readdirSync(to).filter((f) => f.endsWith('.json'))
console.log(`[stage-data] staged ${files.length} datasets -> app/public/data/`)
