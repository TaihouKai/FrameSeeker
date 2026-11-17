// Phase 4, scoring: hard constraints, then composition terms in [0, 1], weighted by the shot's intent.
// Each term names the textbook principle it encodes.
import { add, dist, lerp, mul, sub, type V3 } from '../shared/vec.ts';
import { cast, clear, corners, inside, type Prim, type World } from '../shared/geom.ts';
import { frame, inFrame, pitch, project, ray, screenSegment, SIZE, type Aspect, type Cam, type Frame } from './camera.ts';
import { KP } from '../shared/skeleton.ts';
import type { Intent, Solved, SolvedActor } from '../scene/index.ts';
import { composition, type Line2D, type Region2D } from './composition2d.ts';

export const TERMS = ['composition', 'foreshortening', 'scale', 'sky', 'framing', 'subject_size', 'face', 'tilt', 'lead_room', 'joint_cut', 'overlap', 'aspect', 'merger'] as const;
export type Term = typeof TERMS[number];

/** Weights by intent (starting values). */
export const WEIGHTS: Record<Intent, Record<Term, number>> = {
  scale:   { composition: 3.5, foreshortening: 3, scale: 4, sky: 2, framing: 1.5, subject_size: 2, face: 0.5, tilt: 1, lead_room: 1, joint_cut: 1, overlap: 1, aspect: 0.5, merger: 1 },
  action:  { composition: 4.5, foreshortening: 3, scale: 1, sky: 0.5, framing: 1, subject_size: 2, face: 1.5, tilt: 1.5, lead_room: 1.5, joint_cut: 1, overlap: 1.5, aspect: 0.5, merger: 1 },
  emotion: { composition: 2.5, foreshortening: 1, scale: 0, sky: 0, framing: 0.5, subject_size: 3, face: 3, tilt: 2, lead_room: 1, joint_cut: 1.5, overlap: 0.5, aspect: 0.5, merger: 1.5 },
  reveal:  { composition: 2.5, foreshortening: 2, scale: 2, sky: 1, framing: 1, subject_size: 2, face: 1.5, tilt: 1.5, lead_room: 1, joint_cut: 1, overlap: 1, aspect: 0.5, merger: 1 },
};

/**
 * Camera tilt (pitch in degrees, + up): all 88 rebuilt dev shots (the pitch estimated by hand where the horizon is out
 * of frame — those are the steep ones; leaving them out biased an earlier count against high angles) over the valid
 * random cameras of the search's sampler on the same scenes (117 184), half a count added per bin. Only one bin has
 * evidence: looking down over 45° (near top-down), 2 of 88 shots against 12.7% of random cameras (11 expected) →
 * 0.21 of the rest. Down 20–45° is as common as chance (8 vs 8.0 expected); looking up over 30° is too rare among
 * random cameras (0.3%, 0.26 shots expected) for 0 of 88 to mean anything, so it is not judged. Piecewise linear
 * between the bin centres (-67.5° and -37.5°), as FACE_BINS.
 */
export const TILT_BINS: [pitch: number, score: number][] = [[-67.5, 0.2], [-37.5, 1]];
export function tiltScore(pitchDeg: number): number {
  const [[a, sa], [b, sb]] = TILT_BINS;
  return pitchDeg <= a ? sa : pitchDeg >= b ? sb : sa + (sb - sa) * (pitchDeg - a) / (b - a);
}

/** A scale shot: the person small against what is big ([zero, full, full, zero], person height / frame height). */
const SCALE_SIZE: [number, number, number, number] = [0.02, 0.05, 0.22, 0.4];
/** An establishing shot with nothing big in it: extreme long to long shot (XLS 0.45 – LS 0.92 by SHOT_SCALES). */
const WIDE_SIZE: [number, number, number, number] = [0.015, 0.2, 1.0, 1.6];
/**
 * Face angle (0 = towards the camera, 180 = the back): reference shots (43 dev shots) over a
 * uniform camera, normalized by the front bin: under 60° 27/43 vs 1/3 → 1; 60–100° 8/43 vs 2/9 → 0.44;
 * over 100° 8/43 vs 4/9 → 0.22. Piecewise linear between the bin centres.
 */
