/// <reference lib="webworker" />
import { build, type Toolchain, type ProjectFiles } from './build';
import nesCfg from './share/nes.cfg?raw';
import nesInc from './share/nes.inc?raw';

let toolchain: Promise<Toolchain> | null = null;

function load(base: string): Promise<Toolchain> {
  const get = async (name: string) => {
    const res = await fetch(base + 'toolchain/' + name);
    if (!res.ok) throw new Error(`Couldn't load ${name} (${res.status})`);
    return WebAssembly.compile(await res.arrayBuffer());
  };
  return Promise.all([get('ca65.wasm'), get('ld65.wasm')]).then(([ca65, ld65]) => ({
    ca65,
    ld65,
    share: { 'cfg/nes.cfg': nesCfg, 'asminc/nes.inc': nesInc },
  }));
}

self.onmessage = async (e: MessageEvent<{ id: number; files: ProjectFiles; base: string }>) => {
  const { id, files, base } = e.data;
  try {
    toolchain ??= load(base);
    const result = await build(files, await toolchain);
    const transfer = result.rom ? [result.rom.buffer] : [];
    (self as unknown as Worker).postMessage({ id, result }, transfer as Transferable[]);
  } catch (err) {
    toolchain = null;
    (self as unknown as Worker).postMessage({
      id,
      result: {
        ok: false,
        listings: {},
        messages: [{ file: '', line: 0, severity: 'error', text: String(err) }],
        log: [String(err)],
        sources: [],
        ms: 0,
      },
    });
  }
};
