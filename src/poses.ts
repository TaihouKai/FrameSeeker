// The pose library (DESIGN.md §5.3): COCO-18 keypoints for a body of height 1, origin between the feet on the
// ground, facing +f. Local coordinates are [s, y, f]: s towards the person's own right, y up, f forward.
// Hand-authored approximations; meant to be reviewed and replaced by poses made in a 3D pose editor.
import type { V3 } from './vec.ts';

export type Local = [number, number, number];
export const KP = {
  nose: 0, neck: 1, rShoulder: 2, rElbow: 3, rWrist: 4, lShoulder: 5, lElbow: 6, lWrist: 7,
  rHip: 8, rKnee: 9, rAnkle: 10, lHip: 11, lKnee: 12, lAnkle: 13, rEye: 14, lEye: 15, rEar: 16, lEar: 17,
} as const;
/** Bones as drawn in an OpenPose skeleton. */
export const BONES: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
export const HEAD: number[] = [KP.nose, KP.rEye, KP.lEye, KP.rEar, KP.lEar];
const UPPER: number[] = [KP.nose, KP.neck, KP.rShoulder, KP.rElbow, KP.rWrist, KP.lShoulder, KP.lElbow, KP.lWrist, KP.rEye, KP.lEye, KP.rEar, KP.lEar];

export interface Pose {
  name: string;
  description: string;
  points: Local[];
  /** arms a pose points at its aim with */
  aim: 'right' | 'both' | null;
  /** the head moves to this side of the body (dodges): the solver mirrors the pose so it moves away from what grazes it */
  headSide?: 'left' | 'right';
}

const BASE: Local[] = [
  [0, 0.925, 0.06], [0, 0.855, 0], [0.115, 0.83, 0], [0.135, 0.65, 0], [0.14, 0.48, 0.02], [-0.115, 0.83, 0], [-0.135, 0.65, 0], [-0.14, 0.48, 0.02],
  [0.07, 0.52, 0], [0.07, 0.29, 0.01], [0.07, 0.05, 0], [-0.07, 0.52, 0], [-0.07, 0.29, 0.01], [-0.07, 0.05, 0],
  [0.025, 0.945, 0.055], [-0.025, 0.945, 0.055], [0.06, 0.935, 0], [-0.06, 0.935, 0],
];

function make(mods: Partial<Record<number, Local>>, shift?: { idx: number[]; by: Local }[]): Local[] {
  const p = BASE.map((x) => [...x] as Local);
  for (const s of shift || []) for (const i of s.idx) p[i] = [p[i][0] + s.by[0], p[i][1] + s.by[1], p[i][2] + s.by[2]];
  for (const [k, val] of Object.entries(mods)) p[Number(k)] = val!;
  return p;
}

/** Turn the head about the vertical through its centre (look_back). */
function turnHead(p: Local[], angle: number): Local[] {
  const cs = (p[KP.rEar][0] + p[KP.lEar][0]) / 2, cf = (p[KP.rEar][2] + p[KP.lEar][2]) / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  return p.map((x, i) => {
    if (!HEAD.includes(i)) return x;
    const ds = x[0] - cs, df = x[2] - cf;
    return [cs + ds * c + df * s, x[1], cf - ds * s + df * c];
  });
}

/** Tip the whole body backwards about the ankles (fall_back): angle in radians. */
function tipBack(p: Local[], angle: number): Local[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return p.map(([x, y, f]) => [x, Math.max(0.02, f * s + y * c), f * c - y * s]);
}

