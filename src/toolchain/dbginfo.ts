// Parses the debug file ld65 writes with --dbgfile, so the debugger can map
// CPU addresses to source lines (and back) and show label names.

export interface SourceLoc {
  file: string;
  line: number; // 1-based
}

export interface DebugSymbol {
  name: string;
  value: number;
  zp: boolean;
  isLabel: boolean;
}

export class DebugInfo {
  files: string[] = [];
  /** First byte address of each emitted source line → location */
  addrToLoc = new Map<number, SourceLoc>();
  /** Every PRG byte covered by a line → location (for "which line is PC in") */
  coverage = new Map<number, SourceLoc>();
  /** "file:line" → lowest address emitted for that line */
  locToAddr = new Map<string, number>();
  symbols: DebugSymbol[] = [];
  addrToLabel = new Map<number, string>();
  labelToAddr = new Map<string, number>();
  segments: { name: string; start: number; size: number }[] = [];

  static parse(text: string): DebugInfo {
    const info = new DebugInfo();
    const files = new Map<number, string>();
    const segs = new Map<number, { name: string; start: number; size: number }>();
    const spans = new Map<number, { seg: number; start: number; size: number }>();
    const lines: { file: number; line: number; type: number; spans: number[] }[] = [];

    for (const raw of text.split('\n')) {
      const tab = raw.indexOf('\t');
      if (tab < 0) continue;
      const kind = raw.slice(0, tab);
      const attrs = parseAttrs(raw.slice(tab + 1));
      const id = num(attrs.id);
      switch (kind) {
        case 'file':
          files.set(id, unquote(attrs.name));
          break;
        case 'seg':
          segs.set(id, { name: unquote(attrs.name), start: num(attrs.start), size: num(attrs.size) });
          break;
        case 'span':
          spans.set(id, { seg: num(attrs.seg), start: num(attrs.start), size: num(attrs.size) });
          break;
        case 'line':
          lines.push({
            file: num(attrs.file),
            line: num(attrs.line),
            type: attrs.type ? num(attrs.type) : 0,
            spans: attrs.span ? attrs.span.split('+').map(num) : [],
          });
          break;
        case 'sym': {
          const name = unquote(attrs.name);
          if (attrs.val === undefined) break;
          const value = num(attrs.val);
          const isLabel = attrs.type === 'lab';
          info.symbols.push({ name, value, zp: attrs.addrsize === 'zeropage', isLabel });
          break;
        }
      }
    }

    info.files = [...files.values()];
    info.segments = [...segs.values()];

    // Only segments that live in CPU address space map to code. HEADER and
    // CHARS start at 0 in their own (file / PPU) address spaces.
    const cpuSeg = (segId: number) => {
      const s = segs.get(segId);
      return !!s && s.name !== 'HEADER' && s.name !== 'CHARS' && s.start >= 0x6000;
    };

    for (const ln of lines) {
      if (ln.type !== 0) continue; // skip macro-expansion and C lines
      const file = files.get(ln.file);
      if (!file) continue;
      const loc = { file, line: ln.line };
      for (const spanId of ln.spans) {
        const sp = spans.get(spanId);
        if (!sp || !cpuSeg(sp.seg) || sp.size === 0) continue;
        const addr = segs.get(sp.seg)!.start + sp.start;
        if (!info.addrToLoc.has(addr)) info.addrToLoc.set(addr, loc);
        for (let a = addr; a < addr + sp.size; a++) if (!info.coverage.has(a)) info.coverage.set(a, loc);
        const key = `${file}:${ln.line}`;
        const prev = info.locToAddr.get(key);
        if (prev === undefined || addr < prev) info.locToAddr.set(key, addr);
      }
    }

    // Labels name addresses; equates only name hardware registers (an equate
    // like BTN_RIGHT = 1 would otherwise show up as a name for $0001).
    // Skip cc65 internals.
    const internal = (n: string) => n.startsWith('__') || n.startsWith('@') || n.startsWith('CPU_');
    for (const s of info.symbols) {
      if (internal(s.name)) continue;
      if (!info.labelToAddr.has(s.name) || s.isLabel) info.labelToAddr.set(s.name, s.value);
      if (s.isLabel && !info.addrToLabel.has(s.value)) info.addrToLabel.set(s.value, s.name);
    }
    for (const s of info.symbols) {
      if (internal(s.name) || s.isLabel) continue;
      if (s.value >= 0x2000 && s.value < 0x4020 && !info.addrToLabel.has(s.value)) info.addrToLabel.set(s.value, s.name);
    }
    return info;
  }

  addrForLine(file: string, line: number) {
    return this.locToAddr.get(`${file}:${line}`);
  }

  locForAddr(addr: number) {
    return this.coverage.get(addr);
  }

  /** RAM variables (labels in zero page and BSS) for the debugger. */
  ramSymbols() {
    const seen = new Set<string>();
    return this.symbols.filter((s) => {
      const key = s.name + ':' + s.value;
      if (!s.isLabel || s.value >= 0x800 || s.name.startsWith('__') || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const eq = s.indexOf('=', i);
    if (eq < 0) break;
    const key = s.slice(i, eq);
    let j = eq + 1;
    let val: string;
    if (s[j] === '"') {
      const end = s.indexOf('"', j + 1);
      val = s.slice(j, end + 1);
      j = end + 1;
    } else {
      const end = s.indexOf(',', j);
      val = end < 0 ? s.slice(j) : s.slice(j, end);
      j = end < 0 ? s.length : end;
    }
    out[key] = val;
    i = j + 1;
  }
  return out;
}

function num(v: string | undefined) {
  if (!v) return 0;
  return v.startsWith('0x') ? parseInt(v.slice(2), 16) : parseInt(v, 10);
}

function unquote(v: string | undefined) {
  return v ? v.replace(/^"|"$/g, '') : '';
}
