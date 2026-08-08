// Generates the Glide extension icons (no external deps).
// A purple→blue gradient tile with a white "glide" swoosh — a forward arrow
// with motion lines suggesting effortless movement.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "extension", "icons");
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Glide mark: forward arrow (shaft + head) with motion lines.
function inMark(nx, ny, size) {
  // shaft
  if (nx >= 0.2 && nx <= 0.62 && ny >= 0.45 && ny <= 0.55) return true;
  // arrowhead (tapered triangle pointing right)
  if (nx >= 0.54 && nx <= 0.82) {
    const t = 0.2 * ((0.82 - nx) / (0.82 - 0.54));
    if (Math.abs(ny - 0.5) <= t) return true;
  }
  // motion lines (only render on larger sizes to stay crisp)
  if (size >= 32) {
    if (nx >= 0.13 && nx <= 0.35 && ny >= 0.3 && ny <= 0.37) return true;
    if (nx >= 0.13 && nx <= 0.35 && ny >= 0.63 && ny <= 0.7) return true;
  }
  return false;
}

function makePng(size) {
  const W = size, H = size;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  const c1 = [124, 58, 237]; // purple
  const c2 = [59, 130, 246]; // blue
  const corner = Math.max(2, size * 0.2);

  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const t = (x + y) / (W + H);
      let R = lerp(c1[0], c2[0], t);
      let G = lerp(c1[1], c2[1], t);
      let B = lerp(c1[2], c2[2], t);
      let A = 255;

      const inCorner =
        (x < corner && y < corner && Math.hypot(corner - x, corner - y) > corner) ||
        (x > W - corner && y < corner && Math.hypot(x - (W - corner), corner - y) > corner) ||
        (x < corner && y > H - corner && Math.hypot(corner - x, y - (H - corner)) > corner) ||
        (x > W - corner && y > H - corner && Math.hypot(x - (W - corner), y - (H - corner)) > corner);
      if (inCorner) A = 0;

      if (inMark((x + 0.5) / W, (y + 0.5) / H, size)) {
        R = G = B = 255;
      }

      const off = y * (W * 4 + 1) + 1 + x * 4;
      raw[off] = R;
      raw[off + 1] = G;
      raw[off + 2] = B;
      raw[off + 3] = A;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) {
  const png = makePng(size);
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
