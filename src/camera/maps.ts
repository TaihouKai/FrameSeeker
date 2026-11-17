// Phase 5: the structure maps of a shot, for ControlNet. One ray pass makes a geometry buffer (distance, normal,
// what was hit); depth, line art and region masks are read off it; the pose map is drawn from the skeletons.
//
// Conventions (so off-the-shelf ControlNet models read them as their own preprocessors' output):
//  - depth: near white, far black, sky black (MiDaS-style inverse depth, contrast from the 2nd–98th percentile);
//  - lineart: white lines on black; the environment and the effects (beams, blasts), people left blank (the pose
//    map and the prompt carry them, so the model draws people, not mannequins);
//  - pose: OpenPose body-18 as drawn by controlnet_aux (limbs as ellipses of width 4 at 60% colour, joints as
//    radius-4 discs); joints hidden by other things or out of frame are left out, and a face turned away has no
//    nose or eyes, as a detector would see it;
//  - regions: a mask per person and per effect (what of it is visible), for regional prompting.
import { add, dist, dot, mul, sub, type V3 } from '../shared/vec.ts';
import { cast, clear, inside, raySphere, type World } from '../shared/geom.ts';
import type { Image } from '../shared/image.ts';
import type { Solved, SolvedActor } from '../scene/solve.ts';
import { frame, inFrame, project, ray, SIZE, type Cam, type Frame } from './camera.ts';
import { KP } from '../scene/poses.ts';
import { faceDir } from './score.ts';

const Kind = { Sky: 0, Ground: 1, Actor: 2, Structure: 3, Dressing: 4 } as const;

export interface GBuffer {
  width: number; height: number;
  frame: Frame;
  /** distance along the ray (Infinity: sky) */
  t: Float32Array;
  normal: Float32Array;
  /** world height of the hit point */
  y: Float32Array;
  /** index of the primitive hit (-1 sky, -2 ground) */
  prim: Int32Array;
  kind: Uint8Array;
  /** index into `owners` (-1: sky or ground) */
  owner: Int32Array;
  owners: string[];
}

const dirAt = (g: GBuffer, x: number, y: number) => ray(g.frame, (x + 0.5) / g.width, (y + 0.5) / g.height);

export function gbuffer(w: World, cam: Cam, scale = 1): GBuffer {
  const f = frame(cam);
  const W = Math.round(SIZE[cam.aspect].w * scale), H = Math.round(SIZE[cam.aspect].h * scale), N = W * H;
  const g: GBuffer = {
    width: W, height: H, frame: f, t: new Float32Array(N).fill(Infinity), normal: new Float32Array(N * 3), y: new Float32Array(N),
    prim: new Int32Array(N).fill(-1), kind: new Uint8Array(N), owner: new Int32Array(N).fill(-1), owners: [],
  };
  const ownerIdx = new Map<string, number>();
  const primIdx = new Map(w.prims.map((p, i) => [p, i]));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, d = dirAt(g, x, y);
    const hit = cast(w, cam.pos, d, 5000);
    if (!hit) continue;
    g.t[i] = hit.t;
    g.normal.set(hit.normal, i * 3);
    g.y[i] = cam.pos[1] + d[1] * hit.t;
    if (!hit.prim) { g.prim[i] = -2; g.kind[i] = Kind.Ground; continue; }
    g.prim[i] = primIdx.get(hit.prim)!;
    g.kind[i] = hit.prim.role === 'actor' ? Kind.Actor : hit.prim.role === 'structure' ? Kind.Structure : Kind.Dressing;
    let o = ownerIdx.get(hit.prim.owner);
    if (o === undefined) { o = g.owners.length; g.owners.push(hit.prim.owner); ownerIdx.set(hit.prim.owner, o); }
    g.owner[i] = o;
  }
  return g;
}

/** Inverse depth over the 2nd–98th percentile: one wall at the lens does not flatten the rest. */
export function depthOf(g: GBuffer): Image {
  const inv: number[] = [];
  for (const t of g.t) if (t < Infinity) inv.push(1 / t);
  inv.sort((a, b) => a - b);
  const lo = inv.length ? inv[Math.floor(inv.length * 0.02)] : 0, hi = inv.length ? inv[Math.min(inv.length - 1, Math.floor(inv.length * 0.98))] : 1;
  const px = new Uint8Array(g.width * g.height);
  for (let i = 0; i < px.length; i++) {
    if (g.t[i] === Infinity) continue;
    const v = Math.max(0, Math.min(1, (1 / g.t[i] - lo) / Math.max(1e-9, hi - lo)));
    px[i] = Math.round(20 + 235 * v);
  }
  return { width: g.width, height: g.height, channels: 1, pixels: px };
}

