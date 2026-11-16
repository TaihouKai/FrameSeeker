// Stage 3 scoring (DESIGN.md §6.4): hard constraints, then composition terms in [0, 1], weighted by the shot's intent.
// Each term names the textbook principle it encodes.
import { add, dist, lerp, mul, sub, type V3 } from './vec.ts';
import { cast, clear, corners, inside, type Prim, type World } from './geom.ts';
import { frame, inFrame, pitch, project, ray, screenSegment, SIZE, type Cam, type Frame } from './camera.ts';
import { KP } from './poses.ts';
import type { Intent } from './scene.ts';
import type { Solved, SolvedActor } from './solve.ts';
import { composition, type Line2D, type Region2D } from './composition2d.ts';

export const TERMS = ['composition', 'foreshortening', 'scale', 'sky', 'framing', 'subject_size', 'face', 'lead_room', 'joint_cut', 'overlap', 'aspect', 'merger'] as const;
export type Term = typeof TERMS[number];

/** Weights by intent (DESIGN.md §6.4 table; starting values). */
export const WEIGHTS: Record<Intent, Record<Term, number>> = {
  scale:   { composition: 3.5, foreshortening: 3, scale: 4, sky: 2, framing: 1.5, subject_size: 2, face: 0.5, lead_room: 1, joint_cut: 1, overlap: 1, aspect: 0.5, merger: 1 },
  action:  { composition: 4.5, foreshortening: 3, scale: 1, sky: 0.5, framing: 1, subject_size: 2, face: 1.5, lead_room: 1.5, joint_cut: 1, overlap: 1.5, aspect: 0.5, merger: 1 },
  emotion: { composition: 2.5, foreshortening: 1, scale: 0, sky: 0, framing: 0.5, subject_size: 3, face: 3, lead_room: 1, joint_cut: 1.5, overlap: 0.5, aspect: 0.5, merger: 1.5 },
  reveal:  { composition: 2.5, foreshortening: 2, scale: 2, sky: 1, framing: 1, subject_size: 2, face: 1.5, lead_room: 1, joint_cut: 1, overlap: 1, aspect: 0.5, merger: 1 },
};

/** How big the focus person is on the screen (fraction of the frame height), by intent: [zero, full, full, zero]. */
const SUBJECT_SIZE: Record<Intent, [number, number, number, number]> = {
  scale: [0.02, 0.05, 0.22, 0.4], action: [0.12, 0.25, 0.6, 0.9], emotion: [0.35, 0.6, 1.4, 2.2], reveal: [0.06, 0.15, 0.4, 0.6],
};

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

const GRID: Record<'portrait' | 'landscape', [number, number]> = { portrait: [18, 27], landscape: [27, 18] };

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
  const seen = fp.filter((x) => inFrame(x.s, 0.03) && clear(w, cam.pos, x.p, focusSkip)).length / fp.length;
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
    // a line running nearly at or away from the lens does not read as a line at all (experiments 06/07)
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
  const big = ctx.payoff && ctx.payoff.height > 15;
  if (big || ctx.intent === 'scale') {
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
  if (ctx.intent === 'scale' || ctx.intent === 'reveal') terms.sky = tri(info.sky, 0.08, 0.25, 0.6, 0.85);
  // near things at the edges frame the shot (Mateu-Mestre, Framed Ink: framing devices); nothing near in the middle
  terms.framing = tri(info.edge_near, 0.03, 0.15, 0.6, 0.9) * (info.middle_blocked > 0.2 ? 0.4 : 1);
  // how big the focus person is, for what the shot is for (shot size: Mascelli, Katz)
  const top = project(f, add(ctx.focus.head, [0, ctx.focus.headR, 0])), feet = project(f, lerp(ctx.focus.points[KP.rAnkle], ctx.focus.points[KP.lAnkle], 0.5));
  info.subject_size = top && feet ? Math.abs(feet.v - top.v) : 0;
  // too small to be anyone
  if (info.subject_size < 0.015) return reject('focus too small');
  // with the payoff far from the focus both cannot be big: judge the person's size as in a wide shot
  const far = ctx.payoff && dist(ctx.focus.head, ctx.payoff.points.reduce((a, b) => add(a, mul(b, 1 / ctx.payoff!.points.length)), [0, 0, 0] as V3)) > 30;
  terms.subject_size = tri(info.subject_size, ...SUBJECT_SIZE[far ? 'scale' : ctx.intent]);
  // the face carries the moment: front to three-quarter view (the way the face points, so a look back counts)
  const toCam = flat(sub(cam.pos, ctx.focus.head)), face = faceDir(ctx.focus);
  info.face_angle = Math.acos(Math.max(-1, Math.min(1, toCam[0] * face[0] + toCam[2] * face[2]))) * 180 / Math.PI;
  if (ctx.intent === 'emotion' && info.face_angle > 100) return reject('face turned away');
  terms.face = info.face_angle <= 60 ? 1 : info.face_angle <= 100 ? 1 - 0.7 * (info.face_angle - 60) / 40 : 0.1;
  // look room / lead room: space in front of where they face (Mascelli: composition)
  const ahead = project(f, add(ctx.focus.head, ctx.focus.fwd));
  if (ahead) {
    const dx = ahead.u - head.u, dl = Math.hypot(dx, ahead.v - head.v);
    terms.lead_room = dl < 0.01 ? 0.6 : Math.min(1, Math.max(0, 0.5 + (dx / dl) * (0.5 - head.u) * 2));
  } else terms.lead_room = 0.6;
  // never crop at a joint (Katz: framing the figure)
  let cuts = 0;
  for (const a of ctx.solved.actors.values()) {
    const ps = a.points.map((p) => project(f, p));
    const vis = ps.filter((p) => inFrame(p)).length;
    if (vis === 0 || vis === ps.length) continue;
    for (const j of [KP.neck, KP.rElbow, KP.lElbow, KP.rWrist, KP.lWrist, KP.rKnee, KP.lKnee, KP.rAnkle, KP.lAnkle]) {
      const p = ps[j];
      if (p && (Math.abs(p.u) < 0.025 || Math.abs(1 - p.u) < 0.025 || Math.abs(p.v) < 0.025 || Math.abs(1 - p.v) < 0.025)) cuts++;
    }
  }
  terms.joint_cut = Math.max(0, 1 - 0.5 * cuts);
  // key people should not pile up on the screen
  const boxes = [...ctx.solved.actors.values()].map((a) => bbox(a.points.map((p) => project(f, p)).filter(Boolean) as { u: number; v: number }[])).filter(Boolean) as Box2[];
  let worst = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) worst = Math.max(worst, overlapRatio(boxes[i], boxes[j]));
  terms.overlap = worst <= 0.3 ? 1 : Math.max(0, 1 - (worst - 0.3) / 0.7);
  // tall payoffs suit portrait, flat crossings suit landscape
  terms.aspect = big ? (cam.aspect === 'portrait' ? 1 : 0.4) : ctx.line && theta < 30 ? (cam.aspect === 'landscape' ? 1 : 0.4) : 0.7;
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
function overlapRatio(a: Box2, b: Box2): number {
  const iu = Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)), iv = Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0));
  const area = (x: Box2) => Math.max(1e-6, (x.u1 - x.u0) * (x.v1 - x.v0));
  return (iu * iv) / Math.min(area(a), area(b));
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