export const FACE_BINS: [angle: number, score: number][] = [[30, 1], [80, 0.44], [140, 0.22]];
export function faceScore(angle: number): number {
  const b = FACE_BINS;
  if (angle <= b[0][0]) return b[0][1];
  if (angle >= b[b.length - 1][0]) return b[b.length - 1][1];
  const i = b.findIndex((x) => x[0] > angle) - 1;
  return b[i][1] + (b[i + 1][1] - b[i][1]) * (angle - b[i][0]) / (b[i + 1][0] - b[i][0]);
}
/**
 * Shot scale as films use it: Cutting 2015 (Art & Perception), 13 956 frames from 48 popular films, 1935–2010:
 * XLS 8%, LS 14%, MLS 24%, MS 30%, MCU 16%, CU 6%, XCU 1%. Score = the scale's frequency over the most common (MS).
 * Each scale's centre as the person's full height over the frame height (the frame from the cut to just over the head:
 * LS head to feet ≈ 0.9, MLS from the knees, MS the waist, MCU the chest, CU the head alone); log-linear between.
 */
export const SHOT_SCALES: [name: string, size: number, freq: number][] = [
  ['XLS', 0.45, 0.08], ['LS', 0.92, 0.14], ['MLS', 1.33, 0.24], ['MS', 2.15, 0.3], ['MCU', 3.8, 0.16], ['CU', 6.7, 0.06], ['XCU', 12, 0.01],
];
/**
 * Action shots are wider: the 12 action reference shots over Cutting's scales, add-one
 * smoothed: XLS 9+1, LS 1+1, MLS 1+1, MS 1+1, MCU/CU/XCU 0+1 (sizes as SHOT_SCALES; only the frequencies differ).
 */
const ACTION_REFS: Record<string, number> = { XLS: 10, LS: 2, MLS: 2, MS: 2, MCU: 1, CU: 1, XCU: 1 };
/**
 * 12 shots alone make too sharp a prior (the medium action shots fell, §6.6.7): the mean of the two normalized
 * distributions — films overall and the action references — so both the wide and the medium action shot score well.
 */
export const ACTION_SCALES: [name: string, size: number, freq: number][] = SHOT_SCALES.map(([n, s, f]) => [n, s, f / 0.3 / 2 + ACTION_REFS[n] / 10 / 2]);
export function shotScaleScore(size: number, table: [string, number, number][] = SHOT_SCALES): number {
  const top = Math.max(...table.map((s) => s[2]));
  const xs = table.map((s) => Math.log(s[1])), ys = table.map((s) => s[2] / top), x = Math.log(Math.max(1e-3, size));
  if (x <= xs[0]) return ys[0] * Math.max(0, (x - Math.log(0.015)) / (xs[0] - Math.log(0.015)));
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const i = xs.findIndex((v) => v > x) - 1;
  return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
}

export interface Ctx {
  solved: Solved; world: World; intent: Intent;
  focus: SolvedActor; focusPoints: V3[];
  line: { a: V3; b: V3 } | null;
  payoff: { points: V3[]; owners: Set<string>; height: number } | null;
  must: { id: string; points: V3[] }[];
  /** owners that may block nothing important (the focus itself, the payoff) */
  thin: Prim[];
}

