// A pinhole camera with a 35 mm-equivalent focal length; screen coordinates are normalized: u, v in [0, 1], v down.
import { cross, dot, norm, rotAxis, sub, UP, type V3 } from '../shared/vec.ts';

export type Aspect = 'portrait' | 'landscape' | 'wide';
export interface Cam { pos: V3; target: V3; /** radians */ roll: number; /** mm, 35 mm equivalent */ focal: number; aspect: Aspect }

/** Output sizes (SDXL-friendly); wide is the 16:9-like screen of film and TV. */
export const SIZE: Record<Aspect, { w: number; h: number }> = { portrait: { w: 832, h: 1216 }, landscape: { w: 1216, h: 832 }, wide: { w: 1344, h: 756 } };
export const FOCALS = [14, 18, 24, 28, 35, 50, 85];

export interface Frame { cam: Cam; F: V3; R: V3; U: V3; /** focal / vertical sensor size */ k: number; /** height / width */ ar: number }

export function frame(cam: Cam): Frame {
  const F = norm(sub(cam.target, cam.pos));
  let R = norm(cross(F, UP));
  if (!isFinite(R[0]) || (R[0] === 0 && R[2] === 0)) R = [1, 0, 0];
  let U = cross(R, F);
  if (cam.roll) { R = rotAxis(R, F, cam.roll); U = rotAxis(U, F, cam.roll); }
  // full-frame sensor 36 x 24 mm: the long side is vertical in portrait; wide crops it to 36 mm across
  const { w, h } = SIZE[cam.aspect];
  const sensorV = cam.aspect === 'portrait' ? 36 : cam.aspect === 'landscape' ? 24 : 36 * h / w;
  return { cam, F, R, U, k: cam.focal / sensorV, ar: h / w };
}

export interface Projected { u: number; v: number; z: number }

/** Where a point lands on the screen (null behind the camera). */
export function project(f: Frame, p: V3): Projected | null {
  const d = sub(p, f.cam.pos);
  const z = dot(d, f.F);
  if (z < 0.05) return null;
  return { u: 0.5 + f.k * f.ar * dot(d, f.R) / z, v: 0.5 - f.k * dot(d, f.U) / z, z };
}

/** The unit ray through a screen point. */
export function ray(f: Frame, u: number, v: number): V3 {
  const x = (u - 0.5) / (f.k * f.ar), y = (0.5 - v) / f.k;
  return norm([f.F[0] + f.R[0] * x + f.U[0] * y, f.F[1] + f.R[1] * x + f.U[1] * y, f.F[2] + f.R[2] * x + f.U[2] * y]);
}

export const inFrame = (p: Projected | null, m = 0) => !!p && p.u >= m && p.u <= 1 - m && p.v >= m && p.v <= 1 - m;

/** Pitch of the view (radians, up positive). */
export const pitch = (f: Frame) => Math.asin(Math.max(-1, Math.min(1, f.F[1])));

/** A segment's visible part on the screen (clipped to the near plane and the frame), in normalized coordinates. */
export function screenSegment(f: Frame, a: V3, b: V3): { a: [number, number]; b: [number, number] } | null {
  const da = dot(sub(a, f.cam.pos), f.F), db = dot(sub(b, f.cam.pos), f.F);
  const near = 0.1;
  if (da < near && db < near) return null;
  let p = a, q = b;
  if (da < near) p = lerp3(a, b, (near - da) / (db - da));
  if (db < near) q = lerp3(a, b, (near - da) / (db - da));
  const pa = project(f, p), pb = project(f, q);
  if (!pa || !pb) return null;
  return clipRect([pa.u, pa.v], [pb.u, pb.v]);
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Liang–Barsky clipping to [0,1]². */
function clipRect(a: [number, number], b: [number, number]): { a: [number, number]; b: [number, number] } | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const edges: [number, number][] = [[-dx, a[0]], [dx, 1 - a[0]], [-dy, a[1]], [dy, 1 - a[1]]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return { a: [a[0] + dx * t0, a[1] + dy * t0], b: [a[0] + dx * t1, a[1] + dy * t1] };
}
