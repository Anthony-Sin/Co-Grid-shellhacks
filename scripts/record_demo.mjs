#!/usr/bin/env node
/**
 * record_demo.mjs — drive the CO-GRID UI on Xvfb :99 while ffmpeg
 * x11grab captures. Deterministic segment timing → the voiceover is
 * aligned per segment afterwards.
 *
 * Harness: scripts/demo_capture.sh (Xvfb + chromium kiosk + CDP :9222 +
 * ffmpeg grab). Usage: node scripts/record_demo.mjs [segmentId ...]
 * Wall-clock segment boundaries land in /tmp/demo_marks.json.
 *
 * Reliability notes (hard-won across takes):
 *  - bare-X chromium maps content at 800×600 regardless of window size —
 *    Emulation.setDeviceMetricsOverride THEN reload, so the app mounts
 *    against the final viewport
 *  - FocusRig arrivals are POLLED (zoom settles), not slept — fixed
 *    sleeps under swiftshader produce dead zones in the cut
 *  - the home flight must call __cogridInvalidate, not controls.update()
 *    (damping state reasserts and snaps the camera back)
 *  - the export deliverable opens in a second TAB — LibreOffice cold
 *    starts exceed any usable segment length in this environment
 *  - synthetic page.mouse/keyboard beats xdotool: X focus grabs stall
 *    under render load
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CDP = 'http://127.0.0.1:9222'
// fileURLToPath, not .pathname — URL-encoded chars/spaces in the repo
// path would otherwise leak through as %-escapes
const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPT = JSON.parse(fs.readFileSync(new URL('./demo_script.json', import.meta.url)))
const EXPORT_DIR = path.join(REPO, 'exports')
const DOWNLOADS = path.join(os.homedir(), 'Downloads')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** real X cursor ops so the capture shows deliberate motion.
 * NOTE: no --sync — under swiftshader render load the X input queue
 * lags and --sync can block for minutes; fire-and-forget lands fine. */
