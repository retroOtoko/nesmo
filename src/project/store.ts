// Projects live in IndexedDB on the device. Text files are strings, binary
// files (CHR, NES) are Uint8Arrays.
import { get, set, del } from 'idb-keyval';
import JSZip from 'jszip';
import { samples, type SampleProject } from './samples';

export type FileData = string | Uint8Array;

export interface Project {
  id: string;
  name: string;
  files: Record<string, FileData>;
  openFile: string;
  /** breakpoints by source location, "file:line" */
  breakpoints: string[];
  updated: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updated: number;
}

const INDEX = 'nesmo:index';
const KEY = (id: string) => 'nesmo:project:' + id;
const CURRENT = 'nesmo:current';

const TEXT_EXT = /\.(s|asm|a65|ca65|inc|cfg|txt|md|h|c|mac)$/i;
export const isText = (name: string) => TEXT_EXT.test(name);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return ((await get(INDEX)) as ProjectSummary[] | undefined) ?? [];
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return (await get(KEY(id))) as Project | undefined;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: Project | null = null;

export function saveProjectSoon(p: Project) {
  pendingSave = p;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(), 400);
}

export async function flushSave() {
  if (!pendingSave) return;
  const p = pendingSave;
  pendingSave = null;
  await saveProject(p);
}

export async function saveProject(p: Project) {
  p.updated = Date.now();
  await set(KEY(p.id), p);
  const index = await listProjects();
  const i = index.findIndex((s) => s.id === p.id);
  const summary = { id: p.id, name: p.name, updated: p.updated };
  if (i >= 0) index[i] = summary;
  else index.push(summary);
  await set(INDEX, index);
  localStorage.setItem(CURRENT, p.id);
}

export async function deleteProject(id: string) {
  await del(KEY(id));
  await set(INDEX, (await listProjects()).filter((s) => s.id !== id));
  if (localStorage.getItem(CURRENT) === id) localStorage.removeItem(CURRENT);
}

export function projectFromSample(s: SampleProject, name = s.name): Project {
  const files: Record<string, FileData> = {};
  for (const [k, v] of Object.entries(s.files)) files[k] = typeof v === 'string' ? v : v.slice();
  return { id: uid(), name, files, openFile: s.open, breakpoints: [], updated: Date.now() };
}

/** Open the last project, or create the starter projects on first launch. */
export async function openInitialProject(): Promise<Project> {
  const current = localStorage.getItem(CURRENT);
  if (current) {
    const p = await loadProject(current);
    if (p) return p;
  }
  const index = await listProjects();
  if (index.length) {
    const latest = [...index].sort((a, b) => b.updated - a.updated)[0];
    const p = await loadProject(latest.id);
    if (p) return p;
  }
  const all = samples().map((s) => projectFromSample(s));
  for (const p of [...all].reverse()) await saveProject(p);
  await saveProject(all[0]);
  return all[0];
}

export async function exportZip(p: Project): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(p.files)) zip.file(name, data);
  return zip.generateAsync({ type: 'blob' });
}

export async function importZip(data: ArrayBuffer, name: string): Promise<Project> {
  const zip = await JSZip.loadAsync(data);
  const files: Record<string, FileData> = {};
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX') && !f.name.split('/').pop()!.startsWith('.'));
  // strip a single top-level folder (GitHub "Download ZIP" style)
  const tops = new Set(entries.map((f) => f.name.split('/')[0]));
  const strip = tops.size === 1 && entries.every((f) => f.name.includes('/')) ? [...tops][0] + '/' : '';
  for (const f of entries) {
    const path = f.name.slice(strip.length);
    files[path] = isText(path) ? await f.async('string') : await f.async('uint8array');
  }
  const open = Object.keys(files).find((f) => /\.(asm|s)$/i.test(f)) ?? Object.keys(files)[0] ?? '';
  return { id: uid(), name, files, openFile: open, breakpoints: [], updated: Date.now() };
}

export function newEmptyProject(name: string): Project {
  return projectFromSample(samples()[1], name);
}

export function download(name: string, data: Blob | Uint8Array | string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
