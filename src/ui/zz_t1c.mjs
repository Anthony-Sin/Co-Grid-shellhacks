// zz_t1c.mjs — TEST 1 actions: Zoom to site, ✦ ask draft, Explain chip, Export CSV chip
import { conn, sleep, until, findPage, ev } from './zz_conn.mjs'

const { b } = await conn()
let page = await findPage(b)

const out = {}

// make sure OV-0019 is the live selection
await ev(page, () => {
  const s = window.__cogridStore.getState()
  if (s.selectedOverlapId !== 'OV-0019') s.selectOverlap('OV-0019')
})
await sleep(1200)

// helper: find the OV-0019 selection message's chips
const chipInfo = () => ev(page, () => {
  const msgs = [...document.querySelectorAll('.agent-msg.selection')]
  const m = msgs.find((x) => x.querySelector('.selmsg-head')?.textContent.includes('OV-0019'))
  if (!m) return null
  return [...m.querySelectorAll('.sel-chips button')].map((x) => ({
    label: x.textContent.trim(), disabled: x.disabled,
  }))
})
console.log('OV-0019 chips before:', JSON.stringify(await chipInfo()))

// ---------- (a) Zoom to site ----------
const camBefore = await ev(page, () => ({
  zoom: window.__cogridCamera?.zoom,
  pos: window.__cogridCamera ? [window.__cogridCamera.position.x, window.__cogridCamera.position.y, window.__cogridCamera.position.z] : null,
  tgt: window.__cogridControls ? [window.__cogridControls.target.x, window.__cogridControls.target.y, window.__cogridControls.target.z] : null,
  ft: window.__cogridStore.getState().focusTarget,
}))
await ev(page, () => {
  const msgs = [...document.querySelectorAll('.agent-msg.selection')]
  const m = msgs.find((x) => x.querySelector('.selmsg-head')?.textContent.includes('OV-0019'))
  const btn = [...m.querySelectorAll('.sel-chips button')].find((x) => x.textContent.trim() === 'Zoom to site')
  btn?.click()
})
await sleep(400)
const ftAfter = await ev(page, () => window.__cogridStore.getState().focusTarget)
// poll camera zoom — flight eases toward 0.35
const camAfter = await until(page, () => {
  const z = window.__cogridCamera?.zoom
  return z > 0.1 ? { zoom: z, tgt: [window.__cogridControls.target.x, window.__cogridControls.target.z] } : null
}, 60000, 1500)
out.zoomToSite = { camBefore, focusTargetAfterClick: ftAfter, camAfter }
console.log('zoom-to-site:', JSON.stringify(out.zoomToSite))

// ---------- (b) ✦ ask button -> agentPromptDraft -> input + pinned context ----
await ev(page, () => {
  window.__zzDraft = '<<unset>>'
  const unsub = window.__cogridStore.subscribe((s) => {
    if (s.agentPromptDraft) window.__zzDraft = s.agentPromptDraft
  })
  window.__zzUnsub = unsub
})
await ev(page, () => document.querySelector('.detail-ask')?.click())
await sleep(900)
out.askBtn = await ev(page, () => ({
  capturedDraft: window.__zzDraft,
  storeDraft: window.__cogridStore.getState().agentPromptDraft,
  agentContext: window.__cogridStore.getState().agentContext,
  inputVal: document.querySelector('.agent-input textarea')?.value,
  contextChip: document.querySelector('.agent-context')?.textContent?.trim(),
}))
await ev(page, () => window.__zzUnsub?.())
console.log('ask-button:', JSON.stringify(out.askBtn))
// clear the prefilled input so it doesn't linger for later tests
await ev(page, () => {
  const ta = document.querySelector('.agent-input textarea')
  if (ta) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
})

// ---------- (c) Explain this overlap ----------
await ev(page, () => {
  const msgs = [...document.querySelectorAll('.agent-msg.selection')]
  const m = msgs.find((x) => x.querySelector('.selmsg-head')?.textContent.includes('OV-0019'))
  const btn = [...m.querySelectorAll('.sel-chips button')].find((x) => x.textContent.trim() === 'Explain this overlap')
  btn?.click()
})
// wait for the run to finish: an assistant msg after the user msg, no busy indicator
const explainDone = await until(page, () => {
  const log = document.querySelector('.agent-log')
  if (!log) return null
  const msgs = [...log.querySelectorAll('.agent-msg')]
  const uIdx = msgs.findIndex((x) => x.classList.contains('user') && x.innerText.includes('Explain overlap OV-0019'))
  if (uIdx < 0) return null
  const busy = !!document.querySelector('.agent-stop') || !!log.querySelector('.agent-thinking') || !!log.querySelector('.agent-progress')
  if (busy) return null
  const after = msgs.slice(uIdx + 1).map((x) => ({ cls: x.className, text: x.innerText.slice(0, 1200) }))
  return after.length ? after : null
}, 240000, 2500)
out.explain = explainDone
console.log('explain replies:', JSON.stringify(explainDone)?.slice(0, 1600))

// ---------- (d) Export overlap CSV ----------
const chipsNow = await chipInfo()
console.log('OV-0019 chips after explain:', JSON.stringify(chipsNow))
await ev(page, () => {
  const msgs = [...document.querySelectorAll('.agent-msg.selection')]
  const m = msgs.find((x) => x.querySelector('.selmsg-head')?.textContent.includes('OV-0019'))
  const btn = [...m.querySelectorAll('.sel-chips button')].find((x) => x.textContent.trim() === 'Export overlap CSV')
  btn?.click()
})
const exportDone = await until(page, () => {
  const log = document.querySelector('.agent-log')
  if (!log) return null
  const msgs = [...log.querySelectorAll('.agent-msg')]
  const uIdx = msgs.findIndex((x) => x.classList.contains('user') && x.innerText.includes('Export the'))
  if (uIdx < 0) return null
  const busy = !!document.querySelector('.agent-stop') || !!log.querySelector('.agent-thinking') || !!log.querySelector('.agent-progress')
  if (busy) return null
  const after = msgs.slice(uIdx + 1).map((x) => ({
    cls: x.className,
    text: x.innerText.slice(0, 1500),
    links: [...x.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })),
  }))
  return after.length ? after : null
}, 240000, 2500)
out.export = exportDone
console.log('export replies:', JSON.stringify(exportDone)?.slice(0, 2000))

// if a CSV link appeared, fetch it and peek at the content
if (exportDone) {
  const href = exportDone.flatMap((m) => m.links).find((l) => l.href?.includes('export'))?.href
    ?? exportDone.flatMap((m) => m.links).find((l) => l.href?.endsWith('.csv'))?.href
  if (href) {
    const csv = await ev(page, async (u) => {
      const r = await fetch(u)
      const t = await r.text()
      return { status: r.status, ct: r.headers.get('content-type'), head: t.slice(0, 600), len: t.length, hasOV19: t.includes('OV-0019') }
    }, href)
    out.csvFetch = { href, ...csv }
    console.log('csv fetch:', JSON.stringify(out.csvFetch)?.slice(0, 900))
  }
}

out.finalStore = await ev(page, () => {
  const s = window.__cogridStore.getState()
  return { sel: s.selectedOverlapId, ft: s.focusTarget, ctx: s.agentContext }
})
console.log('final:', JSON.stringify(out.finalStore))
b.disconnect()
