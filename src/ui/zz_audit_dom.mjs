// zz_audit_dom.mjs — initial DOM/chrome audit for CO-GRID (scratch)
import { conn, ev, sleep } from './zz_conn.mjs'

const { b, page } = await conn()

// collect console + page errors
const logs = []
page.on('console', (m) => {
  const t = m.type()
  if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) =>
  logs.push(`[reqfail] ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ''}`),
)

await page.setViewport({ width: 1600, height: 900 })
await sleep(2500) // let layout settle + stores hydrate

const info = await ev(page, () => {
  const out = {}
  out.viewport = { w: innerWidth, h: innerHeight }
  out.url = location.href

  // ---- chrome elements: rects + stacking ----
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom },
      z: cs.zIndex, pos: cs.position, bg: cs.backgroundColor, color: cs.color,
      opacity: cs.opacity, overflowY: cs.overflowY,
      clientH: el.clientHeight, scrollH: el.scrollHeight,
    }
  }
  out.headerBar = pick('.header-bar')
  out.headerStats = pick('.header-stats')
  out.panel = pick('.panel')
  out.panelReopen = pick('.panel-reopen')
  out.agentRail = pick('.agent-rail')
  out.agentBarToggle = pick('.agent-bar-toggle')
  out.viewmodesWrap = pick('.viewmodes-wrap')
  out.labelOverlay = pick('.label-overlay')
  out.canvasWrap = pick('.canvas-wrap')

  // ---- all visible top-layer elements ----
  const layerInfo = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if ((cs.position === 'fixed' || cs.position === 'absolute') && el.getBoundingClientRect().width > 0) {
      const r = el.getBoundingClientRect()
      const cls = (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 60)
      layerInfo.push({
        sel: el.tagName.toLowerCase() + (cls ? '.' + cls.split(' ')[0] : ''),
        cls,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        z: cs.zIndex, pos: cs.position,
      })
    }
  }
  out.absEls = layerInfo

  // ---- agent chips ----
  const chips = document.querySelector('.agent-chips')
  if (chips) {
    const cs = getComputedStyle(chips)
    const btns = [...chips.querySelectorAll('button')]
    const chipRect = chips.getBoundingClientRect()
    const rows = new Map()
    for (const btn of btns) {
      const r = btn.getBoundingClientRect()
      const fullyVisible = r.top >= chipRect.top - 1 && r.bottom <= chipRect.bottom + 1
      const key = Math.round(r.top)
      rows.set(key, (rows.get(key) ?? 0) + 1)
      btn.dataset.__vis = fullyVisible ? '1' : '0'
    }
    out.chips = {
      count: btns.length,
      labels: btns.map((x) => x.textContent.trim()),
      clientH: chips.clientHeight, scrollH: chips.scrollHeight,
      maxH: cs.maxHeight, overflowY: cs.overflowY, flexWrap: cs.flexWrap,
      visibleRows: [...rows.entries()].filter(([top]) => top < chipRect.bottom - 4),
      allRows: [...rows.keys()],
      chipRect: { top: chipRect.top, bottom: chipRect.bottom },
      visFlags: btns.map((x) => ({ t: x.textContent.trim(), vis: x.dataset.__vis, top: Math.round(x.getBoundingClientRect().top), h: Math.round(x.getBoundingClientRect().height) })),
    }
  } else out.chips = null

  // ---- agent log / rail scroll ----
  const log = document.querySelector('.agent-log')
  out.agentLog = log ? {
    clientH: log.clientHeight, scrollH: log.scrollHeight,
    overflowY: getComputedStyle(log).overflowY,
  } : null
  const rail = document.querySelector('.agent-rail')
  if (rail) {
    const r = rail.getBoundingClientRect()
    out.railRect = { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }
    out.railOverflow = getComputedStyle(rail).overflow
  }

  // ---- anything painted at top-right ----
  const tr = []
  for (const el of document.elementsFromPoint(innerWidth - 20, 30)) {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    tr.push({
      sel: el.tagName.toLowerCase() + '.' + (el.className?.baseVal ?? el.className ?? '').toString().split(' ')[0],
      z: cs.zIndex, bg: cs.backgroundColor.slice(0, 60), color: cs.color,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    })
  }
  out.topRightStack = tr

  // ---- teammate/collab/assignee text hunt ----
  const bodyText = document.body.innerText
  const hits = []
  for (const pat of [/teammate/gi, /collab\w*/gi, /assignee/gi, /assigned to/gi, /partner/gi, /n\/a/gi]) {
    let m
    while ((m = pat.exec(bodyText))) {
      hits.push({ pat: pat.source, idx: m.index, ctx: bodyText.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\n/g, ' | ') })
    }
  }
  out.textHits = hits.slice(0, 40)

  // ---- store state ----
  const s = window.__cogridStore?.getState?.()
  out.store = s ? {
    keys: Object.keys(s).filter((k) => typeof s[k] !== 'function').slice(0, 60),
    layers: s.layers, panelOpen: s.panelOpen, mapStyle: s.mapStyle,
    selectedOverlapId: s.selectedOverlapId, activeScene: s.activeScene,
  } : null

  return out
})

console.log(JSON.stringify(info, null, 1))
console.log('--- console/page log lines ---')
for (const l of logs.slice(0, 60)) console.log(l)

b.disconnect()
