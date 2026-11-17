// The gray-box preview for people to look at (CPU ray casting). The ControlNet maps are in maps.ts.
import { add, dist, dot, lerp, mul, norm, sub, type V3 } from '../shared/vec.ts';
import { cast, inside, raySphere, type World } from '../shared/geom.ts';
import { frame, project, ray, SIZE, type Cam } from './camera.ts';
import { BONES } from '../scene/poses.ts';
import type { Solved } from '../scene/solve.ts';
import { faceDir } from './score.ts';
import type { Image } from '../shared/image.ts';

const LIGHT = norm([0.4, 0.8, 0.3]);
const ACTOR_COLOURS: [number, number, number][] = [[220, 60, 60], [60, 110, 230], [60, 170, 90], [230, 150, 40], [150, 80, 200], [40, 180, 190]];

/** The gray-box preview: shaded geometry, actors in colours (focus first, red), lines bright, the damage tinted, thirds grid. */
/**
 * hint: a colour hint for the image model instead (the start of the denoising when the shot has effects, which are too
 * thin in depth and line art to be drawn otherwise): the sky by the time of day, people neutral grey (not the
 * preview's red and blue, which would colour their clothes), no skeletons, face marks or grid.
 */
export function preview(s: Solved, w: World, cam: Cam, scale = 0.5, opts: { hint?: boolean } = {}): Image {
  const hint = !!opts.hint, sky = skyOf(hint ? s.scene.time.of_day : undefined);
  const f = frame(cam);
  const W = Math.round(SIZE[cam.aspect].w * scale), H = Math.round(SIZE[cam.aspect].h * scale);
  const px = new Uint8Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  const order = [s.scene.moment.focus, ...s.scene.actors.map((a) => a.id).filter((id) => id !== s.scene.moment.focus)];
  const colour = (id: string) => ACTOR_COLOURS[order.indexOf(id) % ACTOR_COLOURS.length];
  const damages = [...s.damages.values()];
  const volumes = [...s.volumes.values()];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = ray(f, (x + 0.5) / W, (y + 0.5) / H);
    const hit = cast(w, cam.pos, d);
    let c: [number, number, number];
    if (!hit) {
      const t = Math.max(0, Math.min(1, d[1] * 2));
      c = [0, 1, 2].map((k) => Math.round(sky[0][k] + (sky[1][k] - sky[0][k]) * t)) as [number, number, number];
    } else {
      depth[y * W + x] = hit.t;
      const p = add(cam.pos, mul(d, hit.t));
      const shade = 0.45 + 0.55 * Math.max(0, dot(hit.normal, LIGHT));
      let base: [number, number, number];
      if (!hit.prim) { const chk = (Math.floor(p[0] / 5) + Math.floor(p[2] / 5)) & 1; base = chk ? [92, 92, 96] : [80, 80, 84]; }
      else if (hit.prim.role === 'actor') base = hint ? [150, 150, 150] : colour(hit.prim.owner);
      else if (hit.prim.role === 'structure') base = [205, 205, 210];
      else base = [150, 150, 155];
      c = [base[0] * shade, base[1] * shade, base[2] * shade];
      if (hit.prim) for (const dm of damages) if (dm.target === hit.prim.owner && inside({ kind: 'box', ...dm.box, owner: '', role: 'structure' }, p, 0.01)) c = blend(c, [255, 130, 30], 0.65);
      // building floors: a faint line every storey on structures
      if (hit.prim && hit.prim.role !== 'actor' && Math.abs(hit.normal[1]) < 0.5 && (p[1] % 3.5 + 3.5) % 3.5 < 0.12) c = blend(c, [60, 60, 70], 0.5);
    }
    for (const v of volumes) {
      const h = raySphere(cam.pos, d, v.c, v.r);
      if (h && h.t < depth[y * W + x]) c = blend(c, [255, 230, 120], 0.45);
    }
    px.set(c.map((k) => Math.max(0, Math.min(255, Math.round(k)))), (y * W + x) * 3);
  }
  // lines: bright, hidden behind what stands in front of them
  for (const l of s.lines.values()) {
    const steps = 600;
    for (let i = 0; i <= steps; i++) {
      const q = lerp(l.a, l.b, i / steps);
      const p = project(f, q);
      if (!p) continue;
      const cx = p.u * W, cy = p.v * H;
      const r = Math.max(1.5, Math.min(8, (l.radius * 2.5 * W) / (p.z * 0.9)));
      dot2(px, W, H, cx, cy, r, [255, 245, 150], depth, dist(cam.pos, q) - 0.3);
    }
  }
  if (hint) return { width: W, height: H, channels: 3, pixels: px };
  // skeletons over the bodies (to read poses at a small size)
  for (const a of s.actors.values()) {
    const col = colour(a.id).map((k) => Math.min(255, k + 70)) as [number, number, number];
    for (const [i, j] of BONES) {
      const p = project(f, a.points[i]), q = project(f, a.points[j]);
      if (!p || !q) continue;
      const n = 30;
      for (let t = 0; t <= n; t++) {
        const pt = lerp(a.points[i], a.points[j], t / n);
        dot2(px, W, H, (p.u + (q.u - p.u) * t / n) * W, (p.v + (q.v - p.v) * t / n) * H, 1.2, col, depth, dist(cam.pos, pt) + 0.25);
      }
    }
  }
  // a white dot in front of each face: which way they look
  for (const a of s.actors.values()) {
    const q = add(a.head, mul(faceDir(a), a.headR * 1.15));
    const p = project(f, q);
    if (p) dot2(px, W, H, p.u * W, p.v * H, Math.max(1.5, 0.04 * a.height * W / (p.z * 1.2)), [255, 255, 255], depth, dist(cam.pos, q) + 0.05);
  }
  // thirds grid
  for (const k of [1 / 3, 2 / 3]) {
    for (let y = 0; y < H; y++) tint(px, W, Math.round(k * W), y, [255, 255, 255], 0.18);
    for (let x = 0; x < W; x++) tint(px, W, x, Math.round(k * H), [255, 255, 255], 0.18);
  }
  return { width: W, height: H, channels: 3, pixels: px };
}

/** horizon and zenith colours: day by default; dusk and night from the scene's own time of day */
function skyOf(time?: string): [[number, number, number], [number, number, number]] {
  const t = (time ?? '').toLowerCase();
  if (/night|midnight/.test(t)) return [[40, 45, 80], [10, 12, 30]];
  if (/sunset|dusk|evening|twilight|dawn|sunrise/.test(t)) return [[250, 160, 90], [90, 80, 150]];
  return [[200, 215, 235], [110, 155, 215]];
}

function blend(c: [number, number, number], d: [number, number, number], a: number): [number, number, number] {
  return [c[0] * (1 - a) + d[0] * a, c[1] * (1 - a) + d[1] * a, c[2] * (1 - a) + d[2] * a];
}
function tint(px: Uint8Array, W: number, x: number, y: number, c: [number, number, number], a: number) {
  const i = (y * W + x) * 3;
  if (x < 0 || y < 0 || i + 2 >= px.length || x >= W) return;
  for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a);
}
function dot2(px: Uint8Array, W: number, H: number, cx: number, cy: number, r: number, c: [number, number, number], depth: Float32Array, z: number) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    if (depth[y * W + x] < z) continue;
    px.set(c, (y * W + x) * 3);
  }
}

export { sub };
