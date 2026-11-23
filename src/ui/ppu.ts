// PPU viewer: palettes, pattern tables, nametables, sprites (OAM) and the
// PPUCTRL / PPUMASK bits.
import { app } from '../app';
import { hex2, hex4 } from '../cpu6502/disasm';
import { decodeTile, blitTile } from '../chr/chr';
import { h, clear, throttle } from './dom';

/** jsnes colors are 0xBBGGRR; the canvas helpers want 0xRRGGBB. */
export function nesRgb(index: number): number {
  const v = app.emu.ppu.palTable.getEntry(index & 0x3f);
  return ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}
export const cssColor = (rgb: number) => '#' + rgb.toString(16).padStart(6, '0');

/** The 8 palettes currently in palette RAM, as RGB, plus their NES indices. */
export function currentPalettes(): { rgb: number[][]; idx: number[][] } {
  const rgb: number[][] = [];
  const idx: number[][] = [];
  for (let p = 0; p < 8; p++) {
    const ids = [0, 1, 2, 3].map((c) => (c === 0 ? app.emu.ppuPeek(0x3f00) : app.emu.ppuPeek(0x3f00 + p * 4 + c)) & 0x3f);
    idx.push(ids);
    rgb.push(ids.map(nesRgb));
  }
  return { rgb, idx };
}

const GREY = [0x000000, 0x666666, 0xaaaaaa, 0xffffff];

export class PpuPanel {
  el: HTMLElement;
  private palettes = h('div', { class: 'ppu-pals' });
  private ptCanvas = this.canvas(256, 128, 'ppu-pt');
  private ntCanvas = this.canvas(512, 480, 'ppu-nt');
  private oamCanvas = this.canvas(256, 240, 'ppu-oam');
  private oamList = h('div', { class: 'oam-list mono' });
  private regs = h('div', { class: 'ppu-regs mono' });
  private ptPalette = -1; // -1 = greyscale
  private ptSelect: HTMLSelectElement;
  private showGrid = false;
  private hoverInfo = h('div', { class: 'muted small' }, 'Tap a tile for details.');
  private tileCache = new Map<number, Uint8Array>();
  visible = () => this.el.offsetParent !== null;

  constructor() {
    this.ptSelect = h('select', { onchange: () => { this.ptPalette = +this.ptSelect.value; this.render(); } },
      h('option', { value: -1 }, 'Greyscale'),
      ...[0, 1, 2, 3].map((i) => h('option', { value: i }, `Background ${i}`)),
      ...[4, 5, 6, 7].map((i) => h('option', { value: i }, `Sprite ${i - 4}`)),
    );
    const gridToggle = h('label', { class: 'check' },
      h('input', { type: 'checkbox', onchange: (e: Event) => { this.showGrid = (e.target as HTMLInputElement).checked; this.render(); } }),
      ' Grid',
    );
    this.ntCanvas.addEventListener('click', (e) => this.ntInfo(e));
    this.ptCanvas.addEventListener('click', (e) => this.ptInfo(e));

    this.el = h('div', { class: 'panel-body ppu' },
      h('h3', null, 'Palettes'),
      this.palettes,
      h('div', { class: 'row-between' }, h('h3', null, 'Pattern tables'), this.ptSelect),
      h('div', { class: 'canvas-wrap' }, this.ptCanvas),
      h('div', { class: 'muted small' }, 'Left: $0000   Right: $1000'),
      h('div', { class: 'row-between' }, h('h3', null, 'Nametables'), gridToggle),
      h('div', { class: 'canvas-wrap' }, this.ntCanvas),
      this.hoverInfo,
      h('h3', null, 'Sprites (OAM)'),
      h('div', { class: 'canvas-wrap' }, this.oamCanvas),
      this.oamList,
      h('h3', null, 'Registers'),
      this.regs,
    );

    const live = throttle(() => this.visible() && this.render(), 200);
    app.emu.onFrame(() => live());
    app.emu.subscribe(() => this.visible() && this.render());
  }

  private canvas(w: number, hgt: number, cls: string) {
    const c = h('canvas', { width: w, height: hgt, class: 'pixel ' + cls });
    return c;
  }

  show() {
    this.render();
  }

