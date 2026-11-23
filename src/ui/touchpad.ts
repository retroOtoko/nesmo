// On-screen controller for phones, drawn as one SVG in NesMo 1's style:
// black shapes, a light rim, pixel lettering and grip lines on the d-pad.
//
// Hit testing is done with geometry in SVG units, not with DOM elements:
// - each finger stays bound to the control it first touched, so a thumb
//   that drifts off the d-pad keeps steering;
// - the d-pad is 8-way with narrower diagonals, so straight presses are easy;
// - between A and B is a zone that presses both (configurable), and sliding
//   from B onto A still works like it did in NesMo 1.
import { BUTTONS } from '../emu/emulator';
import { input } from './controller';

export type BetweenMode = 'both' | 'wide' | 'off';
export interface ControlSettings {
  between: BetweenMode;
}

const SETTINGS_KEY = 'nesmo:controls';
export function loadControlSettings(): ControlSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { between: s.between === 'wide' || s.between === 'off' ? s.between : 'both' };
  } catch {
    return { between: 'both' };
  }
}
export function saveControlSettings(s: ControlSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode: keep it for this session */
  }
  settingsListeners.forEach((f) => f(s));
}
const settingsListeners = new Set<(s: ControlSettings) => void>();

// ------------------------------------------------------------------ layout
// All coordinates are in the SVG's 360 x 210 viewBox.
const VIEW = { w: 360, h: 210 };
const DPAD = { cx: 78, cy: 95, arm: 23, reach: 70 }; // arm = half width, reach = center to tip
const R = 31; // A/B radius
const MID = { x: 272, y: 100 };
const ANGLE = (-17 * Math.PI) / 180;
const DIR = { x: Math.cos(ANGLE), y: Math.sin(ANGLE) };
const HALF_GAP = 38; // center of the pair to each button center
const B = { x: MID.x - DIR.x * HALF_GAP, y: MID.y - DIR.y * HALF_GAP };
const A = { x: MID.x + DIR.x * HALF_GAP, y: MID.y + DIR.y * HALF_GAP };
const PILL = { w: 58, h: 22, y: 190 };
const SELECT = { cx: 146, cy: PILL.y };
const START = { cx: 214, cy: PILL.y };

/** Portion of the B→A line (0 = B center, 1 = A center) that presses both. */
const BETWEEN_RANGE: Record<BetweenMode, [number, number] | null> = {
  both: [0.34, 0.66],
  wide: [0.24, 0.76],
  off: null,
};

// --------------------------------------------------------------- pixel font
// 5x7 glyphs, drawn as merged rectangles.
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
};

function pixelText(text: string, cx: number, cy: number, px: number): string {
  const width = (text.length * 6 - 1) * px;
  const x0 = cx - width / 2;
  const y0 = cy - 3.5 * px;
  let d = '';
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) return;
    g.forEach((row, y) => {
      for (let x = 0; x < 5; ) {
        if (row[x] !== '#') { x++; continue; }
        let run = 1;
        while (row[x + run] === '#') run++;
        const rx = +(x0 + (i * 6 + x) * px).toFixed(2);
        const ry = +(y0 + y * px).toFixed(2);
        d += `M${rx} ${ry}h${+(run * px).toFixed(2)}v${px}h${-(run * px).toFixed(2)}z`;
        x += run;
      }
    });
  });
  return d;
}

// ------------------------------------------------------------------ drawing
function crossPath(cx: number, cy: number, a: number, r: number, round = 7): string {
  // Plus-shaped outline with rounded arm tips.
  const k = round;
  return [
    `M${cx - a + k} ${cy - r}`, `H${cx + a - k}`, `Q${cx + a} ${cy - r} ${cx + a} ${cy - r + k}`,
    `V${cy - a}`, `H${cx + r - k}`, `Q${cx + r} ${cy - a} ${cx + r} ${cy - a + k}`,
    `V${cy + a - k}`, `Q${cx + r} ${cy + a} ${cx + r - k} ${cy + a}`, `H${cx + a}`,
    `V${cy + r - k}`, `Q${cx + a} ${cy + r} ${cx + a - k} ${cy + r}`, `H${cx - a + k}`,
    `Q${cx - a} ${cy + r} ${cx - a} ${cy + r - k}`, `V${cy + a}`, `H${cx - r + k}`,
    `Q${cx - r} ${cy + a} ${cx - r} ${cy + a - k}`, `V${cy - a + k}`, `Q${cx - r} ${cy - a} ${cx - r + k} ${cy - a}`,
    `H${cx - a}`, `V${cy - r + k}`, `Q${cx - a} ${cy - r} ${cx - a + k} ${cy - r}`, 'Z',
  ].join(' ');
}

