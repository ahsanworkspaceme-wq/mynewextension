// Generates simple PNG icons (no external deps) for the extension.
// A purple→blue diagonal gradient with a white "spark" mark.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "extension", "icons");
mkdirSync(OUT, { recursive: true });

// CRC32 table for PNG chunk checksums
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

// 4-point sparkle shape membership
function inSparkle(px, py, cx, cy, r) {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  // star: |x|^p + |y|^p style pinch -> use a concave diamond
  const nx = dx / r;
  const ny = dy / r;
  return Math.pow(nx, 0.5) + Math.pow(ny, 0.5) <= 1;
}

function makePng(size) {
  const W = size, H = size;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  const c1 = [124, 58, 237]; // purple
  const c2 = [37, 99, 235]; // blue
  const cx = W / 2, cy = H / 2, r = W * 0.34;

  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter byte: none
    for (let x = 0; x < W; x++) {
      const t = (x + y) / (W + H);
      let R = lerp(c1[0], c2[0], t);
      let G = lerp(c1[1], c2[1], t);
      let B = lerp(c1[2], c2[2], t);
      let A = 255;

      // rounded corners
      const corner = Math.max(2, size * 0.18);
      const inCorner =
        (x < corner && y < corner && Math.hypot(corner - x, corner - y) > corner) ||
        (x > W - corner && y < corner && Math.hypot(x - (W - corner), corner - y) > corner) ||
        (x < corner && y > H - corner && Math.hypot(corner - x, y - (H - corner)) > corner) ||
        (x > W - corner && y > H - corner && Math.hypot(x - (W - corner), y - (H - corner)) > corner);
      if (inCorner) A = 0;

      // white sparkle in center
      if (inSparkle(x + 0.5, y + 0.5, cx, cy, r)) {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const png = makePng(size);
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
