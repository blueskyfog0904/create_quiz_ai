const { chromium } = require('playwright')

async function main() {
  const targetUrl = process.argv[2] || 'http://127.0.0.1:4000/english/library/exam-papers/374660a7-1b24-4e71-8fe6-54c89e507a67'
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
  console.log(JSON.stringify({ title: await page.title(), url: page.url() }, null, 2))
  await page.screenshot({ path: 'output_playwright_workspace.png', fullPage: true })
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
