// Small 3D vector toolkit. Right-handed, Y up, metres.
export type V3 = [number, number, number];

export const v = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => len(sub(a, b));
export const norm = (a: V3): V3 => { const l = len(a); return l === 0 ? [0, 0, 0] : mul(a, 1 / l); };
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const UP: V3 = [0, 1, 0];

/** The horizontal unit direction a yaw faces (yaw 0 faces +Z). */
export const yawDir = (yaw: number): V3 => [Math.sin(yaw), 0, Math.cos(yaw)];
/** The yaw that faces from a towards b (horizontally). */
export const yawTo = (a: V3, b: V3): number => Math.atan2(b[0] - a[0], b[2] - a[2]);
/** Rotate about the Y axis by yaw (the rotation that turns +Z into yawDir(yaw)). */
export const rotY = (p: V3, yaw: number): V3 => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};
/** Rotate p about an axis (unit) through the origin by angle (Rodrigues). */
export const rotAxis = (p: V3, axis: V3, angle: number): V3 => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(mul(p, c), mul(cross(axis, p), s)), mul(axis, dot(axis, p) * (1 - c)));
};

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string (seeds). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const deg = (rad: number) => rad * 180 / Math.PI;
export const rad = (d: number) => d * Math.PI / 180;
