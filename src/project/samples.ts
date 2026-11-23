// Starter projects. Written for the ca65 toolchain famicom.party uses, so the
// book's examples drop straight in.
import { encodeTile } from '../chr/chr';

export interface SampleProject {
  name: string;
  description: string;
  files: Record<string, string | Uint8Array>;
  open: string;
}

const HELLO = `; Hello, NES!
; The smallest useful NES program: turn the screen a color.
; Assembled with ca65 and linked with "ld65 -t nes", like famicom.party.

.segment "HEADER"
.byte "NES", $1A   ; iNES magic number
.byte $02          ; 2 x 16KB PRG ROM
.byte $01          ; 1 x 8KB CHR ROM
.byte $00, $00     ; mapper 0 (NROM), horizontal mirroring

.segment "ZEROPAGE"
.segment "STARTUP"

.segment "CODE"
.proc irq_handler
  RTI
.endproc

.proc nmi_handler
  RTI
.endproc

.proc reset_handler
  SEI            ; ignore IRQs
  CLD            ; no decimal mode on the NES
  LDX #$00
  STX $2000      ; PPUCTRL: no NMI yet
  STX $2001      ; PPUMASK: rendering off
vblankwait:      ; wait for the PPU to warm up
  BIT $2002
  BPL vblankwait
  JMP main
.endproc

.proc main
  LDX $2002      ; reset the PPUADDR latch
  LDX #$3F
  STX $2006
  LDX #$00
  STX $2006      ; PPU address = $3F00 (background color)
  LDA #$29       ; a nice green. Try $11, $16 or $30!
  STA $2007
  LDA #%00011110 ; turn rendering on
  STA $2001
forever:
  JMP forever
.endproc

.segment "VECTORS"
.addr nmi_handler, reset_handler, irq_handler

.segment "CHARS"
.res 8192
`;

const CONSTANTS = `; Hardware registers and button masks shared by every source file.
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOYPAD1   = $4016

; read_controller leaves the buttons in this order
BTN_A      = %10000000
BTN_B      = %01000000
BTN_SELECT = %00100000
BTN_START  = %00010000
BTN_UP     = %00001000
BTN_DOWN   = %00000100
BTN_LEFT   = %00000010
BTN_RIGHT  = %00000001
`;

const HEADER = `.segment "HEADER"
.byte "NES", $1A
.byte $02          ; 2 x 16KB PRG ROM
.byte $01          ; 1 x 8KB CHR ROM
.byte %00000001    ; mapper 0, vertical mirroring
.byte $00

.segment "STARTUP"
`;

const RESET = `.include "constants.inc"

.segment "CODE"
.import main
.export reset_handler

.proc reset_handler
  SEI
  CLD
  LDX #$40
  STX $4017      ; no APU frame IRQs
  LDX #$FF
  TXS            ; stack pointer = $01FF
  INX            ; X = 0
  STX PPUCTRL
  STX PPUMASK
  STX $4010      ; no DMC IRQs
  BIT PPUSTATUS
vblankwait1:
  BIT PPUSTATUS
  BPL vblankwait1

clear_ram:       ; zero RAM and park every sprite below the screen
  LDA #$00
  STA $0000,X
  STA $0100,X
  STA $0300,X
  STA $0400,X
  STA $0500,X
  STA $0600,X
  STA $0700,X
  LDA #$FF
  STA $0200,X
  INX
  BNE clear_ram

vblankwait2:
  BIT PPUSTATUS
  BPL vblankwait2
  JMP main
.endproc
`;

