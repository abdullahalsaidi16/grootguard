/**
 * Headless smoke-check for the map.
 *
 * MapLibre can fail completely silently - if its web worker never answers, the
 * basemap and every hex vanish with no console error and no failed request. A
 * screenshot alone cannot tell that apart from a backgrounded tab, so this
 * drives a real Chrome over CDP and reports what the map actually did:
 * whether the style loaded, whether the hex source was installed, and how many
 * features are genuinely on screen.
 *
 *   node scripts/probe.mjs [url] [out.png] [waitMs]
 *
 * Requires the dev server (or `vite preview`) to be running.
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const URL_ = process.argv[2] ?? 'http://localhost:5180/'
const OUT = process.argv[3] ?? 'probe.png'
const WAIT = Number(process.argv[4] ?? 10000)
const PORT = 9333
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    // Software WebGL, so this works on a machine with no GPU (and in CI).
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=1600,1000',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=/tmp/fusion-probe-${Date.now()}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const page = (await r.json()).find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* still starting */ }
    await sleep(200)
  }
  throw new Error('Chrome did not expose a debugging target')
}

const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let id = 0
const pending = new Map()
const logs = []
const errors = []
const failed = []

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
    return
  }
  const p = m.params
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text)
  } else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') {
    errors.push(`[log] ${p.entry.text} ${p.entry.url ?? ''}`)
  } else if (m.method === 'Network.loadingFailed') {
    failed.push(`${p.errorText} ${p.type}`)
  }
}

const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

for (const d of ['Runtime', 'Log', 'Network', 'Page']) await send(`${d}.enable`)
await send('Page.navigate', { url: URL_ })
await sleep(WAIT)

const diag = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    // window.__fusionMap is exposed in dev builds only.
    const m = window.__fusionMap;
    const cv = document.querySelector('.map canvas');
    const src = m && m.getSource('hex');
    return JSON.stringify({
      mapExposed: !!m,
      visibility: document.visibilityState,
      styleLoaded: m?.isStyleLoaded?.(),
      loaded: m?.loaded?.(),
      hexSource: !!src,
      hexFeatures: src?._data?.features?.length,
      renderedHex: m?.queryRenderedFeatures?.({ layers: ['hex-fill'] })?.length,
      canvas: cv ? [cv.width, cv.height] : null,
      webgl: (() => { try { const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } })(),
    }, null, 1);
  })()`,
})

console.log('=== DIAGNOSTIC ===')
console.log(diag?.result?.value ?? JSON.stringify(diag))
console.log(`\n=== CONSOLE (${logs.length}) ===`)
logs.slice(-20).forEach((l) => console.log(l))
console.log(`\n=== PAGE ERRORS (${errors.length}) ===`)
errors.slice(-10).forEach((l) => console.log(l))
console.log(`\n=== FAILED REQUESTS (${failed.length}) ===`)
;[...new Set(failed)].slice(-10).forEach((l) => console.log(l))

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log(`\nsaved ${OUT}`)
}

ws.close()
chrome.kill()
process.exit(0)