function armGroup(dir: 'up' | 'down' | 'left' | 'right'): string {
  const { cx, cy, arm: a, reach: r } = DPAD;
  const inset = 2;
  let area = '';
  let ridges = '';
  const L = 11; // half length of a grip line
  if (dir === 'up' || dir === 'down') {
    const s = dir === 'up' ? -1 : 1;
    const y1 = cy + s * a;
    const y2 = cy + s * (r - inset);
    area = `M${cx - a + inset} ${Math.min(y1, y2)}H${cx + a - inset}V${Math.max(y1, y2)}H${cx - a + inset}Z`;
    for (const off of [17, 27]) {
      const y = cy + s * (r - off);
      ridges += `<line class="tp-ridge" x1="${cx - L}" y1="${y}" x2="${cx + L}" y2="${y}"/>`;
    }
  } else {
    const s = dir === 'left' ? -1 : 1;
    const x1 = cx + s * a;
    const x2 = cx + s * (r - inset);
    area = `M${Math.min(x1, x2)} ${cy - a + inset}H${Math.max(x1, x2)}V${cy + a - inset}H${Math.min(x1, x2)}Z`;
    for (const off of [17, 27]) {
      const x = cx + s * (r - off);
      ridges += `<line class="tp-ridge" x1="${x}" y1="${cy - L}" x2="${x}" y2="${cy + L}"/>`;
    }
  }
  return `<g class="tp-arm" data-dir="${dir}"><path class="tp-arm-light" d="${area}"/>${ridges}</g>`;
}

function roundButton(name: 'A' | 'B', c: { x: number; y: number }): string {
  return `<g class="tp-btn tp-${name.toLowerCase()}" data-btn="${name}">
    <circle class="tp-shadow" cx="${c.x}" cy="${c.y + 4}" r="${R}"/>
    <g class="tp-face">
      <circle class="tp-face-fill" cx="${c.x}" cy="${c.y}" r="${R}"/>
      <circle class="tp-ring" cx="${c.x}" cy="${c.y}" r="${R - 4}"/>
      <path class="tp-label" d="${pixelText(name, c.x, c.y, 3.6)}"/>
    </g>
  </g>`;
}

function pillButton(name: 'SELECT' | 'START', c: { cx: number; cy: number }): string {
  const x = c.cx - PILL.w / 2;
  const y = c.cy - PILL.h / 2;
  return `<g class="tp-btn tp-pill tp-${name.toLowerCase()}" data-btn="${name}">
    <rect class="tp-shadow" x="${x}" y="${y + 3}" width="${PILL.w}" height="${PILL.h}" rx="${PILL.h / 2}"/>
    <g class="tp-face">
      <rect class="tp-face-fill" x="${x}" y="${y}" width="${PILL.w}" height="${PILL.h}" rx="${PILL.h / 2}"/>
      <rect class="tp-ring" x="${x + 2.5}" y="${y + 2.5}" width="${PILL.w - 5}" height="${PILL.h - 5}" rx="${PILL.h / 2 - 2.5}"/>
      <path class="tp-label" d="${pixelText(name, c.cx, c.cy, 1.3)}"/>
    </g>
  </g>`;
}

