import './style.css';
import { app } from './app';
import { openInitialProject, flushSave, isText } from './project/store';
import { warmUp } from './toolchain/client';
import { CodeEditor } from './ui/editor';
import { Screens } from './ui/screen';
import { touchPad, initKeyboard, initGamepad } from './ui/controller';
import { DebuggerPanel } from './ui/debugger';
import { PpuPanel } from './ui/ppu';
import { ChrPanel } from './ui/chreditor';
import { ReferencePanel } from './ui/reference';
import { FilesDrawer } from './ui/files';
import { h, clear, toast, isPhone } from './ui/dom';
import type { BuildResult } from './toolchain/build';

type View = 'code' | 'play' | 'debug' | 'ppu' | 'chr' | 'ref';
type Tool = 'debug' | 'ppu' | 'chr' | 'ref';

const root = document.getElementById('app')!;
const screens = new Screens();
const drawer = new FilesDrawer();
const debuggerPanel = new DebuggerPanel(screens);
const ppuPanel = new PpuPanel();
const chrPanel = new ChrPanel();
const refPanel = new ReferencePanel();

let view: View = (localStorage.getItem('nesmo:view') as View) || 'code';
let tool: Tool = (localStorage.getItem('nesmo:tool') as Tool) || 'debug';

// ------------------------------------------------------------------ header
const title = h('button', { class: 'title', onclick: () => drawer.open() });
const buildBtn = h('button', { class: 'btn primary build', onclick: () => buildAndRun(), title: 'Build & run (⌘B)' }, '▶ Build');
const soundBtn = h('button', { class: 'icon', title: 'Sound', onclick: () => toggleSound() }, '🔇');
const header = h('header', { class: 'topbar' },
  h('button', { class: 'icon menu', onclick: () => drawer.open(), title: 'Projects & files' }, '☰'),
  title,
  h('div', { class: 'spacer' }),
  soundBtn,
  buildBtn,
);

// -------------------------------------------------------------- code pane
const fileTabs = h('div', { class: 'file-tabs' });
const editorHost = h('div', { class: 'editor-host' });
const editor = new CodeEditor(editorHost);
editor.onBuild = () => buildAndRun();
const msgSummary = h('button', { class: 'msg-summary', onclick: () => msgPanel.classList.toggle('open') }, 'Not built yet');
const msgList = h('div', { class: 'msg-list' });
const msgPanel = h('div', { class: 'messages' }, msgSummary, msgList);
const SYMBOLS = ['#', '$', '%', ':', ',', '.', ';', '(', ')', '<', '>', '+', '-', '=', '"', '_'];
const symbolBar = h('div', { class: 'symbol-bar phone-only' },
  h('button', { onmousedown: (e: Event) => { e.preventDefault(); editor.insert('  '); } }, '⇥'),
  ...SYMBOLS.map((s) => h('button', { onmousedown: (e: Event) => { e.preventDefault(); editor.insert(s); } }, s)),
  h('button', { onmousedown: (e: Event) => { e.preventDefault(); editor.moveCursor(-1); } }, '◀'),
  h('button', { onmousedown: (e: Event) => { e.preventDefault(); editor.moveCursor(1); } }, '▶'),
);
const codePane = h('section', { class: 'pane code-pane' }, fileTabs, editorHost, msgPanel, symbolBar);

// -------------------------------------------------------------- play pane
const runBtn = h('button', { class: 'btn', onclick: () => debuggerPanel.toggleRun() }, '❚❚');
const playBar = h('div', { class: 'play-bar' },
  runBtn,
  h('button', { class: 'btn', onclick: () => app.emu.reset(), title: 'Reset' }, '↺ Reset'),
  h('button', { class: 'btn', onclick: () => app.emu.stepFrame(), title: 'Advance one frame' }, '⏭ Frame'),
  h('button', { class: 'btn', onclick: () => cycleSpeed(), title: 'Speed' }, h('span', { class: 'speed' }, '1×')),
  h('button', { class: 'btn', onclick: () => screenshot(), title: 'Save screenshot' }, '📷'),
);
const screenWrap = h('div', { class: 'screen-wrap' }, screens.create('screen main'), h('div', { class: 'screen-overlay' }));
const playPane = h('section', { class: 'pane play-pane' }, screenWrap, playBar, h('div', { class: 'phone-only pad-wrap' }, touchPad()));

