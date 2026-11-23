// Official 6502 instruction set: used by the disassembler and the reference.

export type Mode =
  | 'imp' | 'acc' | 'imm' | 'zp' | 'zpx' | 'zpy'
  | 'abs' | 'abx' | 'aby' | 'ind' | 'izx' | 'izy' | 'rel';

export interface Opcode {
  op: number;
  mnem: string;
  mode: Mode;
  bytes: number;
  cycles: number;
  /** +1 cycle when indexing crosses a page (branches: +1 taken, +2 across a page) */
  extra: boolean;
}

export const MODE_BYTES: Record<Mode, number> = {
  imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2,
  abs: 3, abx: 3, aby: 3, ind: 3, izx: 2, izy: 2, rel: 2,
};

export const MODE_NAMES: Record<Mode, string> = {
  imp: 'Implied', acc: 'Accumulator', imm: 'Immediate', zp: 'Zero page',
  zpx: 'Zero page,X', zpy: 'Zero page,Y', abs: 'Absolute', abx: 'Absolute,X',
  aby: 'Absolute,Y', ind: 'Indirect', izx: '(Indirect,X)', izy: '(Indirect),Y',
  rel: 'Relative',
};

export const MODE_SYNTAX: Record<Mode, string> = {
  imp: '', acc: 'A', imm: '#$nn', zp: '$nn', zpx: '$nn,X', zpy: '$nn,Y',
  abs: '$nnnn', abx: '$nnnn,X', aby: '$nnnn,Y', ind: '($nnnn)', izx: '($nn,X)',
  izy: '($nn),Y', rel: 'label',
};

