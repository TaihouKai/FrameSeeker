// Evaluation A (DESIGN.md §6.6.3): does the scorer rank the camera a film crew chose above the cameras it could have
// chosen? For each rebuilt reference shot: the reference camera's score, its percentile among valid random cameras
// (the search's own prior, in the reference's format), and whether the search's top 3 contain a camera near it.
import { dist, norm, rng, sub } from './vec.ts';
import { frame, project, type Cam } from './camera.ts';
import { solve } from './solve.ts';
import { dress } from './dress.ts';
import { context, evaluate, TERMS, type Evaluation, type Term } from './score.ts';
import { sampler, search, type Candidate } from './search.ts';
import { rebuild, REF_H, REF_W, type RefFrame } from './refs.ts';
import { KP } from './poses.ts';

export interface RefResult {
  id: string;
  estimated: string[];
  /** pixels: the rebuilt scene seen by the reference camera against the annotation */
  reprojection_px: number;
  camera: { height: number; pitch_deg: number; focal: number };
  ref: Evaluation;
  /** fraction of valid random cameras scoring below the reference */
  percentile: number;
  valid: number;
  /** the search's top 3: how close each is to the reference (view angle, distance ratio) */
  top: { total: number; angle: number; distance_ratio: number }[];
  near_in_top3: boolean;
  /** per term: the reference's value and the mean over the best 10% of random cameras */
  terms: Partial<Record<Term, { ref: number; top10: number }>>;
}

/** Near the reference: looking the same way within 20° and at the focus from within ×2 the distance (the search's own "same shot"). */
export const NEAR_ANGLE = 20, NEAR_RATIO = 2;

export function evalRef(r: RefFrame, opts: { n?: number; seed?: number; searchN?: number } = {}): RefResult {
  const b = rebuild(r);
  const solved = solve(b.scene), world = dress(solved), ctx = context(solved, world);
  const ref = evaluate(ctx, b.cam);
  // reprojection: crowns and feet of the rebuilt people against the annotation
  const f = frame(b.cam);
  let se = 0, n = 0;
  for (const p of r.people) {
    const a = solved.actors.get(p.id)!;
    const crown = project(f, [a.head[0], a.head[1] + a.headR, a.head[2]]);
    if (crown) { se += (crown.u * REF_W - p.crown[0]) ** 2 + (crown.v * REF_H - p.crown[1]) ** 2; n++; }
    if (p.feet) {
      const ft = project(f, [(a.points[KP.rAnkle][0] + a.points[KP.lAnkle][0]) / 2, 0, (a.points[KP.rAnkle][2] + a.points[KP.lAnkle][2]) / 2]);
      if (ft) { se += (ft.u * REF_W - p.feet[0]) ** 2 + (ft.v * REF_H - p.feet[1]) ** 2; n++; }
    }
  }
  // random cameras in the reference's format
  const next = sampler(ctx, rng(opts.seed ?? 7), ['wide']);
  const valid: Evaluation[] = [];
  for (let i = 0; i < (opts.n ?? 3000); i++) { const e = evaluate(ctx, next()); if (e.ok) valid.push(e); }
  const below = valid.filter((e) => e.total < ref.total).length;
  valid.sort((x, y) => y.total - x.total);
  const best = valid.slice(0, Math.max(1, Math.ceil(valid.length / 10)));
  const terms: RefResult['terms'] = {};
  for (const t of TERMS) {
    const xs = best.map((e) => e.terms[t]).filter((x): x is number => x !== undefined);
    if (ref.terms[t] !== undefined || xs.length) terms[t] = { ref: ref.terms[t] ?? NaN, top10: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN };
  }
  // the search's top 3
  const res = search(ctx, { n: opts.searchN ?? 4000, seed: opts.seed ?? 1, k: 3, aspects: ['wide'] });
  const top = res.candidates.map((c) => closeness(c, b.cam, ctx.focus.head as [number, number, number]));
  return {
    id: r.id, estimated: b.estimated, reprojection_px: n ? Math.sqrt(se / n) : NaN,
    camera: { height: b.cam.pos[1], pitch_deg: Math.atan(b.cam.target[1] - b.cam.pos[1]) * 180 / Math.PI, focal: b.cam.focal },
    ref, percentile: valid.length ? below / valid.length : NaN, valid: valid.length,
    top, near_in_top3: top.some((t) => t.angle < NEAR_ANGLE && t.distance_ratio < NEAR_RATIO), terms,
  };
}

function closeness(c: Candidate, ref: Cam, focus: [number, number, number]) {
  const d1 = norm(sub(c.cam.target, c.cam.pos)), d2 = norm(sub(ref.target, ref.pos));
  const angle = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]))) * 180 / Math.PI;
  const r1 = dist(c.cam.pos, focus), r2 = dist(ref.pos, focus);
  return { total: +c.ev.total.toFixed(3), angle: +angle.toFixed(1), distance_ratio: +(Math.max(r1, r2) / Math.min(r1, r2)).toFixed(2) };
}
