// Input: keyboard on the Mac and the Gamepad API for a Bluetooth controller.
// The on-screen pad for phones lives in touchpad.ts. Every source feeds the
// InputMixer, and the NES sees the union.
import { app } from '../app';
import { BUTTONS } from '../emu/emulator';

const KEYMAP: Record<string, number> = {
  ArrowUp: BUTTONS.UP, ArrowDown: BUTTONS.DOWN, ArrowLeft: BUTTONS.LEFT, ArrowRight: BUTTONS.RIGHT,
  KeyX: BUTTONS.A, KeyZ: BUTTONS.B, KeyK: BUTTONS.A, KeyJ: BUTTONS.B,
  Enter: BUTTONS.START, ShiftRight: BUTTONS.SELECT, Backspace: BUTTONS.SELECT,
  KeyW: BUTTONS.UP, KeyS: BUTTONS.DOWN, KeyA: BUTTONS.LEFT, KeyD: BUTTONS.RIGHT,
};

/** Each input source tracks its own pressed set; the NES sees the union. */
class InputMixer {
  private sources = new Map<string, Set<number>>();
  private down = new Set<number>();

  set(source: string, pressed: Set<number>) {
    this.sources.set(source, pressed);
    const all = new Set<number>();
    for (const s of this.sources.values()) for (const b of s) all.add(b);
    for (const b of all) if (!this.down.has(b)) app.emu.buttonDown(b);
    for (const b of this.down) if (!all.has(b)) app.emu.buttonUp(b);
    this.down = all;
    this.listeners.forEach((f) => f(all));
  }
  listeners = new Set<(s: Set<number>) => void>();
}

export const input = new InputMixer();

export function gameHasFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  if (el.closest('.cm-editor')) return false;
  const tag = el.tagName;
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
}

export function initKeyboard() {
  const pressed = new Set<number>();
  const handle = (e: KeyboardEvent, down: boolean) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const b = KEYMAP[e.code];
    if (b === undefined || !gameHasFocus() || app.emu.state !== 'running') {
      if (!down && b !== undefined && pressed.delete(b)) input.set('kbd', new Set(pressed));
      return;
    }
    e.preventDefault();
    if (down) pressed.add(b);
    else pressed.delete(b);
    input.set('kbd', new Set(pressed));
  };
  window.addEventListener('keydown', (e) => handle(e, true));
  window.addEventListener('keyup', (e) => handle(e, false));
  window.addEventListener('blur', () => {
    pressed.clear();
    input.set('kbd', new Set());
  });
}

export function initGamepad() {
  // Standard mapping: 0 = A (bottom), 1 = B (right), 2 = X, 8 = select, 9 = start, 12-15 = d-pad
  const poll = () => {
    const pads = navigator.getGamepads?.() ?? [];
    const pressed = new Set<number>();
    for (const p of pads) {
      if (!p) continue;
      const b = (i: number) => p.buttons[i]?.pressed;
      if (b(0) || b(3)) pressed.add(BUTTONS.A);
      if (b(1) || b(2)) pressed.add(BUTTONS.B);
      if (b(8)) pressed.add(BUTTONS.SELECT);
      if (b(9)) pressed.add(BUTTONS.START);
      if (b(12) || p.axes[1] < -0.5) pressed.add(BUTTONS.UP);
      if (b(13) || p.axes[1] > 0.5) pressed.add(BUTTONS.DOWN);
      if (b(14) || p.axes[0] < -0.5) pressed.add(BUTTONS.LEFT);
      if (b(15) || p.axes[0] > 0.5) pressed.add(BUTTONS.RIGHT);
    }
    input.set('pad', pressed);
    requestAnimationFrame(poll);
  };
  window.addEventListener('gamepadconnected', () => requestAnimationFrame(poll), { once: true });
}
