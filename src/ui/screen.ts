// Draws emulator frames into one or more canvases (the main screen, and the
// small preview on the phone's debugger tab).
import { app } from '../app';

export class Screens {
  private canvases = new Set<HTMLCanvasElement>();
  private img = new ImageData(256, 240);
  private u32 = new Uint32Array(this.img.data.buffer);

  constructor() {
    app.emu.onFrame((buf) => this.draw(buf));
    // while paused mid-frame, show what the PPU has drawn so far
    app.emu.subscribe(() => {
      if (app.emu.state === 'paused' && app.emu.rom) this.draw(app.emu.ppu.buffer);
    });
  }

  create(cls = 'screen'): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 240;
    c.className = cls;
    this.canvases.add(c);
    return c;
  }

  draw(buf: Uint32Array) {
    const out = this.u32;
    for (let i = 0; i < 61440; i++) out[i] = 0xff000000 | buf[i];
    for (const c of this.canvases) {
      if (!c.isConnected || c.offsetParent === null) continue;
      c.getContext('2d')!.putImageData(this.img, 0, 0);
    }
  }

  /** Last drawn frame as a PNG data URL (for screenshots). */
  snapshot(): string {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 240;
    c.getContext('2d')!.putImageData(this.img, 0, 0);
    return c.toDataURL('image/png');
  }
}
