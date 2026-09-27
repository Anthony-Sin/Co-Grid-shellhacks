// zz_watch.mjs — passive store watcher: log any selection/focus changes for ~25s
import { conn, findPage, sleep, ev } from './zz_conn.mjs'

const { b } = await conn()
const page = await findPage(b)
console.log('page:', page.url())

await ev(page, () => {
  window.__zzLog = []
  window.__cogridStore.subscribe((s, prev) => {
    const diff = {}
    for (const k of ['selectedOverlapId', 'selectedProjectId', 'focusTarget', 'activeScene',
      'agentPromptDraft', 'agentContext', 'hoveredOverlapId', 'hoveredProjectId',
      'panelOpen', 'timelineOnly', 'zoneFilter', 'searchText']) {
      if (JSON.stringify(s[k]) !== JSON.stringify(prev[k])) diff[k] = [prev[k], s[k]]
    }
    for (const k of ['visibleTiers', 'layers', 'utilityFilter', 'yearFilter']) {
      if (JSON.stringify(s[k]) !== JSON.stringify(prev[k])) diff[k] = [prev[k], s[k]]
    }
    if (Object.keys(diff).length) window.__zzLog.push({ t: Date.now(), diff })
  })
})

for (let i = 0; i < 5; i++) {
  await sleep(5000)
  const log = await ev(page, () => {
    const l = window.__zzLog.splice(0)
    return { log: l, sel: window.__cogridStore.getState().selectedOverlapId, url: location.href }
  })
  if (log) {
    console.log(`--- t+${(i + 1) * 5}s sel=${log.sel} url=${log.url}`)
    for (const e of log.log) console.log('   ', JSON.stringify(e.diff))
  } else {
    console.log(`--- t+${(i + 1) * 5}s [evaluate failed/nav]`)
    page = await findPage(b)
  }
}
b.disconnect()
