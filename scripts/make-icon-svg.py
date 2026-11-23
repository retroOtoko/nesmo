# Generates public/icon.svg: a wide, Famicom-style cartridge in NesMo's red.
# The dark label carries a pixel "NESMO" and a red line that runs across and
# dips in a V, like early FC labels. Gold contacts echo the NesMo 1 icon.
import sys

GLYPHS = {
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
}

TEXT_COLOR = sys.argv[1] if len(sys.argv) > 1 else '#f2f3f6'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/icon.svg'

def text_path(text, x0, top, px):
    d = ''
    for i, ch in enumerate(text):
        for y, row in enumerate(GLYPHS[ch]):
            x = 0
            while x < 5:
                if row[x] != '#':
                    x += 1
                    continue
                n = 1
                while x + n < 5 and row[x + n] == '#':
                    n += 1
                d += f'M{x0 + (i * 6 + x) * px:.2f} {top + y * px:.2f}h{n * px:.2f}v{px:.2f}h{-n * px:.2f}z'
                x += n
    return d

# cartridge body (512 x 512 canvas), wider than tall like an FC cart
X, Y, W, H = 44, 108, 424, 300
CH = 16   # small chamfer on the top corners
R = 18    # bottom corner radius
body = (f'M{X + CH} {Y} H{X + W - CH} L{X + W} {Y + CH} V{Y + H - R} '
        f'Q{X + W} {Y + H} {X + W - R} {Y + H} H{X + R} Q{X} {Y + H} {X} {Y + H - R} V{Y + CH} Z')

# label
LX, LY, LW, LH = X + 24, Y + 40, W - 48, 196
# header strip above the label: two grip ridges
ridges = ''
for yy in (Y + 15, Y + 26):
    ridges += (f'<line x1="{X + 40}" y1="{yy}" x2="{X + W - 40}" y2="{yy}" class="groove"/>'
               f'<line x1="{X + 40}" y1="{yy + 3}" x2="{X + W - 40}" y2="{yy + 3}" class="lip"/>')

# NESMO, left-aligned like a title
px = 9.4
text_w = (5 * 6 - 1) * px
tx = LX + (LW - text_w) / 2
ty = LY + 34

# the line: across the label, a V dip toward the right, then across again
ly = ty + 7 * px + 30
v1 = LX + LW * 0.60
v_mid = LX + LW * 0.70
v2 = LX + LW * 0.80
dip = 34
line = (f'M{LX} {ly} H{v1} L{v_mid} {ly + dip} L{v2} {ly} H{LX + LW}')

# gold contacts along the bottom
slot_y = LY + LH + 14
slot_h = H - (slot_y - Y) - 14
pins = ''
n_pins = 10
pin_w = 18
gap = (W - 96 - n_pins * pin_w) / (n_pins - 1)
for i in range(n_pins):
    pins += f'<rect x="{X + 48 + i * (pin_w + gap):.2f}" y="{slot_y + 6}" width="{pin_w}" height="{slot_h - 12}" rx="2" class="pin"/>'

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#20242c"/><stop offset="1" stop-color="#0f1115"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#e0483a" stop-opacity="0.16"/><stop offset="1" stop-color="#e0483a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ee5a4c"/><stop offset="1" stop-color="#b9342a"/>
    </linearGradient>
    <linearGradient id="label" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e2128"/><stop offset="1" stop-color="#111317"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd866"/><stop offset="1" stop-color="#d69a1c"/>
    </linearGradient>
    <clipPath id="labelClip"><rect x="{LX}" y="{LY}" width="{LW}" height="{LH}" rx="12"/></clipPath>
    <style>
      .groove {{ stroke: #8c2820; stroke-width: 4; stroke-linecap: round; }}
      .lip {{ stroke: #ff8f84; stroke-opacity: 0.45; stroke-width: 2; stroke-linecap: round; }}
      .pin {{ fill: url(#gold); }}
    </style>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <path d="{body}" transform="translate(0 12)" fill="#050608" opacity="0.7"/>
  <path d="{body}" fill="url(#body)" stroke="#0a0b0e" stroke-width="6" stroke-linejoin="round"/>
  <path d="{body}" fill="none" stroke="#ff9a8f" stroke-opacity="0.35" stroke-width="3"
    transform="translate({X + 4} {Y + 4}) scale({(W - 8) / W} {(H - 8) / H}) translate({-X} {-Y})"/>
  {ridges}
  <rect x="{LX}" y="{LY}" width="{LW}" height="{LH}" rx="12" fill="url(#label)" stroke="#4d5261" stroke-width="3"/>
  <g clip-path="url(#labelClip)">
    <path d="{line}" fill="none" stroke="#e0483a" stroke-width="13" stroke-linejoin="miter" stroke-miterlimit="10"/>
  </g>
  <path d="{text_path('NESMO', tx, ty, px)}" fill="{TEXT_COLOR}"/>
  <rect x="{X + 36}" y="{slot_y}" width="{W - 72}" height="{slot_h}" rx="7" fill="#3a120e" stroke="#0a0b0e" stroke-width="3"/>
  {pins}
</svg>
'''
open(OUT, 'w').write(svg)
