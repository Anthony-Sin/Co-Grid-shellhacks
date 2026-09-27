import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
// reset filters first (list was empty)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find(b => /^reset filters$/i.test(b.textContent?.trim()||''))?.click()
})
await new Promise(r=>setTimeout(r,2500))
// select OV-0001 from the list
await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(r => r.children.length===0 && r.textContent?.trim()==='OV-0001')
  el?.closest('[class*="row"],tr,li,button,div[class*="item"]')?.click()
})
await new Promise(r=>setTimeout(r,6000))
const r = await page.evaluate(() => {
  const d = document.querySelector('.overlap-detail')
  if (!d) return 'no detail card'
  const text = d.innerText.slice(0, 1600)
  return text
})
console.log(r)
b.disconnect()
