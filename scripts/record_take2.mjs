#!/usr/bin/env node
/**
 * record_take2.mjs — second-take segments for the demo edit:
 *   agent   — type "zoom to Macon", camera flight + streamed reply
 *   export  — click the rail CSV export (real /api/overlaps.csv
 *             download), open the downloaded file in LibreOffice,
 *             dwell so the sheet paints, then close it
 *   close   — clear selection + ease camera back to the statewide
 *             resting pose captured after setup
 * Writes /tmp/demo_marks2.json (epoch ms per segment).
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const CDP = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mouse = (x, y) => execSync(`DISPLAY=:99 xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)

async function centerOf(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, sel)
}

const marks = []
const browser = await puppeteer.connect({ browserURL: CDP })
const page = (await browser.pages()).find((p) => p.url().includes('3210'))
await page.bringToFront()
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
// downloads must land in ~/Downloads — chromium kiosk otherwise prompts
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/home/ANT/Downloads' }).catch(() =>
  cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/home/ANT/Downloads' }).catch(() => {}))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__cogridReady===true', { timeout: 120000, polling: 500 }).catch(() => {})
await sleep(4000)

const home = await page.evaluate(() => {
  const c = window.__cogridControls
  return c ? { tx: c.target.x, tz: c.target.z, zoom: c.object.zoom } : null
})
console.log('home:', JSON.stringify(home))

const mark = (id, fn) => async () => {
  const t0 = Date.now()
  marks.push({ id, start_ms: t0 })
  try { await fn() } catch (e) { console.log(`  [${id}] error: ${e.message}`) }
  marks[marks.length - 1].end_ms = Date.now()
  console.log(`[seg ${id}] ${((marks[marks.length - 1].end_ms - t0) / 1000).toFixed(1)}s`)
}

await mark('agent', async () => {
  const c = await centerOf(page, '.agent-input textarea')
  if (c) { mouse(c.x, c.y); await sleep(250) }
  await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
  await page.keyboard.type('zoom to Macon', { delay: 60 })
  const typed = await page.evaluate(() => document.querySelector('.agent-input textarea')?.value ?? '')
  if (!typed.includes('Macon')) {
    await page.evaluate(() => document.querySelector('.agent-input textarea')?.focus())
    await page.keyboard.type('zoom to Macon', { delay: 60 })
  }
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(13000) // flight + tool calls + streamed reply on screen
})()

await mark('export', async () => {
  const before = fs.readdirSync('/home/ANT/Downloads').filter((f) => f.endsWith('.csv'))
  const a = await page.$('a[href*="overlaps.csv"]')
  if (a) {
    const r = await a.boundingBox()
    if (r) { mouse(r.x + r.width / 2, r.y + r.height / 2); await sleep(300); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2) }
  }
  await sleep(4000) // download lands
  const after = fs.readdirSync('/home/ANT/Downloads').filter((f) => f.endsWith('.csv'))
  const fresh = after.filter((f) => !before.includes(f))
  const target = fresh[0] || after.sort().pop()
  console.log('  csv:', target || 'NONE')
  if (target) execSync(`DISPLAY=:99 setsid libreoffice --norestore --view '/home/ANT/Downloads/${target}' >/dev/null 2>&1 &`)
  await sleep(11000) // Calc imports + paints the sheet on camera
  execSync('pkill -f "soffic[e]" 2>/dev/null || true')
  await sleep(2000)
})()

await mark('close', async () => {
  await page.evaluate(() => window.__cogridStore?.getState().selectOverlap(null)).catch(() => {})
  if (home) {
    await page.evaluate((h) => {
      const c = window.__cogridControls
      const cam = c.object
      const from = c.target.clone(), z0 = cam.zoom
      const t0 = performance.now()
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 1800)
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
    }, home).catch((e) => console.log('  fly err:', e.message))
  }
  await sleep(5000)
  await mouse(700, 450)
  await sleep(1500)
})()

fs.writeFileSync('/tmp/demo_marks2.json', JSON.stringify(marks, null, 2))
console.log('done — marks2 written')
await browser.disconnect()
