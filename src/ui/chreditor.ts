// CHR editor: draw tiles in the project's .chr file, with edits patched into
// the running game straight away. Also a palette builder that writes the
// .byte lines for you.
import { app } from '../app';
import { hex2 } from '../cpu6502/disasm';
import { decodeTile, writeTile, blitTile } from '../chr/chr';
import { h, clear, toast, isPhone } from './dom';
import { nesRgb, cssColor, currentPalettes } from './ppu';

type Mode = '8' | '16';
type Tool = 'pen' | 'fill';
type SheetBanks = 'both' | 'left' | 'right';
interface SheetView { banks: SheetBanks; zoom: number }

const SHEET_KEY = 'nesmo:chr-sheet';
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

function loadSheetView(): SheetView {
  try {
    const v = JSON.parse(localStorage.getItem(SHEET_KEY) || 'null');
    if (v && ['both', 'left', 'right'].includes(v.banks) && typeof v.zoom === 'number') return { banks: v.banks, zoom: clampZoom(v.zoom) };
  } catch {
    /* fall through to the default */
  }
  // On a phone, one pattern table at a time gives tiles twice the size.
  return { banks: isPhone() ? 'left' : 'both', zoom: 1 };
}

const DEFAULT_PALS = [
  [0x0f, 0x00, 0x10, 0x30], [0x0f, 0x16, 0x27, 0x30], [0x0f, 0x1a, 0x2a, 0x30], [0x0f, 0x12, 0x22, 0x30],
  [0x0f, 0x16, 0x0f, 0x30], [0x0f, 0x00, 0x10, 0x20], [0x0f, 0x00, 0x10, 0x20], [0x0f, 0x00, 0x10, 0x20],
];

export class ChrPanel {
  el: HTMLElement;
  private file = '';
  private tile = 1;
  private mode: Mode = '8';
  private tool: Tool = 'pen';
  private color = 1;
  private palIndex = 4; // which of the 8 palettes the editor uses
  private customPals: number[][] = DEFAULT_PALS.map((p) => [...p]);
  private usePpuPals = true;
  private undo: Uint8Array[] = [];
  private redo: Uint8Array[] = [];
  private clipboard: Uint8Array[] | null = null;
  private fileSelect = h('select', { onchange: () => this.setFile(this.fileSelect.value) });
  private editCanvas = h('canvas', { width: 256, height: 256, class: 'pixel chr-edit' });
  private sheetCanvas = h('canvas', { width: 256, height: 128, class: 'pixel chr-sheet' });
  private sheetScroll = h('div', { class: 'chr-sheet-scroll' }, this.sheetCanvas);
  private sheetOff = document.createElement('canvas');
  private sheetView: SheetView = loadSheetView();
  private bankBtns: Record<string, HTMLButtonElement> = {};
  private zoomBtns = new Map<number, HTMLButtonElement>();
  private zoomLabel = h('span', { class: 'muted small zoom-label' });
  private swatches = h('div', { class: 'chr-swatches' });
  private palPicker = h('div', { class: 'chr-palpick seg' });
  private info = h('div', { class: 'muted small' });
  private builderOut = h('pre', { class: 'mono pal-out' });
  private builder = h('div', { class: 'pal-builder' });
  private nesGrid = h('div', { class: 'nes-grid' });
  private pickTarget: { pal: number; slot: number } | null = null;
  private toolBtns: Record<string, HTMLButtonElement> = {};
  private modeBtns: Record<string, HTMLButtonElement> = {};
  visible = () => this.el.offsetParent !== null;

