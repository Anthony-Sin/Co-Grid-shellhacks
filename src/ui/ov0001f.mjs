import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
const r = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('aside, section, [class*="pnl"], [class*="panel"], [class*="list"]')]
  return panels.filter(e=>e.className && /list|pnl|panel/i.test(e.className.toString())).slice(0,12).map(e=>({tag:e.tagName, cls:e.className.toString().slice(0,60), kids:e.children.length}))
})
console.log(JSON.stringify(r,null,1))
b.disconnect()