export function context(solved: Solved, world: World): Ctx {
  const m = solved.scene.moment;
  const focus = solved.actors.get(m.focus);
  if (!focus) throw new Error(`moment.focus "${m.focus}" is not an actor`);
  const p = focus.points;
  const focusPoints = m.intent === 'emotion'
    ? [focus.head, p[KP.nose], p[KP.rEye], p[KP.lEye], p[KP.neck]]
    : [focus.head, p[KP.neck], p[KP.rShoulder], p[KP.lShoulder], p[KP.rHip], p[KP.lHip], p[KP.nose]];
  const lineEff = m.action_line ? solved.lines.get(m.action_line) : undefined;
  if (m.action_line && !lineEff) throw new Error(`moment.action_line "${m.action_line}" is not a line effect`);
  const pointsOf = (id: string): { points: V3[]; owners: Set<string>; height: number } => {
    const d = solved.damages.get(id);
    if (d) return { points: boxSamples(d.box), owners: new Set([d.target]), height: solved.structures.get(d.target)!.height };
    const vol = solved.volumes.get(id);
    if (vol) return { points: [vol.c, ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((o) => add(vol.c, mul(o as V3, vol.r * 0.8)))], owners: new Set(), height: vol.r * 2 };
    const l = solved.lines.get(id);
    if (l) return { points: [l.a, lerp(l.a, l.b, 0.5), l.b], owners: new Set(l.hits ? [l.hits] : []), height: Math.abs(l.b[1] - l.a[1]) };
    const s = solved.structures.get(id);
    if (s) return { points: boxSamples(s.box), owners: new Set([s.id]), height: s.height };
    const a = solved.actors.get(id);
    if (a) return { points: [a.head, a.points[KP.neck], lerp(a.points[KP.rHip], a.points[KP.lHip], 0.5)], owners: new Set([a.id]), height: a.height };
    throw new Error(`unknown id "${id}" in moment`);
  };
  const payoff = m.payoff ? pointsOf(m.payoff) : null;
  const mustIds = (m.must_show ?? [m.focus, m.action_line, m.payoff].filter(Boolean) as string[]).filter((id) => id !== m.focus && !(m.may_hide || []).includes(id));
  const must = mustIds.map((id) => ({ id, points: pointsOf(id).points }));
  const thin = world.prims.filter((x) => x.thin || (x.kind === 'capsule' && x.r < 0.3 && x.role !== 'actor'));
  return { solved, world, intent: m.intent, focus, focusPoints, line: lineEff ? { a: lineEff.a, b: lineEff.b } : null, payoff, must, thin };
}

function boxSamples(b: { c: V3; half: V3; yaw: number }): V3[] {
  const out: V3[] = [];
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  for (const x of [-0.85, 0, 0.85]) for (const y of [-0.85, 0, 0.85]) for (const z of [-0.85, 0, 0.85]) {
    const lx = x * b.half[0], lz = z * b.half[2];
    out.push([b.c[0] + lx * c + lz * s, b.c[1] + y * b.half[1], b.c[2] - lx * s + lz * c]);
  }
  return out;
}

export interface Evaluation {
  ok: boolean;
  /** why it was rejected */
  reject?: string;
  total: number;
  terms: Partial<Record<Term, number>>;
  /** measurements, for reading the result */
  info: Record<string, number>;
}

/** 0 below a, rising to 1 at b, 1 to c, falling to 0 at d. */
const tri = (x: number, a: number, b: number, c: number, d: number) => x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : (d - x) / (d - c);

const GRID: Record<Aspect, [number, number]> = { portrait: [18, 27], landscape: [27, 18], wide: [30, 17] };

/**
 * The evaluation baseline: the same hard constraints, then the rule of thirds alone (Liu et al. 2010's RT term, the
 * simplest composition rule) as the total. Not used to choose shots; only to show what the full scorer adds.
 */
export function thirdsOnly(e: Evaluation): Evaluation {
  return e.ok ? { ...e, total: e.info.liu_rt ?? 0 } : e;
}
/**
 * The published method as a baseline: the same hard constraints, then Liu et al. 2010's whole composition score E
 * (rule of thirds, diagonal dominance, visual balance, region size, with the paper's weights) as the total.
 */
export function liuOnly(e: Evaluation): Evaluation {
  return e.ok ? { ...e, total: e.terms.composition ?? 0 } : e;
}

