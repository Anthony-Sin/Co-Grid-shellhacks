import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
await page.evaluate(() => {
  const inp = document.querySelector('.pnl-search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, 'OV-0001')
  inp.dispatchEvent(new Event('input', {bubbles:true}))
})
await new Promise(r=>setTimeout(r,2000))
// click the matching list row
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(r => r.children.length===0 && r.textContent?.trim()==='OV-0001')
  if (!el) return 'no el'
  const row = el.closest('[class*="row"],tr,li,button')
  row?.click()
  return 'clicked ' + (row?.className||row?.tagName)
})
console.log(clicked)
await new Promise(r=>setTimeout(r,5000))
const r = await page.evaluate(() => document.querySelector('.overlap-detail')?.innerText.slice(0,1400) ?? 'no detail')
console.log(r)
b.disconnect()
