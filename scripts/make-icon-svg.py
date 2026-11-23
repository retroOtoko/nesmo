# Generates public/icon.svg: a Famicom-style cartridge in NesMo's red with a
# dark label (Momo + pixel "NESMO") and gold contacts, echoing the NesMo 1 icon.
GLYPHS = {
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
}
MOMO = [
    '......1111......', '....11111111....', '...1111111111...', '..111111111111..',
    '..113331133311..', '.11132311323111.', '.11132311323111.', '.11133311333111.',
    '.11111111111111.', '.11111222211111.', '..111111111111..', '...1111111111...',
    '....11111111....', '.....1....1.....', '....22....22....', '................',
]

def runs(rows, x0, y0, px, want):
    d = ''
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            if row[x] != want:
                x += 1
                continue
            n = 1
            while x + n < len(row) and row[x + n] == want:
                n += 1
            d += f'M{x0 + x * px:.2f} {y0 + y * px:.2f}h{n * px:.2f}v{px:.2f}h{-n * px:.2f}z'
            x += n
    return d

def text_path(text, cx, top, px):
    width = (len(text) * 6 - 1) * px
    x0 = cx - width / 2
    d = ''
    for i, ch in enumerate(text):
        d += runs(GLYPHS[ch], x0 + i * 6 * px, top, px, '#')
    return d

# cartridge geometry (512 x 512 canvas)
X, Y, W, H = 94, 38, 324, 436
CH = 42          # chamfer on the top corners
R = 20           # bottom corner radius
cart = (f'M{X + CH} {Y} H{X + W - CH} L{X + W} {Y + CH} V{Y + H - R} '
        f'Q{X + W} {Y + H} {X + W - R} {Y + H} H{X + R} Q{X} {Y + H} {X} {Y + H - R} V{Y + CH} Z')

ridges = ''
for i, yy in enumerate((Y + 28, Y + 47, Y + 66)):
    inset = 62 - i * 6
    ridges += (f'<line x1="{X + inset}" y1="{yy}" x2="{X + W - inset}" y2="{yy}" class="groove"/>'
               f'<line x1="{X + inset}" y1="{yy + 3}" x2="{X + W - inset}" y2="{yy + 3}" class="lip"/>')

LX, LY, LW, LH = X + 32, Y + 94, W - 64, 254
momo_px = 7
momo_w = 16 * momo_px
momo_x = LX + (LW - momo_w) / 2
text_px = 6.8
content_h = momo_w + 22 + 7 * text_px
momo_y = LY + (LH - content_h) / 2 - 2
text_top = momo_y + momo_w + 22

pins = ''
slot_y = LY + LH + 22
for i in range(8):
    px_ = X + 50 + i * 29
    pins += f'<rect x="{px_}" y="{slot_y + 7}" width="16" height="36" rx="2" class="pin"/>'

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#20242c"/><stop offset="1" stop-color="#0f1115"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="#e0483a" stop-opacity="0.18"/><stop offset="1" stop-color="#e0483a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ee5a4c"/><stop offset="1" stop-color="#b9342a"/>
    </linearGradient>
    <linearGradient id="label" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d2027"/><stop offset="1" stop-color="#101216"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd866"/><stop offset="1" stop-color="#d69a1c"/>
    </linearGradient>
    <style>
      .groove {{ stroke: #8c2820; stroke-width: 5; stroke-linecap: round; }}
      .lip {{ stroke: #ff8f84; stroke-opacity: 0.45; stroke-width: 2; stroke-linecap: round; }}
      .pin {{ fill: url(#gold); }}
    </style>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <path d="{cart}" transform="translate(0 12)" fill="#050608" opacity="0.7"/>
  <path d="{cart}" fill="url(#body)" stroke="#0a0b0e" stroke-width="6" stroke-linejoin="round"/>
  <path d="{cart}" fill="none" stroke="#ff9a8f" stroke-opacity="0.35" stroke-width="3" transform="translate(4 4) scale({(W - 8) / W} {(H - 8) / H})" transform-origin="{X} {Y}"/>
  {ridges}
  <rect x="{LX}" y="{LY}" width="{LW}" height="{LH}" rx="16" fill="url(#label)" stroke="#4d5261" stroke-width="3"/>
  <path d="{runs(MOMO, momo_x, momo_y, momo_px, '1')}" fill="#e0483a"/>
  <path d="{runs(MOMO, momo_x, momo_y, momo_px, '3')}" fill="#ffffff"/>
  <path d="{runs(MOMO, momo_x, momo_y, momo_px, '2')}" fill="#050608"/>
  <path d="{text_path('NESMO', LX + LW / 2, text_top, text_px)}" fill="#ff5b4c"/>
  <rect x="{X + 36}" y="{slot_y}" width="{W - 72}" height="50" rx="8" fill="#3a120e" stroke="#0a0b0e" stroke-width="3"/>
  {pins}
</svg>
'''
open('public/icon.svg', 'w').write(svg)
print('label bottom', LY + LH, 'slot', slot_y, slot_y + 46, 'cart bottom', Y + H, 'text bottom', text_top + 7 * text_px)
