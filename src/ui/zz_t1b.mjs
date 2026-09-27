// zz_t1b.mjs — TEST 1b: find the OV-0019 selection message + chips, top4 selected class
import { conn, findPage, ev } from './zz_conn.mjs'

const { b } = await conn()
const page = await findPage(b)

const r = await ev(page, () => {
  const selMsgs = [...document.querySelectorAll('.agent-msg.selection')].map((m, i) => ({
    i,
    head: m.querySelector('.selmsg-head')?.textContent?.trim(),
    tags: [...m.querySelectorAll('.selmsg-tag')].map((x) => x.textContent.trim()),
    chips: [...m.querySelectorAll('.sel-chips button')].map((x) => ({
      label: x.textContent.trim(), disabled: x.disabled,
    })),
  }))
  const allMsgs = [...document.querySelectorAll('.agent-log .agent-msg')].map((m, i) => ({
    i, cls: m.className, text: m.innerText.slice(0, 140).replace(/\n/g, ' ¶ '),
  }))
  const s = window.__cogridStore.getState()
  const top4 = [...document.querySelectorAll('.pnl-top4-row .pnl-top4-btn')].map((x) => ({
    id: x.querySelector('.pnl-top4-id')?.textContent?.trim(),
    cls: x.className,
    boxShadow: getComputedStyle(x).boxShadow,
  }))
  const selRow = document.querySelector('.overlap-row.is-selected')
  return {
    selectedOverlapId: s.selectedOverlapId,
    nSelMsgs: selMsgs.length,
    selMsgs,
    allMsgsTail: allMsgs.slice(-6),
    nMsgs: allMsgs.length,
    top4,
    selRow: selRow ? {
      ovid: selRow.getAttribute('data-ovid'),
      boxShadow: getComputedStyle(selRow).boxShadow,
      bg: getComputedStyle(selRow).background,
    } : null,
  }
})
console.log(JSON.stringify(r, null, 1))
b.disconnect()
