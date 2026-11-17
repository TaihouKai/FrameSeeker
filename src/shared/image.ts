// A raw image passed between modules (structure maps, generated pictures): row-major, 8 bits per channel.
import { encodePng } from './png.ts';

export interface Image { width: number; height: number; channels: 1 | 3; pixels: Uint8Array }

export const toPng = (img: Image): Uint8Array => encodePng(img.width, img.height, img.pixels, img.channels);

/** As RGB (a grey image's channel copied three times). */
export function toRgb(img: Image): Image {
  if (img.channels === 3) return img;
  const px = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) px[i * 3] = px[i * 3 + 1] = px[i * 3 + 2] = img.pixels[i];
  return { width: img.width, height: img.height, channels: 3, pixels: px };
}

/** Scaled to this height (box filter when shrinking, so thin lines survive as grey rather than vanishing). */
export function scaleToHeight(img: Image, height: number): Image {
  const s = height / img.height, W = Math.max(1, Math.round(img.width * s)), H = height, c = img.channels;
  const px = new Uint8Array(W * H * c);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.floor((x + 1) / s)), y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.floor((y + 1) / s));
    for (let k = 0; k < c; k++) {
      let sum = 0, n = 0;
      for (let yy = y0; yy < Math.min(y1, img.height); yy++) for (let xx = x0; xx < Math.min(x1, img.width); xx++) { sum += img.pixels[(yy * img.width + xx) * c + k]; n++; }
      px[(y * W + x) * c + k] = n ? Math.round(sum / n) : 0;
    }
  }
  return { width: W, height: H, channels: c, pixels: px };
}

/** Side by side, at a common height, with a gap of the given grey between them. */
export function hstack(images: Image[], height: number, gap = 8, background = 255): Image {
  const parts = images.map((i) => toRgb(scaleToHeight(i, height)));
  const W = parts.reduce((s, p) => s + p.width, 0) + gap * Math.max(0, parts.length - 1);
  const px = new Uint8Array(W * height * 3).fill(background);
  let ox = 0;
  for (const p of parts) {
    for (let y = 0; y < height; y++) px.set(p.pixels.subarray(y * p.width * 3, (y + 1) * p.width * 3), (y * W + ox) * 3);
    ox += p.width + gap;
  }
  return { width: W, height, channels: 3, pixels: px };
}