export function evaluate(ctx: Ctx, cam: Cam): Evaluation {
  const f = frame(cam);
  const w = ctx.world;
  const info: Record<string, number> = {};
  const reject = (why: string): Evaluation => ({ ok: false, reject: why, total: 0, terms: {}, info });

  // H4 the camera stands in the open
  if (cam.pos[1] < w.groundY + 0.2) return reject('camera below ground');
  if (w.prims.some((p) => inside(p, cam.pos, 0.3))) return reject('camera inside geometry');

  // H1 the focus is in frame and seen
  const focusSkip = new Set([ctx.focus.id]);
  const fp = ctx.focusPoints.map((p) => ({ p, s: project(f, p) }));
  const seen = fp.filter((x) => inFrame(x.s) && clear(w, cam.pos, x.p, focusSkip)).length / fp.length;
  info.focus_visible = seen;
  if (seen < 0.7) return reject('focus not visible');

  // H2 the payoff is in frame and mostly seen
  if (ctx.payoff) {
    const pts = ctx.payoff.points.map((p) => ({ p, s: project(f, p) }));
    const inside = pts.filter((x) => inFrame(x.s));
    info.payoff_in_frame = inside.length / pts.length;
    if (info.payoff_in_frame < 0.6) return reject('payoff out of frame');
    const skip = new Set([...ctx.payoff.owners]);
    info.payoff_unblocked = inside.filter((x) => clear(w, cam.pos, x.p, skip)).length / inside.length;
    if (info.payoff_unblocked < 0.5) return reject('payoff hidden');
  }
  // H3 the action line reads on the screen
  const { w: W, h: H } = SIZE[cam.aspect];
  const diag = Math.hypot(W, H);
  let theta = 0, alpha = 90;
  if (ctx.line) {
    const seg = screenSegment(f, ctx.line.a, ctx.line.b);
    const lenPx = seg ? Math.hypot((seg.b[0] - seg.a[0]) * W, (seg.b[1] - seg.a[1]) * H) : 0;
    info.line_length = lenPx / diag;
    if (lenPx < 0.35 * diag) return reject('action line too short on screen');
    theta = Math.abs(Math.atan2((seg!.b[1] - seg!.a[1]) * H, (seg!.b[0] - seg!.a[0]) * W)) * 180 / Math.PI;
    if (theta > 90) theta = 180 - theta;
    const d = norm3(sub(ctx.line.b, ctx.line.a));
    const c = Math.abs(d[0] * f.F[0] + d[1] * f.F[1] + d[2] * f.F[2]);
    alpha = Math.acos(Math.min(1, c)) * 180 / Math.PI;
    info.line_angle = theta; info.line_vs_view = alpha;
    // a line running nearly at or away from the lens does not read as a line at all (image-model experiments: beams drawn into the depth)
    if (alpha < 25) return reject('action line runs along the view');
  }
  // must-show things
  for (const m of ctx.must) {
    const k = m.points.filter((p) => inFrame(project(f, p))).length / m.points.length;
    if (k < 0.5) return reject(`"${m.id}" out of frame`);
  }

  const terms: Partial<Record<Term, number>> = {};
  const head = project(f, ctx.focus.head)!;
  const focusDist = dist(cam.pos, ctx.focus.head);
  info.camera_height = cam.pos[1] - w.groundY; info.pitch = pitch(f) * 180 / Math.PI; info.focal = cam.focal;

  // a line running at or away from the lens collapses (foreshortening): it no longer reads as a line
  if (ctx.line) terms.foreshortening = Math.min(1, Math.max(0, (alpha - 30) / 20));
  // picture-plane composition: Liu et al. 2010 (rule of thirds for subjects and lines, diagonal dominance, visual
  // balance, region size), on the regions and lines the scene projects to
  const comp = composition(...regionsAndLines(ctx, f), H / W);
  terms.composition = comp.E;
  info.liu_rt = comp.RT; info.liu_da = comp.DA ?? -1; info.liu_vb = comp.VB; info.liu_sz = comp.SZ;
  // scale: a low camera looking up at something big makes it big (low-angle shot)
  // only with something big to show: an establishing shot of a room or a street is not a low-angle scale shot
  const big = !!ctx.payoff && ctx.payoff.height > 15;
  if (big) {
    const low = tri(info.camera_height, -1, 0, 2, 8);
    const up = tri(info.pitch, -5, 10, 35, 55);
    let size = 0.5;
    if (big) {
      const vs = ctx.payoff!.points.map((p) => project(f, p)).filter(Boolean).map((x) => x!.v);
      size = tri(Math.max(...vs) - Math.min(...vs), 0.15, 0.35, 0.9, 1.3);
    }
    terms.scale = (low + up + size) / 3;
  }
  // rays over a grid: open sky, near things at the edges (framing), what blocks the middle
  const [gx, gy] = GRID[cam.aspect];
  let sky = 0, edge = 0, edgeNear = 0, mid = 0, midNear = 0;
  const skip = new Set([ctx.focus.id, ...(ctx.payoff?.owners || [])]);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const u = (i + 0.5) / gx, v = (j + 0.5) / gy;
    const hit = cast(w, cam.pos, ray(f, u, v));
    if (!hit) sky++;
    const near = !!hit && hit.prim !== null && !skip.has(hit.prim.owner) && hit.t < 0.6 * focusDist;
    if (u < 0.18 || u > 0.82 || v < 0.15) { edge++; if (near) edgeNear++; }
    else if (u > 0.3 && u < 0.7 && v > 0.3 && v < 0.7) { mid++; if (near) midNear++; }
  }
  info.sky = sky / (gx * gy); info.edge_near = edgeNear / edge; info.middle_blocked = mid ? midNear / mid : 0;
  // open sky gives room for scale
  if (big) terms.sky = tri(info.sky, 0.08, 0.25, 0.6, 0.85);
  // near things at the edges frame the shot (Mateu-Mestre, Framed Ink: framing devices); nothing near in the middle
  terms.framing = tri(info.edge_near, 0.03, 0.15, 0.6, 0.9) * (info.middle_blocked > 0.2 ? 0.4 : 1);
  // how big the focus person is, for what the shot is for (shot size: Mascelli, Katz)
  const top = project(f, add(ctx.focus.head, [0, ctx.focus.headR, 0])), feet = project(f, lerp(ctx.focus.points[KP.rAnkle], ctx.focus.points[KP.lAnkle], 0.5));
  info.subject_size = top && feet ? Math.abs(feet.v - top.v) : 0;
  // too small to be anyone
  if (info.subject_size < 0.015) return reject('focus too small');
  // with the payoff far from the focus both cannot be big: judge the person's size as in a wide shot
  const far = ctx.payoff && dist(ctx.focus.head, ctx.payoff.points.reduce((a, b) => add(a, mul(b, 1 / ctx.payoff!.points.length)), [0, 0, 0] as V3)) > 30;
  // a person small against something big (scale); an establishing shot without one: long to extreme long shot
  // (Cutting 2015's definitions: XLS the setting well beyond the figure, LS head to feet); else films' shot scales
  terms.subject_size = far || (ctx.intent === 'scale' && big) ? tri(info.subject_size, ...SCALE_SIZE)
    : ctx.intent === 'scale' ? tri(info.subject_size, ...WIDE_SIZE)
    : shotScaleScore(info.subject_size, ctx.intent === 'action' ? ACTION_SCALES : SHOT_SCALES);
  // which way the face is seen: the reference shots' frequency over a uniform camera's (a likelihood ratio in three
  // coarse bins), so the front is preferred but a back is a choice films make (19% of them)
  const toCam = flat(sub(cam.pos, ctx.focus.head)), face = faceDir(ctx.focus);
  info.face_angle = Math.acos(Math.max(-1, Math.min(1, toCam[0] * face[0] + toCam[2] * face[2]))) * 180 / Math.PI;
  terms.face = faceScore(info.face_angle);
  terms.tilt = tiltScore(info.pitch);
  // look room / lead room: space in front of where they face (Mascelli: composition)
  const ahead = project(f, add(ctx.focus.head, ctx.focus.fwd));
  if (ahead) {
    const dx = ahead.u - head.u, dl = Math.hypot(dx, ahead.v - head.v);
    terms.lead_room = dl < 0.01 ? 0.6 : Math.min(1, Math.max(0, 0.5 + (dx / dl) * (0.5 - head.u) * 2));
  } else terms.lead_room = 0.6;
  // never crop the subject at a joint (Katz: framing the figure). The subject only: the reference shots crop the
  // people around it at the frame's edge freely (10 of 24 lost points when every person counted)
  let cuts = 0;
  {
    const ps = ctx.focus.points.map((p) => project(f, p));
    const vis = ps.filter((p) => inFrame(p)).length;
    if (vis > 0 && vis < ps.length) for (const j of [KP.neck, KP.rElbow, KP.lElbow, KP.rWrist, KP.lWrist, KP.rKnee, KP.lKnee, KP.rAnkle, KP.lAnkle]) {
      const p = ps[j];
      if (p && (Math.abs(p.u) < 0.025 || Math.abs(1 - p.u) < 0.025 || Math.abs(p.v) < 0.025 || Math.abs(1 - p.v) < 0.025)) cuts++;
    }
  }
  // a preference, not a veto: 12 of 43 reference shots measure a cut joint (their rebuild is ±20 px, more than the
  // 2.5% tolerance), so one cut costs a quarter and the term stops at a half
  terms.joint_cut = Math.max(0.5, 1 - 0.25 * cuts);
  // the subject should not be covered by someone nearer (Bares et al. 2000: minimize the primary object's occlusion;
  // others overlapping each other adds depth and is fine)
  const box2 = (a: SolvedActor) => bbox(a.points.map((p) => project(f, p)).filter(Boolean) as { u: number; v: number }[]);
  const fb = box2(ctx.focus);
  let worst = 0;
  if (fb) for (const a of ctx.solved.actors.values()) {
    if (a.id === ctx.focus.id || dist(cam.pos, a.head) >= focusDist) continue;
    const b = box2(a);
    if (b) worst = Math.max(worst, coverRatio(fb, b));
  }
  // glass nearer than the subject covers it too (seen through, but through a pane: a capsule filling the frame);
  // not the glass the subject is in (someone in a tank is seen through their own tank)
  if (fb) for (const p of w.prims) {
    if (!p.glass || inside(p, ctx.focus.head, 0.1)) continue;
    const cs = corners(p);
    if (dist(cam.pos, cs.reduce((x, y) => add(x, mul(y, 1 / cs.length)), [0, 0, 0] as V3)) >= focusDist) continue;
    const b = bbox(cs.map((q) => project(f, q)).filter(Boolean) as { u: number; v: number }[]);
    if (b) worst = Math.max(worst, coverRatio(fb, b));
  }
  terms.overlap = worst <= 0.3 ? 1 : Math.max(0, 1 - (worst - 0.3) / 0.7);
  // tall payoffs suit portrait, flat crossings suit landscape
  terms.aspect = big ? (cam.aspect === 'portrait' ? 1 : 0.4) : ctx.line && theta < 30 ? (cam.aspect !== 'portrait' ? 1 : 0.4) : 0.7;
  // nothing thin growing out of the head (mergers / tangents)
  let merge = 0;
  for (const p of ctx.thin) {
    const ends = corners(p);
    const lo = ends.reduce((a, b) => (a[1] < b[1] ? a : b)), hi = ends.reduce((a, b) => (a[1] > b[1] ? a : b));
    if (dist(cam.pos, lerp(lo, hi, 0.5)) < focusDist) continue;
    const s = screenSegment(f, lo, hi);
    if (!s) continue;
    if (segPointDist(s.a, s.b, [head.u, head.v], H / W) < 0.02) merge++;
  }
  terms.merger = merge ? 0 : 1;

  // weighted geometric mean: one rule broken badly pulls the whole shot down (an average let five easy terms hide it)
  const weights = WEIGHTS[ctx.intent];
  let sum = 0, wsum = 0;
  for (const t of TERMS) if (terms[t] !== undefined && weights[t] > 0) { sum += weights[t] * Math.log(Math.max(0.02, terms[t]!)); wsum += weights[t]; }
  return { ok: true, total: wsum ? Math.exp(sum / wsum) : 0, terms, info };
}

