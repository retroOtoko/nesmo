// Pocket reference: 6502 instructions, NES registers and the memory map.
import { BY_MNEMONIC, MNEMONICS, MODE_NAMES, MODE_SYNTAX } from '../cpu6502/opcodes';
import { hex2 } from '../cpu6502/disasm';
import { h, clear } from './dom';

interface RegInfo { addr: string; name: string; access: string; bits?: string[]; note: string }

const NES_REGS: RegInfo[] = [
  { addr: '$2000', name: 'PPUCTRL', access: 'write', note: 'Write once per frame in vblank, or when changing the base nametable.',
    bits: ['7  V  NMI at start of vblank (1 = on)', '6  P  PPU master/slave (leave 0)', '5  H  sprite size: 0 = 8x8, 1 = 8x16',
      '4  B  background pattern table: 0 = $0000, 1 = $1000', '3  S  sprite pattern table (8x8): 0 = $0000, 1 = $1000',
      '2  I  VRAM increment per PPUDATA access: 0 = +1 across, 1 = +32 down', '1-0 NN base nametable: 0 = $2000, 1 = $2400, 2 = $2800, 3 = $2C00'] },
  { addr: '$2001', name: 'PPUMASK', access: 'write', note: '%00011110 shows background and sprites, including the leftmost 8 pixels.',
    bits: ['7  B  emphasize blue', '6  G  emphasize green (red on PAL)', '5  R  emphasize red (green on PAL)',
      '4  s  show sprites', '3  b  show background', '2  M  show sprites in leftmost 8 pixels',
      '1  m  show background in leftmost 8 pixels', '0  G  greyscale'] },
  { addr: '$2002', name: 'PPUSTATUS', access: 'read', note: 'Reading it clears bit 7 and resets the $2005/$2006 write latch. BIT PPUSTATUS / BPL waits for vblank.',
    bits: ['7  V  vblank has started', '6  S  sprite 0 hit', '5  O  sprite overflow (buggy)', '4-0 open bus'] },
  { addr: '$2003', name: 'OAMADDR', access: 'write', note: 'Set to 0 before writing $4014.' },
  { addr: '$2004', name: 'OAMDATA', access: 'read/write', note: 'Slow and glitchy for writes; use OAM DMA ($4014) instead.' },
  { addr: '$2005', name: 'PPUSCROLL', access: 'write ×2', note: 'First write X scroll, second write Y scroll. Write both at the end of every NMI, after any $2006 use.' },
  { addr: '$2006', name: 'PPUADDR', access: 'write ×2', note: 'High byte, then low byte of the VRAM address. Read PPUSTATUS first to reset the latch.' },
  { addr: '$2007', name: 'PPUDATA', access: 'read/write', note: 'Reads and writes VRAM at PPUADDR, then steps it by 1 or 32. Only safe while rendering is off or in vblank.' },
  { addr: '$4014', name: 'OAMDMA', access: 'write', note: 'Write $02 to copy $0200-$02FF into sprite memory (513-514 CPU cycles). Do it every NMI.' },
  { addr: '$4016', name: 'JOYPAD1', access: 'read/write', note: 'Write 1 then 0 to latch buttons, then read 8 times: A, B, Select, Start, Up, Down, Left, Right (bit 0).' },
  { addr: '$4017', name: 'JOYPAD2 / frame counter', access: 'read/write', note: 'Reads controller 2. Writing $40 disables the APU frame IRQ (reset code does this).' },
  { addr: '$4000-$4003', name: 'Pulse 1', access: 'write', note: 'Duty/volume, sweep, timer low, length + timer high.' },
  { addr: '$4004-$4007', name: 'Pulse 2', access: 'write', note: 'Same layout as pulse 1.' },
  { addr: '$4008-$400B', name: 'Triangle', access: 'write', note: 'Linear counter, unused, timer low, length + timer high.' },
  { addr: '$400C-$400F', name: 'Noise', access: 'write', note: 'Volume, unused, mode + period, length.' },
  { addr: '$4010-$4013', name: 'DMC', access: 'write', note: 'Sample playback. Writing 0 to $4010 disables DMC IRQs.' },
  { addr: '$4015', name: 'APU status', access: 'read/write', note: 'Write to enable channels (%00001111 = pulse, pulse, triangle, noise).' },
];

const MEMORY_MAP = [
  ['$0000-$00FF', 'Zero page: fastest RAM, use for hot variables'],
  ['$0100-$01FF', 'Stack'],
  ['$0200-$02FF', 'Usually the OAM buffer copied by $4014'],
  ['$0300-$07FF', 'General RAM'],
  ['$0800-$1FFF', 'Mirrors of $0000-$07FF'],
  ['$2000-$2007', 'PPU registers (mirrored to $3FFF)'],
  ['$4000-$4017', 'APU and I/O registers'],
  ['$6000-$7FFF', 'Cartridge RAM, if the board has it'],
  ['$8000-$FFFF', 'PRG ROM'],
  ['$FFFA-$FFFF', 'Vectors: NMI, RESET, IRQ'],
];