function svgMarkup(): string {
  const { cx, cy, arm, reach } = DPAD;
  const deg = (ANGLE * 180) / Math.PI;
  const trayLen = HALF_GAP * 2 + (R + 6) * 2;
  const trayH = (R + 6) * 2;
  const plus = { x: MID.x, y: MID.y };
  return `<svg viewBox="0 0 ${VIEW.w} ${VIEW.h}" xmlns="http://www.w3.org/2000/svg" aria-label="NES controller">
  <defs>
    <linearGradient id="tpFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2f38"/><stop offset="1" stop-color="#121419"/>
    </linearGradient>
    <linearGradient id="tpFaceDown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15171c"/><stop offset="1" stop-color="#22262e"/>
    </linearGradient>
    <radialGradient id="tpBtn" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#363a44"/><stop offset="0.6" stop-color="#191b20"/><stop offset="1" stop-color="#0e0f12"/>
    </radialGradient>
    <radialGradient id="tpBtnDown" cx="0.5" cy="0.6" r="0.8">
      <stop offset="0" stop-color="#2a1715"/><stop offset="1" stop-color="#0e0f12"/>
    </radialGradient>
  </defs>
  <g class="tp-dpad">
    <path class="tp-shadow" d="${crossPath(cx, cy + 4, arm, reach)}"/>
    <path class="tp-cross" d="${crossPath(cx, cy, arm, reach)}"/>
    ${armGroup('up')}${armGroup('down')}${armGroup('left')}${armGroup('right')}
    <circle class="tp-dimple" cx="${cx}" cy="${cy}" r="10"/>
  </g>
  <g class="tp-ab">
    <rect class="tp-tray" x="${MID.x - trayLen / 2}" y="${MID.y - trayH / 2}" width="${trayLen}" height="${trayH}" rx="${trayH / 2}"
      transform="rotate(${deg.toFixed(2)} ${MID.x} ${MID.y})"/>
    <path class="tp-plus" d="${pixelText('+', plus.x, plus.y, 1.6)}"/>
    ${roundButton('B', B)}${roundButton('A', A)}
  </g>
  ${pillButton('SELECT', SELECT)}${pillButton('START', START)}
</svg>`;
}

// -------------------------------------------------------------- hit testing
type Control = 'dpad' | 'ab' | 'select' | 'start';
type Pt = { x: number; y: number };

const DIAGONAL_HALF_WIDTH = 15; // degrees either side of 45°, so diagonals are 30° wide

function dpadButtons(p: Pt): number[] {
  const dx = p.x - DPAD.cx;
  const dy = p.y - DPAD.cy;
  if (Math.hypot(dx, dy) < 11) return []; // resting on the center
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = right, 90 = down
  const nearestDiag = Math.round((deg - 45) / 90) * 90 + 45;
  if (Math.abs(deg - nearestDiag) <= DIAGONAL_HALF_WIDTH) {
    const h = Math.cos((nearestDiag * Math.PI) / 180) > 0 ? BUTTONS.RIGHT : BUTTONS.LEFT;
    const v = Math.sin((nearestDiag * Math.PI) / 180) > 0 ? BUTTONS.DOWN : BUTTONS.UP;
    return [h, v];
  }
  const card = Math.round(deg / 90) * 90;
  if (card === 0) return [BUTTONS.RIGHT];
  if (card === 90) return [BUTTONS.DOWN];
  if (card === -90) return [BUTTONS.UP];
  return [BUTTONS.LEFT];
}

function abButtons(p: Pt, mode: BetweenMode): number[] {
  const vx = A.x - B.x;
  const vy = A.y - B.y;
  const len2 = vx * vx + vy * vy;
  const t = ((p.x - B.x) * vx + (p.y - B.y) * vy) / len2;
  const perp = Math.abs((p.x - B.x) * vy - (p.y - B.y) * vx) / Math.sqrt(len2);
  const range = BETWEEN_RANGE[mode];
  if (range && t >= range[0] && t <= range[1] && perp <= R + 8) return [BUTTONS.B, BUTTONS.A];
  const dA = Math.hypot(p.x - A.x, p.y - A.y);
  const dB = Math.hypot(p.x - B.x, p.y - B.y);
  const near = Math.min(dA, dB);
  if (near > R * 2.2) return []; // slid well away: let go
  return [dA < dB ? BUTTONS.A : BUTTONS.B];
}

function inPill(p: Pt, c: { cx: number; cy: number }, slop: number) {
  return Math.abs(p.x - c.cx) <= PILL.w / 2 + slop && Math.abs(p.y - c.cy) <= PILL.h / 2 + slop;
}

/** Which control a new touch at p belongs to. Every spot on the pad maps to something. */
function controlAt(p: Pt): Control {
  if (inPill(p, SELECT, 10)) return 'select';
  if (inPill(p, START, 10)) return 'start';
  if (p.y > 172 && p.x > 112 && p.x < 248) return p.x < (SELECT.cx + START.cx) / 2 ? 'select' : 'start';
  return p.x < (DPAD.cx + DPAD.reach + MID.x - 80) / 2 ? 'dpad' : 'ab';
}

