// CPU debugger: run control, registers, code around PC with breakpoints,
// variables from the debug file, the stack and a RAM viewer.
import { app } from '../app';
import { disasmAround, hex2, hex4 } from '../cpu6502/disasm';
import { h, clear, throttle, isPhone } from './dom';
import type { Screens } from './screen';

const REASONS: Record<string, string> = {
  breakpoint: 'Hit breakpoint',
  step: 'Stepped',
  user: 'Paused',
  frame: 'Advanced one frame',
  load: 'Loaded, paused at reset',
  crash: 'Crashed',
};

export class DebuggerPanel {
  el: HTMLElement;
  private status = h('div', { class: 'dbg-status' });
  private regs = h('div', { class: 'dbg-regs' });
  private code = h('div', { class: 'dbg-code' });
  private vars = h('div', { class: 'dbg-vars' });
  private stack = h('div', { class: 'dbg-stack mono' });
  private ram = h('div', { class: 'dbg-ram mono' });
  private ramPage = 0;
  private pageTabs = h('div', { class: 'seg' });
  private runBtn = h('button', { class: 'btn primary', onclick: () => this.toggleRun() }, '▶ Run');
  private knownStarts: Set<number> | undefined;
  onRevealSource: (file: string, line: number) => void = () => {};
  visible = () => this.el.offsetParent !== null;

