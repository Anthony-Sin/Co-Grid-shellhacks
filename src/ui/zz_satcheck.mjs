import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
await page.evaluate(() => window.__cogridStore.getState().selectOverlap('OV-0001'))
await new Promise(r=>setTimeout(r,9000))
const r = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.snap svg image')]
  return { n: imgs.length, data: imgs.filter(i=>i.getAttribute('href')?.startsWith('data:')).length,
           sel: document.querySelector('.detail-id')?.textContent }
})
console.log(JSON.stringify(r))
b.disconnect()