// mnemonic: [mode, opcode, cycles, page-cross penalty?] ...
const RAW: Record<string, [Mode, number, number, boolean?][]> = {
  ADC: [['imm', 0x69, 2], ['zp', 0x65, 3], ['zpx', 0x75, 4], ['abs', 0x6d, 4], ['abx', 0x7d, 4, true], ['aby', 0x79, 4, true], ['izx', 0x61, 6], ['izy', 0x71, 5, true]],
  AND: [['imm', 0x29, 2], ['zp', 0x25, 3], ['zpx', 0x35, 4], ['abs', 0x2d, 4], ['abx', 0x3d, 4, true], ['aby', 0x39, 4, true], ['izx', 0x21, 6], ['izy', 0x31, 5, true]],
  ASL: [['acc', 0x0a, 2], ['zp', 0x06, 5], ['zpx', 0x16, 6], ['abs', 0x0e, 6], ['abx', 0x1e, 7]],
  BCC: [['rel', 0x90, 2, true]],
  BCS: [['rel', 0xb0, 2, true]],
  BEQ: [['rel', 0xf0, 2, true]],
  BIT: [['zp', 0x24, 3], ['abs', 0x2c, 4]],
  BMI: [['rel', 0x30, 2, true]],
  BNE: [['rel', 0xd0, 2, true]],
  BPL: [['rel', 0x10, 2, true]],
  BRK: [['imp', 0x00, 7]],
  BVC: [['rel', 0x50, 2, true]],
  BVS: [['rel', 0x70, 2, true]],
  CLC: [['imp', 0x18, 2]],
  CLD: [['imp', 0xd8, 2]],
  CLI: [['imp', 0x58, 2]],
  CLV: [['imp', 0xb8, 2]],
  CMP: [['imm', 0xc9, 2], ['zp', 0xc5, 3], ['zpx', 0xd5, 4], ['abs', 0xcd, 4], ['abx', 0xdd, 4, true], ['aby', 0xd9, 4, true], ['izx', 0xc1, 6], ['izy', 0xd1, 5, true]],
  CPX: [['imm', 0xe0, 2], ['zp', 0xe4, 3], ['abs', 0xec, 4]],
  CPY: [['imm', 0xc0, 2], ['zp', 0xc4, 3], ['abs', 0xcc, 4]],
  DEC: [['zp', 0xc6, 5], ['zpx', 0xd6, 6], ['abs', 0xce, 6], ['abx', 0xde, 7]],
  DEX: [['imp', 0xca, 2]],
  DEY: [['imp', 0x88, 2]],
  EOR: [['imm', 0x49, 2], ['zp', 0x45, 3], ['zpx', 0x55, 4], ['abs', 0x4d, 4], ['abx', 0x5d, 4, true], ['aby', 0x59, 4, true], ['izx', 0x41, 6], ['izy', 0x51, 5, true]],
  INC: [['zp', 0xe6, 5], ['zpx', 0xf6, 6], ['abs', 0xee, 6], ['abx', 0xfe, 7]],
  INX: [['imp', 0xe8, 2]],
  INY: [['imp', 0xc8, 2]],
  JMP: [['abs', 0x4c, 3], ['ind', 0x6c, 5]],
  JSR: [['abs', 0x20, 6]],
  LDA: [['imm', 0xa9, 2], ['zp', 0xa5, 3], ['zpx', 0xb5, 4], ['abs', 0xad, 4], ['abx', 0xbd, 4, true], ['aby', 0xb9, 4, true], ['izx', 0xa1, 6], ['izy', 0xb1, 5, true]],
  LDX: [['imm', 0xa2, 2], ['zp', 0xa6, 3], ['zpy', 0xb6, 4], ['abs', 0xae, 4], ['aby', 0xbe, 4, true]],
  LDY: [['imm', 0xa0, 2], ['zp', 0xa4, 3], ['zpx', 0xb4, 4], ['abs', 0xac, 4], ['abx', 0xbc, 4, true]],
  LSR: [['acc', 0x4a, 2], ['zp', 0x46, 5], ['zpx', 0x56, 6], ['abs', 0x4e, 6], ['abx', 0x5e, 7]],
  NOP: [['imp', 0xea, 2]],
  ORA: [['imm', 0x09, 2], ['zp', 0x05, 3], ['zpx', 0x15, 4], ['abs', 0x0d, 4], ['abx', 0x1d, 4, true], ['aby', 0x19, 4, true], ['izx', 0x01, 6], ['izy', 0x11, 5, true]],
  PHA: [['imp', 0x48, 3]],
  PHP: [['imp', 0x08, 3]],
  PLA: [['imp', 0x68, 4]],
  PLP: [['imp', 0x28, 4]],
  ROL: [['acc', 0x2a, 2], ['zp', 0x26, 5], ['zpx', 0x36, 6], ['abs', 0x2e, 6], ['abx', 0x3e, 7]],
  ROR: [['acc', 0x6a, 2], ['zp', 0x66, 5], ['zpx', 0x76, 6], ['abs', 0x6e, 6], ['abx', 0x7e, 7]],
  RTI: [['imp', 0x40, 6]],
  RTS: [['imp', 0x60, 6]],
  SBC: [['imm', 0xe9, 2], ['zp', 0xe5, 3], ['zpx', 0xf5, 4], ['abs', 0xed, 4], ['abx', 0xfd, 4, true], ['aby', 0xf9, 4, true], ['izx', 0xe1, 6], ['izy', 0xf1, 5, true]],
  SEC: [['imp', 0x38, 2]],
  SED: [['imp', 0xf8, 2]],
  SEI: [['imp', 0x78, 2]],
  STA: [['zp', 0x85, 3], ['zpx', 0x95, 4], ['abs', 0x8d, 4], ['abx', 0x9d, 5], ['aby', 0x99, 5], ['izx', 0x81, 6], ['izy', 0x91, 6]],
  STX: [['zp', 0x86, 3], ['zpy', 0x96, 4], ['abs', 0x8e, 4]],
  STY: [['zp', 0x84, 3], ['zpx', 0x94, 4], ['abs', 0x8c, 4]],
  TAX: [['imp', 0xaa, 2]],
  TAY: [['imp', 0xa8, 2]],
  TSX: [['imp', 0xba, 2]],
  TXA: [['imp', 0x8a, 2]],
  TXS: [['imp', 0x9a, 2]],
  TYA: [['imp', 0x98, 2]],
};

export interface MnemonicInfo {
  name: string;
  flags: string; // affected flags, e.g. "NZC"
  summary: string;
  detail: string;
}