function buttonsFor(c: Control, p: Pt, mode: BetweenMode): number[] {
  switch (c) {
    case 'dpad': return dpadButtons(p);
    case 'ab': return abButtons(p, mode);
    case 'select': return inPill(p, SELECT, 24) ? [BUTTONS.SELECT] : [];
    case 'start': return inPill(p, START, 24) ? [BUTTONS.START] : [];
  }
}

// --------------------------------------------------------------- component
export function touchPad(): HTMLElement {
  const pad = document.createElement('div');
  pad.className = 'touchpad';
  pad.innerHTML = svgMarkup();
  const svg = pad.querySelector('svg')!;
  let settings = loadControlSettings();
  const plus = svg.querySelector('.tp-plus') as SVGElement;
  const applySettings = () => plus.classList.toggle('hidden', settings.between === 'off');
  applySettings();
  settingsListeners.add((s) => {
    settings = s;
    applySettings();
  });

  const toSvg = (clientX: number, clientY: number): Pt => {
    const m = svg.getScreenCTM();
    if (!m) return { x: -1, y: -1 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };

  const bound = new Map<number | string, Control>();
  const points = new Map<number | string, Pt>();
  const publish = () => {
    const pressed = new Set<number>();
    for (const [id, c] of bound) {
      const p = points.get(id);
      if (p) buttonsFor(c, p, settings.between).forEach((b) => pressed.add(b));
    }
    input.set('touch', pressed);
  };

  const onTouch = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const p = toSvg(t.clientX, t.clientY);
      if (e.type === 'touchstart') {
        bound.set(t.identifier, controlAt(p));
        points.set(t.identifier, p);
      } else if (e.type === 'touchmove') {
        if (bound.has(t.identifier)) points.set(t.identifier, p);
      } else {
        bound.delete(t.identifier);
        points.delete(t.identifier);
      }
    }
    publish();
  };
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    pad.addEventListener(ev, onTouch, { passive: false });
  }

  // Mouse, for trying the pad in a desktop browser.
  pad.addEventListener('mousedown', (e) => {
    const p = toSvg(e.clientX, e.clientY);
    bound.set('mouse', controlAt(p));
    points.set('mouse', p);
    publish();
  });
  window.addEventListener('mousemove', (e) => {
    if (!bound.has('mouse')) return;
    points.set('mouse', toSvg(e.clientX, e.clientY));
    publish();
  });
  window.addEventListener('mouseup', () => {
    if (!bound.delete('mouse')) return;
    points.delete('mouse');
    publish();
  });
  const releaseAll = () => {
    bound.clear();
    points.clear();
    publish();
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => document.hidden && releaseAll());

  // Pressed states follow every input source (touch, keyboard, gamepad).
  const arms = {
    up: svg.querySelector('[data-dir="up"]')!, down: svg.querySelector('[data-dir="down"]')!,
    left: svg.querySelector('[data-dir="left"]')!, right: svg.querySelector('[data-dir="right"]')!,
  };
  const btns = {
    A: svg.querySelector('[data-btn="A"]')!, B: svg.querySelector('[data-btn="B"]')!,
    SELECT: svg.querySelector('[data-btn="SELECT"]')!, START: svg.querySelector('[data-btn="START"]')!,
  };
  const tray = svg.querySelector('.tp-tray')!;
  input.listeners.add((all) => {
    arms.up.classList.toggle('pressed', all.has(BUTTONS.UP));
    arms.down.classList.toggle('pressed', all.has(BUTTONS.DOWN));
    arms.left.classList.toggle('pressed', all.has(BUTTONS.LEFT));
    arms.right.classList.toggle('pressed', all.has(BUTTONS.RIGHT));
    btns.A.classList.toggle('pressed', all.has(BUTTONS.A));
    btns.B.classList.toggle('pressed', all.has(BUTTONS.B));
    btns.SELECT.classList.toggle('pressed', all.has(BUTTONS.SELECT));
    btns.START.classList.toggle('pressed', all.has(BUTTONS.START));
    const both = all.has(BUTTONS.A) && all.has(BUTTONS.B);
    tray.classList.toggle('both', both);
    plus.classList.toggle('on', both);
  });
  return pad;
}

/** Geometry for tests: button centers in SVG units. */
export const PAD_GEOMETRY = { DPAD, A, B, R, SELECT, START, VIEW };
