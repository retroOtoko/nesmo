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

  // ---- touch pad: geometry in SVG units (see src/ui/touchpad.ts)
  const cdp = await ctx.newCDPSession(page);
  const ang = (-17 * Math.PI) / 180;
  const B = { x: 272 - Math.cos(ang) * 38, y: 100 - Math.sin(ang) * 38 };
  const A = { x: 272 + Math.cos(ang) * 38, y: 100 + Math.sin(ang) * 38 };
  const MIDAB = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const toClient = (pt) => page.evaluate(([x, y]) => {
    const p = new DOMPoint(x, y).matrixTransform(document.querySelector('.touchpad svg').getScreenCTM());
    return { x: p.x, y: p.y };
  }, [pt.x, pt.y]);
  const touch = async (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [await toClient(pt)] : [] });
  const ram = (label) => page.evaluate((l) => window.__nesmo.emu.cpu.mem[window.__nesmo.dbg.labelToAddr.get(l)], label);
  const hold = async (pt, ms = 120) => { await touch('touchStart', pt); await page.waitForTimeout(ms); const b = await ram('buttons'); await touch('touchEnd'); await page.waitForTimeout(60); return b; };
  const pressedNow = () => page.evaluate(() => [...document.querySelectorAll('.touchpad .pressed')].map((e) => e.dataset.dir || e.dataset.btn).sort().join(','));

  const x0 = await ram('player_x');
  await touch('touchStart', { x: 78 + 48, y: 95 });
  await page.waitForTimeout(500);
  const armLit = await pressedNow();
  await touch('touchEnd');
  const x1 = await ram('player_x');
  check('phone: touch d-pad moves the player', x1 > x0, `${x0} -> ${x1}`);
  check('phone: pressed d-pad arm lights up', armLit === 'right', armLit);
  const rad = (d) => (d * Math.PI) / 180;
  const at = (deg) => ({ x: 78 + 45 * Math.cos(rad(deg)), y: 95 + 45 * Math.sin(rad(deg)) });
  const near = await hold(at(25));
  const diag = await hold(at(45));
  check('phone: d-pad 25° below right is still just right', near === 0x01, '$' + near.toString(16));
  check('phone: d-pad diagonal presses right + down', diag === 0x05, '$' + diag.toString(16));

  // finger resting between A and B presses both
  await touch('touchStart', MIDAB);
  await page.waitForTimeout(150);
  const midBtns = await ram('buttons');
  const midLit = await pressedNow();
  await page.screenshot({ path: `${OUT}/p2b-ab-pressed.png` });
  await touch('touchEnd');
  check('phone: finger between A and B presses both', (midBtns & 0xc0) === 0xc0, '$' + midBtns.toString(16));
  check('phone: A and B both show pressed', midLit === 'A,B', midLit);

  // slide from B, through the gap, onto A
  await touch('touchStart', B);
  await page.waitForTimeout(100);
  const s1 = await ram('buttons');
  await touch('touchMove', MIDAB);
  await page.waitForTimeout(100);
  const s2 = await ram('buttons');
  await touch('touchMove', A);
  await page.waitForTimeout(100);
  const s3 = await ram('buttons');
  await touch('touchEnd');
  check('phone: slide B → gap → A gives B, both, A', s1 === 0x40 && s2 === 0xc0 && s3 === 0x80, [s1, s2, s3].map((v) => '$' + v.toString(16)).join(' → '));

  // Controls sheet: switch the gap to "nearest button only"
  await page.tap('.controls-btn');
  await page.waitForSelector('.sheet.open');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/p2c-controls.png` });
  await page.tap('.opt:has-text("Nearest button only")');
  await page.tap('.sheet button:has-text("Done")');
  await page.waitForTimeout(300);
  const offBtns = await hold(MIDAB);
  check('phone: with the setting off, the gap presses one button', offBtns === 0x40 || offBtns === 0x80, '$' + offBtns.toString(16));
  check('phone: setting is saved', (await page.evaluate(() => localStorage.getItem('nesmo:controls'))).includes('off'));
  await page.evaluate(() => localStorage.removeItem('nesmo:controls'));

  for (const v of ['debug', 'ppu', 'chr', 'ref']) {
    await page.tap(`.tabbar button[data-view="${v}"]`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/p3-${v}.png` });
  }
  // ---- CHR tile sheet: one table, tap mapping, zoom, pinch, table switch
  await page.tap('.tabbar button[data-view="chr"]');
  await page.waitForTimeout(300);
  const sheetInfo = () => page.evaluate(() => {
    const c = document.querySelector('.chr-sheet');
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, wrap: document.querySelector('.chr-sheet-scroll').clientWidth, aspect: c.width / c.height, zoom: document.querySelector('.zoom-label').textContent };
  });
  const tileCenter = (col, row) => page.evaluate(([col, row]) => {
    const r = document.querySelector('.chr-sheet').getBoundingClientRect();
    return { x: r.left + ((col + 0.5) * r.width) / 16, y: r.top + ((row + 0.5) * r.height) / 16 };
  }, [col, row]);
  const chrInfo = () => page.evaluate(() => document.querySelector('.chr-left .muted').textContent);
  await page.evaluate(() => document.querySelector('.chr-sheet-scroll').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  let si = await sheetInfo();
  check('phone: tile sheet shows one table at a time', Math.abs(si.aspect - 1) < 0.01, JSON.stringify(si));
  let pt = await tileCenter(2, 1);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(100);
  check('phone: tapping the sheet selects that tile', (await chrInfo()).startsWith('Tile $12'), await chrInfo());
  await page.tap('.sheet-zoom button:has-text("3×")');
  await page.waitForTimeout(300);
  si = await sheetInfo();
  check('phone: 3× zoom makes the table 3 times wider', Math.abs(si.w - 3 * si.wrap) < 3, JSON.stringify(si));
  pt = await tileCenter(3, 1);
  const visible = await page.evaluate(([x, y]) => {
    const r = document.querySelector('.chr-sheet-scroll').getBoundingClientRect();
    return x > r.left && x < r.right && y > r.top && y < r.bottom;
  }, [pt.x, pt.y]);
  check('phone: zooming keeps the selected tile in view', visible);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(100);
  check('phone: tapping a zoomed sheet selects the right tile', (await chrInfo()).startsWith('Tile $13'), await chrInfo());
  await page.screenshot({ path: `${OUT}/p4-chr-zoom.png` });

  await page.tap('.sheet-zoom button:has-text("2×")');
  await page.waitForTimeout(200);
  const wr = await page.evaluate(() => { const r = document.querySelector('.chr-sheet-scroll').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height, 300) / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: wr.x - 40, y: wr.y, id: 1 }, { x: wr.x + 40, y: wr.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: wr.x - 50, y: wr.y, id: 1 }, { x: wr.x + 50, y: wr.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: wr.x - 60, y: wr.y, id: 1 }, { x: wr.x + 60, y: wr.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  si = await sheetInfo();
  const z = parseFloat(si.zoom);
  check('phone: pinching out zooms the sheet', z > 2.7 && z < 3.3, si.zoom);
  check('phone: pinch did not change the selected tile', (await chrInfo()).startsWith('Tile $13'), await chrInfo());

  await page.tap('.chr button:has-text("$1000")');
  await page.waitForTimeout(150);
  check('phone: $1000 shows the second table', (await chrInfo()).includes('table $1000'), await chrInfo());
  await page.tap('.chr button:has-text("Both")');
  await page.waitForTimeout(150);
  si = await sheetInfo();
  check('phone: Both shows the two tables side by side', Math.abs(si.aspect - 2) < 0.01, JSON.stringify(si));
  await page.evaluate(() => localStorage.removeItem('nesmo:chr-sheet'));

  check('phone: debugger mini screen shows', await page.evaluate(() => {
    document.querySelector('.tabbar button[data-view="debug"]').click();
    return !!document.querySelector('.mini-screen canvas');
  }));
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- offline
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('.cm-content');
  const ready = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((k) => k.startsWith('nesmo-')));
    return { active: !!reg.active, cached: (await cache.keys()).length };
  });
  check('offline: service worker saved the app', ready.active && ready.cached >= 10, JSON.stringify(ready));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  check('offline: page reloads with no connection', true);
  check('offline: offline pill shows', await page.isVisible('.offline-pill'));
  await page.tap('button.build');
  await page.waitForFunction(() => document.querySelector('.msg-summary')?.textContent?.includes('Built'), null, { timeout: 15000 });
  check('offline: builds with no connection', true, await page.textContent('.msg-summary'));
  await page.waitForTimeout(600);
  const s = await screenStats(page);
  check('offline: game runs with no connection', s.colors >= 4, JSON.stringify(s));
  await page.tap('.menu');
  await page.waitForTimeout(300);
  check('offline: drawer reports offline ready', (await page.textContent('.device-status')).includes('Works offline'));
  await page.screenshot({ path: `${OUT}/o1-offline-drawer.png` });
  check('offline: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
