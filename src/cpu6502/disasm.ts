import { OPCODES } from './opcodes';

export interface DisasmLine {
  addr: number;
  bytes: number[];
  text: string; // e.g. "LDA #$00"
  target?: number; // branch / jump / memory operand address
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

export function disasmOne(
  addr: number,
  peek: (a: number) => number,
  label?: (a: number) => string | undefined,
): DisasmLine {
  const op = peek(addr);
  const o = OPCODES[op];
  if (!o) return { addr, bytes: [op], text: `.byte $${hex2(op)}` };
  const b1 = peek((addr + 1) & 0xffff);
  const b2 = peek((addr + 2) & 0xffff);
  const bytes = [op, b1, b2].slice(0, o.bytes);
  const w = b1 | (b2 << 8);
  const name = (a: number, digits: 2 | 4) => label?.(a) ?? '$' + (digits === 2 ? hex2(a) : hex4(a));
  let arg = '';
  let target: number | undefined;
  switch (o.mode) {
    case 'imp': break;
    case 'acc': arg = 'A'; break;
    case 'imm': arg = '#$' + hex2(b1); break;
    case 'zp': arg = name(b1, 2); target = b1; break;
    case 'zpx': arg = name(b1, 2) + ',X'; target = b1; break;
    case 'zpy': arg = name(b1, 2) + ',Y'; target = b1; break;
    case 'abs': arg = name(w, 4); target = w; break;
    case 'abx': arg = name(w, 4) + ',X'; target = w; break;
    case 'aby': arg = name(w, 4) + ',Y'; target = w; break;
    case 'ind': arg = '(' + name(w, 4) + ')'; target = w; break;
    case 'izx': arg = '(' + name(b1, 2) + ',X)'; target = b1; break;
    case 'izy': arg = '(' + name(b1, 2) + '),Y'; target = b1; break;
    case 'rel': {
      target = (addr + 2 + ((b1 << 24) >> 24)) & 0xffff;
      arg = name(target, 4);
      break;
    }
  }
  return { addr, bytes, text: arg ? `${o.mnem} ${arg}` : o.mnem, target };
}

/**
 * Disassemble around `pc`. Going backwards on the 6502 is ambiguous, so try
 * start points before pc and keep the earliest one whose instruction stream
 * lands exactly on pc.
 */
export function disasmAround(
  pc: number,
  before: number,
  after: number,
  peek: (a: number) => number,
  label?: (a: number) => string | undefined,
  knownStarts?: Set<number>,
): DisasmLine[] {
  let start = pc;
  for (let back = Math.min(before * 3, 48); back > 0; back--) {
    const s = (pc - back) & 0xffff;
    if (knownStarts && knownStarts.size && !knownStarts.has(s)) continue;
    let a = s;
    let n = 0;
    while (a < pc && n < 64) {
      const o = OPCODES[peek(a)];
      a += o ? o.bytes : 1;
      n++;
    }
    if (a === pc) {
      start = s;
      break;
    }
  }
  const out: DisasmLine[] = [];
  let a = start;
  while (out.length < 200) {
    const line = disasmOne(a, peek, label);
    out.push(line);
    a = (a + line.bytes.length) & 0xffff;
    if (a > pc && out.filter((l) => l.addr > pc).length >= after) break;
  }
  // trim leading lines down to `before`
  const idx = out.findIndex((l) => l.addr === pc);
  return idx > before ? out.slice(idx - before) : out;
}

export { hex2, hex4 };
