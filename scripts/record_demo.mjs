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

/** visible left-drag pan — real X button events so the capture reads
 * as a hand on the map, not a state jump */
async function dragMap(page, x0, y0, dx, dy, steps = 14) {
  await mouse(x0, y0)
  await sleep(350)
  execSync('DISPLAY=:99 xdotool mousedown 1')
  for (let i = 1; i <= steps; i++) {
    mouse(x0 + (dx * i) / steps, y0 + (dy * i) / steps)
    await sleep(65)
  }
  execSync('DISPLAY=:99 xdotool mouseup 1')
  await sleep(900)
}

/** click an element with the cursor visibly moving to it first;
 * if `verifyFn` is given, keep clicking until it flips — a checkbox
 * that didn't toggle means the click missed (stale metrics override
 * once put every rect off-viewport: real clicks fell through, so we
 * verify then fall back to a DOM click which always reaches React) */
async function clickEl(page, sel, idx = 0, verifyFn = null, markName = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await page.evaluate(([s, i]) => {
      const el = [...document.querySelectorAll(s)][i]
      if (!el) return null
      el.scrollIntoView({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, [sel, idx])
    if (!c) return false
    await mouse(c.x, c.y)
    await sleep(320)
    if (attempt === 0) await page.mouse.click(c.x, c.y)
    else await page.evaluate(([s, i]) =>
      [...document.querySelectorAll(s)][i]?.click(), [sel, idx])
    if (!verifyFn) { await sleep(400); if (markName) mark(markName); return true }
    // verify twice: a React re-render can re-assert the OLD controlled
    // state ~1s after the click — only a value that persists counts
    await sleep(400)
    await page.evaluate(verifyFn).catch(() => false)
    await sleep(1000)
    const stuck = await page.evaluate(verifyFn).catch(() => false)
    if (stuck) { if (markName) mark(markName); return true }
    console.log(`  click ${sel}[${idx}] did not stick — retry ${attempt + 1}`)
  }
  return false
}

/** poll until the agent's streamed answer lands (footer meta appears)
 * — the whole point of these beats is watching it write live */
async function waitStreamDone(page, prevMetaCount, maxMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => document.querySelectorAll('.agent-meta').length).catch(() => -1)
    if (n > prevMetaCount) return true
    await sleep(800)
  }
  return false
}

/** smooth-scroll an element so the motion is visible on camera */
async function smoothScroll(page, sel, to, ms = 1400) {
  await page.evaluate(([s, target, dur]) => new Promise((res) => {
    const el = document.querySelector(s)
    if (!el) return res(false)
    const from = el.scrollTop
    const t0 = performance.now()
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur)
      el.scrollTop = from + (target - from) * (1 - Math.pow(1 - k, 3))
      if (k < 1) requestAnimationFrame(step)
      else res(true)
    }
    step()
  }), [sel, to, ms])
}

