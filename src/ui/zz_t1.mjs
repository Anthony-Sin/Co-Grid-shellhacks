// zz_t1.mjs — TEST 1: select OV-0019, detail card, top-picks, action chips
import { conn, sleep, until, resetStore, findPage, ev } from './zz_conn.mjs'

const { b } = await conn()
let page = await findPage(b)
console.log('page:', page.url())

await resetStore(page)
await sleep(800)

// --- select OV-0019 via the store (re-apply if a reload wipes state) ---
let ready = false
for (let attempt = 0; attempt < 4 && !ready; attempt++) {
  await ev(page, () => {
    const s = window.__cogridStore.getState()
    if (s.selectedOverlapId !== 'OV-0019') s.selectOverlap('OV-0019')
  })
  ready = !!(await until(page, () =>
    document.querySelector('.overlap-detail .detail-id')?.textContent === 'OV-0019' &&
    !!document.querySelector('.agent-msg.selection .sel-chips'),
    45000))
  if (!ready) page = await findPage(b)
}
console.log('detail+selmsg ready:', ready)
await sleep(1500) // let kv/nearby/impact rows fill in

const r = await ev(page, () => {
  const s = window.__cogridStore.getState()
  const d = document.querySelector('.overlap-detail')
  const sel = document.querySelector('.agent-msg.selection')
  const top4 = [...document.querySelectorAll('.pnl-top4-row .pnl-top4-btn')]
  const chips = [...(sel?.querySelectorAll('.sel-chips button') ?? [])].map((x) => ({
    label: x.textContent.trim(),
    disabled: x.disabled,
    title: x.title,
  }))
  return {
    store: {
      selectedOverlapId: s.selectedOverlapId,
      selectedProjectId: s.selectedProjectId,
      focusTarget: s.focusTarget,
      agentPromptDraft: s.agentPromptDraft,
      agentContext: s.agentContext,
    },
    detail: d ? {
      id: d.querySelector('.detail-id')?.textContent,
      tier: d.querySelector('.ov-tier')?.textContent?.trim(),
      rank: d.querySelector('.detail-rank')?.textContent?.trim(),
      projNames: [...d.querySelectorAll('.proj-name')].map((x) => x.textContent.trim()),
      kvText: [...d.querySelectorAll('.detail-section')].map((x) => x.innerText.replace(/\n+/g, ' | ')),
      fullText: d.innerText.slice(0, 2600),
    } : null,
    agentSel: document.querySelector('.agent-sel')?.textContent?.trim(),
    top4: top4.map((x) => ({
      id: x.querySelector('.pnl-top4-id')?.textContent?.trim(),
      km: x.querySelector('.pnl-top4-km')?.textContent?.trim(),
      rank: x.querySelector('.pnl-top4-rank')?.textContent?.trim(),
      cls: x.className,
    })),
    selMsg: sel ? {
      head: sel.querySelector('.selmsg-head')?.textContent?.trim(),
      sub: sel.querySelector('.selmsg-sub')?.textContent?.trim(),
      tags: [...sel.querySelectorAll('.selmsg-tag')].map((x) => x.textContent.trim()),
      chips,
    } : null,
    navButtons: [...document.querySelectorAll('.detail-navbtn')].map((x) => ({
      aria: x.getAttribute('aria-label'), disabled: x.disabled, text: x.textContent,
    })),
    reportBtn: !!document.querySelector('.detail-report'),
    askBtn: !!document.querySelector('.detail-ask'),
  }
})
console.log(JSON.stringify(r, null, 1))
b.disconnect()