export const MNEMONICS: Record<string, MnemonicInfo> = {
  ADC: { name: 'Add with carry', flags: 'NVZC', summary: 'A = A + M + C', detail: 'Adds memory and the carry flag to A. Clear the carry with CLC before a fresh addition. V is set when the signed result overflows.' },
  AND: { name: 'Logical AND', flags: 'NZ', summary: 'A = A & M', detail: 'Bitwise AND of A with memory. Handy for masking button bits: AND #BTN_LEFT.' },
  ASL: { name: 'Arithmetic shift left', flags: 'NZC', summary: 'C ← [7..0] ← 0', detail: 'Shifts left one bit; bit 7 goes into carry and bit 0 becomes 0. Doubles an unsigned value.' },
  BCC: { name: 'Branch if carry clear', flags: '', summary: 'if C = 0', detail: 'After CMP, branches when the register was lower than the operand (unsigned).' },
  BCS: { name: 'Branch if carry set', flags: '', summary: 'if C = 1', detail: 'After CMP, branches when the register was greater than or equal to the operand (unsigned).' },
  BEQ: { name: 'Branch if equal', flags: '', summary: 'if Z = 1', detail: 'Branches when the last result was zero, or when CMP found the values equal.' },
  BIT: { name: 'Bit test', flags: 'NVZ', summary: 'Z = !(A & M), N = M7, V = M6', detail: 'Copies bits 7 and 6 of memory into N and V without changing A. BIT PPUSTATUS / BPL is the classic vblank wait.' },
  BMI: { name: 'Branch if minus', flags: '', summary: 'if N = 1', detail: 'Branches when bit 7 of the last result was set.' },
  BNE: { name: 'Branch if not equal', flags: '', summary: 'if Z = 0', detail: 'Branches when the last result was non-zero. The workhorse of counted loops (DEX / BNE).' },
  BPL: { name: 'Branch if plus', flags: '', summary: 'if N = 0', detail: 'Branches when bit 7 of the last result was clear.' },
  BRK: { name: 'Break', flags: 'B I', summary: 'Software interrupt', detail: 'Pushes PC+2 and status, then jumps through the IRQ vector at $FFFE. Usually a sign something went wrong on the NES.' },
  BVC: { name: 'Branch if overflow clear', flags: '', summary: 'if V = 0', detail: 'Branches when the overflow flag is clear.' },
  BVS: { name: 'Branch if overflow set', flags: '', summary: 'if V = 1', detail: 'Branches when the overflow flag is set.' },
  CLC: { name: 'Clear carry', flags: 'C', summary: 'C = 0', detail: 'Do this before ADC.' },
  CLD: { name: 'Clear decimal', flags: 'D', summary: 'D = 0', detail: 'The NES CPU has no decimal mode, but reset code clears D out of habit.' },
  CLI: { name: 'Clear interrupt disable', flags: 'I', summary: 'I = 0', detail: 'Allows IRQs. NMI ignores this flag.' },
  CLV: { name: 'Clear overflow', flags: 'V', summary: 'V = 0', detail: 'Clears the overflow flag.' },
  CMP: { name: 'Compare A', flags: 'NZC', summary: 'A − M (flags only)', detail: 'Sets C when A ≥ M and Z when equal, without changing A.' },
  CPX: { name: 'Compare X', flags: 'NZC', summary: 'X − M (flags only)', detail: 'Like CMP for X. CPX #32 / BNE loop is the usual "copy 32 bytes" pattern.' },
  CPY: { name: 'Compare Y', flags: 'NZC', summary: 'Y − M (flags only)', detail: 'Like CMP for Y.' },
  DEC: { name: 'Decrement memory', flags: 'NZ', summary: 'M = M − 1', detail: 'Wraps from $00 to $FF.' },
  DEX: { name: 'Decrement X', flags: 'NZ', summary: 'X = X − 1', detail: 'Wraps from $00 to $FF.' },
  DEY: { name: 'Decrement Y', flags: 'NZ', summary: 'Y = Y − 1', detail: 'Wraps from $00 to $FF.' },
  EOR: { name: 'Exclusive OR', flags: 'NZ', summary: 'A = A ^ M', detail: 'EOR #$FF flips every bit of A.' },
  INC: { name: 'Increment memory', flags: 'NZ', summary: 'M = M + 1', detail: 'Wraps from $FF to $00.' },
  INX: { name: 'Increment X', flags: 'NZ', summary: 'X = X + 1', detail: 'Wraps from $FF to $00.' },
  INY: { name: 'Increment Y', flags: 'NZ', summary: 'Y = Y + 1', detail: 'Wraps from $FF to $00.' },
  JMP: { name: 'Jump', flags: '', summary: 'PC = address', detail: 'JMP ($nnnn) has a hardware bug: if the pointer sits at $xxFF, the high byte is read from $xx00.' },
  JSR: { name: 'Jump to subroutine', flags: '', summary: 'push PC+2, PC = address', detail: 'Pushes the return address minus one. Pair with RTS.' },
  LDA: { name: 'Load A', flags: 'NZ', summary: 'A = M', detail: 'Loads A from memory or an immediate value.' },
  LDX: { name: 'Load X', flags: 'NZ', summary: 'X = M', detail: 'Loads X from memory or an immediate value.' },
  LDY: { name: 'Load Y', flags: 'NZ', summary: 'Y = M', detail: 'Loads Y from memory or an immediate value.' },
  LSR: { name: 'Logical shift right', flags: 'NZC', summary: '0 → [7..0] → C', detail: 'Shifts right; bit 0 goes into carry. Reading the controller uses LSR A to move each button bit into carry.' },
  NOP: { name: 'No operation', flags: '', summary: '2 cycles of nothing', detail: 'Useful for timing or patching.' },
  ORA: { name: 'Logical OR', flags: 'NZ', summary: 'A = A | M', detail: 'Sets bits in A.' },
  PHA: { name: 'Push A', flags: '', summary: 'push A', detail: 'Pushes A onto the stack at $0100–$01FF.' },
  PHP: { name: 'Push status', flags: '', summary: 'push P', detail: 'Pushes the status flags (with B and bit 5 set).' },
  PLA: { name: 'Pull A', flags: 'NZ', summary: 'A = pull', detail: 'Pulls a byte from the stack into A.' },
  PLP: { name: 'Pull status', flags: 'NVDIZC', summary: 'P = pull', detail: 'Pulls the status flags from the stack.' },
  ROL: { name: 'Rotate left', flags: 'NZC', summary: 'C ← [7..0] ← C', detail: 'Rotates through carry. ROL buttons collects controller bits one at a time.' },
  ROR: { name: 'Rotate right', flags: 'NZC', summary: 'C → [7..0] → C', detail: 'Rotates right through carry.' },
  RTI: { name: 'Return from interrupt', flags: 'NVDIZC', summary: 'pull P, pull PC', detail: 'Ends an NMI or IRQ handler.' },
  RTS: { name: 'Return from subroutine', flags: '', summary: 'pull PC, PC = PC + 1', detail: 'Returns to the instruction after the JSR.' },
  SBC: { name: 'Subtract with carry', flags: 'NVZC', summary: 'A = A − M − !C', detail: 'Set the carry with SEC before a fresh subtraction. C clear afterwards means a borrow happened.' },
  SEC: { name: 'Set carry', flags: 'C', summary: 'C = 1', detail: 'Do this before SBC.' },
  SED: { name: 'Set decimal', flags: 'D', summary: 'D = 1', detail: 'No effect on the NES CPU, which lacks decimal mode.' },
  SEI: { name: 'Set interrupt disable', flags: 'I', summary: 'I = 1', detail: 'Blocks IRQs. The first instruction of most reset handlers.' },
  STA: { name: 'Store A', flags: '', summary: 'M = A', detail: 'Writes A to memory. STA PPUDATA sends a byte to the PPU.' },
  STX: { name: 'Store X', flags: '', summary: 'M = X', detail: 'Writes X to memory.' },
  STY: { name: 'Store Y', flags: '', summary: 'M = Y', detail: 'Writes Y to memory.' },
  TAX: { name: 'Transfer A to X', flags: 'NZ', summary: 'X = A', detail: 'Copies A into X.' },
  TAY: { name: 'Transfer A to Y', flags: 'NZ', summary: 'Y = A', detail: 'Copies A into Y.' },
  TSX: { name: 'Transfer SP to X', flags: 'NZ', summary: 'X = SP', detail: 'Reads the stack pointer.' },
  TXA: { name: 'Transfer X to A', flags: 'NZ', summary: 'A = X', detail: 'Copies X into A.' },
  TXS: { name: 'Transfer X to SP', flags: '', summary: 'SP = X', detail: 'Sets the stack pointer. Reset code does LDX #$FF / TXS.' },
  TYA: { name: 'Transfer Y to A', flags: 'NZ', summary: 'A = Y', detail: 'Copies Y into A.' },
};

export const OPCODES: (Opcode | undefined)[] = new Array(256);
export const BY_MNEMONIC: Record<string, Opcode[]> = {};

for (const [mnem, modes] of Object.entries(RAW)) {
  BY_MNEMONIC[mnem] = [];
  for (const [mode, op, cycles, extra] of modes) {
    const o: Opcode = { op, mnem, mode, bytes: MODE_BYTES[mode], cycles, extra: !!extra };
    OPCODES[op] = o;
    BY_MNEMONIC[mnem].push(o);
  }
}
