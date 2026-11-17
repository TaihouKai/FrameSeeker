// Reference shots (DESIGN.md §6.6.2): a frame from a film, annotated by hand in pixels, rebuilt as a gray-box scene
// and the camera that took it, by single-view metrology (Criminisi, Reid, Zisserman 2000): the horizon gives the
// pitch and roll, two vanishing points the focal length, and people of known height the camera height and where
// they stand. The annotations are measurements; nothing here judges the shot.
import { add, mul, sub, type V3 } from '../shared/vec.ts';
import { frame, project, ray, type Cam } from '../camera/camera.ts';
import { POSES, KP } from '../scene/poses.ts';
import type { Intent, Scene } from '../scene/types.ts';

/** Annotation image size (the frames are scaled to 960 x 540 with a 40 px grid). */
export const REF_W = 960, REF_H = 540;
export const DEFAULT_HEIGHT = 1.6;
/** crown to chin, as a fraction of the height (anime teenagers draw at about 6.5 heads) */
export const HEAD_LEN = 0.15;
/** used when no two vanishing points give the focal length */
export const DEFAULT_FOCAL = 35;
/** a camera on the ground (the search's lowest is 0.3 m too) */
export const MIN_CAMERA_HEIGHT = 0.3;

type Px = [number, number];
export interface RefPerson {
  id: string;
  pose: string;
  /** top of the head */
  crown: Px;
  /** the ground point between the feet (when they stand on the ground and the feet are in frame) */
  feet?: Px;
  /** else the chin: the head's size gives the distance */
  chin?: Px;
  /** where they face, in the ground plane: 0 at the camera, 90 screen right, -90 screen left, 180 away */
  face: number;
  height?: number;
}
export interface RefFrame {
  /** '<episode>#<frame>' */
  id: string;
  intent: Intent;
  focus: string;
  /** y of the horizon at the left and the right edge */
  horizon?: Px;
  /** when the horizon is far off the frame: an estimate of the pitch (degrees, up positive) and roll */
  pitch_deg?: number;
  roll_deg?: number;
  /** vanishing points of two perpendicular horizontal directions: give the focal length */
  vps?: [Px, Px];
  people: RefPerson[];
  note?: string;
}

export interface Rebuilt {
  scene: Scene;
  cam: Cam;
  /** what was estimated rather than measured */
  estimated: string[];
  /** camera height from each person (metres) */
  heights: number[];
}

const crownHeight = (pose: string, h: number) => {
  const p = POSES.get(pose);
  if (!p) throw new Error(`unknown pose "${pose}"`);
  return ((p.points[KP.rEar][1] + p.points[KP.lEar][1]) / 2 + 0.075) * h;
};
const uv = (p: Px): [number, number] => [p[0] / REF_W, p[1] / REF_H];

