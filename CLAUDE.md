# NesMo 2 notes for Claude

Matt is learning NES development with the famicom.party book (ca65/ld65) and uses NesMo on an iPhone and a Mac. Every feature has to work with touch on a ~390px-wide screen as well as on desktop.

- Stack: Vite + vanilla TypeScript, no UI framework. `h()` in `src/ui/dom.ts` builds elements. Shared state and events live in `src/app.ts`.
- Phone vs desktop: CSS breakpoint at 900px. Phone shows one view at a time (`body[data-view]`) with a bottom tab bar; desktop shows editor left, screen and tool tabs right (`body[data-tool]`).
- The toolchain is cc65's ca65/ld65 compiled to WASI (from 8bitworkshop), run with `@bjorn3/browser_wasi_shim` in `src/toolchain/build.ts`. That file also runs under Node for tests.
- The emulator is jsnes 3. `src/emu/emulator.ts` runs its own frame loop (`runFrame`) so breakpoints and stepping work; read memory with `peek()`, never `cpu.load()` (side effects).
- jsnes colors are 0xBBGGRR; use `nesRgb()` in `src/ui/ppu.ts` for 0xRRGGBB.
- The phone controller is one SVG in `src/ui/touchpad.ts`, hit-tested with geometry in SVG units. Each touch stays bound to the control it started on. Its look follows Matt's NesMo 1 buttons: black faces, light rim, pixel lettering, grip lines on the d-pad.
- Breakpoints are stored as `file:line` and resolved to addresses through the ld65 debug file after each build.
- Tests: `npm test` (Node) and `node tests/e2e.mjs` against `vite preview` (headless Chrome at /usr/bin/google-chrome). Keep both passing.
- Deploys on Vercel from GitHub (`vercel.json`).
