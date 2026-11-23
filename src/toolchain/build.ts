// Runs the cc65 assembler (ca65) and linker (ld65) as WASI programs over an
// in-memory filesystem. Works in a web worker and in Node (for tests).
import {
  WASI,
  File,
  OpenFile,
  ConsoleStdout,
  PreopenDirectory,
  Directory,
} from '@bjorn3/browser_wasi_shim';

export type ProjectFiles = Record<string, Uint8Array | string>;

export interface BuildMessage {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  text: string;
}

export interface BuildResult {
  ok: boolean;
  rom?: Uint8Array;
  dbg?: string;
  map?: string;
  listings: Record<string, string>;
  messages: BuildMessage[];
  log: string[];
  sources: string[];
  ms: number;
}

export interface Toolchain {
  ca65: WebAssembly.Module;
  ld65: WebAssembly.Module;
  share: Record<string, string>; // e.g. { 'cfg/nes.cfg': ..., 'asminc/nes.inc': ... }
}

const SOURCE_RE = /\.(s|asm|a65|ca65)$/i;
const enc = new TextEncoder();
const dec = new TextDecoder();

type Tree = Map<string, File | Directory>;

function addPath(root: Tree, path: string, data: Uint8Array) {
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    let next = dir.get(parts[i]);
    if (!(next instanceof Directory)) {
      next = new Directory(new Map());
      dir.set(parts[i], next);
    }
    dir = (next as Directory).contents as Tree;
  }
  dir.set(parts[parts.length - 1], new File(data));
}

function getPath(root: Tree, path: string): Uint8Array | undefined {
  const parts = path.split('/').filter(Boolean);
  let node: File | Directory | undefined = undefined;
  let dir = root;
  for (const p of parts) {
    node = dir.get(p);
    if (!node) return undefined;
    if (node instanceof Directory) dir = node.contents as Tree;
  }
  return node instanceof File ? node.data : undefined;
}

function toBytes(v: Uint8Array | string) {
  return typeof v === 'string' ? enc.encode(v) : v;
}

async function runTool(mod: WebAssembly.Module, name: string, args: string[], root: Tree) {
  const out: string[] = [];
  const fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered((l) => out.push(l)),
    ConsoleStdout.lineBuffered((l) => out.push(l)),
    new PreopenDirectory('.', root as any),
  ];
  const wasi = new WASI([name, ...args], [], fds, { debug: false });
  const inst = await WebAssembly.instantiate(mod, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  let code: number;
  try {
    code = wasi.start(inst as any);
  } catch (e) {
    out.push(`${name}: crashed: ${e}`);
    code = 99;
  }
  return { code, out };
}

// Sources that another source pulls in with .include are assembled as part of
// that file, so only "top level" sources get their own ca65 run.
export function findTopLevelSources(files: ProjectFiles): string[] {
  const sources = Object.keys(files).filter((f) => SOURCE_RE.test(f));
  const included = new Set<string>();
  const incRe = /^\s*\.include\s+"([^"]+)"/gim;
  for (const f of sources) {
    const text = typeof files[f] === 'string' ? (files[f] as string) : dec.decode(files[f] as Uint8Array);
    const base = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
    for (const m of text.matchAll(incRe)) {
      included.add(m[1]);
      included.add(base + m[1]);
    }
  }
  return sources.filter((f) => !included.has(f)).sort();
}

const MSG_RE = /^(.+?):(\d+): (Error|Warning|Note): (.*)$/;

