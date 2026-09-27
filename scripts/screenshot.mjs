#!/usr/bin/env node
/**
 * Headless UI capture for CO-GRID — shoots the running app from several
 * camera states using puppeteer-core + system chromium.
 *
 * Requires: dev server (127.0.0.1:3210) + API (127.0.0.1:8000) running.
 * Software WebGL via --enable-unsafe-swiftshader (works on GPU-less boxes).
 *
 * Usage:
 *   node scripts/screenshot.mjs                 # all presets -> shots/
 *   node scripts/screenshot.mjs --out=/tmp/s    # custom output dir
 *   node scripts/screenshot.mjs --base=http://127.0.0.1:3210
 *   node scripts/screenshot.mjs "name|select=OV-0004&panel=0" ...
 */
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

// puppeteer-core lives in src/ui/node_modules (devDependency there).
const require = createRequire(new URL('../src/ui/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const args = process.argv.slice(2)
let OUT = 'shots'
let BASE = 'http://127.0.0.1:3210'
const custom = []
for (const a of args) {
  if (a.startsWith('--out=')) OUT = a.slice(6)
  else if (a.startsWith('--base=')) BASE = a.slice(7)
  else custom.push(a)
}
mkdirSync(OUT, { recursive: true })

const CHROME =
  execSync('command -v chromium || command -v chromium-browser || command -v google-chrome || true', {
    shell: '/bin/bash',
  })
    .toString()
    .trim()
    .split('\n')[0]
if (!CHROME) {
  console.error('no chromium binary found')
  process.exit(1)
}

// name|query presets — the build is single-scene (every ?scene= value
// resolves to 'state', see urlParams.ts), so distinct shots come from
// panel/tier filters, ?select= corridor fly-tos and ?focus= points.
// See src/ui/src/lib/urlParams.ts for params.
const SHOTS = custom.length
  ? custom
  : [
      'state_overview|panel=1',
      'state_map_only|panel=0',
      'tier1_only|tiers=1&panel=1',
      'okatie_mcintosh_tier1|select=OV-0004&panel=0',
      'jasper_okatie_tier1|select=OV-0001&panel=0',
      'select_with_panel|select=OV-0004&panel=1',
      'river_corridor_focus|focus=-81.06,32.34&panel=0',
    ]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=1600,1000',
  ],
  defaultViewport: { width: 1600, height: 1000 },
})

const page = await browser.newPage()
page.on('console', (m) => {
  const t = m.type()
  if (t === 'error' || t === 'warning') console.log(`  [console.${t}]`, m.text().slice(0, 200))
})
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)))

for (const entry of SHOTS) {
  const [name, query] = entry.split('|')
  const url = `${BASE}/?${query ?? ''}`
  console.log(`==> ${name}  (${url})`)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // Wait for the app's ready flag (city data + a few committed frames).
    await page
      .waitForFunction('window.__cogridReady === true', { timeout: 120_000, polling: 500 })
      .catch(() => console.log('  (ready flag timed out — shooting anyway)'))
    await new Promise((r) => setTimeout(r, 1500)) // settle camera ease
    await page.screenshot({ path: `${OUT}/${name}.png` })
    console.log(`  -> ${OUT}/${name}.png`)
  } catch (e) {
    console.log(`  (shot failed: ${name}: ${e.message})`)
  }
}

// ---- E2E agent check (opt-in): clicks the first quick-action chip and
// waits for a real assistant reply through the SSE path, then shoots the
// conversation. Exercises backend agent + proxy + SSE + UI in one pass.
if (process.env.AGENT_E2E === '1') {
  console.log('==> agent_e2e  (chat round-trip)')
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction('window.__cogridReady === true', { timeout: 120_000, polling: 500 })
      .catch(() => {})
    // open the agent rail only if collapsed — the rail defaults open and
    // the toggle would otherwise close it
    await page.evaluate(() => {
      if (document.querySelector('.agent-input textarea')) return
      const btn = document.querySelector('.agent-bar-toggle')
      if (btn) btn.click()
    })
    await new Promise((r) => setTimeout(r, 800))
    // type a minimal prompt — one `define` tool call, fast round-trip.
    // (Quick chips kick off multi-round chains that can run minutes on a
    // thinking model; E2E verifies the path, not the benchmark.)
    const clicked = await page.evaluate(() => {
      const input = document.querySelector('.agent-input textarea')
      const form = document.querySelector('.agent-input')
      if (!input || !form) return false
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, 'what is SERTP? one sentence')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })
    if (!clicked) throw new Error('agent input not rendered')
    await new Promise((r) => setTimeout(r, 400)) // let React enable submit
    await page.evaluate(() => {
      document.querySelector('.agent-input button[type=submit]')?.click()
    })
    // SSE reply can take 30-90s through multi-round tool chains; done when
    // the transient 'analyzing…' placeholder is gone and a real reply sits
    // in the log (⚙ progress lines don't count).
    const ok = await page
      .waitForFunction(
        `!document.querySelector('.agent-thinking') &&
         !document.querySelector('.agent-progress') &&
         document.querySelectorAll('.agent-msg.assistant').length > 0`,
        { timeout: 360_000, polling: 1000 },
      )
      .then(() => true)
      .catch(() => false)
    const last = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll('.agent-msg.assistant')]
      return msgs.length ? msgs[msgs.length - 1].textContent.slice(0, 400) : null
    })
    console.log(`  agent reply: ${ok ? 'RECEIVED' : 'TIMED OUT'} — ${last ?? 'none'}`)
    await page.screenshot({ path: `${OUT}/agent_e2e.png` })
    console.log(`  -> ${OUT}/agent_e2e.png`)
    if (!ok) process.exitCode = 2
  } catch (e) {
    console.log(`  (agent e2e failed: ${e.message})`)
    process.exitCode = 2
  }
}
await browser.close()
console.log(`done -> ${OUT}/`)
