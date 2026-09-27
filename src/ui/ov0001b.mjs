import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i => /search/i.test(i.placeholder||'') || /search/i.test(i.getAttribute('aria-label')||''))
  if (inp) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, 'OV-0001')
    inp.dispatchEvent(new Event('input', {bubbles:true}))
  }
})
await new Promise(r=>setTimeout(r,2500))
const rows = await page.evaluate(() => [...document.querySelectorAll('[class*="row"],tr,li')].map(r=>r.textContent?.slice(0,60)).filter(t=>t?.includes('OV-')).slice(0,8))
console.log('rows:', JSON.stringify(rows))
await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(r => r.children.length===0 && r.textContent?.trim()==='OV-0001')
  el?.closest('[class*="row"],tr,li,button')?.click()
})
await new Promise(r=>setTimeout(r,5000))
const r = await page.evaluate(() => {
  const d = document.querySelector('.overlap-detail')
  return d ? d.innerText.slice(0, 900) : 'no detail'
})
console.log(r)
b.disconnect()
