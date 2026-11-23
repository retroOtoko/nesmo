// Input: keyboard on the Mac, an on-screen pad on the phone, and the
// Gamepad API for a Bluetooth controller. The touch pad keeps the trick from
// NesMo 1: slide your thumb from B onto A to hold both.
import { app } from '../app';
import { BUTTONS } from '../emu/emulator';
import { h } from './dom';

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

/** On-screen controller. Every touch point presses whatever zones it is over. */
export function touchPad(): HTMLElement {
  const zone = (cls: string, buttons: number[], label = '') =>
    h('div', { class: 'tp-zone ' + cls, 'data-buttons': buttons.join(',') }, label);
  const dpad = h('div', { class: 'tp-dpad' },
    zone('tp-ul', [BUTTONS.UP, BUTTONS.LEFT]), zone('tp-u', [BUTTONS.UP]), zone('tp-ur', [BUTTONS.UP, BUTTONS.RIGHT]),
    zone('tp-l', [BUTTONS.LEFT]), h('div', { class: 'tp-center' }), zone('tp-r', [BUTTONS.RIGHT]),
    zone('tp-dl', [BUTTONS.DOWN, BUTTONS.LEFT]), zone('tp-d', [BUTTONS.DOWN]), zone('tp-dr', [BUTTONS.DOWN, BUTTONS.RIGHT]),
  );
  const ab = h('div', { class: 'tp-ab' },
    zone('tp-b round', [BUTTONS.B], 'B'),
    zone('tp-ba', [BUTTONS.B, BUTTONS.A]),
    zone('tp-a round', [BUTTONS.A], 'A'),
  );
  const ss = h('div', { class: 'tp-ss' },
    zone('tp-select pill', [BUTTONS.SELECT], 'SELECT'),
    zone('tp-start pill', [BUTTONS.START], 'START'),
  );
  const pad = h('div', { class: 'touchpad' }, dpad, ss, ab);

  const update = (e: TouchEvent) => {
    e.preventDefault();
    const pressed = new Set<number>();
    for (const t of Array.from(e.touches)) {
      const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
      const z = el?.closest('.tp-zone') as HTMLElement | null;
      z?.dataset.buttons?.split(',').forEach((b) => pressed.add(+b));
    }
    input.set('touch', pressed);
  };
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    pad.addEventListener(ev, update, { passive: false });
  }
  // mouse fallback so it works on a desktop browser too
  let mouseDown = false;
  const mouse = (e: MouseEvent) => {
    if (!mouseDown) return input.set('touch', new Set());
    const z = (e.target as HTMLElement).closest('.tp-zone') as HTMLElement | null;
    input.set('touch', new Set(z?.dataset.buttons?.split(',').map(Number) ?? []));
  };
  pad.addEventListener('mousedown', (e) => { mouseDown = true; mouse(e); });
  pad.addEventListener('mousemove', mouse);
  window.addEventListener('mouseup', (e) => { if (mouseDown) { mouseDown = false; mouse(e); } });

  input.listeners.add((all) => {
    pad.querySelectorAll<HTMLElement>('.tp-zone').forEach((z) => {
      const bs = z.dataset.buttons!.split(',').map(Number);
      z.classList.toggle('on', bs.length === 1 && all.has(bs[0]));
    });
  });
  return pad;
}
