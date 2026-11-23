// NES 2bpp tile helpers. A tile is 16 bytes: 8 bytes of bit plane 0, then
// 8 bytes of bit plane 1. Pixel x = 0 is bit 7.

export function decodeTile(data: Uint8Array, offset: number, out?: Uint8Array): Uint8Array {
  const px = out ?? new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const lo = data[offset + y] ?? 0;
    const hi = data[offset + y + 8] ?? 0;
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      px[y * 8 + x] = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
    }
  }
  return px;
}

export function writeTile(data: Uint8Array, offset: number, px: Uint8Array) {
  for (let y = 0; y < 8; y++) {
    let lo = 0;
    let hi = 0;
    for (let x = 0; x < 8; x++) {
      const c = px[y * 8 + x];
      lo |= (c & 1) << (7 - x);
      hi |= ((c >> 1) & 1) << (7 - x);
    }
    data[offset + y] = lo;
    data[offset + y + 8] = hi;
  }
}

/** rows of '.', '1', '2', '3' → 16 bytes */
export function encodeTile(rows: string[]): Uint8Array {
  const px = new Uint8Array(64);
  rows.forEach((r, y) => {
    for (let x = 0; x < 8; x++) px[y * 8 + x] = r[x] === '.' ? 0 : parseInt(r[x], 10) || 0;
  });
  const out = new Uint8Array(16);
  writeTile(out, 0, px);
  return out;
}

/** Draw one tile into RGBA ImageData at (dx, dy) with a 4-color RGB palette. */
export function blitTile(
  img: ImageData,
  dx: number,
  dy: number,
  px: Uint8Array,
  pal: number[], // 0xRRGGBB
  transparent0 = false,
  flipH = false,
  flipV = false,
) {
  const d = img.data;
  for (let y = 0; y < 8; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= img.height) continue;
    for (let x = 0; x < 8; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= img.width) continue;
      const c = px[(flipV ? 7 - y : y) * 8 + (flipH ? 7 - x : x)];
      if (transparent0 && c === 0) continue;
      const rgb = pal[c];
      const i = (ty * img.width + tx) * 4;
      d[i] = (rgb >> 16) & 255;
      d[i + 1] = (rgb >> 8) & 255;
      d[i + 2] = rgb & 255;
      d[i + 3] = 255;
    }
  }
}
