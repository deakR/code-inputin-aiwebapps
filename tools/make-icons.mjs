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

/**
 * The mark matches the project logo: a dark rounded tile with neon code
 * brackets and a four-point spark. It is drawn from shapes rather than a
 * bitmap so every size stays crisp, including the 16px toolbar size.
 */
const BG_FROM = [0x08, 0x0d, 0x1a];
const BG_TO = [0x1e, 0x1b, 0x4b];
const BG_GLOW = [0x1e, 0x29, 0x3b];
const CYAN = [0x22, 0xd3, 0xee];
const VIOLET = [0xa8, 0x55, 0xf7];
const SPARK = [0xf8, 0xfa, 0xfc];

function mix(a, b, t) {
  const amount = Math.max(0, Math.min(1, t));
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));
}

/** A round-capped line segment, used for the bracket strokes. */
function inSegment(u, v, x1, y1, x2, y2, radius) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (u - x1) ** 2 + (v - y1) ** 2 <= radius * radius;
  const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / lengthSquared));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return (u - x) ** 2 + (v - y) ** 2 <= radius * radius;
}

const STROKE = 0.085;
const LEFT_BRACKET = [0.36, 0.3, 0.235, 0.5, 0.36, 0.7];
const RIGHT_BRACKET = [0.64, 0.3, 0.765, 0.5, 0.64, 0.7];

/** Colour of one sample point, or null for transparent. */
function sample(u, v) {
  if (!inRoundRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.23)) return null;

  const diagonal = (u + v) / 2;
  const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.7);
  let color = mix(BG_FROM, BG_TO, diagonal);
  color = mix(color, BG_GLOW, glow * 0.32);

  const [lx1, ly1, lx2, ly2, lx3, ly3] = LEFT_BRACKET;
  const [rx1, ry1, rx2, ry2, rx3, ry3] = RIGHT_BRACKET;
  const onLeft = inSegment(u, v, lx1, ly1, lx2, ly2, STROKE / 2) ||
    inSegment(u, v, lx2, ly2, lx3, ly3, STROKE / 2);
  const onRight = inSegment(u, v, rx1, ry1, rx2, ry2, STROKE / 2) ||
    inSegment(u, v, rx2, ry2, rx3, ry3, STROKE / 2);
  if (onLeft || onRight) return mix(CYAN, VIOLET, (u - 0.2) / 0.6);

  // Four-point spark: a concave diamond, like the one in the project logo.
  const spark = Math.abs(u - 0.5) ** 0.62 + Math.abs(v - 0.5) ** 0.62 <= 0.058 ** 0.62;
  if (spark) return SPARK;

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