  render() {
    if (!app.emu.rom) {
      clear(this.palettes);
      this.palettes.append(h('div', { class: 'muted' }, 'Build and run a project to see the PPU.'));
      return;
    }
    this.tileCache.clear();
    const pals = currentPalettes();
    this.renderPalettes(pals.idx);
    this.renderPatternTables(pals.rgb);
    this.renderNametables(pals.rgb);
    this.renderSprites(pals.rgb);
    this.renderRegs();
  }

  private tile(addr: number) {
    let t = this.tileCache.get(addr);
    if (!t) {
      t = decodeTile(app.emu.ppu.vramMem, addr);
      this.tileCache.set(addr, t);
    }
    return t;
  }

  private renderPalettes(idx: number[][]) {
    clear(this.palettes);
    idx.forEach((pal, p) => {
      this.palettes.append(
        h('div', { class: 'pal' },
          h('span', { class: 'pal-name' }, p < 4 ? `BG${p}` : `SP${p - 4}`),
          ...pal.map((c) => h('span', { class: 'swatch', style: { background: cssColor(nesRgb(c)) }, title: '$' + hex2(c) }, hex2(c))),
        ),
      );
    });
  }

  private renderPatternTables(rgb: number[][]) {
    const ctx = this.ptCanvas.getContext('2d')!;
    const img = ctx.createImageData(256, 128);
    const pal = this.ptPalette < 0 ? GREY : rgb[this.ptPalette];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < 256; i++) {
        blitTile(img, t * 128 + (i % 16) * 8, Math.floor(i / 16) * 8, this.tile(t * 0x1000 + i * 16), pal);
      }
    }
    ctx.putImageData(img, 0, 0);
    if (this.showGrid) this.grid(ctx, 256, 128, 8, 'rgba(255,255,255,0.15)');
  }

  private renderNametables(rgb: number[][]) {
    const emu = app.emu;
    const ctx = this.ntCanvas.getContext('2d')!;
    const img = ctx.createImageData(512, 480);
    const bgBase = emu.ppu.f_bgPatternTable ? 0x1000 : 0;
    for (let nt = 0; nt < 4; nt++) {
      const base = 0x2000 + nt * 0x400;
      const ox = (nt & 1) * 256;
      const oy = (nt >> 1) * 240;
      for (let row = 0; row < 30; row++) {
        for (let col = 0; col < 32; col++) {
          const tileIdx = emu.ppuPeek(base + row * 32 + col);
          const attr = emu.ppuPeek(base + 0x3c0 + (row >> 2) * 8 + (col >> 2));
          const shift = ((row & 2) << 1) | (col & 2);
          const pal = (attr >> shift) & 3;
          blitTile(img, ox + col * 8, oy + row * 8, this.tile(bgBase + tileIdx * 16), rgb[pal]);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(256.5, 0); ctx.lineTo(256.5, 480);
    ctx.moveTo(0, 240.5); ctx.lineTo(512, 240.5);
    ctx.stroke();
    if (this.showGrid) {
      this.grid(ctx, 512, 480, 8, 'rgba(255,255,255,0.08)');
      this.grid(ctx, 512, 480, 32, 'rgba(255,200,0,0.25)'); // attribute areas
    }
  }

  private renderSprites(rgb: number[][]) {
    const emu = app.emu;
    const oam = emu.ppu.spriteMem;
    const tall = emu.ppu.f_spriteSize === 1;
    const spBase = emu.ppu.f_spPatternTable ? 0x1000 : 0;
    const ctx = this.oamCanvas.getContext('2d')!;
    const img = ctx.createImageData(256, 240);
    // dark backdrop so sprites read clearly
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    const rows: string[] = [];
    // draw in reverse so sprite 0 ends up on top, like the real priority
    for (let s = 63; s >= 0; s--) {
      const y = oam[s * 4] + 1;
      const tile = oam[s * 4 + 1];
      const attr = oam[s * 4 + 2];
      const x = oam[s * 4 + 3];
      if (y >= 240) continue;
      const pal = rgb[4 + (attr & 3)];
      const fh = !!(attr & 0x40);
      const fv = !!(attr & 0x80);
      if (!tall) {
        blitTile(img, x, y, this.tile(spBase + tile * 16), pal, true, fh, fv);
      } else {
        const base = (tile & 1) * 0x1000 + (tile & 0xfe) * 16;
        const top = fv ? base + 16 : base;
        const bot = fv ? base : base + 16;
        blitTile(img, x, y, this.tile(top), pal, true, fh, fv);
        blitTile(img, x, y + 8, this.tile(bot), pal, true, fh, fv);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,80,80,0.6)';
    for (let s = 0; s < 64; s++) {
      const y = oam[s * 4] + 1;
      if (y >= 240) continue;
      ctx.strokeRect(oam[s * 4 + 3] + 0.5, y + 0.5, 7, tall ? 15 : 7);
      rows.push(`#${String(s).padStart(2, '0')}  x=${hex2(oam[s * 4 + 3])} y=${hex2(oam[s * 4])} tile=${hex2(oam[s * 4 + 1])} attr=${hex2(oam[s * 4 + 2])}` +
        `  pal ${oam[s * 4 + 2] & 3}${oam[s * 4 + 2] & 0x20 ? ' behind' : ''}${oam[s * 4 + 2] & 0x40 ? ' flipH' : ''}${oam[s * 4 + 2] & 0x80 ? ' flipV' : ''}`);
    }
    this.oamList.textContent = rows.length ? rows.join('\n') : 'No sprites on screen (Y ≥ $EF hides a sprite).';
  }

  private renderRegs() {
    const p = app.emu.ppu;
    const ctrl = (p.f_nmiOnVblank << 7) | (p.f_spriteSize << 5) | (p.f_bgPatternTable << 4) | (p.f_spPatternTable << 3) | (p.f_addrInc << 2) | p.f_nTblAddress;
    const mask = (p.f_color << 5) | (p.f_spVisibility << 4) | (p.f_bgVisibility << 3) | (p.f_spClipping << 2) | (p.f_bgClipping << 1) | p.f_dispType;
    this.regs.textContent = [
      `PPUCTRL  $2000 = %${ctrl.toString(2).padStart(8, '0')}`,
      `  NMI on vblank ${p.f_nmiOnVblank ? 'on' : 'off'} · sprites 8x${p.f_spriteSize ? 16 : 8}`,
      `  BG table $${p.f_bgPatternTable ? '1000' : '0000'} · sprite table $${p.f_spPatternTable ? '1000' : '0000'}`,
      `  VRAM step +${p.f_addrInc ? 32 : 1} · base nametable $${hex4(0x2000 + p.f_nTblAddress * 0x400)}`,
      `PPUMASK  $2001 = %${mask.toString(2).padStart(8, '0')}`,
      `  BG ${p.f_bgVisibility ? 'shown' : 'hidden'} · sprites ${p.f_spVisibility ? 'shown' : 'hidden'}`,
      `  left 8px: BG ${p.f_bgClipping ? 'shown' : 'clipped'}, sprites ${p.f_spClipping ? 'shown' : 'clipped'}`,
      `  greyscale ${p.f_dispType ? 'on' : 'off'} · emphasis %${p.f_color.toString(2).padStart(3, '0')}`,
    ].join('\n');
  }

  private grid(ctx: CanvasRenderingContext2D, w: number, hgt: number, step: number, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, hgt); }
    for (let y = step; y < hgt; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  }

  private pos(e: MouseEvent, c: HTMLCanvasElement) {
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  private ntInfo(e: MouseEvent) {
    if (!app.emu.rom) return;
    const { x, y } = this.pos(e, this.ntCanvas);
    const nt = (x >= 256 ? 1 : 0) + (y >= 240 ? 2 : 0);
    const col = Math.floor((x % 256) / 8);
    const row = Math.floor((y % 240) / 8);
    const addr = 0x2000 + nt * 0x400 + row * 32 + col;
    const attrAddr = 0x2000 + nt * 0x400 + 0x3c0 + (row >> 2) * 8 + (col >> 2);
    const attr = app.emu.ppuPeek(attrAddr);
    const pal = (attr >> (((row & 2) << 1) | (col & 2))) & 3;
    this.hoverInfo.textContent = `Nametable $${hex4(addr)} (col ${col}, row ${row}) = tile $${hex2(app.emu.ppuPeek(addr))} · attribute $${hex4(attrAddr)} = $${hex2(attr)} → palette ${pal}`;
  }

  private ptInfo(e: MouseEvent) {
    const { x, y } = this.pos(e, this.ptCanvas);
    const table = x >= 128 ? 1 : 0;
    const tile = Math.floor(y / 8) * 16 + Math.floor((x % 128) / 8);
    this.hoverInfo.textContent = `Pattern table $${table ? '1000' : '0000'} tile $${hex2(tile)} at PPU $${hex4(table * 0x1000 + tile * 16)}`;
  }
}
