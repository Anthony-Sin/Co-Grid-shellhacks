import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
const r = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')].filter(e => e.children.length===0 && /^OV-\d/.test(e.textContent?.trim()||''))
  return all.slice(0,10).map(e => ({tag: e.tagName, cls: e.className, txt: e.textContent.trim().slice(0,20), parent: e.parentElement?.className?.toString().slice(0,40)}))
})
console.log(JSON.stringify(r,null,1))
b.disconnect()
