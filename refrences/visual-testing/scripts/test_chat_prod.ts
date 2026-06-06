/** biome-ignore-all lint/suspicious/noConsole: Playwright test scripts use console for output */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture console
  page.on('console', (_msg) => {});
  await page.goto('http://localhost:4322/');
  await page.waitForSelector('#chat-chat', { timeout: 10000 });
  await page.waitForTimeout(3000);

  // Type and send
  await page.fill('#chat-input', 'What is Nordclaw?');
  await page.click('#chat-send');
  await page.waitForTimeout(5000);

  const _text = await page.locator('#chat-history').textContent();

  await browser.close();
}

main().catch(console.error);
