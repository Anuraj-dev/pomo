import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): Uint8Array {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  c = (c ^ 0xffffffff) >>> 0;
  return new Uint8Array([c >>> 24, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  out.set(len, 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(crc32(new Uint8Array([...typeBytes, ...data])), 8 + data.length);
  return out;
}

export function encodePng(size: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4 + 1;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
  }
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const BG: [number, number, number, number] = [13, 17, 23, 255];
const TRACK: [number, number, number, number] = [35, 44, 58, 255];
const RED: [number, number, number, number] = [255, 77, 61, 255];
const DOT: [number, number, number, number] = [236, 229, 216, 255];

function coverage(edge0: number, edge1: number, value: number): number {
  const t = (value - edge0) / (edge1 - edge0);
  return Math.min(1, Math.max(0, t));
}

function band(distance: number, radius: number, width: number): number {
  const half = width / 2;
  return coverage(radius - half - 0.5, radius - half + 0.5, distance) *
    (1 - coverage(radius + half - 0.5, radius + half + 0.5, distance));
}

function blend(px: Uint8Array, color: [number, number, number, number], alpha: number): void {
  if (alpha <= 0) return;
  const a = alpha;
  const dst = px[3]! / 255;
  const out = a + dst * (1 - a);
  if (out <= 0) return;
  for (let k = 0; k < 3; k++) {
    const cs = color[k]! / 255;
    const cd = px[k]! / 255;
    px[k] = Math.round(((cs * a + cd * dst * (1 - a)) / out) * 255);
  }
  px[3] = Math.round(out * 255);
}

function drawIcon(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      rgba[px] = BG[0];
      rgba[px + 1] = BG[1];
      rgba[px + 2] = BG[2];
      rgba[px + 3] = BG[3];
    }
  }

  const c = size / 2;
  const ringR = size * 0.3;
  const trackW = size * 0.09;
  const arcW = size * 0.115;
  const dotR = size * 0.1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      const dx = x - c;
      const dy = y - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const inArc = angleDeg >= -90 && angleDeg <= 180;

      if (!inArc) {
        blend(rgba.subarray(px, px + 4), TRACK, band(d, ringR, trackW));
      } else {
        blend(rgba.subarray(px, px + 4), RED, band(d, ringR, arcW));
      }
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      const d = Math.sqrt((x - c) ** 2 + (y - c) ** 2);
      const dotAlpha = 1 - coverage(dotR - 0.5, dotR + 0.5, d);
      blend(rgba.subarray(px, px + 4), DOT, dotAlpha);
    }
  }

  return rgba;
}

export function generateIcons(): void {
  const outDir = join(import.meta.dir, "..", "dist", "icons");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    writeFileSync(join(outDir, `icon${size}.png`), encodePng(size, drawIcon(size)));
  }
  console.log(`icons: generated 16/32/48/128 -> ${outDir}`);
}

if (import.meta.main) {
  generateIcons();
}