// ------------------------------------------------------------- tools pane
const TOOLS: [Tool, string, HTMLElement][] = [
  ['debug', 'Debug', debuggerPanel.el],
  ['ppu', 'PPU', ppuPanel.el],
  ['chr', 'CHR', chrPanel.el],
  ['ref', 'Ref', refPanel.el],
];
const toolTabs = h('div', { class: 'tool-tabs desktop-only' },
  ...TOOLS.map(([id, label]) => h('button', { 'data-tool': id, onclick: () => setTool(id) }, label)));
const toolsPane = h('section', { class: 'pane tools-pane' }, toolTabs,
  ...TOOLS.map(([id, , el]) => h('div', { class: 'tool', 'data-tool': id }, el)));

// ------------------------------------------------------------ phone tabs
const VIEWS: [View, string, string][] = [
  ['code', '≡', 'Code'], ['play', '▶', 'Play'], ['debug', '🐞', 'Debug'],
  ['ppu', '▦', 'PPU'], ['chr', '✎', 'CHR'], ['ref', '?', 'Ref'],
];
const tabbar = h('nav', { class: 'tabbar phone-only' },
  ...VIEWS.map(([id, icon, label]) => h('button', { 'data-view': id, onclick: () => setView(id) }, h('span', { class: 'ti' }, icon), label)));

root.append(header, h('main', { class: 'layout' }, codePane, h('div', { class: 'right-col' }, playPane, toolsPane)), tabbar, drawer.el);

// ----------------------------------------------------------------- views
function setView(v: View) {
  view = v;
  localStorage.setItem('nesmo:view', v);
  if (v === 'debug' || v === 'ppu' || v === 'chr' || v === 'ref') tool = v;
  applyLayout();
}

function setTool(t: Tool) {
  tool = t;
  localStorage.setItem('nesmo:tool', t);
  if (isPhone()) view = t;
  applyLayout();
}

function applyLayout() {
  document.body.dataset.view = view;
  document.body.dataset.tool = tool;
  tabbar.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  toolTabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  toolsPane.querySelectorAll<HTMLElement>('.tool').forEach((t) => t.classList.toggle('on', t.dataset.tool === tool));
  requestAnimationFrame(() => {
    if (tool === 'ppu') ppuPanel.show();
    if (tool === 'chr') chrPanel.show();
    if (tool === 'debug') debuggerPanel.render();
    if (view === 'code' || !isPhone()) editor.view.requestMeasure();
  });
}
window.matchMedia('(max-width: 899px)').addEventListener('change', applyLayout);

// ----------------------------------------------------------------- files
function renderFileTabs() {
  clear(fileTabs);
  const p = app.project;
  const names = Object.keys(p.files).filter(isText).sort((a, b) => a.localeCompare(b));
  for (const f of names) {
    fileTabs.append(h('button', { class: f === p.openFile ? 'on' : '', onclick: () => openFile(f) }, f));
  }
  title.textContent = p.name;
}

function openFile(f: string) {
  if (/\.chr$/i.test(f)) {
    setTool('chr');
    if (isPhone()) setView('chr');
    return;
  }
  app.openFile(f);
  if (isPhone()) setView('code');
}

app.on('project', () => {
  editor.reset();
  renderFileTabs();
  editor.setMessages([]);
  msgSummary.textContent = 'Not built yet';
  clear(msgList);
});
app.on('open', (f) => {
  editor.open(f);
  renderFileTabs();
});
app.on('breakpoints', () => queueMicrotask(() => editor.refreshBreakpoints()));
app.on('reveal', ({ file, line }) => revealSource(file, line));

function revealSource(file: string, line: number) {
  if (app.project.openFile !== file) app.openFile(file);
  if (isPhone()) setView('code');
  requestAnimationFrame(() => editor.reveal(line));
}
debuggerPanel.onRevealSource = revealSource;
drawer.onOpenFile = openFile;

// ----------------------------------------------------------------- build
async function buildAndRun() {
  if (app.building) return;
  await flushSave();
  const r = await app.build(true);
  if (r.ok && isPhone() && view === 'code') setView('play');
}

app.on('building', (b) => {
  buildBtn.disabled = b;
  buildBtn.textContent = b ? 'Building…' : '▶ Build';
});