/** A crease where faces meet at more than this angle. */
export const CREASE_DEG = 30;
/** Storey lines on vertical faces of things taller than this (metres), every FLOOR_H. */
const STOREY_MIN_HEIGHT = 6, FLOOR_H = 3.5;
/** A depth step on the same surface wider than this fraction of the distance is an edge. */
const DEPTH_STEP = 0.04;

export function lineartOf(g: GBuffer, w: World, effects: Region[] = []): Image {
  const W = g.width, H = g.height, px = new Uint8Array(W * H);
  const cosCrease = Math.cos(CREASE_DEG * Math.PI / 180);
  const tall = new Set(w.prims.map((p, i) => [p, i] as const).filter(([p]) => p.kind === 'box' && p.half[1] * 2 > STOREY_MIN_HEIGHT && p.role !== 'actor').map(([, i]) => i));
  const edge = (i: number, j: number): boolean => {
    const ki = g.kind[i], kj = g.kind[j];
    // people are left out, and so is the outline of what stands behind them
    if (ki === Kind.Actor || kj === Kind.Actor) return false;
    if (ki === Kind.Sky || kj === Kind.Sky) return ki !== kj;
    if (g.prim[i] !== g.prim[j]) return true;
    const ni = i * 3, nj = j * 3;
    const c = g.normal[ni] * g.normal[nj] + g.normal[ni + 1] * g.normal[nj + 1] + g.normal[ni + 2] * g.normal[nj + 2];
    if (c < cosCrease) return true;
    if (Math.abs(g.t[i] - g.t[j]) > DEPTH_STEP * Math.min(g.t[i], g.t[j]) && g.kind[i] !== Kind.Ground) return true;
    // storeys on tall vertical faces
    if (tall.has(g.prim[i]) && Math.abs(g.normal[ni + 1]) < 0.5 && Math.floor(g.y[i] / FLOOR_H) !== Math.floor(g.y[j] / FLOOR_H)) return true;
    return false;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x + 1 < W && edge(i, i + 1)) { px[i] = 255; px[i + 1] = 255; }
    if (y + 1 < H && edge(i, i + W)) { px[i] = 255; px[i + W] = 255; }
  }
  // effects drawn over: the outline of what is visible of each beam and blast
  for (const r of effects) if (r.kind === 'line' || r.kind === 'volume') outline(r.mask.pixels, W, H, px);
  return { width: W, height: H, channels: 1, pixels: px };
}

function outline(mask: Uint8Array, W: number, H: number, out: Uint8Array) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) out[i] = 255;
  }
}

export interface Region {
  id: string;
  kind: 'person' | 'line' | 'volume' | 'damage';
  /** visible area as a fraction of the frame */
  area: number;
  /** normalized [u0, v0, u1, v1] of the visible pixels */
  box: [number, number, number, number];
  /** centre of the visible pixels, normalized */
  centre: [number, number];
  mask: Image;
}

/** The angle between where a person faces and the camera, degrees (0 = towards it, 180 = their back). */
export function faceAngleOf(a: SolvedActor, cam: Cam): number {
  const to = sub(cam.pos, a.head), d = Math.hypot(to[0], to[2]) || 1, fd = faceDir(a);
  return Math.acos(Math.max(-1, Math.min(1, (to[0] * fd[0] + to[2] * fd[2]) / d))) * 180 / Math.PI;
}

function region(id: string, kind: Region['kind'], px: Uint8Array, W: number, H: number): Region | null {
  let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!px[y * W + x]) continue;
    n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return null;
  return { id, kind, area: n / (W * H), box: [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H], centre: [(sx / n + 0.5) / W, (sy / n + 0.5) / H], mask: { width: W, height: H, channels: 1, pixels: px } };
}