const actions = {
  async overview_idle(page) {
    await store(page, `setActiveScene('state')`)
    for (let i = 0; i < 3; i++) { mouse(620 + i * 80, 400 + i * 25); await sleep(750) }
  },
  /** three big drags — the map visibly moves under the narration */
  async slow_pan(page) {
    mark('pan1')
    await dragMap(page, 1100, 400, -420, 140)
    await sleep(500)
    mark('pan2')
    await dragMap(page, 640, 560, 330, -180)
    await sleep(400)
    mark('pan3')
    await dragMap(page, 900, 420, -260, -60)
  },
  /** scroll the ranked table then flip "timeline overlap only" so the
   * counters recompute on camera (1957 ↔ 897) */
  async filter_showcase(page) {
    mark('table_scroll')
    await smoothScroll(page, '.overlap-list', 420, 1600)
    await sleep(700)
    // timeline checkbox off -> on; the KPI counters visibly recompute —
    // verify the toggle actually flipped before moving on
    const tl = '.filter-row--timeline input'
    await clickEl(page, tl, 0,
      () => document.querySelector('.filter-row--timeline input').checked === false, 'timeline_off')
    await sleep(2200)
    await clickEl(page, tl, 0,
      () => document.querySelector('.filter-row--timeline input').checked === true, 'timeline_on')
    await sleep(1600)
    await smoothScroll(page, '.overlap-list', 0, 900)
  },
  /** isolate tier 1 — uncheck t2/t3/t4, hold, restore */
  async tier_ladder(page) {
    const tiers = await page.evaluate(() =>
      [...document.querySelectorAll('.pnl-tier-row')].map((r) => r.textContent.trim().slice(0, 14)),
    )
    console.log('  tier rows:', JSON.stringify(tiers))
    // rows are tier 1..4 in order — uncheck 2,3,4 (index 1..3), retry
    // until the checkbox state actually reads back false on camera
    for (const i of [1, 2, 3]) {
      for (let a = 0; a < 3; a++) {
        if (!(await clickEl(page, '.pnl-tier-row input', i))) break
        const off = await page.evaluate((i2) =>
          !document.querySelectorAll('.pnl-tier-row input')[i2]?.checked, i)
        if (off) break
        console.log(`  tier ${i} uncheck missed — retry`)
      }
      await sleep(500)
    }
    mark('tiers_isolated')
    await sleep(2600) // let the map thin visibly
    for (const i of [1, 2, 3]) {
      for (let a = 0; a < 3; a++) {
        if (!(await clickEl(page, '.pnl-tier-row input', i))) break
        const on = await page.evaluate((i2) =>
          !!document.querySelectorAll('.pnl-tier-row input')[i2]?.checked, i)
        if (on) break
        console.log(`  tier ${i} recheck missed — retry`)
      }
      await sleep(350)
    }
    mark('tiers_restored')
  },
  /** click top-pick #1 — flight, then scroll the detail card */
  async pick_ov1(page) {
    const c = await centerOf(page, '.pnl-top4-btn')
    if (c) { mouse(c.x, c.y); await sleep(350); await page.mouse.click(c.x, c.y) }
    mark('pick_clicked')
    const z = await waitArrived(page)
    mark('flight_arrived')
    console.log(`  pick flight arrived at zoom ${z}`)
    await page.waitForFunction(() =>
      !document.body.textContent.includes('loading overlap detail'), { timeout: 20000 }).catch(() => {})
    await sleep(1800)
    mark('card_scroll')
    // scroll the detail card through snapshot → projects → schedule → value
    const sc = await page.evaluate(() => {
      const el = document.querySelector('.agent-detail') || document.querySelector('.overlap-detail')
      return el ? el.scrollHeight : 0
    })
    for (const frac of [0.33, 0.66, 0.95]) await smoothScroll(page, '.agent-detail, .overlap-detail', sc * frac, 1200)
    await smoothScroll(page, '.agent-detail, .overlap-detail', 0, 700)
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
  /** type a question, watch the streamed answer, then click the first
   * OV citation link in it — the map flies on the link's own action */
  async agent_stream(page, home, seg) {
    const prompt = seg?.prompt || 'which overlaps sit near the savannah river?'
    const prevMeta = await page.evaluate(() => document.querySelectorAll('.agent-meta').length).catch(() => 0)
    const c = await centerOf(page, '.agent-input textarea')
    if (c) { mouse(c.x, c.y); await sleep(250) }
    await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
    await page.click('.agent-input textarea').catch(() => {})
    mark('type_start')
    await page.keyboard.type(prompt, { delay: 50 })
    const tail = prompt.split(/\s+/).pop().toLowerCase()
    const typed = await page.evaluate(() => document.querySelector('.agent-input textarea')?.value ?? '')
    if (!typed.toLowerCase().includes(tail)) {
      await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
      await page.keyboard.type(prompt, { delay: 50 })
    }
    await sleep(350)
    mark('typed')
    await page.keyboard.press('Enter')
    mark('sent')
    const done = await waitStreamDone(page, prevMeta, 55000)
    mark('streamed')
    console.log(`  stream ${done ? 'completed' : 'TIMED OUT (kept rolling)'}`)
    await sleep(1200)
    // click a citation chip in the answer — the link flies the map itself
    const n = await page.evaluate(() => document.querySelectorAll('.md-ovlink').length)
    if (n > 0) {
      const ok = await clickEl(page, '.md-ovlink', n - 1, null, 'ovlink_clicked')
      if (ok) {
        const z = await waitArrived(page, 20000)
        mark('ovlink_arrived')
        console.log(`  ovlink flight arrived at zoom ${z}`)
      }
    } else console.log('  no ovlink chips in answer — skipped flight')
  },
  /** click a quick-action chip by label and let the answer stream */
  async chip_ask(page, home, seg) {
    const prevMeta = await page.evaluate(() => document.querySelectorAll('.agent-meta').length).catch(() => 0)
    const c = await page.evaluate((label) => {
      const btn = [...document.querySelectorAll('.agent-chips button')].find(b => b.textContent.trim() === label)
      if (!btn) return null
      btn.scrollIntoView({ block: 'nearest' })
      const r = btn.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, seg?.chip || 'Top opportunities')
    if (!c) { console.log('  chip not found (may be consumed)') ; return }
    await mouse(c.x, c.y); await sleep(300); await page.mouse.click(c.x, c.y)
    mark('chip_clicked')
    const done = await waitStreamDone(page, prevMeta, 50000)
    mark('chip_streamed')
    console.log(`  chip stream ${done ? 'completed' : 'TIMED OUT'}`)
    await sleep(1000)
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
    const a = await page.$('a[href*="overlaps.csv"]')
    if (a) {
      const r = await a.boundingBox()
      if (r) { mouse(r.x + r.width / 2, r.y + r.height / 2); await sleep(300); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2) }
    }
    mark('csv_clicked')
    await sleep(2500)
    // a same-name re-download lands as " (1).csv" OR overwrites — verify by
    // freshness, not by filename-set diff (which misses the overwrite case)
    const fresh = fs.readdirSync(DOWNLOADS).filter((f) =>
      f.endsWith('.csv') && Date.now() - fs.statSync(path.join(DOWNLOADS, f)).mtimeMs < 15000)
    console.log(`  csv downloaded: ${fresh[0] ?? 'NONE — export click did not produce a file'}`)
    // …then show the deliverable in a second tab — the generated HTML
    // report renders the same ranked set and paints instantly (a raw CSV
    // won't render via file:// and LibreOffice cold-start exceeded 30s)
    const latest = execSync(`ls -t ${JSON.stringify(EXPORT_DIR)}/*.html 2>/dev/null | head -1 || true`).toString().trim()
    if (latest) {
      try {
        // bound the whole tab cycle — a wedged newPage once burned
        // ~5min of take; never let the artifact beat hold the segment
        const tab = await Promise.race([browser.newPage(), sleep(8000).then(() => null)])
        if (tab) {
          await tab.goto('file://' + latest, { waitUntil: 'load', timeout: 10000 }).catch(() => {})
          mark('report_open')
          await sleep(6000)
          await tab.close().catch(() => {})
        }
      } catch (e) { console.log('  report tab err:', e.message) }
      await page.bringToFront().catch(() => {})
    }
    await sleep(1500)
  },
  async zoom_out_state(page, home) {
    await store(page, `selectOverlap(null)`).catch(() => {}) // collapse the detail card
    mark('deselected')
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
    }), home).then((z) => { mark('home'); console.log('  flew home, zoom', z) }).catch((e) => console.log('  fly err:', e.message))
    await sleep(3000)
    await mouse(700, 450)
  },
}

