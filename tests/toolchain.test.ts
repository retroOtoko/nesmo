import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../src/toolchain/build';
import { DebugInfo } from '../src/toolchain/dbginfo';
import { samples } from '../src/project/samples';
import { NES } from 'jsnes';

const tc = async () => ({
  ca65: await WebAssembly.compile(readFileSync('public/toolchain/ca65.wasm')),
  ld65: await WebAssembly.compile(readFileSync('public/toolchain/ld65.wasm')),
  share: {
    'cfg/nes.cfg': readFileSync('src/toolchain/share/nes.cfg', 'utf8'),
    'asminc/nes.inc': readFileSync('src/toolchain/share/nes.inc', 'utf8'),
  },
});

function runFrames(rom: Uint8Array, n: number, onFrameN?: (nes: any, i: number) => void) {
  let last: Uint32Array | null = null;
  const nes: any = new NES({ onFrame: (b: Uint32Array) => { last = b.slice(); }, emulateSound: false });
  nes.loadROM(rom);
  for (let i = 0; i < n; i++) { onFrameN?.(nes, i); nes.frame(); }
  return { nes, frame: last! };
}

test('samples assemble, link and run', async () => {
  const t = await tc();
  for (const s of samples()) {
    const r = await build(s.files, t);
    if (!r.ok) console.log(r.log.join('\n'), r.messages);
    assert.ok(r.ok, s.name + ' should build');
    assert.equal(r.rom!.length, 16 + 32768 + 8192);
    assert.deepEqual(r.messages.filter(m => m.severity === 'error'), []);
    console.log(s.name, 'built in', r.ms, 'ms; warnings:', r.messages.length, 'sources:', r.sources);
    const dbg = DebugInfo.parse(r.dbg!);
    assert.ok(dbg.addrToLoc.size > 10);
    const { frame } = runFrames(r.rom!, 30);
    assert.ok(frame, 'got a frame');
  }
});

test('hello world paints the background color', async () => {
  const r = await build(samples()[1].files, await tc());
  const { frame } = runFrames(r.rom!, 10);
  // jsnes palette entry $29 is 0xBBGGRR
  const counts = new Map<number, number>();
  for (const px of frame) counts.set(px, (counts.get(px) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('dominant pixel', top[0].toString(16), top[1]);
  assert.ok(top[1] > 50000);
});

test('sprite mover: d-pad moves player_x, OAM updates, dbg maps lines', async () => {
  const r = await build(samples()[0].files, await tc());
  const dbg = DebugInfo.parse(r.dbg!);
  const px = dbg.labelToAddr.get('player_x')!;
  assert.ok(px !== undefined && px < 0x100, 'player_x in zero page: ' + px);
  const mainAddr = dbg.labelToAddr.get('main')!;
  assert.ok(mainAddr >= 0x8000);
  const loc = dbg.locForAddr(mainAddr + 3);
  assert.equal(loc?.file, 'main.asm');
  const lineAddr = dbg.addrForLine('main.asm', loc!.line);
  assert.ok(lineAddr !== undefined);
  const { nes } = runFrames(r.rom!, 120, (nes, i) => { if (i === 40) nes.buttonDown(1, 7); });
  const x = nes.cpu.mem[px];
  console.log('player_x after holding right:', x.toString(16), 'OAM[3]=', nes.ppu.spriteMem[3].toString(16));
  assert.ok(x > 0x78 + 50);
  assert.ok(Math.abs(nes.ppu.spriteMem[3] - x) <= 1, 'OAM trails RAM by one frame');
  assert.equal(nes.ppu.spriteMem[1], 1);
});

test('errors are reported with file and line', async () => {
  const files = { ...samples()[0].files, 'main.asm': (samples()[0].files['main.asm'] as string).replace('INC nmi_count', 'INCC nmi_count') };
  const r = await build(files, await tc());
  assert.equal(r.ok, false);
  const e = r.messages.find(m => m.severity === 'error')!;
  console.log(e);
  assert.equal(e.file, 'main.asm');
  assert.ok(e.line > 20);
});
