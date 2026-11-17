// An image-board tagger (SmilingWolf's WD SwinV2 tagger v3, ONNX, run on the CPU): the probability of each Danbooru
// tag in a picture. Used as a measuring instrument on each person's own pixels — is the one planned as "1boy" drawn
// as a boy? — in the same vocabulary the prompts use. Optional: without onnxruntime-node or the model files it is
// absent and the checks that need it are skipped.
//   model files: FRAMESEEKER_TAGGER=<dir> or ~/.cache/frameseeker/wd-swinv2-tagger-v3 (npm run get-tagger)
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Image } from '../shared/image.ts';

export interface Tagger { tag(img: Image, box: [number, number, number, number], mask?: Image): Promise<Map<string, number>> }

export const TAGGER_REPO = 'SmilingWolf/wd-swinv2-tagger-v3';
export const taggerDir = (env: NodeJS.ProcessEnv = process.env) => env.FRAMESEEKER_TAGGER ?? join(homedir(), '.cache', 'frameseeker', 'wd-swinv2-tagger-v3');
const SIZE = 448;

let loaded: Promise<Tagger | null> | undefined;
/** The tagger, loaded once; null when the runtime or the model is missing. */
export function loadTagger(dir = taggerDir()): Promise<Tagger | null> {
  return loaded ??= (async () => {
    if (!existsSync(join(dir, 'model.onnx')) || !existsSync(join(dir, 'selected_tags.csv'))) return null;
    let ort: typeof import('onnxruntime-node');
    try { ort = await import('onnxruntime-node'); } catch { return null; }
    const names = readFileSync(join(dir, 'selected_tags.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[1]);
    const session = await ort.InferenceSession.create(join(dir, 'model.onnx'));
    return {
      async tag(img, box, mask) {
        const input = new ort.Tensor('float32', taggerInput(img, box, mask), [1, SIZE, SIZE, 3]);
        const out = await session.run({ [session.inputNames[0]]: input });
        const p = out[session.outputNames[0]].data as Float32Array;
        // board tags use underscores ("male_focus"); prompts use spaces
        return new Map(names.map((n, i) => [n.replace(/_/g, ' '), p[i]]));
      },
    };
  })();
}

/**
 * The tagger's input: the box grown 15%, made square, everything outside the (grown) mask white — only this
 * person, not the one beside them — bilinear to 448 × 448, BGR, 0..255.
 */
export function taggerInput(img: Image, box: [number, number, number, number], mask?: Image): Float32Array {
  const [b0, b1, b2, b3] = box, gx = (b2 - b0) * 0.15, gy = (b3 - b1) * 0.15;
  const x0 = (b0 - gx) * img.width, x1 = (b2 + gx) * img.width, y0 = (b1 - gy) * img.height, y1 = (b3 + gy) * img.height;
  const side = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const m = mask ? grown(mask, Math.round(0.03 * mask.width)) : null;
  const out = new Float32Array(SIZE * SIZE * 3);
  const px = (x: number, y: number, c: number) => img.pixels[(y * img.width + x) * img.channels + (img.channels === 3 ? c : 0)];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const sx = cx - side / 2 + (x + 0.5) * side / SIZE - 0.5, sy = cy - side / 2 + (y + 0.5) * side / SIZE - 0.5;
    const inside = sx >= 0 && sy >= 0 && sx < img.width - 1 && sy < img.height - 1
      && (!m || m[Math.min(mask!.height - 1, Math.floor(sy / img.height * mask!.height)) * mask!.width + Math.min(mask!.width - 1, Math.floor(sx / img.width * mask!.width))] > 0);
    for (let c = 0; c < 3; c++) {
      let v = 255;
      if (inside) {
        const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
        v = px(ix, iy, c) * (1 - fx) * (1 - fy) + px(ix + 1, iy, c) * fx * (1 - fy) + px(ix, iy + 1, c) * (1 - fx) * fy + px(ix + 1, iy + 1, c) * fx * fy;
      }
      out[(y * SIZE + x) * 3 + (2 - c)] = v;
    }
  }
  return out;
}

/** the mask grown by r pixels (a square: rows, then columns) */
function grown(mask: Image, r: number): Uint8Array {
  const { width: W, height: H, pixels } = mask, a = new Uint8Array(W * H), b = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pixels[y * W + x]) for (let d = Math.max(0, x - r); d <= Math.min(W - 1, x + r); d++) a[y * W + d] = 255;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (a[y * W + x]) for (let d = Math.max(0, y - r); d <= Math.min(H - 1, y + r); d++) b[d * W + x] = 255;
  return b;
}
