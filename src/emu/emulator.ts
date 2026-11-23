// Wraps jsnes with a frame loop we control, so the debugger can stop on any
// instruction, step, and peek at memory without side effects.
import { NES } from 'jsnes';
import { AudioOut } from './audio';

/** The bits of jsnes internals the debugger reads. */
export interface JsnesCPU {
  REG_PC: number; REG_ACC: number; REG_X: number; REG_Y: number; REG_SP: number;
  F_CARRY: number; F_ZERO: number; F_INTERRUPT: number; F_DECIMAL: number;
  F_OVERFLOW: number; F_SIGN: number;
  mem: Uint8Array;
  cycles: number;
  emulate(): number;
  getStatus(): number;
}
export interface JsnesPPU {
  vramMem: Uint8Array;
  spriteMem: Uint8Array;
  buffer: Uint32Array;
  frameEnded: boolean;
  line: number;
  dot: number;
  palTable: { getEntry(i: number): number };
  mirroredLoad(addr: number): number;
  f_nmiOnVblank: number; f_spriteSize: number; f_bgPatternTable: number;
  f_spPatternTable: number; f_addrInc: number; f_nTblAddress: number;
  f_color: number; f_spVisibility: number; f_bgVisibility: number;
  f_spClipping: number; f_bgClipping: number; f_dispType: number;
}
type NESInternals = NES & { cpu: JsnesCPU; ppu: JsnesPPU; crashed: boolean; mmap: unknown };

export type RunState = 'empty' | 'running' | 'paused';

export interface PauseInfo {
  reason: 'breakpoint' | 'step' | 'user' | 'crash' | 'frame' | 'load';
  message?: string;
}

const FRAME_MS = 1000 / 60.0988;
const OP_JSR = 0x20;
const OP_RTS = 0x60;
const OP_RTI = 0x40;

export class Emulator {
  nes!: NESInternals;
  state: RunState = 'empty';
  breakpoints = new Set<number>();
  frameCount = 0;
  rom: Uint8Array | null = null;
  audio = new AudioOut();
  lastPause: PauseInfo | null = null;
  /** CPU cycle count when the emulator last started running (for "cycles since") */
  pauseCycles = 0;
  /** RAM snapshot from when it last started running, to highlight what changed */
  ramAtPause = new Uint8Array(0x800);
  speed = 1;

  private listeners = new Set<() => void>();
  private frameListeners = new Set<(buf: Uint32Array) => void>();
  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private tempBreak: number | null = null;
  private stepOutSP: number | null = null;
  private skipBreakAt: number | null = null;

  constructor() {
    this.makeNES();
  }

  private makeNES() {
    this.nes = new NES({
      onFrame: (buf: Uint32Array) => this.frameListeners.forEach((f) => f(buf)),
      onAudioSample: (l: number, r: number) => this.audio.push(l, r),
      emulateSound: true,
      sampleRate: this.audio.sampleRate,
    }) as NESInternals;
    this.showOverscan();
  }

  /** Show all 256x240 pixels; jsnes blanks the 8px TV border by default. */
  private showOverscan() {
    (this.nes.ppu as unknown as { clipToTvSize: boolean }).clipToTvSize = false;
  }

  get cpu() { return this.nes.cpu; }
  get ppu() { return this.nes.ppu; }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onFrame(fn: (buf: Uint32Array) => void) { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }

  load(rom: Uint8Array, run = true) {
    this.stopLoop();
    this.rom = rom;
    this.makeNES();
    this.nes.loadROM(rom); // creates a fresh PPU
    this.showOverscan();
    this.frameCount = 0;
    this.snapshot();
    if (run) this.resume();
    else this.pause({ reason: 'load' });
  }

  reset() {
    if (!this.rom) return;
    const wasRunning = this.state === 'running';
    this.load(this.rom, wasRunning);
  }

  // ---------------------------------------------------------------- loop
  resume() {
    if (!this.rom) return;
    this.snapshot();
    this.skipBreakAt = this.cpu.REG_PC; // don't stop on the breakpoint we're sitting on
    this.state = 'running';
    this.lastPause = null;
    this.lastTime = performance.now();
    this.acc = 0;
    this.audio.setPaused(false);
    this.emit();
    this.loop();
  }

  pause(info: PauseInfo = { reason: 'user' }) {
    this.stopLoop();
    if (!this.rom) return;
    this.state = 'paused';
    this.lastPause = info;
    this.tempBreak = null;
    this.stepOutSP = null;
    this.audio.setPaused(true);
    this.emit();
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    this.acc += Math.min(now - this.lastTime, 100) * this.speed;
    this.lastTime = now;
    let frames = 0;
    while (this.acc >= FRAME_MS && frames < 4) {
      this.acc -= FRAME_MS;
      frames++;
      if (!this.runFrame()) return;
    }
  };

