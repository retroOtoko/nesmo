// Small ring buffer between jsnes' per-sample callback and Web Audio.
// Starts muted: iOS only allows audio after a tap, so the speaker button
// creates the AudioContext.

const SIZE = 16384;

export class AudioOut {
  sampleRate = 48000;
  enabled = false;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private bufL = new Float32Array(SIZE);
  private bufR = new Float32Array(SIZE);
  private w = 0;
  private r = 0;
  private paused = true;

  push(l: number, r: number) {
    if (!this.enabled) return;
    this.bufL[this.w] = l;
    this.bufR[this.w] = r;
    this.w = (this.w + 1) % SIZE;
    if (this.w === this.r) this.r = (this.r + 1) % SIZE; // overrun: drop oldest
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.r = this.w;
  }

  async enable() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx({ sampleRate: this.sampleRate });
      this.sampleRate = this.ctx.sampleRate;
      this.node = this.ctx.createScriptProcessor(1024, 0, 2);
      this.node.onaudioprocess = (e) => this.fill(e);
      this.node.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.ctx?.suspend();
  }

  private fill(e: AudioProcessingEvent) {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      if (this.paused || this.r === this.w) {
        L[i] = R[i] = 0;
      } else {
        L[i] = this.bufL[this.r];
        R[i] = this.bufR[this.r];
        this.r = (this.r + 1) % SIZE;
      }
    }
  }
}
