// Primitives of the gray-box world and ray casting against them (CPU, no GPU).
import { add, cross, dot, mul, norm, rotY, sub, type V3 } from './vec.ts';

/** What a primitive belongs to: the scene's own things are scored; dressing only frames the shot. */
export type Role = 'actor' | 'structure' | 'dressing';

/** label: what a dressing piece is (wall, ceiling, window, floor, desk), so the picture's regions can be named */
/**
 * label: what a dressing piece is (wall, ceiling, window, floor, desk), so the picture's regions can be named.
 * glass: seen through: rays pass it (occlusion, depth, the camera's checks); only its outline and region are drawn.
 */
interface Base { owner: string; role: Role; thin?: boolean; label?: string; glass?: boolean }
export type Prim =
  | (Base & { kind: 'box'; c: V3; half: V3; yaw: number })
  /** flat: a cylinder (flat discs at a and b instead of round caps: a tank, a column) */
  | (Base & { kind: 'capsule'; a: V3; b: V3; r: number; flat?: boolean })
  | (Base & { kind: 'sphere'; c: V3; r: number });

/** room: indoors, the room the camera stays in (centred at the origin, x within ±hx, z within ±hz, under the ceiling h) */
export interface World { prims: Prim[]; groundY: number; room?: { hx: number; hz: number; h: number } }
export interface Hit { t: number; prim: Prim | null; normal: V3 }

const EPS = 1e-6;

export function rayBox(o: V3, d: V3, p: Extract<Prim, { kind: 'box' }>): { t: number; normal: V3 } | null {
  const lo = rotY(sub(o, p.c), -p.yaw), ld = rotY(d, -p.yaw);
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < EPS) { if (Math.abs(lo[i]) > p.half[i]) return null; continue; }
    let t1 = (-p.half[i] - lo[i]) / ld[i], t2 = (p.half[i] - lo[i]) / ld[i];
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < EPS) return null;
  const t = tmin > EPS ? tmin : tmax;
  const n: V3 = [0, 0, 0];
  n[axis] = tmin > EPS ? sign : -sign;
  return { t, normal: rotY(n, p.yaw) };
}

export function raySphere(o: V3, d: V3, c: V3, r: number): { t: number; normal: V3 } | null {
  const oc = sub(o, c);
  const b = dot(oc, d), cc = dot(oc, oc) - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const sq = Math.sqrt(h);
  let t = -b - sq;
  if (t < EPS) t = -b + sq;
  if (t < EPS) return null;
  return { t, normal: norm(sub(add(o, mul(d, t)), c)) };
}

/** Ray against a capsule (Inigo Quilez's capsule intersection); d must be a unit vector. */
export function rayCapsule(o: V3, d: V3, a: V3, b: V3, r: number, flat = false): { t: number; normal: V3 } | null {
  const ba = sub(b, a), oa = sub(o, a);
  const baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > EPS) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (t > EPS && y > 0 && y < baba) {
      const p = add(o, mul(d, t));
      const q = add(a, mul(ba, y / baba));
      return { t, normal: norm(sub(p, q)) };
    }
  }
  // the caps: flat discs (a cylinder) or half spheres
  if (flat) {
    const n = norm(ba);
    let best: { t: number; normal: V3 } | null = null;
    for (const [c, nc] of [[a, mul(n, -1)], [b, n]] as [V3, V3][]) {
      const den = dot(d, nc);
      if (Math.abs(den) < EPS) continue;
      const t = dot(sub(c, o), nc) / den;
      if (t > EPS && (!best || t < best.t) && Math.hypot(...sub(add(o, mul(d, t)), c)) <= r) best = { t, normal: nc };
    }
    return best;
  }
  const s1 = raySphere(o, d, a, r), s2 = raySphere(o, d, b, r);
  if (s1 && s2) return s1.t < s2.t ? s1 : s2;
  return s1 || s2;
}

export function rayPrim(o: V3, d: V3, p: Prim): { t: number; normal: V3 } | null {
  if (p.kind === 'box') return rayBox(o, d, p);
  if (p.kind === 'sphere') return raySphere(o, d, p.c, p.r);
  return rayCapsule(o, d, p.a, p.b, p.r, p.flat);
}

/** The first hit of a ray (d unit) within maxT, the ground included; owners in `skip` are ignored. */
export function cast(w: World, o: V3, d: V3, maxT = Infinity, skip?: ReadonlySet<string>): Hit | null {
  let best: Hit | null = null;
  if (d[1] < -EPS) {
    const t = (w.groundY - o[1]) / d[1];
    if (t > EPS && t < maxT) best = { t, prim: null, normal: [0, 1, 0] };
  }
  for (const p of w.prims) {
    if (p.glass || (skip && skip.has(p.owner))) continue;
    const h = rayPrim(o, d, p);
    if (h && h.t < (best ? best.t : maxT)) best = { t: h.t, prim: p, normal: h.normal };
  }
  return best;
}

/** Whether nothing (but the skipped owners) lies between a and b. */
export function clear(w: World, a: V3, b: V3, skip?: ReadonlySet<string>): boolean {
  const ab = sub(b, a);
  const l = Math.hypot(ab[0], ab[1], ab[2]);
  if (l < 1e-4) return true;
  return !cast(w, a, mul(ab, 1 / l), l - 1e-3, skip);
}

/** Signed distance-ish test: whether a point is inside (or within margin of) a primitive. */
export function inside(p: Prim, q: V3, margin = 0): boolean {
  if (p.kind === 'box') {
    const l = rotY(sub(q, p.c), -p.yaw);
    return Math.abs(l[0]) <= p.half[0] + margin && Math.abs(l[1]) <= p.half[1] + margin && Math.abs(l[2]) <= p.half[2] + margin;
  }
  if (p.kind === 'sphere') return Math.hypot(...sub(q, p.c)) <= p.r + margin;
  const ba = sub(p.b, p.a), qa = sub(q, p.a);
  const along = dot(qa, ba) / dot(ba, ba);
  if (p.flat) { const L = Math.sqrt(dot(ba, ba)); if (along * L < -margin || along * L > L + margin) return false; }
  const h = Math.max(0, Math.min(1, along));
  return Math.hypot(...sub(qa, mul(ba, h))) <= p.r + margin;
}

/** The eight corners of a box (or a capsule's / sphere's bounding points). */
export function corners(p: Prim): V3[] {
  if (p.kind === 'box') {
    const out: V3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(add(p.c, rotY([sx * p.half[0], sy * p.half[1], sz * p.half[2]], p.yaw)));
    return out;
  }
  if (p.kind === 'sphere') return [add(p.c, [0, p.r, 0]), add(p.c, [0, -p.r, 0]), add(p.c, [p.r, 0, 0]), add(p.c, [-p.r, 0, 0]), add(p.c, [0, 0, p.r]), add(p.c, [0, 0, -p.r])];
  return [p.a, p.b];
}

/** Any unit vector perpendicular to d. */
export function perp(d: V3): V3 {
  const a: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(d, a));
}
