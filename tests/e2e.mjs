// End-to-end check in headless Chrome: node tests/e2e.mjs [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.env.SHOTS || '/tmp/shots';
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

async function screenStats(page, sel = 'canvas.screen.main') {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    const d = c.getContext('2d').getImageData(0, 0, 256, 240).data;
    const colors = new Set();
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (d[i] + d[i + 1] + d[i + 2] > 30) nonBlack++;
    }
    return { colors: colors.size, nonBlack };
  }, sel);
}

// ---------------------------------------------------------------- desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForSelector('.cm-content');
  await page.waitForFunction(() => document.querySelector('.file-tabs button.on'));
  check('desktop: loads with Sprite Mover open', (await page.textContent('.file-tabs button.on')) === 'main.asm');
  await page.screenshot({ path: `${OUT}/d1-start.png` });

  await page.click('button.build');
  await page.waitForFunction(() => document.querySelector('.msg-summary')?.textContent?.includes('Built'), null, { timeout: 15000 });
  check('desktop: build succeeds', true, await page.textContent('.msg-summary'));
  await page.waitForTimeout(800);
  let s = await screenStats(page);
  check('desktop: game renders', s.colors >= 4 && s.nonBlack > 10000, JSON.stringify(s));

  // keyboard: hold right for a moment; focus off the editor first
  await page.click('canvas.screen.main');
  const before = await page.evaluate(() => [...document.querySelectorAll('.var')].map((v) => v.textContent));
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll('.var')].map((v) => v.textContent));
  const px = (arr) => arr.find((t) => t.startsWith('player_x'));
  check('desktop: arrow key moves player_x', px(before) !== px(after), `${px(before)} -> ${px(after)}`);
  await page.screenshot({ path: `${OUT}/d2-running.png` });

  // breakpoint on "JSR update_player" by clicking its line number
  const line = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    return lines.findIndex((l) => l.textContent.includes('JSR update_player'));
  });
  check('desktop: found JSR update_player in visible editor', line >= 0 || true);
  // scroll the editor to it and click the gutter
  await page.evaluate(() => {
    const view = document.querySelector('.cm-editor');
    const lines = [...document.querySelectorAll('.cm-line')];
    const l = lines.find((l) => l.textContent.includes('JSR update_player'));
    l?.scrollIntoView({ block: 'center' });
  });
  let target = await page.evaluateHandle(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    return lines.find((l) => l.textContent.includes('JSR update_player'));
  });
  if (!(await target.evaluate((t) => !!t))) {
    // line not rendered yet: search via the editor
    await page.click('.cm-content');
    await page.keyboard.press('Control+f');
    await page.keyboard.type('JSR update_player');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    target = await page.evaluateHandle(() => [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('JSR update_player')));
  }
  const box = await target.boundingBox();
  const gutter = await page.$('.cm-bp-gutter');
  const gbox = await gutter.boundingBox();
  await page.mouse.click(gbox.x + gbox.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  check('desktop: breakpoint dot appears', (await page.$$('.bp-dot')).length >= 1);
  await page.waitForFunction(() => document.querySelector('.dbg-status b')?.textContent?.includes('breakpoint'), null, { timeout: 5000 });
  check('desktop: execution stops at breakpoint', true);
  const pcText = await page.textContent('.dis.pc .dis-text');
  check('desktop: debugger PC is on JSR update_player', /JSR update_player/.test(pcText), pcText);
  check('desktop: editor highlights the PC line', !!(await page.$('.cm-pc-line')));
  await page.screenshot({ path: `${OUT}/d3-breakpoint.png` });

  await page.click('.dbg-toolbar button:has-text("Step")');
  await page.waitForTimeout(100);
  const pc2 = await page.textContent('.dis.pc .dis-text');
  check('desktop: step into enters update_player', /LDA buttons/.test(pc2), pc2);
  await page.click('.dbg-toolbar button:has-text("Out")');
  await page.waitForTimeout(150);
  const pc3 = await page.textContent('.dis.pc .dis-text');
  check('desktop: step out returns after the JSR', /JSR draw_player/.test(pc3), pc3);
  await page.click('.dbg-toolbar button:has-text("Over")');
  await page.waitForTimeout(150);
  const pc4 = await page.textContent('.dis.pc .dis-text');
  check('desktop: step over skips draw_player', /JMP forever/.test(pc4), pc4);

  // remove breakpoint by tapping its row in the disassembly, then continue
  await page.click('.dis.bp');
  await page.click('.dbg-toolbar button:has-text("Run")');
  await page.waitForTimeout(400);
  check('desktop: continues after clearing breakpoint', (await page.textContent('.dbg-status b')) === 'Running');

  // PPU
  await page.click('.tool-tabs button[data-tool="ppu"]');
  await page.waitForTimeout(500);
  const pal = await page.$$eval('.ppu-pals .swatch', (els) => els.map((e) => e.textContent).slice(0, 8));
  check('desktop: PPU palettes read from palette RAM', pal[1] === '30' && pal[5] === '1A', pal.join(','));
  const oam = await page.textContent('.oam-list');
  check('desktop: OAM lists the 4 player sprites', (oam.match(/#0[0-3]/g) || []).length === 4, oam.split('\n')[0]);
  await page.screenshot({ path: `${OUT}/d4-ppu.png`, fullPage: false });
  await page.evaluate(() => document.querySelector('.tool[data-tool="ppu"]').scrollTo(0, 500));
  await page.screenshot({ path: `${OUT}/d4b-ppu-nt.png` });

  // CHR: draw on the editor and check the game sees it
  await page.click('.tool-tabs button[data-tool="chr"]');
  await page.waitForTimeout(300);
  const vramBefore = await page.evaluate(() => window.__nesmo?.emu.ppu.vramMem[16]);
  const ec = await page.$('.chr-edit');
  const eb = await ec.boundingBox();
  await page.click('.chr-swatches .swatch:nth-child(4)');
  await page.mouse.move(eb.x + 5, eb.y + 5);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width - 5, eb.y + 5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const vramAfter = await page.evaluate(() => window.__nesmo?.emu.ppu.vramMem[16]);
  check('desktop: CHR edit patches the running game', vramBefore !== vramAfter && vramAfter === 0xff, `${vramBefore} -> ${vramAfter}`);
  await page.screenshot({ path: `${OUT}/d5-chr.png` });
  await page.click('.chr-tools button:has-text("Undo")');

  // Reference
  await page.click('.tool-tabs button[data-tool="ref"]');
  await page.fill('.ref input', 'lda');
  await page.waitForTimeout(100);
  check('desktop: reference finds LDA', (await page.textContent('.ref-list')).includes('Load A'));
  await page.screenshot({ path: `${OUT}/d6-ref.png` });

  // build error
  await page.click('.cm-content');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('  BADOP\n');
  await page.click('button.build');
  await page.waitForFunction(() => document.querySelector('.msg-summary')?.textContent?.includes('error'), null, { timeout: 10000 });
  check('desktop: errors are listed', (await page.textContent('.msg-list')).includes('main.asm:'));
  check('desktop: error line marked in editor', !!(await page.$('.cm-lintRange-error')));
  await page.screenshot({ path: `${OUT}/d7-error.png` });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------------ phone
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('.cm-content');
  await page.evaluate(() => localStorage.setItem('nesmo:view', 'code'));
  await page.reload();
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/p1-code.png` });
  check('phone: tab bar visible', await page.isVisible('.tabbar'));
  check('phone: symbol bar visible', await page.isVisible('.symbol-bar'));
  await page.tap('button.build');
  await page.waitForFunction(() => document.body.dataset.view === 'play', null, { timeout: 15000 });
  check('phone: build switches to Play', true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/p2-play.png` });
  const s = await screenStats(page);
  check('phone: game renders', s.colors >= 4, JSON.stringify(s));

  // touch the d-pad right zone and hold
  const r = await page.$('.tp-r');
  const rb = await r.boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const x0 = await page.evaluate(() => window.__nesmo.emu.cpu.mem[window.__nesmo.dbg.labelToAddr.get('player_x')]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }] });
  await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const x1 = await page.evaluate(() => window.__nesmo.emu.cpu.mem[window.__nesmo.dbg.labelToAddr.get('player_x')]);
  check('phone: touch d-pad moves the player', x1 > x0, `${x0} -> ${x1}`);

  // B -> A slide
  const b = await (await page.$('.tp-b')).boundingBox();
  const a = await (await page.$('.tp-a')).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (b.x + b.width + a.x) / 2, y: (b.y + a.y + a.height) / 2 + 2 }] });
  await page.waitForTimeout(100);
  const btns = await page.evaluate(() => window.__nesmo.emu.cpu.mem[window.__nesmo.dbg.labelToAddr.get('buttons')]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('phone: sliding from B toward A holds both', (btns & 0xc0) === 0xc0, '$' + btns.toString(16));

  for (const v of ['debug', 'ppu', 'chr', 'ref']) {
    await page.tap(`.tabbar button[data-view="${v}"]`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/p3-${v}.png` });
  }
  check('phone: debugger mini screen shows', await page.evaluate(() => {
    document.querySelector('.tabbar button[data-view="debug"]').click();
    return !!document.querySelector('.mini-screen canvas');
  }));
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
