import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
await page.evaluate(() => {
  window.__cogridStore.getState().setSearchText('')
  window.__cogridStore.getState().selectOverlap('OV-0001')
})
await new Promise(r=>setTimeout(r,6000))
const r = await page.evaluate(() => document.querySelector('.overlap-detail')?.innerText.slice(0,1600) ?? 'no detail')
console.log(r)
b.disconnect()
