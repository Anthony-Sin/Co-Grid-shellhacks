import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
await page.evaluate(() => document.querySelector('.snap')?.scrollIntoView({block:'center'}))
await new Promise(r=>setTimeout(r,2500))
await page.screenshot({path:'/tmp/snap_ov1.png'})
console.log('done')
b.disconnect()
