const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', (request) =>
    console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText),
  );
  await page.goto('http://localhost:5274/dev/sandbox');
  await new Promise((r) => setTimeout(r, 2000));
  await browser.close();
})();
