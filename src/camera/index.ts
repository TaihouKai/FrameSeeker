// Module 2 — the camera (phases 4–5): search cameras around the 3D world, score each by deterministic composition
// rules (never a model), keep the best that differ, and render each shot's 2D structure maps for generation.
// Input: a World3D from the scene module. Output: shots with their maps.
import type { World3D, Rating } from '../scene/index.ts';
import type { Image } from '../shared/image.ts';
import { context, evaluate, TERMS, type Evaluation } from './score.ts';
import { search, type SearchOpts } from './search.ts';
import { depthMap, preview } from './render.ts';
import { frame, pitch, type Cam } from './camera.ts';

export type { Cam, Aspect } from './camera.ts';
export type { SearchOpts } from './search.ts';
export { SIZE } from './camera.ts';

export interface Shot {
  cam: Cam;
  /** the score in [0, 1] and its terms */
  total: number;
  terms: Evaluation['terms'];
  /** measurements: camera height, pitch, subject size, face angle, ... */
  info: Record<string, number>;
}

/**
 * The 2D maps of a shot. `preview` is the gray box for people to look at; the rest are ControlNet inputs.
 * lineart and pose are milestone M2 (not yet rendered).
 */
export interface ShotMaps { preview: Image; depth: Image; lineart?: Image; pose?: Image }

/** Phase 4: the best k cameras that differ from each other (seeded: same world, same shots). */
export function shoot(w: World3D, opts: SearchOpts = {}): { shots: Shot[]; sampled: number; accepted: number; rejects: Record<string, number> } {
  const r = search(context(w.solved, w.world), opts);
  return { shots: r.candidates.map((c) => toShot(c.cam, c.ev)), sampled: r.sampled, accepted: r.accepted, rejects: r.rejects };
}

/** Score one given camera (e.g. a user's own). */
export function rateCamera(w: World3D, cam: Cam): Evaluation {
  return evaluate(context(w.solved, w.world), cam);
}

/** The world's best shot as the scene module's staging judge needs it. */
export function rate(w: World3D, opts: SearchOpts = { seed: 1, k: 1 }): Rating {
  const best = shoot(w, opts).shots[0];
  return best ? { total: best.total, terms: Object.fromEntries(TERMS.filter((t) => best.terms[t] !== undefined).map((t) => [t, best.terms[t]!])) } : { total: 0, terms: {} };
}

/** Phase 5: the shot's 2D maps. */
export function maps(w: World3D, cam: Cam, scale = 0.5): ShotMaps {
  return { preview: preview(w.solved, w.world, cam, scale), depth: depthMap(w.world, cam, scale) };
}

function toShot(cam: Cam, ev: Evaluation): Shot {
  return { cam, total: ev.total, terms: ev.terms, info: { ...ev.info, pitch_deg: pitch(frame(cam)) * 180 / Math.PI } };
}