app.on('build', (r: BuildResult) => {
  editor.setMessages(r.messages);
  const errors = r.messages.filter((m) => m.severity === 'error');
  const warnings = r.messages.filter((m) => m.severity === 'warning');
  msgSummary.className = 'msg-summary ' + (r.ok ? (warnings.length ? 'warn' : 'ok') : 'err');
  msgSummary.textContent = r.ok
    ? `✓ Built in ${r.ms} ms${warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}`
    : `✕ ${errors.length} error${errors.length === 1 ? '' : 's'}`;
  clear(msgList);
  for (const m of r.messages) {
    msgList.append(h('button', { class: 'msg ' + m.severity, onclick: () => m.line && revealSource(m.file, m.line) },
      h('span', { class: 'msg-loc' }, m.line ? `${m.file}:${m.line}` : m.file || 'build'), ' ', m.text));
  }
  msgList.append(h('details', { class: 'build-log' }, h('summary', null, 'Build log'), h('pre', { class: 'mono' }, r.log.join('\n'))));
  if (!r.ok) {
    msgPanel.classList.add('open');
    const first = errors.find((e) => e.line > 0);
    if (first) revealSource(first.file, first.line);
    else if (isPhone()) setView('code');
  } else if (!warnings.length) {
    msgPanel.classList.remove('open');
  }
});

// -------------------------------------------------------------- emulator
const overlay = screenWrap.querySelector('.screen-overlay') as HTMLElement;
function onEmuChange() {
  const emu = app.emu;
  runBtn.textContent = emu.state === 'running' ? '❚❚ Pause' : '▶ Run';
  overlay.textContent = !emu.rom ? 'Tap ▶ Build to assemble and run' : emu.state === 'paused' ? (emu.lastPause?.reason === 'crash' ? 'Crashed' : 'Paused') : '';
  overlay.classList.toggle('show', !emu.rom || emu.state === 'paused');
  if (emu.state === 'paused' && emu.rom) {
    const loc = app.dbg?.locForAddr(emu.cpu.REG_PC) ?? null;
    editor.setPc(loc);
    const reason = emu.lastPause?.reason;
    if (reason === 'breakpoint' || reason === 'step' || reason === 'crash') {
      if (loc && !isPhone()) {
        if (app.project.openFile !== loc.file) app.openFile(loc.file);
        requestAnimationFrame(() => editor.reveal(loc.line, false));
      }
      if (reason === 'breakpoint') {
        if (isPhone() && view === 'play') setView('debug');
        if (!isPhone() && tool !== 'debug') setTool('debug');
      }
    }
  } else {
    editor.setPc(null);
  }
}
app.emu.subscribe(onEmuChange);
screenWrap.addEventListener('click', () => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  if (!app.emu.rom) buildAndRun();
});

let speedIdx = 0;
const SPEEDS = [1, 2, 0.5, 0.25];
function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  app.emu.speed = SPEEDS[speedIdx];
  (playBar.querySelector('.speed') as HTMLElement).textContent = SPEEDS[speedIdx] + '×';
}

function screenshot() {
  const a = h('a', { href: screens.snapshot(), download: `nesmo-${Date.now()}.png` });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function toggleSound() {
  if (app.emu.audio.enabled) {
    app.emu.audio.disable();
    soundBtn.textContent = '🔇';
  } else {
    await app.emu.audio.enable();
    soundBtn.textContent = '🔊';
    if (app.emu.rom && app.emu.state === 'running') toast('Sound on');
  }
}

// ------------------------------------------------------------- shortcuts
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'b' || e.key === 'Enter')) { e.preventDefault(); buildAndRun(); }
  else if (mod && e.key === 's') { e.preventDefault(); flushSave().then(() => toast('Saved on this device')); }
  else if (e.key === 'F5') { e.preventDefault(); debuggerPanel.toggleRun(); }
  else if (e.key === 'F10') { e.preventDefault(); app.emu.stepOver(); }
  else if (e.key === 'F11' && e.shiftKey) { e.preventDefault(); app.emu.stepOut(); }
  else if (e.key === 'F11') { e.preventDefault(); app.emu.stepInstruction(); }
});

// -------------------------------------------------- phone keyboard + safe area
const vv = window.visualViewport;
function fitViewport() {
  const hgt = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', `${hgt}px`);
  document.body.classList.toggle('kb', !!vv && window.innerHeight - vv.height > 120);
  if (vv) window.scrollTo(0, 0);
}
vv?.addEventListener('resize', fitViewport);
vv?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
fitViewport();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushSave();
    if (app.emu.state === 'running') app.emu.pause();
  }
});

// ------------------------------------------------------------------- go
(window as unknown as { __nesmo: typeof app }).__nesmo = app; // handy from the console
initKeyboard();
initGamepad();
warmUp();
openInitialProject().then((p) => {
  app.setProject(p);
  if (isPhone() && !['code', 'play', 'debug', 'ppu', 'chr', 'ref'].includes(view)) view = 'code';
  applyLayout();
  onEmuChange();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}