// newer cc65 colors its diagnostics and uses typographic quotes
const ANSI_RE = /\x1B\[[0-9;]*m/g;
export const cleanLine = (l: string) => l.replace(ANSI_RE, '').replace(/[‘’]/g, "'");

function parseMessages(lines: string[], fallbackFile: string, messages: BuildMessage[]) {
  for (const raw of lines) {
    const l = cleanLine(raw);
    const m = MSG_RE.exec(l);
    if (m) {
      if (m[3] === 'Note') continue;
      messages.push({
        file: m[1].replace(/^\.\//, ''),
        line: parseInt(m[2], 10),
        severity: m[3] === 'Error' ? 'error' : 'warning',
        text: m[4],
      });
    } else if (/(Error|Warning):/.test(l)) {
      messages.push({
        file: fallbackFile,
        line: 0,
        severity: /Error:/.test(l) ? 'error' : 'warning',
        text: l.replace(/^ld65: |^ca65: /, ''),
      });
    }
  }
}

export async function build(files: ProjectFiles, tc: Toolchain): Promise<BuildResult> {
  const t0 = Date.now();
  const root: Tree = new Map();
  for (const [path, data] of Object.entries(files)) addPath(root, path, toBytes(data));
  for (const [path, text] of Object.entries(tc.share)) addPath(root, 'cc65/' + path, enc.encode(text));

  const messages: BuildMessage[] = [];
  const log: string[] = [];
  const listings: Record<string, string> = {};
  const sources = findTopLevelSources(files);
  if (sources.length === 0) {
    messages.push({ file: '', line: 0, severity: 'error', text: 'No .asm or .s source files in this project.' });
    return { ok: false, listings, messages, log, sources, ms: Date.now() - t0 };
  }

  const objs: string[] = [];
  let failed = false;
  for (const src of sources) {
    const stem = src.replace(SOURCE_RE, '');
    const obj = `_build/${stem.replace(/\//g, '_')}.o`;
    const lst = `_build/${stem.replace(/\//g, '_')}.lst`;
    const args = ['-g', '-I', '.', '-I', 'cc65/asminc', '-o', obj, '-l', lst, src];
    log.push('ca65 ' + args.join(' '));
    addPath(root, '_build/.keep', new Uint8Array());
    const { code, out } = await runTool(tc.ca65, 'ca65', args, root);
    out.forEach((l) => log.push('  ' + cleanLine(l)));
    parseMessages(out, src, messages);
    if (code !== 0) {
      failed = true;
      if (!messages.some((m) => m.severity === 'error')) {
        messages.push({ file: src, line: 0, severity: 'error', text: `ca65 exited with code ${code}` });
      }
      continue;
    }
    const lstData = getPath(root, lst);
    if (lstData) listings[src] = dec.decode(lstData);
    objs.push(obj);
  }
  if (failed) return { ok: false, listings, messages, log, sources, ms: Date.now() - t0 };

  const cfg = Object.keys(files).find((f) => /\.cfg$/i.test(f));
  const linkArgs = cfg
    ? ['-C', cfg]
    : ['--cfg-path', 'cc65/cfg', '-t', 'nes'];
  const args = [...linkArgs, '--dbgfile', '_build/game.dbg', '-m', '_build/game.map', '-o', '_build/game.nes', ...objs];
  log.push('ld65 ' + args.join(' '));
  const { code, out } = await runTool(tc.ld65, 'ld65', args, root);
  out.forEach((l) => log.push('  ' + cleanLine(l)));
  parseMessages(out, cfg || 'ld65', messages);
  const rom = getPath(root, '_build/game.nes');
  if (code !== 0 || !rom) {
    if (!messages.some((m) => m.severity === 'error')) {
      messages.push({ file: 'ld65', line: 0, severity: 'error', text: `ld65 exited with code ${code}` });
    }
    return { ok: false, listings, messages, log, sources, ms: Date.now() - t0 };
  }
  const dbg = getPath(root, '_build/game.dbg');
  const map = getPath(root, '_build/game.map');
  return {
    ok: true,
    rom: new Uint8Array(rom),
    dbg: dbg ? dec.decode(dbg) : undefined,
    map: map ? dec.decode(map) : undefined,
    listings,
    messages,
    log,
    sources,
    ms: Date.now() - t0,
  };
}
