// zz_watch2.mjs — detect reloads + external store writes for ~60s
import { conn, findPage, sleep, ev } from './zz_conn.mjs'

const { b } = await conn()
let page = await findPage(b)

await ev(page, () => {
  window.__zzMark = 'MARK-' + Math.random().toString(36).slice(2)
  window.__zzLog = []
  window.__cogridStore.subscribe((s, prev) => {
    const diff = {}
    for (const k of Object.keys(s)) {
      if (typeof s[k] === 'function') continue
      if (JSON.stringify(s[k]) !== JSON.stringify(prev[k])) diff[k] = [prev[k], s[k]]
    }
    if (Object.keys(diff).length) window.__zzLog.push({ t: Date.now(), diff })
  })
  console.log('sentinel set', window.__zzMark)
})

for (let i = 0; i < 12; i++) {
  await sleep(5000)
  const r = await ev(page, () => ({
    mark: window.__zzMark ?? null,
    sel: window.__cogridStore?.getState?.().selectedOverlapId,
    navAge: Math.round(performance.now() / 1000),
    log: window.__zzLog?.splice(0) ?? null,
    nMsgs: document.querySelectorAll('.agent-log .agent-msg').length,
    detailId: document.querySelector('.overlap-detail .detail-id')?.textContent ?? null,
  }))
  if (!r) {
    console.log(`t+${(i + 1) * 5}s EVAL FAILED (nav/crash)`)
    page = await findPage(b)
    continue
  }
  console.log(`t+${(i + 1) * 5}s mark=${r.mark ?? 'GONE(reloaded!)'} navAge=${r.navAge}s sel=${r.sel} msgs=${r.nMsgs} detail=${r.detailId} changes=${r.log ? r.log.length : '?'}`)
  if (r.log) for (const e of r.log.slice(0, 12)) console.log('     ', JSON.stringify(e.diff).slice(0, 400))
}
b.disconnect()
