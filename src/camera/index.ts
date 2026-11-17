// Module 2 — the camera (phases 4–5): search cameras around the 3D world, score each by deterministic composition
// rules (never a model), keep the best that differ, and render each shot's 2D structure maps for generation.
// Input: a World3D from the scene module. Output: shots with their maps.
import type { World3D, Rating } from '../scene/index.ts';
import type { Image } from '../shared/image.ts';
import { context, evaluate, TERMS, type Evaluation } from './score.ts';
import { search, type SearchOpts } from './search.ts';
import { preview } from './render.ts';
import { depthOf, gbuffer, lineartOf, openposeOf, regionsOf, type Region } from './maps.ts';
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
 * The 2D maps of a shot. `preview` is the gray box for people to look at; depth, lineart and pose are ControlNet
 * inputs at the output size; regions are each person's visible mask and position (for regional prompts).
 */
export interface ShotMaps { preview: Image; depth: Image; lineart: Image; pose: Image; regions: Region[] }
export type { Region } from './maps.ts';

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

/** Phase 5: the shot's 2D maps (ControlNet maps at `scale` of the output size, the preview at `previewScale`). */
export function maps(w: World3D, cam: Cam, opts: { scale?: number; previewScale?: number } = {}): ShotMaps {
  const g = gbuffer(w.world, cam, opts.scale ?? 1);
  const regions = regionsOf(g, w.solved);
  return {
    preview: preview(w.solved, w.world, cam, opts.previewScale ?? 0.5),
    depth: depthOf(g),
    lineart: lineartOf(g, w.world, regions),
    pose: openposeOf(w.solved, w.world, cam, g.width, g.height),
    regions,
  };
}

function toShot(cam: Cam, ev: Evaluation): Shot {
  return { cam, total: ev.total, terms: ev.terms, info: { ...ev.info, pitch_deg: pitch(frame(cam)) * 180 / Math.PI } };
}
