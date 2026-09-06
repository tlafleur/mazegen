import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1300, height: 1500 } })
await p.goto('file://' + process.cwd() + '/.preview.html')
await p.screenshot({ path: process.argv[2] + '/objects.png', fullPage: true })
await b.close()