const PPU_MAP = [
  ['$0000-$0FFF', 'Pattern table 0 (CHR)'],
  ['$1000-$1FFF', 'Pattern table 1 (CHR)'],
  ['$2000-$23BF', 'Nametable 0 tiles (32 x 30)'],
  ['$23C0-$23FF', 'Nametable 0 attributes (one byte per 32x32 px)'],
  ['$2400 / $2800 / $2C00', 'Nametables 1-3 (two are mirrors)'],
  ['$3F00', 'Universal background color'],
  ['$3F01-$3F0F', 'Background palettes 0-3'],
  ['$3F11-$3F1F', 'Sprite palettes 0-3'],
];

const LINKS: [string, string][] = [
  ['famicom.party book', 'https://famicom.party/book/'],
  ['NESdev wiki', 'https://www.nesdev.org/wiki/Nesdev_Wiki'],
  ['PPU registers', 'https://www.nesdev.org/wiki/PPU_registers'],
  ['6502 instruction reference', 'https://www.nesdev.org/obelisk-6502-guide/reference.html'],
  ['ca65 users guide', 'https://cc65.github.io/doc/ca65.html'],
];

export class ReferencePanel {
  el: HTMLElement;
  private list = h('div', { class: 'ref-list' });
  private search: HTMLInputElement;
  private section = 'ops';
  private segBtns: Record<string, HTMLButtonElement> = {};

  constructor() {
    this.search = h('input', { type: 'search', placeholder: 'Search: LDA, carry, $2006, sprite…', oninput: () => this.render(), autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    const seg = (id: string, label: string) => {
      const b = h('button', { onclick: () => { this.section = id; this.render(); } }, label);
      this.segBtns[id] = b;
      return b;
    };
    this.el = h('div', { class: 'panel-body ref' },
      this.search,
      h('div', { class: 'seg' }, seg('ops', '6502'), seg('regs', 'Registers'), seg('map', 'Memory'), seg('links', 'Links')),
      this.list,
    );
    this.render();
  }

  /** Jump to an instruction (used from the editor). */
  showMnemonic(m: string) {
    this.section = 'ops';
    this.search.value = m;
    this.render();
  }

  render() {
    const q = this.search.value.trim().toLowerCase();
    Object.entries(this.segBtns).forEach(([k, b]) => b.classList.toggle('on', k === this.section && !q));
    clear(this.list);
    if (q || this.section === 'ops') this.renderOps(q);
    if (q || this.section === 'regs') this.renderRegs(q);
    if (q || this.section === 'map') this.renderMap(q);
    if (!q && this.section === 'links') this.renderLinks();
  }

  private renderOps(q: string) {
    for (const [m, info] of Object.entries(MNEMONICS)) {
      const hay = `${m} ${info.name} ${info.summary} ${info.detail} ${info.flags}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const ops = BY_MNEMONIC[m];
      const exact = q === m.toLowerCase();
      const details = h('details', { class: 'ref-item', open: exact },
        h('summary', null, h('b', { class: 'mono' }, m), ' ', info.name, h('span', { class: 'ref-flags mono' }, info.flags || '—')),
        h('div', { class: 'ref-body' },
          h('div', { class: 'mono' }, info.summary),
          h('p', null, info.detail),
          h('table', { class: 'mono' },
            h('tr', null, h('th', null, 'Mode'), h('th', null, 'Syntax'), h('th', null, 'Op'), h('th', null, 'Bytes'), h('th', null, 'Cycles')),
            ...ops.map((o) => h('tr', null,
              h('td', null, MODE_NAMES[o.mode]),
              h('td', null, `${m} ${MODE_SYNTAX[o.mode]}`.trim()),
              h('td', null, '$' + hex2(o.op)),
              h('td', null, String(o.bytes)),
              h('td', null, o.cycles + (o.extra ? (o.mode === 'rel' ? '+1/2' : '+1') : '')),
            )),
          ),
        ),
      );
      this.list.append(details);
    }
  }

  private renderRegs(q: string) {
    for (const r of NES_REGS) {
      const hay = `${r.addr} ${r.name} ${r.note} ${(r.bits ?? []).join(' ')}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      this.list.append(
        h('details', { class: 'ref-item', open: !!q && hay.includes(q) && q.startsWith('$') },
          h('summary', null, h('b', { class: 'mono' }, r.addr), ' ', r.name, h('span', { class: 'ref-flags' }, r.access)),
          h('div', { class: 'ref-body' },
            h('p', null, r.note),
            r.bits ? h('pre', { class: 'mono' }, r.bits.join('\n')) : null,
          ),
        ),
      );
    }
  }

  private renderMap(q: string) {
    const table = (title: string, rows: string[][]) => {
      const hits = rows.filter(([a, d]) => !q || `${a} ${d}`.toLowerCase().includes(q));
      if (!hits.length) return;
      this.list.append(h('h3', null, title),
        h('table', { class: 'mono map' }, ...hits.map(([a, d]) => h('tr', null, h('td', null, a), h('td', null, d)))));
    };
    table('CPU memory map', MEMORY_MAP);
    table('PPU memory map', PPU_MAP);
  }

  private renderLinks() {
    this.list.append(...LINKS.map(([t, u]) => h('a', { class: 'ref-link', href: u, target: '_blank', rel: 'noopener' }, t)));
  }
}