const MAIN = `; Sprite Mover: a 2x2 metasprite you can walk around with the d-pad.
; Open the PPU tab to watch OAM and the nametable while it runs,
; or the CHR tab to redraw Momo.
.include "constants.inc"
.include "header.inc"

.segment "ZEROPAGE"
player_x:  .res 1
player_y:  .res 1
buttons:   .res 1
nmi_count: .res 1

.segment "CODE"
.import reset_handler
.export main

.proc irq_handler
  RTI
.endproc

.proc nmi_handler
  PHA
  LDA #$00
  STA OAMADDR
  LDA #$02
  STA OAMDMA     ; copy the sprite buffer at $0200 to the PPU
  LDA #$00
  STA PPUSCROLL  ; x scroll
  STA PPUSCROLL  ; y scroll
  INC nmi_count  ; tell the main loop a frame has passed
  PLA
  RTI
.endproc

.proc main
  ; ---- palettes ($3F00-$3F1F)
  LDX PPUSTATUS
  LDX #$3F
  STX PPUADDR
  LDX #$00
  STX PPUADDR
load_palettes:
  LDA palettes,X
  STA PPUDATA
  INX
  CPX #32
  BNE load_palettes

  ; ---- clear nametable 0 ($2000-$23FF, 4 x 256 bytes)
  LDA PPUSTATUS
  LDA #$20
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDY #4
  TAX
clear_nt:
  STA PPUDATA
  INX
  BNE clear_nt
  DEY
  BNE clear_nt

  ; ---- ground: grass on row 26, dirt on row 27
  LDA PPUSTATUS
  LDA #$23
  STA PPUADDR
  LDA #$40
  STA PPUADDR
  LDX #32
  LDA #$05
grass:
  STA PPUDATA
  DEX
  BNE grass
  LDX #32
  LDA #$07
dirt:
  STA PPUDATA
  DEX
  BNE dirt

  ; ---- ground uses background palette 1 (attribute row 6, bottom half)
  LDA PPUSTATUS
  LDA #$23
  STA PPUADDR
  LDA #$F0
  STA PPUADDR
  LDX #8
  LDA #%01010000
ground_attr:
  STA PPUDATA
  DEX
  BNE ground_attr

  ; ---- stars: pairs of (high, low) nametable addresses, $00 ends the list
  LDY #$00
stars:
  LDA star_positions,Y
  BEQ stars_done
  STA PPUADDR
  INY
  LDA star_positions,Y
  STA PPUADDR
  INY
  LDA #$06
  STA PPUDATA
  JMP stars
stars_done:

  LDA #$78
  STA player_x
  LDA #$BF
  STA player_y

vblankwait:      ; turn the screen on during vblank
  BIT PPUSTATUS
  BPL vblankwait
  LDA #%10010000 ; NMI on, sprites from table 0, background from table 1
  STA PPUCTRL
  LDA #%00011110 ; show background and sprites
  STA PPUMASK

forever:
  LDA nmi_count
wait_nmi:        ; sleep until the next frame
  CMP nmi_count
  BEQ wait_nmi

  JSR read_controller
  JSR update_player
  JSR draw_player
  JMP forever
.endproc

.proc read_controller
  LDA #$01
  STA JOYPAD1    ; latch the buttons
  STA buttons    ; this 1 falls out into carry after 8 reads
  LSR A
  STA JOYPAD1
loop:
  LDA JOYPAD1
  LSR A          ; button bit -> carry
  ROL buttons    ; carry -> buttons
  BCC loop
  RTS
.endproc

.proc update_player
  LDA buttons
  AND #BTN_LEFT
  BEQ check_right
  DEC player_x
check_right:
  LDA buttons
  AND #BTN_RIGHT
  BEQ check_up
  INC player_x
check_up:
  LDA buttons
  AND #BTN_UP
  BEQ check_down
  DEC player_y
check_down:
  LDA buttons
  AND #BTN_DOWN
  BEQ done
  INC player_y
done:
  RTS
.endproc

.proc draw_player
  ; each sprite is 4 bytes: Y, tile, attributes, X
  LDA player_y
  STA $0200
  LDA #$01
  STA $0201
  LDA #$00
  STA $0202
  LDA player_x
  STA $0203

  LDA player_y
  STA $0204
  LDA #$02
  STA $0205
  LDA #$00
  STA $0206
  LDA player_x
  CLC
  ADC #$08
  STA $0207

  LDA player_y
  CLC
  ADC #$08
  STA $0208
  LDA #$03
  STA $0209
  LDA #$00
  STA $020A
  LDA player_x
  STA $020B

  LDA player_y
  CLC
  ADC #$08
  STA $020C
  LDA #$04
  STA $020D
  LDA #$00
  STA $020E
  LDA player_x
  CLC
  ADC #$08
  STA $020F
  RTS
.endproc

.segment "RODATA"
palettes:
  ; background
  .byte $0C, $30, $21, $11
  .byte $0C, $1A, $17, $27
  .byte $0C, $00, $10, $20
  .byte $0C, $00, $10, $20
  ; sprites
  .byte $0C, $16, $0F, $30
  .byte $0C, $00, $10, $20
  .byte $0C, $00, $10, $20
  .byte $0C, $00, $10, $20

star_positions:
  .byte $20, $C4,  $20, $D9,  $21, $2B,  $21, $70
  .byte $21, $E6,  $22, $1C,  $22, $54,  $20, $6E
  .byte $00

.segment "VECTORS"
.addr nmi_handler, reset_handler, irq_handler

.segment "CHARS"
.incbin "graphics.chr"
`;

// Momo, 16x16: 1 = body, 2 = black, 3 = white
const MOMO = [
  '......1111......',
  '....11111111....',
  '...1111111111...',
  '..111111111111..',
  '..113331133311..',
  '.11132311323111.',
  '.11132311323111.',
  '.11133311333111.',
  '.11111111111111.',
  '.11111222211111.',
  '..111111111111..',
  '...1111111111...',
  '....11111111....',
  '.....1....1.....',
  '....22....22....',
  '................',
];

const GRASS = ['11111111', '11111111', '12111211', '22122212', '22222222', '22322222', '22222232', '22222222'];
const DIRT = ['22222222', '22232222', '22222222', '32222223', '22222222', '22223222', '22222222', '23222222'];
const STAR = ['........', '...1....', '...1....', '.11111..', '...1....', '...1....', '........', '........'];

function quadrant(rows: string[], qx: number, qy: number) {
  return rows.slice(qy * 8, qy * 8 + 8).map((r) => r.slice(qx * 8, qx * 8 + 8));
}

export function makeSpriteChr(): Uint8Array {
  const chr = new Uint8Array(8192);
  chr.set(encodeTile(quadrant(MOMO, 0, 0)), 1 * 16);
  chr.set(encodeTile(quadrant(MOMO, 1, 0)), 2 * 16);
  chr.set(encodeTile(quadrant(MOMO, 0, 1)), 3 * 16);
  chr.set(encodeTile(quadrant(MOMO, 1, 1)), 4 * 16);
  const bank1 = 4096;
  chr.set(encodeTile(GRASS), bank1 + 0x05 * 16);
  chr.set(encodeTile(STAR), bank1 + 0x06 * 16);
  chr.set(encodeTile(DIRT), bank1 + 0x07 * 16);
  return chr;
}

export function samples(): SampleProject[] {
  return [
    {
      name: 'Sprite Mover',
      description: 'Multi-file project: reset code, controller reading, a 2x2 metasprite and a background.',
      files: {
        'main.asm': MAIN,
        'reset.asm': RESET,
        'header.inc': HEADER,
        'constants.inc': CONSTANTS,
        'graphics.chr': makeSpriteChr(),
      },
      open: 'main.asm',
    },
    {
      name: 'Hello NES',
      description: 'One file that sets the background color. The famicom.party starting point.',
      files: { 'helloworld.asm': HELLO },
      open: 'helloworld.asm',
    },
  ];
}
