// Module 2 — the camera (phases 4–5): search cameras around the 3D world, score each by deterministic composition
// rules (never a model), keep the best that differ, and render each shot's 2D structure maps for generation.
// Input: a World3D from the scene module. Output: shots with their maps.
//
// Public surface (other modules import only this file):
//  - phase 4: shoot (the search), rate (for staging), rateCamera, scorer (the scorer on one world: score a camera,
//    draw random cameras from the search's prior, search; for evaluating the scorer itself), TERMS
//  - phase 5: maps, preview
//  - camera geometry: frame, project, ray, pitch, inFrame, SIZE, FOCALS
import type { World3D, Rating } from '../scene/index.ts';
import type { Image } from '../shared/image.ts';
import { context, evaluate, TERMS, type Evaluation } from './score.ts';
import { sampler, search, type SearchOpts, type SearchResult } from './search.ts';
import { preview as renderPreview } from './render.ts';
import { depthOf, faceAngleOf, gbuffer, keypoints, lineartOf, openposeOf, regionsOf, type Region } from './maps.ts';
import { frame, pitch, type Cam } from './camera.ts';

export type { Cam, Aspect, Frame, Projected } from './camera.ts';
export type { SearchOpts, SearchResult, Candidate } from './search.ts';
export type { Evaluation, Term } from './score.ts';
export { SIZE, FOCALS, frame, project, ray, pitch, inFrame } from './camera.ts';
export { TERMS } from './score.ts';

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
 * inputs at the output size; regions are each person's and effect's visible mask and position (for regional prompts);
 * hint, only when an effect is in frame, is a colour hint to start the image from (beams are too thin for the others).
 */
export interface ShotMaps { preview: Image; depth: Image; lineart: Image; pose: Image; regions: Region[]; hint: Image | null; people: PlannedPerson[] }
/**
 * Each person as planned: the OpenPose body-18 joints where they should appear ([u, v] in 0..1 of the frame; null:
 * hidden or out of frame, nose and eyes when facing away), and the angle between where they face and the camera.
 */
export interface PlannedPerson { id: string; faceAngle: number; joints: ([number, number] | null)[] }
export type { Region } from './maps.ts';

/** The scorer on one world (its context built once): score cameras, draw the search's random cameras, search. */
export interface Scorer {
  evaluate(cam: Cam): Evaluation;
  /** random cameras from the search's own prior, in these formats */
  random(rand: () => number, aspects?: Cam['aspect'][]): () => Cam;
  search(opts?: SearchOpts): SearchResult;
}
export function scorer(w: World3D): Scorer {
  const ctx = context(w.solved, w.world);
  return { evaluate: (cam) => evaluate(ctx, cam), random: (rand, aspects) => sampler(ctx, rand, aspects), search: (opts) => search(ctx, opts) };
}

/** Phase 4: the best k cameras that differ from each other (seeded: same world, same shots). */
export function shoot(w: World3D, opts: SearchOpts = {}): { shots: Shot[]; sampled: number; accepted: number; rejects: Record<string, number> } {
  const r = scorer(w).search(opts);
  return { shots: r.candidates.map((c) => toShot(c.cam, c.ev)), sampled: r.sampled, accepted: r.accepted, rejects: r.rejects };
}

/** Score one given camera (e.g. a user's own). */
export function rateCamera(w: World3D, cam: Cam): Evaluation {
  return scorer(w).evaluate(cam);
}

/** The gray box seen by a camera, for people to look at (people in colours, focus red, skeletons, thirds grid). */
export function preview(w: World3D, cam: Cam, scale = 0.5): Image {
  return renderPreview(w.solved, w.world, cam, scale);
}

/** The world's best shot as the scene module's staging judge needs it. */
export function rate(w: World3D, opts: SearchOpts = { seed: 1, k: 1 }): Rating {
  const best = shoot(w, opts).shots[0];
  return best ? { total: best.total, terms: Object.fromEntries(TERMS.filter((t) => best.terms[t] !== undefined).map((t) => [t, best.terms[t]!])) } : { total: 0, terms: {} };
}

/** Phase 5: the shot's 2D maps (ControlNet maps at `scale` of the output size, the preview at `previewScale`). */
export function maps(w: World3D, cam: Cam, opts: { scale?: number; previewScale?: number } = {}): ShotMaps {
  const g = gbuffer(w.world, cam, opts.scale ?? 1);
  const regions = regionsOf(g, w.solved, w.world);
  return {
    preview: renderPreview(w.solved, w.world, cam, opts.previewScale ?? 0.5),
    depth: depthOf(g),
    lineart: lineartOf(g, w.world, regions),
    pose: openposeOf(w.solved, w.world, cam, g.width, g.height),
    regions,
    people: [...w.solved.actors.values()].map((a) => ({ id: a.id, faceAngle: faceAngleOf(a, cam), joints: keypoints(a, w.world, cam, 1, 1) })),
    hint: regions.some((g) => g.kind === 'line' || g.kind === 'volume' || g.kind === 'damage') ? renderPreview(w.solved, w.world, cam, opts.previewScale ?? 0.5, { hint: true }) : null,
  };
}

function toShot(cam: Cam, ev: Evaluation): Shot {
  return { cam, total: ev.total, terms: ev.terms, info: { ...ev.info, pitch_deg: pitch(frame(cam)) * 180 / Math.PI } };
}
