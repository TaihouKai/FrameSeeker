// Minimal PNG writer (8-bit RGB or grey) and reader (8-bit, non-interlaced; alpha dropped), no dependencies.
import { deflateSync, inflateSync } from 'node:zlib';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}

/** channels: 3 (RGB) or 1 (grey); pixels row by row. */
export function encodePng(width: number, height: number, pixels: Uint8Array, channels: 1 | 3): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

/** Decode an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB, RGBA) to grey or RGB. */
export function decodePng(png: Uint8Array): { width: number; height: number; channels: 1 | 3; pixels: Uint8Array } {
  const b = Buffer.from(png);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, type = 0;
  const idat: Buffer[] = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos), kind = b.toString('ascii', pos + 4, pos + 8), data = b.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || ![0, 2, 4, 6].includes(type)) throw new Error('unsupported PNG (8-bit, non-interlaced, no palette only)');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type], stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat)), cur = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[row + x - bpp] : 0, up = y ? cur[row - stride + x] : 0, c = x >= bpp && y ? cur[row - stride + x - bpp] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      cur[row + x] = (src[x] + pred) & 0xff;
    }
  }
  const channels: 1 | 3 = type === 0 || type === 4 ? 1 : 3;
  const out = new Uint8Array(width * height * channels);
  for (let i = 0; i < width * height; i++) for (let k = 0; k < channels; k++) out[i * channels + k] = cur[i * bpp + k];
  return { width, height, channels, pixels: out };
}