  constructor() {
    const tb = (label: string, title: string, fn: () => void, key?: string) => {
      const b = h('button', { class: 'btn', title, onclick: fn }, label);
      if (key) this.toolBtns[key] = b;
      return b;
    };
    const mb = (m: Mode, label: string) => {
      const b = h('button', { onclick: () => { this.mode = m; this.render(); } }, label);
      this.modeBtns[m] = b;
      return b;
    };
    const bankBtn = (b: SheetBanks, label: string) => {
      const el = h('button', { onclick: () => this.setSheetView({ banks: b }) }, label);
      this.bankBtns[b] = el;
      return el;
    };
    const zoomBtn = (z: number) => {
      const el = h('button', { onclick: () => this.setSheetView({ zoom: z }) }, `${z}×`);
      this.zoomBtns.set(z, el);
      return el;
    };
    const ppuToggle = h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => { this.usePpuPals = (e.target as HTMLInputElement).checked; this.render(); } }),
      ' Use game palettes',
    );

    this.el = h('div', { class: 'panel-body chr' },
      h('div', { class: 'row-between' }, this.fileSelect, h('div', { class: 'seg' }, mb('8', '8×8'), mb('16', '16×16'))),
      h('div', { class: 'chr-main' },
        h('div', { class: 'chr-left' },
          h('div', { class: 'canvas-wrap square' }, this.editCanvas),
          this.info,
        ),
        h('div', { class: 'chr-right' },
          this.swatches,
          h('div', { class: 'row-between' }, this.palPicker, ppuToggle),
          h('div', { class: 'chr-tools' },
            tb('✏️ Pen', 'Pen', () => this.setTool('pen'), 'pen'),
            tb('🪣 Fill', 'Flood fill', () => this.setTool('fill'), 'fill'),
            tb('⇋ Flip', 'Flip horizontally', () => this.transform('h')),
            tb('⇵ Flip', 'Flip vertically', () => this.transform('v')),
            tb('⟳ Rot', 'Rotate 90°', () => this.transform('r')),
            tb('Clear', 'Clear tile', () => this.transform('clear')),
            tb('Copy', 'Copy tile', () => this.copy()),
            tb('Paste', 'Paste tile', () => this.paste()),
            tb('↶ Undo', 'Undo', () => this.doUndo()),
            tb('↷ Redo', 'Redo', () => this.doRedo()),
          ),
        ),
      ),
      h('div', { class: 'row-between' },
        h('h3', null, 'Tiles'),
        h('div', { class: 'seg' }, bankBtn('left', '$0000'), bankBtn('right', '$1000'), bankBtn('both', 'Both')),
      ),
      h('div', { class: 'row-between sheet-zoom' },
        h('div', { class: 'seg' }, ...[1, 2, 3, 4].map(zoomBtn)),
        this.zoomLabel,
      ),
      this.sheetScroll,
      h('div', { class: 'muted small' }, 'Tap a tile to edit it. Pinch the table (or use the trackpad on a Mac) to zoom.'),
      h('h3', null, 'Palette builder'),
      h('div', { class: 'muted small' }, 'Tap a slot, then a color. Copy the result into your RODATA.'),
      this.builder,
      this.builderOut,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => this.copyPalettes() }, 'Copy .byte lines'),
        h('button', { class: 'btn', onclick: () => this.loadPpuPalettes() }, 'Load from game'),
      ),
      h('h3', null, 'NES colors'),
      this.nesGrid,
    );

    this.setupDrawing();
    this.setupSheet();

    app.on('project', () => this.refreshFiles());
    app.on('file', (f) => f === this.file && this.render());
    app.on('build', () => this.visible() && this.render());
    this.refreshFiles();
  }

  show() {
    this.refreshFiles();
    this.render();
  }

  private refreshFiles() {
    const chrs = Object.keys(app.project?.files ?? {}).filter((f) => /\.chr$/i.test(f));
    clear(this.fileSelect);
    for (const f of chrs) this.fileSelect.append(h('option', { value: f }, f));
    this.fileSelect.append(h('option', { value: '+new' }, '+ New CHR file…'));
    if (!chrs.includes(this.file)) this.file = chrs[0] ?? '';
    this.fileSelect.value = this.file || '+new';
    this.undo = [];
    this.redo = [];
  }

  private setFile(f: string) {
    if (f === '+new') {
      const name = prompt('New CHR file name', 'graphics.chr');
      if (name) {
        const n = /\.chr$/i.test(name) ? name : name + '.chr';
        app.setFile(n, new Uint8Array(8192));
        this.file = n;
        toast(`Created ${n}. Add .incbin "${n}" to your CHARS segment.`, 4000);
      }
      this.refreshFiles();
    } else {
      this.file = f;
    }
    this.render();
  }

  private data(): Uint8Array | null {
    const d = app.project.files[this.file];
    return d instanceof Uint8Array ? d : null;
  }

  private palettes(): number[][] {
    if (this.usePpuPals && app.emu.rom) return currentPalettes().idx;
    return this.customPals;
  }

  /** Tile indices shown in the editor, row-major: 1 tile or a 2x2 block. */
  private tiles(): number[] {
    if (this.mode === '8') return [this.tile];
    const t = this.tile;
    return [t, t + 1, t + 16, t + 17].map((i) => i & 0x1ff);
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.render();
  }

  render() {
    if (!app.project) return;
    Object.entries(this.toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === this.tool));
    Object.entries(this.modeBtns).forEach(([k, b]) => b.classList.toggle('on', k === this.mode));
    this.renderSwatches();
    this.renderEditor();
    this.renderSheet();
    this.renderBuilder();
    this.renderNesGrid();
  }

  private renderSwatches() {
    const pals = this.palettes();
    clear(this.swatches);
    pals[this.palIndex].forEach((c, i) => {
      this.swatches.append(
        h('button', {
          class: 'swatch big' + (i === this.color ? ' on' : ''),
          style: { background: cssColor(nesRgb(c)) },
          onclick: () => { this.color = i; this.render(); },
        }, String(i)),
      );
    });
    clear(this.palPicker);
    for (let p = 0; p < 8; p++) {
      this.palPicker.append(h('button', { class: p === this.palIndex ? 'on' : '', onclick: () => { this.palIndex = p; this.render(); } }, p < 4 ? `BG${p}` : `SP${p - 4}`));
    }
  }

  private renderEditor() {
    const data = this.data();
    const ctx = this.editCanvas.getContext('2d')!;
    const n = this.mode === '8' ? 8 : 16;
    const cell = 256 / n;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 256, 256);
    if (!data) {
      this.info.textContent = 'No CHR file in this project yet. Pick "+ New CHR file…" above.';
      return;
    }
    const pal = this.palettes()[this.palIndex].map(nesRgb);
    this.tiles().forEach((t, i) => {
      const px = decodeTile(data, t * 16);
      const ox = (i % 2) * 8;
      const oy = Math.floor(i / 2) * 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = cssColor(pal[px[y * 8 + x]]);
        ctx.fillRect((ox + x) * cell, (oy + y) * cell, cell, cell);
      }
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(i * cell + 0.5, 0); ctx.lineTo(i * cell + 0.5, 256);
      ctx.moveTo(0, i * cell + 0.5); ctx.lineTo(256, i * cell + 0.5);
    }
    ctx.stroke();
    if (n === 16) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(128.5, 0); ctx.lineTo(128.5, 256);
      ctx.moveTo(0, 128.5); ctx.lineTo(256, 128.5);
      ctx.stroke();
    }
    const t = this.tile;
    this.info.textContent = `Tile $${hex2(t & 0xff)} in table $${t >= 256 ? '1000' : '0000'}` +
      (this.mode === '16' ? ` (+ $${hex2((t + 1) & 0xff)}, $${hex2((t + 16) & 0xff)}, $${hex2((t + 17) & 0xff)})` : '') +
      ` · ${this.file}`;
  }

  // ------------------------------------------------------------ tile sheet
  private shownBanks(): number[] {
    const b = this.sheetView.banks;
    return b === 'both' ? [0, 1] : [b === 'left' ? 0 : 1];
  }

  private setSheetView(change: Partial<SheetView>) {
    if (change.zoom !== undefined) change.zoom = clampZoom(change.zoom);
    this.sheetView = { ...this.sheetView, ...change };
    try {
      localStorage.setItem(SHEET_KEY, JSON.stringify(this.sheetView));
    } catch {
      /* private mode */
    }
    if (change.banks) {
      // jump to the table being shown if the selection is in the other one
      const banks = this.shownBanks();
      if (!banks.includes(this.tile >= 256 ? 1 : 0)) this.tile = banks[0] * 256 + (this.tile & 0xff);
    }
    this.render();
    requestAnimationFrame(() => this.scrollToSelection());
  }

  private updateSheetControls() {
    const z = this.sheetView.zoom;
    Object.entries(this.bankBtns).forEach(([k, b]) => b.classList.toggle('on', k === this.sheetView.banks));
    this.zoomBtns.forEach((b, k) => b.classList.toggle('on', Math.abs(k - z) < 0.05));
    this.zoomLabel.textContent = `${z.toFixed(z % 1 ? 1 : 0)}×`;
    this.sheetCanvas.style.width = `${z * 100}%`;
  }

  private renderSheet() {
    this.updateSheetControls();
    const data = this.data();
    const banks = this.shownBanks();
    const nesW = 128 * banks.length;
    // Draw at roughly one canvas pixel per screen pixel so grid lines stay sharp.
    const cssW = (this.sheetScroll.clientWidth || 360) * this.sheetView.zoom;
    const S = Math.max(1, Math.min(8, Math.round((cssW / nesW) * (window.devicePixelRatio || 1))));
    const canvas = this.sheetCanvas;
    if (canvas.width !== nesW * S || canvas.height !== 128 * S) {
      canvas.width = nesW * S;
      canvas.height = 128 * S;
    }
    const off = this.sheetOff;
    off.width = nesW;
    off.height = 128;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(nesW, 128);
    if (data) {
      const pal = this.palettes()[this.palIndex].map(nesRgb);
      banks.forEach((bank, col) => {
        for (let i = 0; i < 256; i++) {
          const t = bank * 256 + i;
          if (t * 16 >= data.length) break;
          blitTile(img, col * 128 + (i % 16) * 8, Math.floor(i / 16) * 8, decodeTile(data, t * 16), pal);
        }
      });
    }
    octx.putImageData(img, 0, 0);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, nesW * S, 128 * S);

    if (S >= 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 8 * S; x < nesW * S; x += 8 * S) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, 128 * S); }
      for (let y = 8 * S; y < 128 * S; y += 8 * S) { ctx.moveTo(0, y + 0.5); ctx.lineTo(nesW * S, y + 0.5); }
      ctx.stroke();
    }
    if (banks.length === 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(128 * S - Math.max(1, S / 4), 0, Math.max(2, S / 2), 128 * S);
    }

    const t = this.tile;
    const col = banks.indexOf(t >= 256 ? 1 : 0);
    if (col >= 0) {
      const size = (this.mode === '8' ? 8 : 16) * S;
      const lw = Math.max(1, Math.round(S / 2));
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = lw;
      ctx.strokeRect((col * 128 + (t & 15) * 8) * S + lw / 2, ((t & 0xff) >> 4) * 8 * S + lw / 2, size - lw, size - lw);
    }
  }

  private scrollToSelection() {
    const banks = this.shownBanks();
    const col = banks.indexOf(this.tile >= 256 ? 1 : 0);
    if (col < 0) return;
    const r = this.sheetCanvas.getBoundingClientRect();
    const fx = (col * 128 + (this.tile & 15) * 8 + 4) / (128 * banks.length);
    const fy = (((this.tile & 0xff) >> 4) * 8 + 4) / 128;
    this.sheetScroll.scrollLeft = fx * r.width - this.sheetScroll.clientWidth / 2;
    this.sheetScroll.scrollTop = fy * r.height - this.sheetScroll.clientHeight / 2;
  }

  /** Zoom while keeping the point under (ax, ay) where it is on screen. */
  private zoomAround(z: number, fx: number, fy: number, ax: number, ay: number) {
    this.sheetView.zoom = clampZoom(z);
    this.updateSheetControls();
    const wr = this.sheetScroll.getBoundingClientRect();
    const r = this.sheetCanvas.getBoundingClientRect();
    this.sheetScroll.scrollLeft = fx * r.width - (ax - wr.left);
    this.sheetScroll.scrollTop = fy * r.height - (ay - wr.top);
  }

  private commitZoom() {
    this.setSheetViewQuiet();
    this.renderSheet();
  }

  private setSheetViewQuiet() {
    try {
      localStorage.setItem(SHEET_KEY, JSON.stringify(this.sheetView));
    } catch {
      /* private mode */
    }
  }

  private setupSheet() {
    let suppressClickUntil = 0;
    this.sheetCanvas.addEventListener('click', (e) => {
      if (performance.now() < suppressClickUntil) return;
      const banks = this.shownBanks();
      const r = this.sheetCanvas.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const colAll = Math.min(16 * banks.length - 1, Math.max(0, Math.floor(fx * 16 * banks.length)));
      const row = Math.min(15, Math.max(0, Math.floor(fy * 16)));
      const bank = banks[Math.floor(colAll / 16)];
      this.tile = bank * 256 + row * 16 + (colAll % 16);
      this.render();
    });

    // Two-finger pinch on the table.
    const wrap = this.sheetScroll;
    let pinch: { d0: number; z0: number; fx: number; fy: number } | null = null;
    const mid = (e: TouchEvent) => ({
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
    });
    wrap.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e);
      const r = this.sheetCanvas.getBoundingClientRect();
      pinch = { d0: Math.max(m.d, 1), z0: this.sheetView.zoom, fx: (m.x - r.left) / r.width, fy: (m.y - r.top) / r.height };
    }, { passive: false });
    wrap.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e);
      this.zoomAround(pinch.z0 * (m.d / pinch.d0), pinch.fx, pinch.fy, m.x, m.y);
    }, { passive: false });
    const endPinch = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      pinch = null;
      suppressClickUntil = performance.now() + 400;
      this.commitZoom();
    };
    wrap.addEventListener('touchend', endPinch);
    wrap.addEventListener('touchcancel', endPinch);
    // Safari would otherwise zoom the whole page.
    for (const ev of ['gesturestart', 'gesturechange']) wrap.addEventListener(ev, (e) => e.preventDefault());

    // Trackpad pinch on a Mac arrives as ctrl + wheel.
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    wrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = this.sheetCanvas.getBoundingClientRect();
      this.zoomAround(this.sheetView.zoom * Math.exp(-e.deltaY / 100), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX, e.clientY);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => this.commitZoom(), 150);
    }, { passive: false });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.visible() && this.renderSheet(), 200);
    });
  }

  // --------------------------------------------------------------- drawing
  private setupDrawing() {
    let drawing = false;
    let changed = false;
    const at = (e: PointerEvent) => {
      const r = this.editCanvas.getBoundingClientRect();
      const n = this.mode === '8' ? 8 : 16;
      const x = Math.floor(((e.clientX - r.left) / r.width) * n);
      const y = Math.floor(((e.clientY - r.top) / r.height) * n);
      return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
    };
    this.editCanvas.addEventListener('pointerdown', (e) => {
      const data = this.data();
      if (!data) return;
      e.preventDefault();
      this.editCanvas.setPointerCapture(e.pointerId);
      this.pushUndo();
      const p = at(e);
      if (this.tool === 'fill') {
        this.fill(p.x, p.y);
        this.commit();
        return;
      }
      drawing = true;
      changed = this.plot(p.x, p.y);
      this.renderEditor();
    });
    this.editCanvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = at(e);
      if (this.plot(p.x, p.y)) {
        changed = true;
        this.renderEditor();
      }
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      if (changed) this.commit();
      else this.undo.pop();
    };
    this.editCanvas.addEventListener('pointerup', end);
    this.editCanvas.addEventListener('pointercancel', end);
  }

  /** Map an editor pixel to (tile offset in file, pixel index). */
  private locate(x: number, y: number) {
    const tiles = this.tiles();
    const ti = this.mode === '8' ? 0 : (y >= 8 ? 2 : 0) + (x >= 8 ? 1 : 0);
    return { offset: tiles[ti] * 16, px: (y % 8) * 8 + (x % 8) };
  }

  private plot(x: number, y: number): boolean {
    const data = this.data()!;
    const { offset, px } = this.locate(x, y);
    const pixels = decodeTile(data, offset);
    if (pixels[px] === this.color) return false;
    pixels[px] = this.color;
    writeTile(data, offset, pixels);
    return true;
  }

  private getPx(x: number, y: number) {
    const { offset, px } = this.locate(x, y);
    return decodeTile(this.data()!, offset)[px];
  }

  private fill(x0: number, y0: number) {
    const n = this.mode === '8' ? 8 : 16;
    const target = this.getPx(x0, y0);
    if (target === this.color) return;
    const stack = [[x0, y0]];
    const seen = new Set<number>();
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= n || y >= n || seen.has(y * n + x)) continue;
      seen.add(y * n + x);
      if (this.getPx(x, y) !== target) continue;
      this.plot(x, y);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  /** Read the editor area as a flat n*n pixel grid, and write it back. */
  private readGrid(): Uint8Array {
    const n = this.mode === '8' ? 8 : 16;
    const g = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[y * n + x] = this.getPx(x, y);
    return g;
  }
  private writeGrid(g: Uint8Array) {
    const n = this.mode === '8' ? 8 : 16;
    const data = this.data()!;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const { offset, px } = this.locate(x, y);
      const pixels = decodeTile(data, offset);
      pixels[px] = g[y * n + x];
      writeTile(data, offset, pixels);
    }
  }

  private transform(kind: 'h' | 'v' | 'r' | 'clear') {
    if (!this.data()) return;
    this.pushUndo();
    const n = this.mode === '8' ? 8 : 16;
    const g = this.readGrid();
    const out = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = g[y * n + x];
      if (kind === 'h') out[y * n + (n - 1 - x)] = v;
      if (kind === 'v') out[(n - 1 - y) * n + x] = v;
      if (kind === 'r') out[x * n + (n - 1 - y)] = v;
    }
    this.writeGrid(out);
    this.commit();
  }

  private copy() {
    if (!this.data()) return;
    this.clipboard = [this.readGrid()];
    toast('Copied');
  }

  private paste() {
    if (!this.clipboard || !this.data()) return;
    const g = this.clipboard[0];
    const n = this.mode === '8' ? 8 : 16;
    if (g.length !== n * n) return toast(`Clipboard holds a ${Math.sqrt(g.length)}×${Math.sqrt(g.length)} block; switch modes to paste it.`);
    this.pushUndo();
    this.writeGrid(g);
    this.commit();
  }

  private pushUndo() {
    const d = this.data();
    if (!d) return;
    this.undo.push(d.slice());
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
  }

  private doUndo() {
    const d = this.data();
    const prev = this.undo.pop();
    if (!d || !prev) return;
    this.redo.push(d.slice());
    d.set(prev);
    this.commit(false);
  }

  private doRedo() {
    const d = this.data();
    const next = this.redo.pop();
    if (!d || !next) return;
    this.undo.push(d.slice());
    d.set(next);
    this.commit(false);
  }

  /** Save the file and patch the running game's pattern tables. */
  private commit(_userEdit = true) {
    const data = this.data();
    if (!data) return;
    app.setFile(this.file, data, { silent: true });
    const emu = app.emu;
    if (emu.rom && data.length === 8192 && this.chrIsInRom()) {
      const vram = emu.ppu.vramMem;
      const ppu = emu.ppu as unknown as { writeMem(a: number, v: number): void };
      for (let a = 0; a < 0x2000; a++) if (vram[a] !== data[a]) ppu.writeMem(a, data[a]);
    }
    this.render();
  }

  /** Only patch the game if this file is what's in CHR ROM (8KB, mapper 0). */
  private chrIsInRom() {
    const rom = app.emu.rom!;
    return rom[5] === 1 && (rom[6] >> 4) === 0 && (rom[7] & 0xf0) === 0;
  }

  // -------------------------------------------------------------- palettes
  private renderBuilder() {
    clear(this.builder);
    this.customPals.forEach((pal, p) => {
      this.builder.append(
        h('div', { class: 'pal' },
          h('span', { class: 'pal-name' }, p < 4 ? `BG${p}` : `SP${p - 4}`),
          ...pal.map((c, slot) => h('button', {
            class: 'swatch' + (this.pickTarget?.pal === p && this.pickTarget.slot === slot ? ' on' : ''),
            style: { background: cssColor(nesRgb(c)) },
            onclick: () => { this.pickTarget = { pal: p, slot }; this.renderBuilder(); this.renderNesGrid(); },
          }, hex2(c))),
        ),
      );
    });
    const line = (p: number[]) => '  .byte ' + p.map((c) => '$' + hex2(c)).join(', ');
    this.builderOut.textContent = 'palettes:\n  ; background\n' +
      this.customPals.slice(0, 4).map(line).join('\n') + '\n  ; sprites\n' +
      this.customPals.slice(4).map(line).join('\n');
  }

  private renderNesGrid() {
    clear(this.nesGrid);
    for (let i = 0; i < 64; i++) {
      const rgb = nesRgb(i);
      const lum = ((rgb >> 16) & 255) * 0.3 + ((rgb >> 8) & 255) * 0.59 + (rgb & 255) * 0.11;
      this.nesGrid.append(h('button', {
        class: 'nes-color',
        style: { background: cssColor(rgb), color: lum > 128 ? '#000' : '#fff' },
        onclick: () => {
          if (!this.pickTarget) return toast('Tap a palette slot first');
          const { pal, slot } = this.pickTarget;
          this.customPals[pal][slot] = i;
          // the backdrop color is shared by every palette
          if (slot === 0) this.customPals.forEach((p) => (p[0] = i));
          this.usePpuPals = false;
          (this.el.querySelector('.check input') as HTMLInputElement).checked = false;
          this.render();
        },
      }, hex2(i)));
    }
  }

  private loadPpuPalettes() {
    if (!app.emu.rom) return toast('Run a game first');
    this.customPals = currentPalettes().idx.map((p) => [...p]);
    this.render();
  }

  private copyPalettes() {
    navigator.clipboard?.writeText(this.builderOut.textContent ?? '').then(
      () => toast('Copied palette lines'),
      () => toast('Copy failed; select the text instead'),
    );
  }
}
