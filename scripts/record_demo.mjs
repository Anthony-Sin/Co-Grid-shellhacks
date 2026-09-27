#!/usr/bin/env node
/**
 * record_demo.mjs — drive the CO-GRID UI on Xvfb :99 while ffmpeg
 * x11grab captures. Deterministic segment timing → the voiceover is
 * aligned per segment afterwards.
 *
 * Harness: scripts/demo_capture.sh (Xvfb + chromium kiosk + CDP :9222 +
 * ffmpeg grab). Usage: node scripts/record_demo.mjs [segmentId ...]
 * Wall-clock segment boundaries land in /tmp/demo_marks.json.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const CDP = 'http://127.0.0.1:9222'
const SCRIPT = JSON.parse(fs.readFileSync(new URL('./demo_script.json', import.meta.url)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** real X cursor ops so the capture shows deliberate motion.
 * NOTE: no --sync — under swiftshader render load the X input queue
 * lags and --sync can block for minutes; fire-and-forget lands fine. */
const mouse = (x, y) => execSync(`DISPLAY=:99 xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)
const click = () => execSync('DISPLAY=:99 xdotool click 1')
const type = (s) => execSync(`DISPLAY=:99 xdotool type --delay 40 --clearmodifiers ${JSON.stringify(s)}`)

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
    await sleep(9000) // camera flight + hatch + rail card + snapshot render
  },
  async click_top_pick(page) {
    const c = await centerOf(page, '.top-picks button')
    if (c) { mouse(c.x, c.y); await sleep(350); await page.mouse.click(c.x, c.y) }
    await sleep(2800) // FocusRig flight + zone hatch + rail card + snapshot
  },
  async agent_ask_macon(page) {
    const c = await centerOf(page, '.agent-input textarea')
    if (c) { mouse(c.x, c.y); await sleep(250) }
    // synthetic CDP click+type — guaranteed focus; xdotool typing needs a
    // real X focus grab that stalls under render load
    await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
    await page.click('.agent-input textarea').catch(() => {})
    await page.keyboard.type('which overlaps share crews near Macon?', { delay: 45 })
    // verify the text landed — if focus was lost, force it and retry once
    const typed = await page.evaluate(() => document.querySelector('.agent-input textarea')?.value ?? '')
    if (!typed.includes('Macon')) {
      await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
      await page.keyboard.type('which overlaps share crews near Macon?', { delay: 45 })
    }
    await sleep(400)
    await page.keyboard.press('Enter')
    await sleep(10000) // tool progress + streamed reply stay on screen
  },
  async export_and_open(page) {
    const chip = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /export/i.test(x.textContent || ''))
      if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (chip) { mouse(chip.x, chip.y); await sleep(350); await page.mouse.click(chip.x, chip.y) }
    await sleep(9000) // export run streams; link lands in the log
    const latest = execSync(
      'ls -t /home/ANT/projects/Co-Grid-shellhacks/exports/* 2>/dev/null | head -1 || true',
    ).toString().trim()
    if (latest) execSync(`DISPLAY=:99 setsid libreoffice --norestore '${latest}' >/dev/null 2>&1 &`)
    await sleep(6000)
    // bare Xvfb has no WM — unmap the sheet by closing soffice so the
    // kiosk browser is visible again for the outro
    execSync('pkill -f "soffic[e]" 2>/dev/null || true')
    await sleep(1200)
  },
  async zoom_out_state(page, home) {
    await store(page, `selectOverlap(null)`) // collapse the detail card
    // ease the camera back to the statewide view captured at setup —
    // controls.update() fires 'change' which r3f auto-invalidates on
    await page.evaluate((h) => {
      const c = window.__cogridControls
      const cam = c.object
      const from = c.target.clone(), z0 = cam.zoom
      const t0 = performance.now()
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 1600)
        const e = 1 - Math.pow(1 - k, 3)
        const d = c.target.clone()
        c.target.set(from.x + (h.tx - from.x) * e, 0, from.z + (h.tz - from.z) * e)
        d.sub(c.target)
        cam.position.sub(d)
        cam.zoom = z0 + (h.zoom - z0) * e
        cam.updateProjectionMatrix()
        c.update?.()
        if (k < 1) requestAnimationFrame(step)
      }
      step()
    }, home)
    await sleep(3200)
    await mouse(700, 450)
  },
}

const wanted = process.argv.slice(2)
const segs = SCRIPT.segments.filter((s) => !wanted.length || wanted.includes(s.id))
const marks = []
const browser = await puppeteer.connect({ browserURL: CDP })
const page = (await browser.pages()).find((p) => p.url().includes('3210')) || (await browser.pages())[0]
await page.bringToFront()
// bare-X chromium maps the content view at 800×600 regardless of window
// size — force the real viewport via emulation, then reload so the app
// mounts against the final size (mid-flight overrides leave it blank)
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__cogridReady===true', { timeout: 120000, polling: 500 }).catch(() => {})
await sleep(4000) // let the post-mount render burst finish before X input
// snapshot the statewide resting view — the outro flies back to it
const home = await page.evaluate(() => {
  const c = window.__cogridControls
  return c ? { tx: c.target.x, tz: c.target.z, zoom: c.object.zoom } : null
})

for (const s of segs) {
  const t0 = Date.now()
  marks.push({ id: s.id, start_ms: t0 })
  console.log(`[seg ${s.id}] ${s.action} (target ${s.dur_s}s)`)
  try { await actions[s.action](page, home) } catch (e) { console.log(`  action error: ${e.message}`) }
  const pad = s.dur_s * 1000 - (Date.now() - t0)
  if (pad > 0) await sleep(pad)
  marks[marks.length - 1].end_ms = Date.now()
}
fs.writeFileSync('/tmp/demo_marks.json', JSON.stringify(marks, null, 2))
console.log('done — marks in /tmp/demo_marks.json')
await browser.disconnect()
