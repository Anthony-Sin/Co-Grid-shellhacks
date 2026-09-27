import p from 'puppeteer-core'
const b = await p.connect({browserURL:'http://127.0.0.1:9222'})
const page = (await b.pages()).find(x=>x.url().includes('3210'))
const r = await page.evaluate(() => {
  const search = document.querySelector('.pnl-search')?.value
  const stats = document.querySelector('[class*="count"], .pnl-count, [class*="matches"]')?.textContent
  // find all checkbox states + tier buttons
  const tiers = [...document.querySelectorAll('button')].filter(b=>/tier [1-4]|touching|<1|<8|<40|shared|crew|logistic/i.test(b.textContent||'')).map(b=>({t:b.textContent.trim().slice(0,30), on:b.getAttribute('aria-pressed'), cls:b.className}))
  const cbs = [...document.querySelectorAll('input[type=checkbox]')].map(c=>({checked:c.checked, label:c.closest('label')?.textContent?.trim().slice(0,30)}))
  const listRows = [...document.querySelectorAll('.pnl-list *')].length
  return {search, stats, tiers, cbs, listRows}
})
console.log(JSON.stringify(r,null,1))
b.disconnect()