  constructor(screens: Screens) {
    const btn = (label: string, title: string, fn: () => void) =>
      h('button', { class: 'btn', title, onclick: fn }, label);
    const toolbar = h('div', { class: 'dbg-toolbar' },
      this.runBtn,
      btn('Step', 'Step into (F11)', () => app.emu.stepInstruction()),
      btn('Over', 'Step over (F10)', () => app.emu.stepOver()),
      btn('Out', 'Step out (Shift+F11)', () => app.emu.stepOut()),
      btn('Frame', 'Run one frame', () => app.emu.stepFrame()),
      btn('Reset', 'Reset the NES', () => app.emu.reset()),
    );
    const pages = ['ZP $00', 'Stack $01', 'OAM $02', '$03', '$04', '$05', '$06', '$07'];
    pages.forEach((p, i) =>
      this.pageTabs.appendChild(h('button', { class: i === 0 ? 'on' : '', onclick: () => { this.ramPage = i; this.renderRam(); } }, p)),
    );
    const mini = h('div', { class: 'mini-screen phone-only' }, screens.create('screen small'));
    this.el = h('div', { class: 'panel-body debugger' },
      mini,
      toolbar,
      this.status,
      this.regs,
      h('h3', null, 'Code'),
      this.code,
      h('h3', null, 'Variables'),
      this.vars,
      h('h3', null, 'Stack'),
      this.stack,
      h('h3', null, 'RAM'),
      this.pageTabs,
      this.ram,
    );

    this.code.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const src = t.closest('[data-src]') as HTMLElement | null;
      if (src) {
        const [file, line] = src.dataset.src!.split('|');
        this.onRevealSource(file, +line);
        return;
      }
      const row = t.closest('[data-addr]') as HTMLElement | null;
      if (row) app.toggleAddressBreakpoint(+row.dataset.addr!);
    });
    this.ram.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-addr]') as HTMLElement | null;
      if (!b || app.emu.state !== 'paused') return;
      const addr = +b.dataset.addr!;
      const v = prompt(`New value for $${hex4(addr)} (hex)`, hex2(app.emu.peek(addr)));
      if (v !== null && /^[0-9a-f]{1,2}$/i.test(v.trim())) app.emu.poke(addr, parseInt(v, 16));
    });
    this.regs.addEventListener('click', (e) => {
      const r = (e.target as HTMLElement).closest('[data-reg]') as HTMLElement | null;
      if (!r || app.emu.state !== 'paused') return;
      const reg = r.dataset.reg as 'A' | 'X' | 'Y' | 'SP' | 'PC';
      const cur = { A: app.emu.cpu.REG_ACC, X: app.emu.cpu.REG_X, Y: app.emu.cpu.REG_Y, SP: app.emu.cpu.REG_SP, PC: app.emu.cpu.REG_PC }[reg];
      const v = prompt(`New value for ${reg} (hex)`, reg === 'PC' ? hex4(cur) : hex2(cur));
      if (v !== null && /^[0-9a-f]{1,4}$/i.test(v.trim())) app.emu.setRegister(reg, parseInt(v, 16));
    });

    const live = throttle(() => this.visible() && this.renderLive(), 150);
    app.emu.subscribe(() => this.render());
    app.emu.onFrame(() => live());
    app.on('build', () => {
      this.knownStarts = app.dbg ? new Set(app.dbg.addrToLoc.keys()) : undefined;
      this.render();
    });
    app.on('breakpoints', () => this.renderCode());
    this.render();
  }

  toggleRun() {
    const emu = app.emu;
    if (!emu.rom) return;
    if (emu.state === 'running') emu.pause();
    else emu.resume();
  }

  render() {
    const emu = app.emu;
    const running = emu.state === 'running';
    this.runBtn.replaceChildren(running ? '❚❚' : '▶', h('span', { class: 'lbl' }, running ? ' Pause' : ' Run'));
    this.renderStatus();
    this.renderRegs();
    this.renderCode();
    this.renderLive();
  }

  private renderLive() {
    this.renderVars();
    this.renderStack();
    this.renderRam();
    if (app.emu.state === 'running') {
      this.renderRegs();
      this.renderStatus();
    }
  }

  private renderStatus() {
    const emu = app.emu;
    if (!emu.rom) {
      this.status.textContent = 'Build a project to start debugging.';
      return;
    }
    const p = emu.lastPause;
    const what = emu.state === 'running' ? 'Running' : p ? REASONS[p.reason] + (p.message ? `: ${p.message}` : '') : 'Paused';
    const cyc = emu.cpu.cycles - emu.pauseCycles;
    clear(this.status);
    this.status.append(
      h('b', { class: emu.lastPause?.reason === 'crash' ? 'err' : '' }, what),
      h('span', null, `frame ${emu.frameCount}`),
      h('span', null, `scanline ${emu.ppu.line} · dot ${emu.ppu.dot}`),
    );
    if (emu.state === 'paused' && cyc > 0) this.status.append(h('span', null, `+${cyc} cycles`));
  }

  private renderRegs() {
    const emu = app.emu;
    clear(this.regs);
    if (!emu.rom) return;
    const c = emu.cpu;
    const reg = (name: 'A' | 'X' | 'Y' | 'SP' | 'PC', v: string) =>
      h('div', { class: 'reg', 'data-reg': name }, h('label', null, name), h('span', null, '$' + v));
    const f = emu.flags();
    const flag = (k: keyof typeof f) => h('span', { class: 'flag' + (f[k] ? ' on' : '') }, k);
    this.regs.append(
      reg('A', hex2(c.REG_ACC)), reg('X', hex2(c.REG_X)), reg('Y', hex2(c.REG_Y)),
      reg('SP', hex2(c.REG_SP)), reg('PC', hex4(c.REG_PC)),
      h('div', { class: 'flags' }, flag('N'), flag('V'), flag('D'), flag('I'), flag('Z'), flag('C')),
    );
  }

  private renderCode() {
    const emu = app.emu;
    clear(this.code);
    if (!emu.rom) return;
    if (emu.state === 'running') {
      this.code.append(h('div', { class: 'muted pad' }, 'Pause (or hit a breakpoint) to see code here. Tap a line to toggle a breakpoint.'));
      return;
    }
    const pc = emu.cpu.REG_PC;
    const dbg = app.dbg;
    const label = (a: number) => dbg?.addrToLabel.get(a);
    const known = this.knownStarts && this.knownStarts.has(pc) ? this.knownStarts : undefined;
    const lines = disasmAround(pc, isPhone() ? 4 : 6, isPhone() ? 10 : 14, (a) => emu.peek(a), label, known);
    for (const l of lines) {
      const name = dbg?.addrToLabel.get(l.addr);
      if (name) this.code.append(h('div', { class: 'dis-label' }, name + ':'));
      const loc = dbg?.addrToLoc.get(l.addr);
      const isBp = emu.breakpoints.has(l.addr);
      const src = loc ? app.sourceText(loc.file)?.split('\n')[loc.line - 1]?.trim() : undefined;
      const comment = src && src.includes(';') ? src.slice(src.indexOf(';')) : '';
      this.code.append(
        h('div', { class: 'dis' + (l.addr === pc ? ' pc' : '') + (isBp ? ' bp' : ''), 'data-addr': l.addr },
          h('span', { class: 'dis-bp' }),
          h('span', { class: 'dis-addr' }, hex4(l.addr)),
          h('span', { class: 'dis-bytes' }, l.bytes.map(hex2).join(' ')),
          h('span', { class: 'dis-text' }, l.text),
          comment ? h('span', { class: 'dis-comment' }, comment) : null,
          loc ? h('span', { class: 'dis-src', 'data-src': `${loc.file}|${loc.line}` }, `${loc.file}:${loc.line}`) : null,
        ),
      );
    }
  }

  private renderVars() {
    clear(this.vars);
    const emu = app.emu;
    const syms = app.dbg?.ramSymbols().sort((a, b) => a.value - b.value) ?? [];
    if (!emu.rom || !syms.length) {
      this.vars.append(h('div', { class: 'muted pad' }, 'Labels in ZEROPAGE or BSS show up here with their live values.'));
      return;
    }
    for (const s of syms) {
      const v = emu.peek(s.value);
      const changed = emu.state === 'paused' && emu.ramAtPause[s.value & 0x7ff] !== v;
      this.vars.append(
        h('div', { class: 'var' + (changed ? ' changed' : '') },
          h('span', { class: 'var-name' }, s.name),
          h('span', { class: 'var-addr mono' }, '$' + (s.value < 0x100 ? hex2(s.value) : hex4(s.value))),
          h('span', { class: 'var-val mono' }, `$${hex2(v)}  ${v}`),
        ),
      );
    }
  }

  private renderStack() {
    const emu = app.emu;
    if (!emu.rom) return void (this.stack.textContent = '');
    const sp = emu.cpu.REG_SP;
    const items: string[] = [];
    for (let a = sp + 1; a <= 0xff && items.length < 16; a++) items.push(hex2(emu.peek(0x100 + a)));
    this.stack.textContent = items.length ? `SP=$${hex2(sp)}  ${items.join(' ')}` : `SP=$${hex2(sp)}  (empty)`;
  }

  private renderRam() {
    const emu = app.emu;
    [...this.pageTabs.children].forEach((b, i) => b.classList.toggle('on', i === this.ramPage));
    if (!emu.rom) return void (this.ram.innerHTML = '');
    const cols = this.ram.clientWidth > 520 ? 16 : 8;
    const base = this.ramPage * 0x100;
    const mem = emu.cpu.mem;
    const before = emu.ramAtPause;
    const paused = emu.state === 'paused';
    let html = '';
    for (let row = 0; row < 256; row += cols) {
      html += `<div class="ram-row"><span class="ram-addr">${hex4(base + row)}</span>`;
      for (let i = 0; i < cols; i++) {
        const a = base + row + i;
        const v = mem[a];
        const cls = paused && before[a] !== v ? 'b changed' : v ? 'b' : 'b zero';
        html += `<span class="${cls}" data-addr="${a}">${hex2(v)}</span>`;
      }
      html += '</div>';
    }
    this.ram.innerHTML = html;
  }
}
