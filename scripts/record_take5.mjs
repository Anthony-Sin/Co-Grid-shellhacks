#!/usr/bin/env node
/**
 * record_take5.mjs — reshoot of the corridor/export/outro beats.
 *  sav     — select OV-0004, POLL the camera until the FocusRig flight
 *            actually arrives (zoom settles) — kills the dead zone
 *  pick    — click the top pick, wait for the detail card to populate
 *  export  — rail CSV click, then open the UNFILTERED html report
 *            (timeline_only only — the full ranked coordination set)
 *  close   — deselect + camera home via direct writes +
 *            __cogridInvalidate (controls.update() snaps back)
 * Writes /tmp/demo_marks5.json
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

const zoomNow = () => page.evaluate(() => window.__cogridControls?.object?.zoom ?? -1)
/** wait until the camera zoom holds steady near corridor level */
async function waitArrived(maxMs = 25000) {
  const t0 = Date.now()
  let last = -1, still = 0
  while (Date.now() - t0 < maxMs) {
    const z = await zoomNow()
    if (z > 0.05 && Math.abs(z - last) < 0.005) { still++; if (still >= 3) return z }
    else still = 0
    last = z
    await sleep(600)
  }
  return last
}

const mark = (id, fn) => async () => {
  const t0 = Date.now()
  marks.push({ id, start_ms: t0 })
  try { await fn() } catch (e) { console.log(`  [${id}] error: ${e.message}`) }
  marks[marks.length - 1].end_ms = Date.now()
  console.log(`[seg ${id}] ${((marks[marks.length - 1].end_ms - t0) / 1000).toFixed(1)}s`)
}

await mark('sav', async () => {
  await page.evaluate(() => window.__cogridStore.getState().selectOverlap('OV-0004'))
  const z = await waitArrived()
  console.log('  arrived at zoom', z)
  await sleep(3500) // dwell on the corridor + zone hatch + crossing lines
})()

await mark('pick', async () => {
  const c = await page.evaluate(() => {
    const b = document.querySelector('.top-picks button')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (c) { mouse(c.x, c.y); await sleep(300); await page.mouse.click(c.x, c.y) }
  await sleep(2000)
  await waitArrived()
  // wait for the detail card to finish populating
  await page.waitForFunction(() =>
    !document.body.textContent.includes('loading overlap detail'), { timeout: 20000 }).catch(() => {})
  await sleep(3500) // card + snapshot on screen
})()

await mark('export', async () => {
  const a = await page.$('a[href*="overlaps.csv"]')
  if (a) {
    const r = await a.boundingBox()
    if (r) { mouse(r.x + r.width / 2, r.y + r.height / 2); await sleep(300); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2) }
  }
  await sleep(2500)
  const report = '/home/ANT/projects/Co-Grid-shellhacks/exports/co-grid-overlaps-20260927-082040.html'
  const tab = await browser.newPage()
  await tab.goto('file://' + report, { waitUntil: 'load' })
  await sleep(6000)
  await tab.close()
  await page.bringToFront()
  await sleep(1500)
})()

await mark('close', async () => {
  await page.evaluate(() => window.__cogridStore?.getState().selectOverlap(null)).catch(() => {})
  await sleep(400)
  if (home) {
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
  }
  await sleep(3500)
  await mouse(700, 450)
  await sleep(1200)
})()

fs.writeFileSync('/tmp/demo_marks5.json', JSON.stringify(marks, null, 2))
console.log('done — marks5 written')
await browser.disconnect()
