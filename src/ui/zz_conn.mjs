// zz_conn.mjs — shared CDP connect helper for CO-GRID tests (scratch, delete later)
import p from 'puppeteer-core'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function conn() {
  const b = await p.connect({ browserURL: 'http://127.0.0.1:9222' })
  const page = await findPage(b)
  return { b, page }
}

export async function findPage(b, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const page = (await b.pages()).find((x) => x.url().includes('3210'))
    if (page) {
      try {
        await page.evaluate(() => !!window.__cogridStore)
        return page
      } catch {
        /* context mid-destroy — retry */
      }
    }
    await sleep(1000)
  }
  const urls = (await b.pages()).map((x) => x.url())
  throw new Error('no live page on :3210 — pages: ' + JSON.stringify(urls))
}

// evaluate that survives a mid-flight navigation/context swap
export async function ev(page, fn, arg) {
  try {
    return await page.evaluate(fn, arg)
  } catch (e) {
    if (/context was destroyed|Cannot find context|Inspected target navigated/i.test(String(e))) {
      return undefined
    }
    throw e
  }
}

// poll a page-side predicate until truthy or timeout; returns last value
export async function until(page, fn, timeout = 60000, step = 700) {
  const t0 = Date.now()
  let v
  while (Date.now() - t0 < timeout) {
    v = await ev(page, fn)
    if (v) return v
    await sleep(step)
  }
  return v
}

// reset store to default-ish state (filters cleared, no selection)
export async function resetStore(page) {
  await ev(page, () => {
    const s = window.__cogridStore.getState()
    s.selectOverlap(null)
    s.selectProject(null)
    s.setSearchText('')
    s.setZoneFilter('')
    s.setUtilityFilter([])
    s.setVisibleTiers({ 1: true, 2: true, 3: true, 4: true })
    s.setTimelineOnly(true)
    s.setYearFilter(null)
    s.setHoveredOverlap(null)
    s.setPanelOpen(true)
    if (!s.layers.basemap) s.toggleLayer('basemap')
    if (!s.layers.projects) s.toggleLayer('projects')
    if (!s.layers.labels) s.toggleLayer('labels')
  })
}
