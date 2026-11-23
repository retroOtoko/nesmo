// Shared app state: the open project, the last build, and the emulator.
import { Emulator } from './emu/emulator';
import { buildProject } from './toolchain/client';
import type { BuildResult } from './toolchain/build';
import { DebugInfo } from './toolchain/dbginfo';
import { saveProjectSoon, type FileData, type Project } from './project/store';

type Events = {
  project: void;
  file: string; // a file's content changed
  open: string; // a file was opened in the editor
  build: BuildResult;
  building: boolean;
  breakpoints: void;
  reveal: { file: string; line: number }; // jump the editor to a line
  tab: string;
};

export class App {
  project!: Project;
  emu = new Emulator();
  lastBuild: BuildResult | null = null;
  dbg: DebugInfo | null = null;
  building = false;
  /** files changed since the last successful build */
  dirty = true;
  private handlers = new Map<keyof Events, Set<(v: never) => void>>();

  on<K extends keyof Events>(ev: K, fn: (v: Events[K]) => void) {
    let set = this.handlers.get(ev);
    if (!set) this.handlers.set(ev, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set!.delete(fn as (v: never) => void);
  }

  emit<K extends keyof Events>(ev: K, v: Events[K]) {
    this.handlers.get(ev)?.forEach((f) => (f as (v: Events[K]) => void)(v));
  }

  setProject(p: Project) {
    this.project = p;
    p.breakpoints ??= [];
    this.lastBuild = null;
    this.dbg = null;
    this.dirty = true;
    this.emit('project', undefined);
    this.emit('open', p.openFile);
  }

  openFile(name: string) {
    if (!(name in this.project.files)) return;
    this.project.openFile = name;
    saveProjectSoon(this.project);
    this.emit('open', name);
  }

  setFile(name: string, data: FileData, opts: { silent?: boolean } = {}) {
    const isNew = !(name in this.project.files);
    this.project.files[name] = data;
    this.dirty = true;
    saveProjectSoon(this.project);
    if (isNew) this.emit('project', undefined);
    if (!opts.silent) this.emit('file', name);
  }

  deleteFile(name: string) {
    delete this.project.files[name];
    this.project.breakpoints = this.project.breakpoints.filter((b) => !b.startsWith(name + ':'));
    if (this.project.openFile === name) this.project.openFile = Object.keys(this.project.files)[0] ?? '';
    saveProjectSoon(this.project);
    this.emit('project', undefined);
    this.emit('open', this.project.openFile);
  }

  renameFile(from: string, to: string) {
    if (from === to || !(from in this.project.files) || to in this.project.files) return;
    this.project.files[to] = this.project.files[from];
    delete this.project.files[from];
    this.project.breakpoints = this.project.breakpoints.map((b) => (b.startsWith(from + ':') ? to + b.slice(from.length) : b));
    if (this.project.openFile === from) this.project.openFile = to;
    saveProjectSoon(this.project);
    this.emit('project', undefined);
    this.emit('open', this.project.openFile);
  }

  async build(run = true): Promise<BuildResult> {
    this.building = true;
    this.emit('building', true);
    const result = await buildProject(this.project.files);
    this.building = false;
    this.lastBuild = result;
    if (result.ok && result.rom) {
      this.dbg = result.dbg ? DebugInfo.parse(result.dbg) : null;
      this.dirty = false;
      this.applyBreakpoints();
      if (run) this.emu.load(result.rom, true);
    }
    this.emit('building', false);
    this.emit('build', result);
    return result;
  }

  // ---------------------------------------------------------- breakpoints
  /** Breakpoints are stored as "file:line" (or "$ADDR" when there's no source). */
  breakpointAddress(bp: string): number | undefined {
    if (bp.startsWith('$')) return parseInt(bp.slice(1), 16);
    const i = bp.lastIndexOf(':');
    return this.dbg?.addrForLine(bp.slice(0, i), parseInt(bp.slice(i + 1), 10));
  }

  applyBreakpoints() {
    const addrs: number[] = [];
    for (const bp of this.project.breakpoints) {
      const a = this.breakpointAddress(bp);
      if (a !== undefined) addrs.push(a);
    }
    this.emu.setBreakpoints(addrs);
  }

  setFileBreakpoints(file: string, lines: number[]) {
    const others = this.project.breakpoints.filter((b) => !b.startsWith(file + ':'));
    this.project.breakpoints = [...others, ...lines.map((l) => `${file}:${l}`)];
    saveProjectSoon(this.project);
    this.applyBreakpoints();
    this.emit('breakpoints', undefined);
  }

  /** Toggle a breakpoint at an address, preferring its source line. */
  toggleAddressBreakpoint(addr: number) {
    const loc = this.dbg?.addrToLoc.get(addr);
    const key = loc ? `${loc.file}:${loc.line}` : '$' + addr.toString(16).toUpperCase().padStart(4, '0');
    const list = this.project.breakpoints;
    const existing = list.findIndex((b) => b === key || this.breakpointAddress(b) === addr);
    if (existing >= 0) list.splice(existing, 1);
    else list.push(key);
    saveProjectSoon(this.project);
    this.applyBreakpoints();
    this.emit('breakpoints', undefined);
  }

  sourceText(file: string): string | undefined {
    const f = this.project.files[file];
    return typeof f === 'string' ? f : undefined;
  }
}

export const app = new App();