const wanted = process.argv.slice(2)
const segs = SCRIPT.segments.filter((s) => !wanted.length || wanted.includes(s.id))
const marks = []
/** name an on-camera moment so the edit can align narration to the
 * action, not the segment boundary (VO consistently led the visuals) */
const mark = (name) => {
  marks[marks.length - 1].events = marks[marks.length - 1].events || {}
  marks[marks.length - 1].events[name] = Date.now()
  fs.writeFileSync('/tmp/demo_marks.json', JSON.stringify(marks, null, 2))
}
const browser = await puppeteer.connect({ browserURL: CDP })
const page = (await browser.pages()).find((p) => p.url().includes('3210')) || (await browser.pages())[0]
await page.bringToFront()
const cdp = await page.createCDPSession()
// the window is 1600x900 but a stale metrics override / page zoom can leave
// the CSS viewport at 800x600 — clicks then land off-viewport and toggles
// silently never fire. Assert before recording a single frame.
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
await cdp.send('Emulation.setDeviceMetricsOverride',
  { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => {})
const vw = await page.evaluate(() => innerWidth)
if (vw !== 1600) {
  console.log(`!! viewport is ${vw}px — clicks will miss. Fix before recording.`)
  process.exit(2)
}
console.log('viewport ok 1600x900')
// bare-X chromium maps the content view at 800×600 regardless of window
// size — force the real viewport via emulation, then reload so the app
// mounts against the final size (mid-flight overrides leave it blank)
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
// downloads must land in ~/Downloads — chromium kiosk otherwise prompts
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() =>
  cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() => {}))
// Chromium renders native title= tooltips as a dark box that doesn't
// rasterize under swiftshader — on camera it's a black rectangle stuck
// over the panel for ~10s. Strip every title attr + re-strip any that
// mount later (observer survives HMR within the session).
await page.evaluateOnNewDocument(() => {
  const strip = (root) => {
    const t = root.querySelectorAll?.('[title]') ?? []
    t.forEach((e) => e.removeAttribute('title'))
    if (root.getAttribute?.('title') !== undefined && root.getAttribute?.('title'))
      root.removeAttribute('title')
  }
  const boot = () => {
    strip(document)
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') m.target.removeAttribute('title')
        else m.addedNodes.forEach((n) => strip(n))
      }
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['title'],
    })
  }
  if (document.documentElement) boot()
  else document.addEventListener('DOMContentLoaded', boot, { once: true })
})
// reload so the app mounts against the final viewport — but the dev
// server + 40MB of artifacts can exceed the nav timeout under
// swiftshader; a live app is fine to record against as-is.
// ?lowfx: caps pixel ratio + drops the shadow map so frames actually
// move during the capture (SwiftShader renders ~9s/frame at full dpr).
await page.goto('http://127.0.0.1:3210/?lowfx', { waitUntil: 'domcontentloaded', timeout: 45000 })
  .catch(() => page.reload({ waitUntil: 'domcontentloaded' }).catch(() => console.log('  reload timed out — continuing on the live page')))
await page.waitForFunction('window.__cogridReady===true', { timeout: 120000, polling: 500 }).catch(() => {})
// pre-warm: under software GL each frame is seconds — hold until a few
// real frames have presented so the cut opens on the drawn network,
// not a bare basemap (this wait is pre-marks, never on camera)
await page.evaluate(() => new Promise((res) => {
  let n = 0
  const t0 = performance.now()
  const tick = () => {
    if (++n >= 3 || performance.now() - t0 > 20000) return res(n)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})).catch(() => {})
await sleep(1500)
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
  // flush per segment — a wedged/killed run must not lose the marks
  fs.writeFileSync('/tmp/demo_marks.json', JSON.stringify(marks, null, 2))
}
console.log('done — marks in /tmp/demo_marks.json')
await browser.disconnect()
