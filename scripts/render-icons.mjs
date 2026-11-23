// Renders public/icon.svg to the PNG icons the app and manifest use.
// Usage: node scripts/render-icons.mjs   (needs Chrome; set CHROME to override)
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#000">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png);
  console.log(`icon-${size}.png`);
}
await browser.close();