/** The salient regions and prominent lines of the shot, from the scene itself (saliencies are fixed constants). */
export const SALIENCY = { focus: 1, actor: 0.6, payoff: 0.8, structure: 0.3, actionLine: 1, otherLine: 0.6, structureEdges: 0.4, girder: 0.5, horizon: 0.4 };
function regionsAndLines(ctx: Ctx, f: Frame): [Region2D[], Line2D[]] {
  const regions: Region2D[] = [];
  const box = (pts: V3[], saliency: number) => {
    const ps = pts.map((p) => project(f, p)).filter(Boolean) as { u: number; v: number }[];
    if (!ps.length) return;
    const u0 = Math.max(0, Math.min(...ps.map((p) => p.u))), u1 = Math.min(1, Math.max(...ps.map((p) => p.u)));
    const v0 = Math.max(0, Math.min(...ps.map((p) => p.v))), v1 = Math.min(1, Math.max(...ps.map((p) => p.v)));
    if (u1 <= u0 || v1 <= v0) return;
    regions.push({ c: [(u0 + u1) / 2, (v0 + v1) / 2], area: (u1 - u0) * (v1 - v0), saliency });
  };
  for (const a of ctx.solved.actors.values()) box([...a.points, add(a.head, [0, a.headR, 0])], a.id === ctx.focus.id ? SALIENCY.focus : SALIENCY.actor);
  if (ctx.payoff) box(ctx.payoff.points, SALIENCY.payoff);
  const lines: Line2D[] = [];
  const seg = (a: V3, b: V3, saliency: number) => { const s = screenSegment(f, a, b); if (s && Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0.05) lines.push({ a: s.a, b: s.b, saliency }); };
  for (const l of ctx.solved.lines.values()) seg(l.a, l.b, ctx.line && l.a === ctx.line.a ? SALIENCY.actionLine : SALIENCY.otherLine);
  for (const st of ctx.solved.structures.values()) {
    if (!ctx.payoff?.owners.has(st.id)) box(boxCorners(st.box), SALIENCY.structure);
    const cs = boxCorners(st.box);
    if (st.kind === 'truss' || st.kind === 'bridge') {
      // the girder's long bottom edges
      seg(cs[0], cs[4], SALIENCY.girder); seg(cs[1], cs[5], SALIENCY.girder);
    } else for (let i = 0; i < 4; i++) seg(cs[i * 2], cs[i * 2 + 1], SALIENCY.structureEdges / 4);
  }
  const h = horizon(f);
  if (h) lines.push({ ...h, saliency: SALIENCY.horizon });
  return [regions, lines];
}
/** Box corners ordered so that [2i, 2i+1] are the vertical edges and [0,4], [1,5] run along the local x axis. */
function boxCorners(b: { c: V3; half: V3; yaw: number }): V3[] {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), out: V3[] = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [-1, 1]) {
    const lx = x * b.half[0], lz = z * b.half[2];
    out.push([b.c[0] + lx * c + lz * s, b.c[1] + y * b.half[1], b.c[2] - lx * s + lz * c]);
  }
  return out;
}
/** The horizon across the frame (points at infinity on the horizontal), when it is on the screen. */
function horizon(f: Frame): { a: [number, number]; b: [number, number] } | null {
  const fl = Math.hypot(f.F[0], f.F[2]);
  if (fl < 0.05) return null;
  const fwd: V3 = [f.F[0] / fl, 0, f.F[2] / fl], right: V3 = [-fwd[2], 0, fwd[0]];
  const far = (k: number) => project(f, add(f.cam.pos, mul(add(fwd, mul(right, k)), 1e6)));
  const p = far(-0.2), q = far(0.2);
  if (!p || !q) return null;
  const slope = (q.v - p.v) / ((q.u - p.u) || 1e-9);
  const v0 = p.v + (0 - p.u) * slope, v1 = p.v + (1 - p.u) * slope;
  if ((v0 < 0 && v1 < 0) || (v0 > 1 && v1 > 1)) return null;
  return { a: [0, Math.max(0, Math.min(1, v0))], b: [1, Math.max(0, Math.min(1, v1))] };
}

