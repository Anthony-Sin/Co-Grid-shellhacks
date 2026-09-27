#!/usr/bin/env node
/**
 * record_take3.mjs — export + outro beats:
 *   setup  — reload, metrics override, fly camera to OV-0004 corridor
 *   export — click the rail CSV export (real /api/overlaps.csv
 *            download), open the product's HTML overlap report in a
 *            new tab, dwell, close back to the map
 *   close  — deselect + ease camera back to the resting statewide pose
 *            via direct camera writes + __cogridInvalidate (controls
 *            .update() would snap the pose back via damping)
 * Writes /tmp/demo_marks3.json.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const CDP = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mouse = (x, y) => execSync(`DISPLAY=:99 xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)

const marks = []
const browser = await puppeteer.connect({ browserURL: CDP })
const page = (await browser.pages()).find((p) => p.url().includes('3210'))
await page.bringToFront()
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
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

// setup: fly to the Savannah corridor so the outro has somewhere to pull out from
await page.evaluate(() => window.__cogridStore.getState().selectOverlap('OV-0004'))
await sleep(5000)

const mark = (id, fn) => async () => {
  const t0 = Date.now()
  marks.push({ id, start_ms: t0 })
  try { await fn() } catch (e) { console.log(`  [${id}] error: ${e.message}`) }
  marks[marks.length - 1].end_ms = Date.now()
  console.log(`[seg ${id}] ${((marks[marks.length - 1].end_ms - t0) / 1000).toFixed(1)}s`)
}

await mark('export', async () => {
  const a = await page.$('a[href*="overlaps.csv"]')
  if (a) {
    const r = await a.boundingBox()
    if (r) { mouse(r.x + r.width / 2, r.y + r.height / 2); await sleep(300); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2) }
  }
  await sleep(2500) // download lands in ~/Downloads
  // open the product's own HTML report — a real generated deliverable
  const report = execSync('ls -t /home/ANT/projects/Co-Grid-shellhacks/exports/*.html | head -1').toString().trim()
  console.log('  report:', report)
  const tab = await browser.newPage()
  await tab.goto('file://' + report, { waitUntil: 'load' })
  await sleep(6000) // report reads on camera
  await tab.close()
  await page.bringToFront()
  await sleep(1200)
})()

await mark('close', async () => {
  await page.evaluate(() => window.__cogridStore?.getState().selectOverlap(null)).catch(() => {})
  await sleep(400)
  if (home) {
    await page.evaluate((h) => {
      const c = window.__cogridControls
      const cam = c.object
      const from = c.target.clone(), z0 = cam.zoom
      const t0 = performance.now()
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 2000)
        const e = 1 - Math.pow(1 - k, 3)
        const d = c.target.clone()
        c.target.set(from.x + (h.tx - from.x) * e, 0, from.z + (h.tz - from.z) * e)
        d.sub(c.target)
        cam.position.sub(d)
        cam.zoom = z0 + (h.zoom - z0) * e
        cam.updateProjectionMatrix()
        window.__cogridInvalidate?.()
        if (k < 1) requestAnimationFrame(step)
      }
      step()
    }, home).catch((e) => console.log('  fly err:', e.message))
  }
  await sleep(4000)
  await mouse(700, 450)
  await sleep(1500)
})()

fs.writeFileSync('/tmp/demo_marks3.json', JSON.stringify(marks, null, 2))
console.log('done — marks3 written')
await browser.disconnect()