const mouse = (x, y) => execSync(`DISPLAY=:99 xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)

async function centerOf(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, sel)
}

const store = async (page, fn) => {
  // __cogridStore registers when CityScene mounts — post-reload the app
  // can still be mid-mount when a segment starts; poll briefly first
  await page.waitForFunction('!!window.__cogridStore', { timeout: 30000, polling: 300 }).catch(() => {})
  return page.evaluate(`window.__cogridStore.getState().${fn}`)
}

/** wait until the FocusRig zoom holds steady near corridor level —
 * demand-mode rendering means a fixed sleep routinely lands mid-flight */
async function waitArrived(page, maxMs = 25000) {
  const t0 = Date.now()
  let last = -1, still = 0
  while (Date.now() - t0 < maxMs) {
    const z = await page.evaluate(() => window.__cogridControls?.object?.zoom ?? -1).catch(() => -1)
    if (z > 0.05 && Math.abs(z - last) < 0.005) { if (++still >= 3) return z }
    else still = 0
    last = z
    await sleep(600)
  }
  return last
}

const actions = {
  async overview_idle(page) {
    await store(page, `setActiveScene('state')`)
    for (let i = 0; i < 3; i++) { mouse(620 + i * 80, 400 + i * 25); await sleep(750) }
  },
  async overview_pan(page) {
    await mouse(760, 430); await sleep(400)
    execSync('DISPLAY=:99 xdotool mousedown 1')
    for (let i = 0; i <= 12; i++) { mouse(760 - i * 16, 430 + i * 5); await sleep(70) }
    execSync('DISPLAY=:99 xdotool mouseup 1')
    await sleep(1500)
  },
  async zoom_savannah(page) {
    // FocusRig flight to the Savannah River crossing — the product's own
    // zoom behavior (CDP wheel at statewide scale barely moves the camera)
    await mouse(880, 600); await sleep(300)
    await store(page, `selectOverlap('OV-0004')`)
    const z = await waitArrived(page)
    console.log(`  corridor arrived at zoom ${z}`)
    await sleep(3500) // dwell: zone hatch + crossing lines + rail card + snapshot
  },
  async click_top_pick(page) {
    const c = await centerOf(page, '.top-picks button')
    if (c) { mouse(c.x, c.y); await sleep(350); await page.mouse.click(c.x, c.y) }
    await waitArrived(page)
    // hold until the detail card finishes populating, not just in-flight
    await page.waitForFunction(() =>
      !document.body.textContent.includes('loading overlap detail'), { timeout: 20000 }).catch(() => {})
    await sleep(3000)
  },
  async agent_ask_macon(page, home, seg) {
    const prompt = seg?.prompt || 'zoom to Macon'
    const c = await centerOf(page, '.agent-input textarea')
    if (c) { mouse(c.x, c.y); await sleep(250) }
    // synthetic CDP click+type — guaranteed focus; xdotool typing needs a
    // real X focus grab that stalls under render load
    await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
    await page.click('.agent-input textarea').catch(() => {})
    await page.keyboard.type(prompt, { delay: 55 })
    // verify the text landed — if focus was lost, force it and retry once
    // (check for the prompt's last word so any future prompt works)
    const tail = prompt.split(/\s+/).pop().toLowerCase()
    const typed = await page.evaluate(() => document.querySelector('.agent-input textarea')?.value ?? '')
    if (!typed.toLowerCase().includes(tail)) {
      await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
      await page.keyboard.type(prompt, { delay: 55 })
    }
    await sleep(400)
    await page.keyboard.press('Enter')
    await sleep(11000) // one tool call → map flight + streamed reply on screen
  },
  async export_and_open(page, home, seg, browser) {
    // click the rail CSV export (real /api/overlaps.csv download) and
    // verify the file actually landed — the click must produce an artifact
    const before = new Set(fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.csv')))
    const a = await page.$('a[href*="overlaps.csv"]')
    if (a) {
      const r = await a.boundingBox()
      if (r) { mouse(r.x + r.width / 2, r.y + r.height / 2); await sleep(300); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2) }
    }
    await sleep(2500)
    const fresh = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.csv') && !before.has(f))
    console.log(`  csv downloaded: ${fresh[0] ?? 'NONE — export click did not produce a file'}`)
    // …then show the deliverable in a second tab — the generated HTML
    // report renders the same ranked set and paints instantly (a raw CSV
    // won't render via file:// and LibreOffice cold-start exceeded 30s)
    const latest = execSync(`ls -t ${JSON.stringify(EXPORT_DIR)}/*.html 2>/dev/null | head -1 || true`).toString().trim()
    if (latest) {
      const tab = await browser.newPage()
      await tab.goto('file://' + latest, { waitUntil: 'load' }).catch(() => {})
      await sleep(6000)
      await tab.close()
      await page.bringToFront()
    }
    await sleep(1500)
  },
  async zoom_out_state(page, home) {
    await store(page, `selectOverlap(null)`).catch(() => {}) // collapse the detail card
    await sleep(400)
    if (!home) return
    // ease back to the statewide pose captured at setup — write target +
    // zoom directly and invalidate; controls.update() reasserts the
    // damping state and snaps the camera back
    await page.evaluate((h) => new Promise((res) => {
      const c = window.__cogridControls
      const cam = c.object
      const from = c.target.clone(), z0 = cam.zoom
      const t0 = performance.now()
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 2200)
        const e = 1 - Math.pow(1 - k, 3)
        const d = c.target.clone()
        c.target.set(from.x + (h.tx - from.x) * e, 0, from.z + (h.tz - from.z) * e)
        d.sub(c.target)
        cam.position.sub(d)
        cam.zoom = z0 + (h.zoom - z0) * e
        cam.updateProjectionMatrix()
        window.__cogridInvalidate?.()
        if (k < 1) requestAnimationFrame(step)
        else res(cam.zoom)
      }
      step()
    }), home).then((z) => console.log('  flew home, zoom', z)).catch((e) => console.log('  fly err:', e.message))
    await sleep(3000)
    await mouse(700, 450)
  },
}

const wanted = process.argv.slice(2)
const segs = SCRIPT.segments.filter((s) => !wanted.length || wanted.includes(s.id))
const marks = []
const browser = await puppeteer.connect({ browserURL: CDP })
const page = (await browser.pages()).find((p) => p.url().includes('3210')) || (await browser.pages())[0]
await page.bringToFront()
const cdp = await page.createCDPSession()
// bare-X chromium maps the content view at 800×600 regardless of window
// size — force the real viewport via emulation, then reload so the app
// mounts against the final size (mid-flight overrides leave it blank)
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
// downloads must land in ~/Downloads — chromium kiosk otherwise prompts
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() =>
  cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() => {}))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__cogridReady===true', { timeout: 120000, polling: 500 }).catch(() => {})
await sleep(4000) // let the post-mount render burst finish before X input
// snapshot the statewide resting view — the outro flies back to it
const home = await page.evaluate(() => {
  const c = window.__cogridControls
  return c ? { tx: c.target.x, tz: c.target.z, zoom: c.object.zoom } : null
})
console.log('home:', JSON.stringify(home))

for (const s of segs) {
  const t0 = Date.now()
  marks.push({ id: s.id, start_ms: t0 })
  console.log(`[seg ${s.id}] ${s.action} (target ${s.dur_s}s)`)
  try { await actions[s.action](page, home, s, browser) } catch (e) { console.log(`  action error: ${e.message}`) }
  const pad = s.dur_s * 1000 - (Date.now() - t0)
  if (pad > 0) await sleep(pad)
  marks[marks.length - 1].end_ms = Date.now()
}
fs.writeFileSync('/tmp/demo_marks.json', JSON.stringify(marks, null, 2))
console.log('done — marks in /tmp/demo_marks.json')
await browser.disconnect()