  /** Runs until the end of the current frame. Returns false if it stopped early. */
  runFrame(): boolean {
    const nes = this.nes;
    const cpu = nes.cpu;
    const ppu = nes.ppu;
    const checking = this.breakpoints.size > 0 || this.tempBreak !== null || this.stepOutSP !== null;
    try {
      if (!checking) {
        while (!ppu.frameEnded) cpu.emulate();
      } else {
        while (!ppu.frameEnded) {
          const pc = cpu.REG_PC;
          if (pc !== this.skipBreakAt) {
            if (this.breakpoints.has(pc)) {
              this.pause({ reason: 'breakpoint' });
              return false;
            }
            if (pc === this.tempBreak) {
              this.pause({ reason: 'step' });
              return false;
            }
          }
          this.skipBreakAt = null;
          const op = cpu.mem[pc]; // PRG is mirrored into cpu.mem for NROM-style mappers
          const sp = cpu.REG_SP;
          cpu.emulate();
          if (this.stepOutSP !== null && (op === OP_RTS || op === OP_RTI) && sp >= this.stepOutSP) {
            this.pause({ reason: 'step' });
            return false;
          }
        }
      }
    } catch (e) {
      this.pause({ reason: 'crash', message: String(e) });
      return false;
    }
    this.skipBreakAt = null;
    ppu.frameEnded = false;
    this.frameCount++;
    return true;
  }

  // ------------------------------------------------------------- stepping
  stepInstruction() {
    if (!this.rom) return;
    this.stopLoop();
    this.snapshot();
    try {
      this.cpu.emulate();
    } catch (e) {
      this.pause({ reason: 'crash', message: String(e) });
      return;
    }
    if (this.ppu.frameEnded) {
      this.ppu.frameEnded = false;
      this.frameCount++;
    }
    this.pause({ reason: 'step' });
  }

  stepOver() {
    if (!this.rom) return;
    const pc = this.cpu.REG_PC;
    if (this.peek(pc) === OP_JSR) this.runTo((pc + 3) & 0xffff);
    else this.stepInstruction();
  }

  stepOut() {
    if (!this.rom) return;
    const sp = this.cpu.REG_SP;
    this.resume();
    // stop once an RTS/RTI pops the frame we're in
    this.stepOutSP = sp;
  }

  runTo(addr: number) {
    this.resume();
    this.tempBreak = addr;
  }

  stepFrame() {
    if (!this.rom) return;
    this.stopLoop();
    this.snapshot();
    this.skipBreakAt = this.cpu.REG_PC;
    if (this.runFrame()) this.pause({ reason: 'frame' });
  }

  toggleBreakpoint(addr: number) {
    if (this.breakpoints.has(addr)) this.breakpoints.delete(addr);
    else this.breakpoints.add(addr);
    this.emit();
  }

  setBreakpoints(addrs: Iterable<number>) {
    this.breakpoints = new Set(addrs);
    this.emit();
  }

  private snapshot() {
    if (!this.rom) return;
    this.pauseCycles = this.cpu.cycles;
    this.ramAtPause = this.cpu.mem.slice(0, 0x800);
  }

  // --------------------------------------------------------------- memory
  /** Read memory without the side effects a real read would have. */
  peek(addr: number): number {
    addr &= 0xffff;
    const mem = this.cpu.mem;
    if (addr < 0x2000) return mem[addr & 0x7ff];
    if (addr >= 0x6000) return mem[addr];
    return 0;
  }

  poke(addr: number, value: number) {
    if (addr < 0x2000) this.cpu.mem[addr & 0x7ff] = value & 0xff;
    else if (addr >= 0x6000 && addr < 0x8000) this.cpu.mem[addr] = value & 0xff;
    this.emit();
  }

  ppuPeek(addr: number): number {
    addr &= 0x3fff;
    if (addr < 0x2000) return this.ppu.vramMem[addr];
    return this.ppu.mirroredLoad(addr);
  }

  flags() {
    const c = this.cpu;
    return {
      N: c.F_SIGN ? 1 : 0,
      V: c.F_OVERFLOW ? 1 : 0,
      D: c.F_DECIMAL ? 1 : 0,
      I: c.F_INTERRUPT ? 1 : 0,
      Z: c.F_ZERO === 0 ? 1 : 0,
      C: c.F_CARRY ? 1 : 0,
    };
  }

  setRegister(reg: 'A' | 'X' | 'Y' | 'SP' | 'PC', value: number) {
    const c = this.cpu;
    if (reg === 'A') c.REG_ACC = value & 0xff;
    if (reg === 'X') c.REG_X = value & 0xff;
    if (reg === 'Y') c.REG_Y = value & 0xff;
    if (reg === 'SP') c.REG_SP = value & 0xff;
    if (reg === 'PC') c.REG_PC = value & 0xffff;
    this.emit();
  }

  // ---------------------------------------------------------------- input
  buttonDown(b: number) { if (this.rom) this.nes.buttonDown(1, b as any); }
  buttonUp(b: number) { if (this.rom) this.nes.buttonUp(1, b as any); }
}

export const BUTTONS = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 } as const;
