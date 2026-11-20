// Draws the home-screen icon (a vinyl record with a pink "?" label) as PNGs
// without any image library. Run with `npm run icons`.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x12, 0x10, 0x1c];
const GROOVE_A = [0x0c, 0x0b, 0x12];
const GROOVE_B = [0x1f, 0x1b, 0x30];
const PINK = [0xff, 0x4f, 0x9a];
const WHITE = [0xf4, 0xf1, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// "?" as a 5x7 bitmap, drawn inside the label.
const QUESTION = ['01110', '10001', '00001', '00110', '00100', '00000', '00100'];

function pixel(x, y, size) {
  const c = size / 2;
  const r = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c; // 0 at centre, 1 at edge
  const label = 0.32;
  if (r < label) {
    const cell = (label * 2 * c) / 9;
    const gx = Math.floor((x - (c - 2.5 * cell)) / cell);
    const gy = Math.floor((y - (c - 3.5 * cell)) / cell);
    return QUESTION[gy]?.[gx] === '1' ? WHITE : PINK;
  }
  if (r < 0.86) return Math.floor(r * 40) % 2 ? GROOVE_A : GROOVE_B;
  return BG;
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) row.set(pixel(x, y, size), 1 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(`public/icon-${size}.png`, png(size));
