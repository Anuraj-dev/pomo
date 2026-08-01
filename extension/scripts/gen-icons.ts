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

const BG = [13, 17, 23, 255];
const RED = [255, 77, 61, 255];

function drawIcon(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const inset = Math.round(size * 0.18);
  const bar = Math.max(1, Math.round(size * 0.06));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      const inBar = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const pips = inBar && ((y - inset) % Math.round(size * 0.3) < bar);
      const c = pips ? BG : RED;
      rgba.set(c, px);
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
