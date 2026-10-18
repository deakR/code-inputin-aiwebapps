/**
 * Generates the extension icons as PNGs with no image dependencies:
 * a minimal PNG encoder on top of node:zlib, drawing supersampled shapes.
 */
import zlib from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const name = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded rectangle test in normalized [0,1] space. */
function inRoundRect(u, v, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const cx = u < x + rr ? x + rr : u > x + w - rr ? x + w - rr : u;
  const cy = v < y + rr ? y + rr : v > y + h - rr ? y + h - rr : v;
  const dx = u - cx;
  const dy = v - cy;
  return dx * dx + dy * dy <= rr * rr;
}

const BG_FROM = [0x42, 0x85, 0xf4];
const BG_TO = [0x15, 0x58, 0xd6];
const BAR = [0xff, 0xff, 0xff];
const CARET = [0x34, 0xa8, 0x53];

const BARS = [
  { x: 0.24, y: 0.275, w: 0.52, h: 0.095 },
  { x: 0.24, y: 0.452, w: 0.36, h: 0.095 },
  { x: 0.24, y: 0.629, w: 0.44, h: 0.095 },
];

/** Colour of one sample point, or null for transparent. */
function sample(u, v) {
  if (!inRoundRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.24)) return null;

  let color = BG_FROM.map((c, i) => Math.round(c + (BG_TO[i] - c) * ((u + v) / 2)));

  if (inRoundRect(u, v, 0.7, 0.614, 0.1, 0.125, 0.02)) return CARET;
  for (const bar of BARS) {
    if (inRoundRect(u, v, bar.x, bar.y, bar.w, bar.h, bar.h / 2)) return BAR;
  }
  return color;
}

export function renderIcon(size, samples = 4) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * samples);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x * samples + sx + 0.5) * step;
          const v = (y * samples + sy + 0.5) * step;
          const c = sample(u, v);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const total = samples * samples;
      const alpha = a / total;
      const i = (y * size + x) * 4;
      const cover = a === 0 ? 1 : a / 255;
      rgba[i] = Math.round(r / cover);
      rgba[i + 1] = Math.round(g / cover);
      rgba[i + 2] = Math.round(b / cover);
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

export const ICON_SIZES = [16, 32, 48, 128];

export async function generateIcons(outDir) {
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    ICON_SIZES.map((size) => writeFile(path.join(outDir, `icon${size}.png`), renderIcon(size))),
  );
  return ICON_SIZES.map((s) => path.join(outDir, `icon${s}.png`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const written = await generateIcons(path.join(root, 'dist/icons'));
  console.log(`[icons] wrote ${written.length} files to dist/icons`);
}
