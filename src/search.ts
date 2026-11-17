// Stage 3 search (DESIGN.md §6.3): random cameras around the focus, the rejected dropped, the best refined by local
// search, then the top K that differ from each other. Seeded: the same scene and seed give the same shots.
import { add, dist, lerp, mul, norm, rng, sub, type V3 } from './vec.ts';
import { FOCALS, type Aspect, type Cam } from './camera.ts';
import { evaluate, type Ctx, type Evaluation } from './score.ts';

export interface Candidate { cam: Cam; ev: Evaluation }
export interface SearchResult { candidates: Candidate[]; sampled: number; accepted: number; rejects: Record<string, number> }

export interface SearchOpts { n?: number; seed?: number; k?: number; refine?: number; iters?: number; /** the formats to try (default portrait and landscape) */ aspects?: Aspect[] }

/** A random camera around the focus, looking somewhere among the things that matter (the search's prior). */
export function sampler(ctx: Ctx, rand: () => number, aspects: Aspect[] = ['portrait', 'landscape']): () => Cam {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const g = ctx.world.groundY;
  const focus = ctx.focus.head;
  const keys: V3[] = [focus];
  if (ctx.line) keys.push(lerp(ctx.line.a, ctx.line.b, 0.5));
  if (ctx.payoff) keys.push(mul(ctx.payoff.points.reduce((a, b) => add(a, b), [0, 0, 0] as V3), 1 / ctx.payoff.points.length));
  const lowBias = ctx.intent === 'scale' ? 0.7 : 0.5;
  return () => {
    const r = Math.exp(Math.log(1.5) + rand() * (Math.log(150) - Math.log(1.5)));
    const az = rand() * Math.PI * 2;
    const h = rand() < lowBias ? 0.3 + rand() * 1.7 : 0.3 + rand() * rand() * 45;
    const pos: V3 = [focus[0] + r * Math.sin(az), g + h, focus[2] + r * Math.cos(az)];
    const ws = keys.map(() => rand() + 0.05);
    const wsum = ws.reduce((a, b) => a + b, 0);
    let target = keys.reduce((acc, p, j) => add(acc, mul(p, ws[j] / wsum)), [0, 0, 0] as V3);
    target = add(target, mul([gauss(), gauss() * 0.5, gauss()], 0.05 * r));
    return {
      pos, target,
      roll: rand() < 0.8 ? 0 : (rand() < 0.5 ? -1 : 1) * (8 + rand() * 7) * Math.PI / 180,
      focal: FOCALS[Math.floor(rand() * FOCALS.length)],
      aspect: aspects[Math.floor(rand() * aspects.length)],
    };
  };
}

export function search(ctx: Ctx, opts: SearchOpts = {}): SearchResult {
  const n = opts.n ?? 4000, k = opts.k ?? 3, refineN = opts.refine ?? 30, iters = opts.iters ?? 60;
  const rand = rng(opts.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const next = sampler(ctx, rand, opts.aspects);

  const rejects: Record<string, number> = {};
  const ok: Candidate[] = [];
  const consider = (cam: Cam): Candidate => {
    const ev = evaluate(ctx, cam);
    if (!ev.ok) rejects[ev.reject!] = (rejects[ev.reject!] || 0) + 1;
    return { cam, ev };
  };
  for (let i = 0; i < n; i++) {
    const c = consider(next());
    if (c.ev.ok) ok.push(c);
  }
  const accepted = ok.length;

  // local refinement of the best
  ok.sort((a, b) => b.ev.total - a.ev.total);
  const refined: Candidate[] = [];
  for (const start of ok.slice(0, refineN)) {
    let best = start;
    for (let it = 0; it < iters; it++) {
      const shrink = 1 - it / iters;
      const r = dist(best.cam.pos, best.cam.target);
      const cam: Cam = { ...best.cam, pos: [...best.cam.pos] as V3, target: [...best.cam.target] as V3 };
      const which = Math.floor(rand() * 5);
      if (which === 0) cam.pos = add(cam.pos, mul([gauss(), gauss() * 0.5, gauss()], 0.12 * r * shrink));
      else if (which === 1) cam.target = add(cam.target, mul([gauss(), gauss() * 0.5, gauss()], 0.08 * r * shrink));
      else if (which === 2) { const idx = FOCALS.indexOf(cam.focal) + (rand() < 0.5 ? -1 : 1); if (idx >= 0 && idx < FOCALS.length) cam.focal = FOCALS[idx]; }
      else if (which === 3) cam.roll = Math.max(-0.3, Math.min(0.3, cam.roll + gauss() * 0.05 * shrink));
      else cam.pos = add(cam.pos, [0, gauss() * 0.15 * Math.max(1, cam.pos[1] - ctx.world.groundY) * shrink, 0]);
      const c = consider(cam);
      if (c.ev.ok && c.ev.total > best.ev.total) best = c;
    }
    refined.push(best);
  }
  const pool = [...refined, ...ok.slice(refineN)].sort((a, b) => b.ev.total - a.ev.total);

  // top K that differ: another viewing direction (>= 20°) or another distance (x2)
  const picked: Candidate[] = [];
  for (const c of pool) {
    if (picked.length >= k) break;
    const dir = norm(sub(c.cam.target, c.cam.pos));
    const far = dist(c.cam.pos, ctx.focus.head);
    const same = picked.some((p) => {
      const d2 = norm(sub(p.cam.target, p.cam.pos));
      const ang = Math.acos(Math.max(-1, Math.min(1, dir[0] * d2[0] + dir[1] * d2[1] + dir[2] * d2[2]))) * 180 / Math.PI;
      return ang < 20 && Math.abs(Math.log(far / dist(p.cam.pos, ctx.focus.head))) < 0.7;
    });
    if (!same) picked.push(c);
  }
  return { candidates: picked, sampled: n + refineN * iters, accepted, rejects };
}
