# NesMo 2

A browser-based NES development environment that works on an iPhone as well as on a desktop. Write 6502 assembly, build it with the real cc65 toolchain, run it, and debug it, all in the browser with nothing to install.

NesMo 1 (2020, NESASM-based) still lives in [`public/legacy`](public/legacy) and is served at `/legacy/`.

## What's in it

- **ca65 + ld65 in the browser.** The cc65 assembler and linker run as WebAssembly in a web worker, so projects match what [famicom.party](https://famicom.party/book/) teaches. Every `.asm`/`.s` file that isn't pulled in by `.include` is assembled and the objects are linked with `ld65 -t nes`, or with your own `.cfg` if the project has one.
- **Emulator.** [jsnes](https://github.com/bfirsh/jsnes) 3, with keyboard controls on desktop, an on-screen pad on the phone and Bluetooth gamepads. The pad shows every button as you press it, and resting your thumb between A and B presses both (adjustable under ⚙︎ Controls).
- **Debugger.** Breakpoints set from the editor gutter or the disassembly, step / step over / step out / run one frame, registers and flags (tap to edit), source lines mapped through ld65's debug file, your zero-page variables with live values, the stack, and a RAM viewer that highlights what changed.
- **PPU viewer.** Palette RAM, both pattern tables, all four nametables with attribute grid, OAM with a sprite layout view, and decoded PPUCTRL/PPUMASK.
- **CHR editor.** Draw 8×8 or 16×16 tiles with the game's own palettes. Edits are patched into the running game immediately (NROM). Includes a palette builder that writes the `.byte` lines for you.
- **Reference.** All official 6502 instructions with opcodes, cycles and flags; NES registers bit by bit; CPU and PPU memory maps.
- Projects are saved in the browser (IndexedDB), and NesMo asks the browser to keep them. Export/import `.zip` to move a project between devices, or download the `.nes`.
- **Works offline.** On the first visit a service worker saves the whole app, assembler included (about 2 MB). After that NesMo opens, builds and runs with no connection. `vite.config.ts` writes the file list into `sw.js` at build time.

Keyboard on desktop: arrows/WASD, Z = B, X = A, Enter = Start, Right Shift = Select. ⌘B or ⌘Enter builds, F5 runs/pauses, F10 steps over, F11 steps in, Shift+F11 steps out.

## Deploying on Vercel

1. In Vercel, **Add New → Project** and import this repository.
2. Vercel reads `vercel.json` (Vite, `npm run build`, output `dist`). Nothing to configure.
3. Every push redeploys. Add the site to your iPhone home screen for a full-screen app that also works offline after the first load.

## GitHub Pages

`.github/workflows/pages.yml` builds the app with `BASE_PATH=/<repo name>/` and publishes it to GitHub Pages on every push to `master` (pull requests only build and test). In the repo settings, Pages → Source must be set to **GitHub Actions**. The site lands at `https://retrootoko.github.io/nesmo/`.

## Local development

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # toolchain + emulator tests (Node)
npm run build && npx vite preview --port 4173 &
node tests/e2e.mjs   # headless Chrome checks on desktop and phone layouts
```

## Layout

```
src/toolchain/   ca65/ld65 WASI runner, worker, ld65 debug-file parser
src/emu/         jsnes wrapper (frame loop, breakpoints, stepping), audio
src/cpu6502/     opcode table and disassembler
src/ui/          editor, debugger, PPU viewer, CHR editor, reference, drawer
src/project/     IndexedDB storage and starter projects
public/toolchain ca65.wasm / ld65.wasm
```

## Credits and licenses

NesMo is GPL-3.0. It builds on:

- [cc65](https://github.com/cc65/cc65) (zlib license). The WASI builds of ca65 and ld65 come from [8bitworkshop](https://github.com/sehugg/8bitworkshop).
- [jsnes](https://github.com/bfirsh/jsnes) (Apache-2.0)
- [CodeMirror 6](https://codemirror.net/) (MIT)
- [browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) (MIT/Apache-2.0)