type Box2 = { u0: number; u1: number; v0: number; v1: number };
function bbox(ps: { u: number; v: number }[]): Box2 | null {
  if (!ps.length) return null;
  return { u0: Math.min(...ps.map((p) => p.u)), u1: Math.max(...ps.map((p) => p.u)), v0: Math.min(...ps.map((p) => p.v)), v1: Math.max(...ps.map((p) => p.v)) };
}
/** How much of `a` the box `b` covers. */
function coverRatio(a: Box2, b: Box2): number {
  const iu = Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)), iv = Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0));
  return (iu * iv) / Math.max(1e-6, (a.u1 - a.u0) * (a.v1 - a.v0));
}
function segPointDist(a: [number, number], b: [number, number], p: [number, number], ar: number): number {
  const ax = a[0], ay = a[1] * ar, bx = b[0], by = b[1] * ar, px = p[0], py = p[1] * ar;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}
const flat = (d: V3): V3 => { const l = Math.hypot(d[0], d[2]) || 1; return [d[0] / l, 0, d[2] / l]; };
/** Where the face points (nose from the head centre), horizontally. */
export const faceDir = (a: SolvedActor): V3 => flat(sub(a.points[KP.nose], a.head));
const norm3 = (d: V3): V3 => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };

export { frame };
export type { Frame };
