import type { BuildResult, ProjectFiles } from './build';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: BuildResult) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: BuildResult }>) => {
      pending.get(e.data.id)?.(e.data.result);
      pending.delete(e.data.id);
    };
  }
  return worker;
}

export function buildProject(files: ProjectFiles): Promise<BuildResult> {
  const id = nextId++;
  // copy binary files so the project's own buffers stay usable
  const copy: ProjectFiles = {};
  for (const [k, v] of Object.entries(files)) copy[k] = typeof v === 'string' ? v : v.slice();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ id, files: copy, base: new URL(import.meta.env.BASE_URL, location.href).href });
  });
}

/** Start loading the wasm tools early so the first build is quick. */
export function warmUp() {
  buildProject({}).catch(() => {});
}