/** The visible part of each person and each effect: masks for regional prompts, and where they are. */
export function regionsOf(g: GBuffer, s: Solved): Region[] {
  const W = g.width, H = g.height, f = g.frame, cam = f.cam, out: Region[] = [];
  const push = (r: Region | null) => { if (r) out.push(r); };
  for (const a of s.actors.values()) {
    const o = g.owners.indexOf(a.id), px = new Uint8Array(W * H);
    if (o >= 0) for (let i = 0; i < px.length; i++) if (g.owner[i] === o) px[i] = 255;
    push(region(a.id, 'person', px, W, H));
  }
  // a beam: discs along its axis, each pixel kept where nothing nearer stands in front
  const vscale = f.k * H;
  for (const l of s.lines.values()) {
    const px = new Uint8Array(W * H);
    const pa = project(f, l.a), pb = project(f, l.b);
    const lenPx = pa && pb ? Math.hypot((pb.u - pa.u) * W, (pb.v - pa.v) * H) : 2000;
    const steps = Math.min(4000, Math.max(50, Math.ceil(lenPx)));
    for (let k = 0; k <= steps; k++) {
      const q = add(l.a, mul(sub(l.b, l.a), k / steps));
      const p = project(f, q);
      if (!p) continue;
      const r = Math.max(1.5, l.radius * vscale / p.z), cx = p.u * W, cy = p.v * H, zq = dist(cam.pos, q) - l.radius;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
          if (g.t[y * W + x] >= zq) px[y * W + x] = 255;
        }
      }
    }
    push(region(l.id, 'line', px, W, H));
  }
  for (const v of s.volumes.values()) {
    const px = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = raySphere(cam.pos, dirAt(g, x, y), v.c, v.r);
      if (h && h.t < g.t[y * W + x]) px[y * W + x] = 255;
    }
    push(region(v.id, 'volume', px, W, H));
  }
  for (const d of s.damages.values()) {
    const o = g.owners.indexOf(d.target), px = new Uint8Array(W * H);
    const box = { kind: 'box' as const, ...d.box, owner: d.target, role: 'structure' as const };
    if (o >= 0) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (g.owner[i] !== o) continue;
      if (inside(box, add(cam.pos, mul(dirAt(g, x, y), g.t[i])), 0.05)) px[i] = 255;
    }
    push(region(d.id, 'damage', px, W, H));
  }
  return out;
}

// OpenPose body-18 (COCO order, the same as poses.ts KP): limbs and colours as controlnet_aux draws them
export const OPENPOSE_LIMBS: [number, number][] = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
export const OPENPOSE_COLOURS: [number, number, number][] = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170],
  [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];
const STICK = 4, JOINT = 4;

/** Which of a person's 18 keypoints a detector would find in this shot (screen pixels; null: not found). */
export function keypoints(a: SolvedActor, w: World, cam: Cam, W: number, H: number): ([number, number] | null)[] {
  const f = frame(cam);
  const toCam = sub(cam.pos, a.head);
  const facing = dot(faceDir(a), [toCam[0], 0, toCam[2]] as V3) > 0;
  const self = new Set([a.id]);
  return a.points.map((p, k) => {
    if (!facing && (k === KP.nose || k === KP.rEye || k === KP.lEye)) return null;
    const q = project(f, p);
    if (!q || !inFrame(q)) return null;
    // hidden by something else (the person's own body does not hide their joints: the skeleton shows through)
    if (!clear(w, cam.pos, p, self)) return null;
    return [q.u * W, q.v * H];
  });
}

export function openposeOf(s: Solved, w: World, cam: Cam, W: number, H: number): Image {
  const px = new Uint8Array(W * H * 3);
  const people = [...s.actors.values()].map((a) => keypoints(a, w, cam, W, H));
  for (const kp of people) OPENPOSE_LIMBS.forEach(([i, j], li) => {
    const p = kp[i], q = kp[j];
    if (!p || !q) return;
    const c = OPENPOSE_COLOURS[li].map((v) => Math.floor(v * 0.6)) as [number, number, number];
    ellipse(px, W, H, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, Math.hypot(q[0] - p[0], q[1] - p[1]) / 2, STICK, Math.atan2(q[1] - p[1], q[0] - p[0]), c);
  });
  for (const kp of people) kp.forEach((p, k) => { if (p) ellipse(px, W, H, p[0], p[1], JOINT, JOINT, 0, OPENPOSE_COLOURS[k]); });
  return { width: W, height: H, channels: 3, pixels: px };
}

function ellipse(px: Uint8Array, W: number, H: number, cx: number, cy: number, a: number, b: number, ang: number, c: [number, number, number]) {
  const r = Math.max(a, b), cs = Math.cos(ang), sn = Math.sin(ang);
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * cs + dy * sn) / Math.max(a, 0.5), v = (-dx * sn + dy * cs) / b;
      if (u * u + v * v <= 1) px.set(c, (y * W + x) * 3);
    }
  }
}
