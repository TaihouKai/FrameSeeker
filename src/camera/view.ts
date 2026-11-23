// What a camera shows, measured: for each person and thing in the world, how much of it is in frame and seen,
// where it sits on the screen and how big it is; for each person, which way their face is turned to the camera and
// whether the camera is above or below their eyes. Neutral facts, no judgement: other modules (the intent module)
// turn them into preferences.
import { add, lerp, mul, sub, type V3 } from '../shared/vec.ts';
import { clear } from '../shared/geom.ts';
import { KP } from '../shared/skeleton.ts';
import { partPoints, type World3D } from '../scene/index.ts';
import { frame, inFrame, pitch, project, type Cam } from './camera.ts';
import { faceAngleOf } from './maps.ts';

export interface ThingView {
  id: string;
  /** 'part': the moment's part of its focus, in an insert (id "<actor>.<part>") */
  kind: 'actor' | 'structure' | 'line' | 'volume' | 'damage' | 'part';
  /** share of its sample points inside the frame */
  inFrame: number;
  /** share of its sample points inside the frame and not hidden by something else */
  seen: number;
  /** centre of its points in frame, [u, v] in 0..1 (null when none is) */
  centre: [number, number] | null;
  /** its screen height (top to bottom of its points), as a fraction of the frame's height */
  size: number;
}
export interface ActorView extends ThingView {
  /** angle between where the face points and the camera, degrees (0 towards it, 180 the back; 90 lying on the back) */
  faceAngle: number;
  /** camera height minus the person's eye height, metres (negative: the camera is below their eyes) */
  above: number;
  /** distance from the camera to the head, metres */
  distance: number;
  /** the head in frame and not hidden (a close shot keeps the head and loses the feet: inFrame alone undersells it) */
  headSeen: boolean;
  /**
   * the shot scale: the whole person's height (crown to feet, wherever they fall) over the frame's height, as the
   * scorer's subject size (Cutting 2015: LS ≈ 0.9, MS ≈ 2.1, MCU ≈ 3.8)
   */
  scale: number;
  /** what they look at (scene looks_at), if anything: whether that point is in frame and in sight */
  gaze: { inFrame: boolean; seen: boolean } | null;
}
export interface View {
  cam: Cam;
  /** degrees, + looking up */
  pitchDeg: number;
  /** metres above the ground */
  height: number;
  things: Map<string, ThingView>;
  actors: Map<string, ActorView>;
}

/** The sample points the view measures for each person and thing (built once per world). */
export function samples(w: World3D): { id: string; kind: ThingView['kind']; owners: Set<string>; points: V3[] }[] {
  const s = w.solved, out: { id: string; kind: ThingView['kind']; owners: Set<string>; points: V3[] }[] = [];
  for (const a of s.actors.values()) {
    const p = a.points;
    out.push({ id: a.id, kind: 'actor', owners: new Set([a.id]), points: [a.head, add(a.head, [0, a.headR, 0]), p[KP.neck], lerp(p[KP.rHip], p[KP.lHip], 0.5), p[KP.rWrist], p[KP.lWrist], lerp(p[KP.rAnkle], p[KP.lAnkle], 0.5)] });
  }
  const box = (b: { c: V3; half: V3; yaw: number }): V3[] => {
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), pts: V3[] = [];
    for (const x of [-0.9, 0, 0.9]) for (const y of [-0.9, 0, 0.9]) for (const z of [-0.9, 0.9]) {
      const lx = x * b.half[0], lz = z * b.half[2];
      pts.push([b.c[0] + lx * c + lz * sn, b.c[1] + y * b.half[1], b.c[2] - lx * sn + lz * c]);
    }
    return pts;
  };
  const m = s.scene.moment, focus = s.actors.get(m.focus);
  if (m.part && focus) out.push({ id: `${focus.id}.${m.part}`, kind: 'part', owners: new Set([focus.id]), points: partPoints(focus, m.part) });
  for (const st of s.structures.values()) out.push({ id: st.id, kind: 'structure', owners: new Set([st.id]), points: box(st.box) });
  for (const l of s.lines.values()) out.push({ id: l.id, kind: 'line', owners: new Set(l.hits ? [l.hits] : []), points: [0, 0.25, 0.5, 0.75, 1].map((t) => lerp(l.a, l.b, t)) });
  for (const v of s.volumes.values()) out.push({ id: v.id, kind: 'volume', owners: new Set(), points: [v.c, ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]].map((o) => add(v.c, mul(o as V3, v.r * 0.8)))] });
  for (const d of s.damages.values()) out.push({ id: d.id, kind: 'damage', owners: new Set([d.target]), points: box(d.box) });
  return out;
}

export function measure(w: World3D, cam: Cam, pts = samples(w)): View {
  const f = frame(cam), things = new Map<string, ThingView>(), actors = new Map<string, ActorView>();
  for (const t of pts) {
    const proj = t.points.map((p) => ({ p, s: project(f, p) }));
    const inside = proj.filter((x) => inFrame(x.s));
    const seen = inside.filter((x) => clear(w.world, cam.pos, x.p, t.owners)).length;
    const vs = inside.map((x) => x.s!.v);
    const tv: ThingView = {
      id: t.id, kind: t.kind, inFrame: inside.length / proj.length, seen: seen / proj.length,
      centre: inside.length ? [inside.reduce((a, x) => a + x.s!.u, 0) / inside.length, vs.reduce((a, v) => a + v, 0) / inside.length] : null,
      // a part's size is its larger side (a foot lies flat), as the insert's score measures it
      size: !vs.length ? 0 : t.kind === 'part' ? Math.max(Math.max(...vs) - Math.min(...vs), (Math.max(...inside.map((x) => x.s!.u)) - Math.min(...inside.map((x) => x.s!.u))) / f.ar) : Math.max(...vs) - Math.min(...vs),
    };
    things.set(t.id, tv);
    if (t.kind === 'actor') {
      const a = w.solved.actors.get(t.id)!;
      const eye = lerp(a.points[KP.rEye], a.points[KP.lEye], 0.5);
      const gp = a.gaze, gs = gp ? project(f, gp) : null;
      const gaze = gp ? { inFrame: inFrame(gs), seen: inFrame(gs) && clear(w.world, cam.pos, gp, new Set([a.id])) } : null;
      const hs = project(f, a.head), headSeen = inFrame(hs) && clear(w.world, cam.pos, a.head, t.owners);
      const top = project(f, add(a.head, [0, a.headR, 0])), feet = project(f, lerp(a.points[KP.rAnkle], a.points[KP.lAnkle], 0.5));
      const scale = top && feet ? Math.abs(feet.v - top.v) : 0;
      actors.set(t.id, { ...tv, faceAngle: faceAngleOf(a, cam), above: cam.pos[1] - eye[1], distance: Math.hypot(...sub(a.head, cam.pos)), gaze, headSeen, scale });
    }
  }
  return { cam, pitchDeg: pitch(f) * 180 / Math.PI, height: cam.pos[1] - w.world.groundY, things, actors };
}

/**
 * A preference over what a camera shows, from outside the camera module (e.g. a cinematographic device chosen for
 * an intent): a score in [0, 1] on the measured view, and its weight against the composition score (weight 1).
 */
export interface Preference { name: string; weight: number; score(v: View): number }