export function rebuild(r: RefFrame): Rebuilt {
  const estimated: string[] = [];
  // focal length (35 mm equivalent: 36 mm across)
  let focal = DEFAULT_FOCAL;
  if (r.vps) {
    const c = [REF_W / 2, REF_H / 2];
    const d = -((r.vps[0][0] - c[0]) * (r.vps[1][0] - c[0]) + (r.vps[0][1] - c[1]) * (r.vps[1][1] - c[1]));
    if (d > 0) focal = Math.sqrt(d) * 36 / REF_W; else estimated.push('focal (vanishing points inconsistent)');
  } else estimated.push('focal');
  const fpx = focal / 36 * REF_W;
  // pitch and roll
  let pitch: number, roll: number;
  if (r.horizon) {
    const yc = (r.horizon[0] + r.horizon[1]) / 2;
    pitch = Math.atan((yc - REF_H / 2) / fpx);
    roll = Math.atan2(r.horizon[1] - r.horizon[0], REF_W);
  } else {
    if (r.pitch_deg === undefined) throw new Error(`${r.id}: needs a horizon or pitch_deg`);
    pitch = r.pitch_deg * Math.PI / 180; roll = (r.roll_deg ?? 0) * Math.PI / 180;
    estimated.push('pitch');
  }
  const camAt = (h: number, rollSign: number): Cam => ({ pos: [0, h, 0], target: [0, h + Math.tan(pitch), 1], roll: rollSign * roll, focal, aspect: 'wide' });
  // the roll's sign in the camera model: the one that puts the horizon where it was annotated
  let rollSign = 1;
  if (r.horizon && Math.abs(roll) > 1e-4) {
    const err = (s: number) => {
      const f = frame(camAt(1, s));
      const far = (x: number) => project(f, [x * 1e6, 1, 1e6])!;
      const a = far(-0.3), b = far(0.3);
      const slopePx = ((b.v - a.v) * REF_H) / ((b.u - a.u) * REF_W);
      return Math.abs(slopePx - (r.horizon![1] - r.horizon![0]) / REF_W);
    };
    rollSign = err(1) <= err(-1) ? 1 : -1;
  }
  // camera height: each person of known height gives one; the median is taken
  const unit = frame(camAt(1, rollSign));
  const heights: number[] = [];
  /** where each person stands, with the camera at height h over the origin */
  const where = (h: number): Map<string, V3> => {
    const m = new Map<string, V3>();
    for (const p of r.people) {
      if (p.feet) {
        const rf = ray(unit, ...uv(p.feet));
        const P = add(unit.cam.pos, mul(rf, 1 / -rf[1]));
        m.set(p.id, [P[0] * h, 0, P[2] * h]);
      } else {
        // on the crown's ray, where the crown is at its height above the ground with the camera at h: the layout on
        // the screen stays exact; the head's size gives the distance only when that ray runs too flat to say
        const H = p.height ?? DEFAULT_HEIGHT, C = headCentre(p, H), rc = ray(unit, ...uv(p.crown));
        const dSize = Math.hypot(C[0], C[1], C[2]), dRay = (crownHeight(p.pose, H) - h) / rc[1];
        const d = Math.abs(rc[1]) > 0.05 && dRay > dSize / 3 && dRay < dSize * 3 ? dRay : dSize;
        m.set(p.id, [rc[0] * d, 0, rc[2] * d]);
      }
    }
    return m;
  };
  /** the crown, with the camera at the origin, from the head's size on the screen */
  const headCentre = (p: RefPerson, H: number): V3 => {
    const rc = ray(unit, ...uv(p.crown)), rn = ray(unit, ...uv(p.chin!));
    const ang = Math.acos(Math.min(1, rc[0] * rn[0] + rc[1] * rn[1] + rc[2] * rn[2]));
    const d = HEAD_LEN * H / (2 * Math.tan(ang / 2));
    return mul(rc, d);
  };
  for (const p of r.people) {
    const H = p.height ?? DEFAULT_HEIGHT, crown = crownHeight(p.pose, H);
    if (p.feet) {
      const rf = ray(unit, ...uv(p.feet));
      if (rf[1] >= -1e-3) throw new Error(`${r.id}/${p.id}: the feet are above the horizon`);
      const P = add(unit.cam.pos, mul(rf, 1 / -rf[1]));
      // the vertical through P against the crown ray: where they pass closest
      const rc = ray(unit, ...uv(p.crown));
      const y = verticalMeet(P, unit.cam.pos, rc);
      if (y > 0) heights.push(crown / y);
    } else if (p.chin) {
      heights.push(crown - headCentre(p, H)[1]);
    } else throw new Error(`${r.id}/${p.id}: needs feet or chin`);
  }
  if (!heights.length) throw new Error(`${r.id}: no camera height`);
  let h = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)];
  // an estimated pitch can put the camera underground (a low shot looking up): the lowest a camera goes
  if (h < MIN_CAMERA_HEIGHT) { h = MIN_CAMERA_HEIGHT; estimated.push('camera height (clamped)'); }
  const pos = where(h);
  const scene: Scene = {
    version: 1,
    place: { kind: 'other', description: r.note ?? r.id },
    time: { of_day: 'afternoon' },
    actors: r.people.map((p) => ({
      id: p.id, pose: p.pose, height: p.height ?? DEFAULT_HEIGHT,
      place: { at: [pos.get(p.id)![0], pos.get(p.id)![2]] as [number, number] },
      // camera looks along +Z; its screen right is -X (yaw -90°), the camera is at yaw 180°
      facing: 180 + p.face,
      prompt: { look: [], outfit: [], expression: [] },
    })),
    structures: [], effects: [],
    moment: { focus: r.focus, intent: r.intent },
  };
  return { scene, cam: camAt(h, rollSign), estimated, heights };
}

/** Height (with the ground at 0) where the vertical through P passes closest to the ray o + s·d. */
function verticalMeet(P: V3, o: V3, d: V3): number {
  // minimize |P + t·UP − (o + s·d)| over t, s
  const w = sub(P, o);
  const c = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], wd = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
  const s = (wd - w[1] * d[1]) / (c - d[1] * d[1]);
  const t = s * d[1] - w[1];
  return P[1] + t;
}