const P: Pose[] = [
  { name: 'stand', description: 'standing, arms down', aim: null, points: make({}) },
  { name: 'talk', description: 'standing, one hand raised while talking', aim: null, points: make({ [KP.rElbow]: [0.15, 0.66, 0.04], [KP.rWrist]: [0.17, 0.66, 0.16] }) },
  { name: 'arms_crossed', description: 'standing, arms crossed', aim: null, points: make({ [KP.rElbow]: [0.14, 0.7, 0.06], [KP.rWrist]: [-0.06, 0.72, 0.1], [KP.lElbow]: [-0.14, 0.7, 0.06], [KP.lWrist]: [0.06, 0.74, 0.1] }) },
  { name: 'walk', description: 'walking', aim: null, points: make({ [KP.rKnee]: [0.07, 0.29, 0.06], [KP.rAnkle]: [0.07, 0.05, 0.12], [KP.lKnee]: [-0.07, 0.29, -0.03], [KP.lAnkle]: [-0.07, 0.06, -0.12], [KP.rWrist]: [0.14, 0.49, -0.08], [KP.lWrist]: [-0.14, 0.49, 0.08] }) },
  { name: 'run', description: 'running, leaning forward', aim: null, points: make({
    [KP.rKnee]: [0.07, 0.33, 0.15], [KP.rAnkle]: [0.07, 0.17, 0.05], [KP.lKnee]: [-0.07, 0.27, -0.08], [KP.lAnkle]: [-0.07, 0.12, -0.25],
    [KP.rElbow]: [0.13, 0.66, -0.01], [KP.rWrist]: [0.12, 0.72, 0.1], [KP.lElbow]: [-0.13, 0.66, 0.12], [KP.lWrist]: [-0.12, 0.58, 0.22],
  }, [{ idx: UPPER, by: [0, -0.02, 0.07] }]) },
  { name: 'fire_beam_one_hand', description: 'firing from one outstretched hand', aim: 'right', points: make({
    [KP.rElbow]: [0.12, 0.83, 0.18], [KP.rWrist]: [0.12, 0.83, 0.35], [KP.rKnee]: [0.075, 0.29, -0.05], [KP.rAnkle]: [0.08, 0.05, -0.12], [KP.lKnee]: [-0.08, 0.29, 0.06], [KP.lAnkle]: [-0.09, 0.05, 0.1],
  }) },
  { name: 'fire_beam_two_hands', description: 'firing from both hands held forward', aim: 'both', points: make({
    [KP.rElbow]: [0.08, 0.82, 0.18], [KP.rWrist]: [0.03, 0.82, 0.34], [KP.lElbow]: [-0.08, 0.82, 0.18], [KP.lWrist]: [-0.03, 0.82, 0.34], [KP.rAnkle]: [0.09, 0.05, -0.12], [KP.lAnkle]: [-0.09, 0.05, 0.1],
  }) },
  { name: 'point', description: 'pointing at something', aim: 'right', points: make({ [KP.rElbow]: [0.13, 0.82, 0.17], [KP.rWrist]: [0.13, 0.84, 0.34] }) },
  { name: 'punch', description: 'throwing a straight punch', aim: 'right', points: make({
    [KP.rElbow]: [0.09, 0.8, 0.19], [KP.rWrist]: [0.05, 0.8, 0.36], [KP.lElbow]: [-0.15, 0.7, -0.08], [KP.lWrist]: [-0.12, 0.74, 0.04], [KP.rAnkle]: [0.09, 0.05, -0.18], [KP.lAnkle]: [-0.09, 0.05, 0.14],
  }, [{ idx: UPPER, by: [0, -0.01, 0.05] }]) },
  { name: 'dodge_head_tilt', description: 'jerking the head aside at the last instant', aim: null, headSide: 'left', points: make({
    [KP.rShoulder]: [0.105, 0.84, 0], [KP.lShoulder]: [-0.13, 0.8, 0], [KP.rKnee]: [0.07, 0.3, 0.03], [KP.lKnee]: [-0.07, 0.3, 0.03],
    [KP.rWrist]: [0.22, 0.55, 0.03], [KP.lWrist]: [-0.2, 0.5, 0.05], [KP.rElbow]: [0.17, 0.66, 0.0], [KP.lElbow]: [-0.17, 0.64, 0.0],
  }, [{ idx: HEAD, by: [-0.07, -0.03, -0.01] }, { idx: [KP.neck], by: [-0.03, -0.01, 0] }]) },
  { name: 'dodge_side_step', description: 'leaping sideways out of the way', aim: null, headSide: 'left', points: make({
    [KP.lAnkle]: [-0.25, 0.05, 0], [KP.lKnee]: [-0.2, 0.28, 0.02], [KP.rAnkle]: [0.12, 0.05, 0], [KP.rKnee]: [0.08, 0.27, 0.02],
  }, [{ idx: UPPER, by: [-0.12, -0.04, 0] }, { idx: [KP.rHip, KP.lHip], by: [-0.06, -0.04, 0] }]) },
  { name: 'look_back', description: 'looking back over the shoulder', aim: null, points: turnHead(make({}), 2.3) },
  { name: 'shield_arm', description: 'raising a forearm before the face', aim: null, points: make({ [KP.rElbow]: [0.1, 0.84, 0.12], [KP.rWrist]: [-0.02, 0.95, 0.15] }) },
  { name: 'crouch', description: 'crouching low', aim: null, points: make({
    [KP.rHip]: [0.07, 0.32, -0.05], [KP.lHip]: [-0.07, 0.32, -0.05], [KP.rKnee]: [0.08, 0.2, 0.12], [KP.lKnee]: [-0.08, 0.2, 0.12], [KP.rAnkle]: [0.07, 0.04, 0], [KP.lAnkle]: [-0.07, 0.04, 0],
  }, [{ idx: UPPER, by: [0, -0.2, 0.05] }]) },
  { name: 'kneel', description: 'kneeling on one knee', aim: null, points: make({
    [KP.rHip]: [0.07, 0.3, 0], [KP.lHip]: [-0.07, 0.3, 0], [KP.rKnee]: [0.07, 0.04, 0], [KP.rAnkle]: [0.07, 0.05, -0.2], [KP.lKnee]: [-0.07, 0.25, 0.18], [KP.lAnkle]: [-0.07, 0.04, 0.2],
  }, [{ idx: UPPER, by: [0, -0.22, 0] }]) },
  { name: 'sit', description: 'sitting on something knee-high', aim: null, points: make({
    [KP.rHip]: [0.07, 0.35, -0.02], [KP.lHip]: [-0.07, 0.35, -0.02], [KP.rKnee]: [0.07, 0.35, 0.22], [KP.lKnee]: [-0.07, 0.35, 0.22], [KP.rAnkle]: [0.07, 0.05, 0.24], [KP.lAnkle]: [-0.07, 0.05, 0.24],
  }, [{ idx: UPPER, by: [0, -0.17, -0.02] }]) },
  { name: 'jump', description: 'in mid-leap, legs tucked, arms up', aim: null, points: make({
    [KP.rKnee]: [0.07, 0.35, 0.12], [KP.lKnee]: [-0.07, 0.35, 0.12], [KP.rAnkle]: [0.07, 0.2, -0.02], [KP.lAnkle]: [-0.07, 0.2, -0.02],
    [KP.rElbow]: [0.16, 0.95, 0.02], [KP.rWrist]: [0.17, 1.08, 0.04], [KP.lElbow]: [-0.16, 0.95, 0.02], [KP.lWrist]: [-0.17, 1.08, 0.04],
  }) },
  { name: 'float', description: 'floating, legs relaxed, arms slightly out (only when the character can)', aim: null, points: make({
    [KP.rAnkle]: [0.06, 0.06, -0.04], [KP.lAnkle]: [-0.06, 0.08, -0.06], [KP.rWrist]: [0.22, 0.52, 0.03], [KP.lWrist]: [-0.22, 0.52, 0.03],
  }) },
  { name: 'fall_back', description: 'knocked off balance, falling backwards', aim: null, points: tipBack(make({ [KP.rWrist]: [0.25, 0.7, 0.1], [KP.lWrist]: [-0.25, 0.7, 0.1] }), 0.6) },
];

export const POSES: ReadonlyMap<string, Pose> = new Map(P.map((p) => [p.name, p]));

/** The pose mirrored left to right (a dodge to the other side). */
export function mirror(p: Local[]): Local[] {
  const swap: Record<number, number> = { 2: 5, 3: 6, 4: 7, 5: 2, 6: 3, 7: 4, 8: 11, 9: 12, 10: 13, 11: 8, 12: 9, 13: 10, 14: 15, 15: 14, 16: 17, 17: 16 };
  return p.map((_, i) => { const [s, y, f] = p[swap[i] ?? i]; return [-s, y, f]; });
}

/** World position of a local point: the person stands at `at`, faces `fwd` (unit, horizontal), and is `height` tall. */
export function toWorld(l: Local, at: V3, fwd: V3, height: number): V3 {
  // the person's right: fwd × up
  const right: V3 = [-fwd[2], 0, fwd[0]];
  return [at[0] + (right[0] * l[0] + fwd[0] * l[2]) * height, at[1] + l[1] * height, at[2] + (right[2] * l[0] + fwd[2] * l[2]) * height];
}
