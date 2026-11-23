// The pose library: COCO-18 keypoints for a body of height 1, origin between the feet on the
// ground, facing +f. Local coordinates are [s, y, f]: s towards the person's own right, y up, f forward.
// Hand-authored approximations; meant to be reviewed and replaced by poses made in a 3D pose editor.
import type { V3 } from '../shared/vec.ts';
import { HEAD, KP } from '../shared/skeleton.ts';

export type Local = [number, number, number];
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

// Proportions about 7.5 heads: crown 1.0, chin 0.865, shoulder line 0.81. The OpenPose neck is the shoulders'
// midpoint, at their height; placed above them (0.855, shoulders 0.83) the skeleton itself had no neck, and the
// pictures drawn from it had short necks.
const BASE: Local[] = [
  [0, 0.925, 0.06], [0, 0.81, 0], [0.115, 0.81, 0], [0.135, 0.635, 0], [0.14, 0.47, 0.02], [-0.115, 0.81, 0], [-0.135, 0.635, 0], [-0.14, 0.47, 0.02],
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
  { name: 'lie', description: 'lying on the back, asleep or still (on a bed or in a pod: give its elevation; the head is behind where they face)', aim: null, points: tipBack(make({}), Math.PI / 2) },
];

// ---- Poses built from joint directions ----
// The rest are written as where each limb points rather than as coordinates: the bones keep the base body's lengths,
// and the body is set down on the ground (its lowest joint at ankle height) unless it is in the air. Directions are
// [s, y, f] in the body's frame (s to its right, y up, f forward), not normalised; for a left limb s points outward
// (to the body's left), so a pose reads the same on both sides.
type D = [number, number, number];
interface Spec {
  /** pelvis to neck (default straight up) */
  spine?: D;
  /** the shoulders turned about the vertical, degrees (+: the right shoulder forward) */
  twist?: number;
  /** degrees, relative to the spine: down (+) or up (-); turned to the body's right (+) or left (-) */
  head?: { down?: number; turn?: number };
  /** upper arm and forearm; thigh and shin */
  ra?: [D, D]; la?: [D, D]; rl?: [D, D]; ll?: [D, D];
  /** the whole body tipped about the pelvis, degrees: pitch forward (+, face down) or back (-); roll onto its right side (+) */
  orient?: { pitch?: number; roll?: number };
  /** not set down: in the air, or held up (by someone, a seat, a ledge: the scene gives the elevation) */
  air?: boolean;
}
const ARM: [D, D] = [[0.11, -1, 0], [0.03, -1, 0.12]], LEG: [D, D] = [[0, -1, 0.04], [0, -1, -0.04]];
const LEN = { spine: 0.29, shoulder: 0.115, hip: 0.07, upper: 0.176, fore: 0.166, thigh: 0.23, shin: 0.24, pelvis: 0.52 };
const nrm = (a: D): D => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const plus = (a: D, b: D, k = 1): D => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const times = (a: D, k: number): D => [a[0] * k, a[1] * k, a[2] * k];
const crs = (a: D, b: D): D => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rad = (d: number) => d * Math.PI / 180;

function build(x: Spec): Local[] {
  const P: D = [0, LEN.pelvis, 0];
  const U = nrm(x.spine ?? [0, 1, 0]);
  const t = rad(x.twist ?? 0);
  let R: D = [Math.cos(t), 0, Math.sin(t)];
  R = nrm(plus(R, U, -(R[0] * U[0] + R[1] * U[1] + R[2] * U[2])));
  const F = crs(R, U);
  const neck = plus(P, U, LEN.spine);
  const limb = (o: D, ds: [D, D], a: number, b: number, left: boolean): [D, D] => {
    const m = (d: D): D => nrm(left ? [-d[0], d[1], d[2]] : d);
    const j = plus(o, m(ds[0]), a);
    return [j, plus(j, m(ds[1]), b)];
  };
  const rSh = plus(neck, R, LEN.shoulder), lSh = plus(neck, R, -LEN.shoulder);
  const rHip = plus(P, [1, 0, 0], LEN.hip), lHip = plus(P, [1, 0, 0], -LEN.hip);
  const [rEl, rWr] = limb(rSh, x.ra ?? ARM, LEN.upper, LEN.fore, false), [lEl, lWr] = limb(lSh, x.la ?? ARM, LEN.upper, LEN.fore, true);
  const [rKn, rAn] = limb(rHip, x.rl ?? LEG, LEN.thigh, LEN.shin, false), [lKn, lAn] = limb(lHip, x.ll ?? LEG, LEN.thigh, LEN.shin, true);
  // the head: tipped down about the shoulder line, then turned about its own up
  const dn = rad(x.head?.down ?? 0), tn = rad(x.head?.turn ?? 0);
  const Fd = plus(times(F, Math.cos(dn)), U, -Math.sin(dn)), Uh = plus(times(U, Math.cos(dn)), F, Math.sin(dn));
  const Fh = plus(times(Fd, Math.cos(tn)), R, Math.sin(tn)), Rh = plus(times(R, Math.cos(tn)), Fd, -Math.sin(tn));
  const at = (u: number, f: number, r: number): D => plus(plus(plus(neck, Uh, u), Fh, f), Rh, r);
  let pts: D[] = [at(0.115, 0.06, 0), neck, rSh, rEl, rWr, lSh, lEl, lWr, rHip, rKn, rAn, lHip, lKn, lAn,
    at(0.135, 0.055, 0.025), at(0.135, 0.055, -0.025), at(0.125, 0, 0.06), at(0.125, 0, -0.06)];
  const pa = rad(x.orient?.pitch ?? 0), ro = rad(x.orient?.roll ?? 0);
  if (pa || ro) pts = pts.map((q) => {
    let [s, y, f] = [q[0] - P[0], q[1] - P[1], q[2] - P[2]];
    [f, y] = [f * Math.cos(pa) + y * Math.sin(pa), y * Math.cos(pa) - f * Math.sin(pa)];
    [s, y] = [s * Math.cos(ro) + y * Math.sin(ro), y * Math.cos(ro) - s * Math.sin(ro)];
    return [P[0] + s, P[1] + y, P[2] + f];
  });
  if (!x.air) { const lift = 0.05 - Math.min(...pts.map((q) => q[1])); pts = pts.map((q) => [q[0], q[1] + lift, q[2]]); }
  return pts.map((q) => [q[0], q[1], q[2]] as Local);
}

// limbs several poses share
const SEAT_LEGS: { rl: [D, D]; ll: [D, D] } = { rl: [[0, -0.02, 1], [0, -1, 0.05]], ll: [[0, -0.02, 1], [0, -1, 0.05]] };
const KNEEL_BOTH: { rl: [D, D]; ll: [D, D] } = { rl: [[0, -1, 0.05], [0, -0.1, -1]], ll: [[0, -1, 0.05], [0, -0.1, -1]] };
const CROUCH_LEGS: { rl: [D, D]; ll: [D, D] } = { rl: [[0.15, -0.35, 1], [0, -1, -0.35]], ll: [[0.15, -0.35, 1], [0, -1, -0.35]] };
const WALK_LEGS: { rl: [D, D]; ll: [D, D] } = { rl: [[0, -1, 0.3], [0, -1, 0.05]], ll: [[0, -1, -0.25], [0, -1, -0.45]] };
const FACE_IN_HANDS: { ra: [D, D]; la: [D, D] } = { ra: [[0.1, -0.6, 0.75], [-0.3, 0.95, 0.1]], la: [[0.1, -0.6, 0.75], [-0.3, 0.95, 0.1]] };
const CROSSED: { ra: [D, D]; la: [D, D] } = { ra: [[0.15, -0.75, 0.35], [-1, 0.25, 0.3]], la: [[0.15, -0.65, 0.4], [-1, 0.2, 0.35]] };

const BUILT: [name: string, description: string, spec: Spec, aim?: 'right' | 'both'][] = [
  // standing: gestures
  ['wave', 'standing, waving a raised hand (hello, goodbye)', { ra: [[0.6, 0.6, 0.1], [0.1, 1, 0.05]] }],
  ['walk_wave', 'walking away with one hand raised over the shoulder (a wave or a thumbs up without turning round)', { ...WALK_LEGS, ra: [[0.45, 0.7, -0.05], [0, 1, 0.1]] }],
  ['thumbs_up', 'standing, a thumb held up in front', { ra: [[0.15, -0.55, 0.6], [0, 0.55, 1]] }],
  ['raise_hand', 'standing, one arm straight up (volunteering, calling out)', { ra: [[0.1, 1, 0], [0, 1, 0]] }],
  ['cheer', 'both arms thrown up in joy or triumph', { ra: [[0.4, 1, 0], [0.15, 1, 0]], la: [[0.4, 1, 0], [0.15, 1, 0]], head: { down: -15 } }],
  ['surrender', 'both hands raised at the sides, palms out (surrender, "wait")', { ra: [[0.9, 0.25, 0], [0, 1, 0.05]], la: [[0.9, 0.25, 0], [0, 1, 0.05]] }],
  ['stretch', 'stretching, both arms up overhead', { ra: [[0.1, 1, 0], [-0.15, 1, 0]], la: [[0.1, 1, 0], [-0.15, 1, 0]], head: { down: -15 } }],
  ['hands_on_hips', 'standing, hands on the hips (confident, scolding)', { ra: [[0.6, -0.8, -0.1], [-0.7, -0.6, 0.1]], la: [[0.6, -0.8, -0.1], [-0.7, -0.6, 0.1]] }],
  ['hand_on_chest', 'standing, a hand pressed to the chest (relief, a vow, heartache)', { ra: [[0.1, -0.9, 0.3], [-0.75, 0.6, 0.35]] }],
  ['pray', 'standing, hands clasped before the chest (praying, pleading)', { ra: [[0.1, -0.8, 0.5], [-0.6, 0.55, 0.6]], la: [[0.1, -0.8, 0.5], [-0.6, 0.55, 0.6]], head: { down: 15 } }],
  ['hand_to_mouth', 'a hand to the mouth (shock, a gasp, holding back a laugh)', { ra: [[0.1, -0.7, 0.6], [-0.35, 0.9, 0.15]] }],
  ['face_in_hands', 'standing, the face buried in both hands (crying, despair)', { ...FACE_IN_HANDS, head: { down: 30 } }],
  ['wipe_tears', 'wiping the eyes with the back of a hand (crying)', { ra: [[0.15, -0.6, 0.6], [-0.3, 1, 0]], head: { down: 15 } }],
  ['hold_head', 'both hands on the head (headache, despair, panic)', { ra: [[0.6, 0.6, 0.3], [-0.6, 0.6, -0.1]], la: [[0.6, 0.6, 0.3], [-0.6, 0.6, -0.1]], head: { down: 15 } }],
  ['head_down', 'standing, head bowed, shoulders slumped (dejected, ashamed, looking at the ground)', { spine: [0, 1, 0.12], head: { down: 40 } }],
  ['look_up', 'standing, looking up (at the sky, at something tall)', { head: { down: -45 } }],
  ['bow', 'bowing from the waist (thanks, apology)', { spine: [0, 0.65, 0.75], head: { down: 10 }, ra: [[0, -1, 0.1], [0, -1, 0.1]], la: [[0, -1, 0.1], [0, -1, 0.1]] }],
  ['salute', 'a hand raised to the brow in a salute', { ra: [[0.85, 0.25, 0.3], [-0.75, 0.6, 0.1]] }],
  ['shrug', 'shrugging, forearms turned out', { ra: [[0.4, -0.9, 0], [0.6, 0.3, 0.6]], la: [[0.4, -0.9, 0], [0.6, 0.3, 0.6]], head: { turn: 10 } }],
  ['scratch_head', 'scratching the back of the head (embarrassed, puzzled)', { ra: [[0.45, 0.8, 0.1], [-0.7, 0.35, -0.15]], head: { down: 10 } }],
  ['clap', 'clapping before the chest', { ra: [[0.2, -0.7, 0.6], [-0.7, 0.4, 0.6]], la: [[0.2, -0.7, 0.6], [-0.7, 0.4, 0.6]] }],
  ['peace_sign', 'a V sign held up beside the face', { ra: [[0.35, -0.45, 0.6], [0, 1, 0.2]] }],
  ['hands_in_pockets', 'standing, hands in the pockets', { ra: [[0.25, -1, -0.05], [-0.3, -0.9, 0.25]], la: [[0.25, -1, -0.05], [-0.3, -0.9, 0.25]] }],
  ['hands_behind_back', 'standing, hands clasped behind the back', { ra: [[0.15, -0.9, -0.3], [-0.6, -0.3, -0.4]], la: [[0.15, -0.9, -0.3], [-0.6, -0.3, -0.4]] }],
  ['hug_self', 'arms wrapped round oneself (cold, scared, lonely)', { ra: [[0.1, -0.5, 0.5], [-0.95, 0.25, 0.1]], la: [[0.1, -0.55, 0.5], [-0.95, 0.2, 0.15]], head: { down: 15 } }],
  ['clench_fists', 'standing tense, fists clenched at the sides, leaning in (anger, resolve)', { spine: [0, 1, 0.12], ra: [[0.2, -1, -0.05], [0.05, -1, 0.05]], la: [[0.2, -1, -0.05], [0.05, -1, 0.05]], head: { down: 10 } }],
  ['laugh', 'laughing, leaning back, a hand on the stomach', { spine: [0, 1, -0.2], head: { down: -20 }, ra: [[0.1, -0.8, 0.3], [-0.8, 0.2, 0.4]] }],
  ['step_back', 'recoiling, leaning back with the hands up (surprise, fear)', { spine: [0, 1, -0.2], ra: [[0.3, -0.4, 0.5], [0.1, 0.9, 0.3]], la: [[0.3, -0.4, 0.5], [0.1, 0.9, 0.3]], rl: [[0, -1, -0.3], [0, -1, -0.2]] }],
  ['stop_hand', 'one palm held out towards someone ("stop", "wait")', { ra: [[0.05, -0.05, 1], [0, 1, 0.2]] }],
  ['phone_call', 'standing, a phone held to the ear', { ra: [[0.25, -0.7, 0.3], [-0.2, 1, -0.05]] }],
  ['look_at_phone', 'standing, looking down at a phone in one hand', { ra: [[0.05, -0.85, 0.3], [-0.2, 0.25, 1]], head: { down: 35 } }],
  ['read', 'standing, reading a book held in both hands', { ra: [[0.05, -0.85, 0.3], [-0.15, 0.25, 1]], la: [[0.05, -0.85, 0.3], [-0.15, 0.25, 1]], head: { down: 30 } }],
  ['drink', 'drinking from a cup or a can, head tipped back', { ra: [[0.1, -0.7, 0.6], [-0.25, 0.95, 0.2]], head: { down: -15 } }],
  ['umbrella', 'standing, holding up an umbrella', { ra: [[0.1, -0.5, 0.5], [0, 1, 0.1]] }],
  ['carry_bag', 'a bag slung over the shoulder, a hand on its strap', { ra: [[0.1, -0.95, 0.15], [-0.05, 1, 0.25]] }],
  ['carry_in_arms', 'carrying something held in both arms at the waist (a box, books)', { ra: [[0.1, -0.9, 0.3], [-0.15, 0.1, 1]], la: [[0.1, -0.9, 0.3], [-0.15, 0.1, 1]] }],
  ['offer', 'holding something out in both hands (a gift, a letter)', { ra: [[0.05, -0.6, 0.6], [-0.1, 0, 1]], la: [[0.05, -0.6, 0.6], [-0.1, 0, 1]] }],
  ['lean_back_wall', 'leaning back against a wall, arms crossed (place them just in front of it, facing away)', { spine: [0, 1, -0.12], ...CROSSED, rl: [[0, -1, 0.15], [0, -1, 0.05]], ll: [[0, -1, 0.15], [0, -1, 0.05]] }],
  ['lean_on_railing', 'leaning forward on a waist-high railing or sill, forearms on it', { spine: [0, 0.85, 0.5], ra: [[0.05, -0.4, 0.9], [-0.5, 0, 0.85]], la: [[0.05, -0.4, 0.9], [-0.5, 0, 0.85]] }],
  ['touch_glass', 'a palm laid on a window or a wall in front', { ra: [[0.05, 0.15, 1], [0, 0.3, 1]] }, 'right'],
  ['point_up', 'pointing up at the sky', { ra: [[0.1, 1, 0.25], [0, 1, 0.2]], head: { down: -30 } }],
  // standing: with someone
  ['reach_out', 'reaching a hand out towards someone or something', { spine: [0, 1, 0.15], ra: [[0.05, -0.1, 1], [0, 0, 1]] }, 'right'],
  ['hand_on_shoulder', "a hand on someone's shoulder", { ra: [[0.1, -0.15, 1], [0, -0.3, 1]] }, 'right'],
  ['head_pat', "patting someone's head", { ra: [[0.1, 0.3, 0.9], [0, -0.2, 1]] }, 'right'],
  ['handshake', "shaking hands, or taking someone's hand", { ra: [[0.1, -0.7, 0.6], [0, -0.1, 1]] }, 'right'],
  ['hold_hands', 'holding hands with someone beside them', { ra: [[0.45, -0.9, 0.05], [0.3, -0.9, 0.15]] }, 'right'],
  ['hug', 'hugging someone, arms around them', { ra: [[0.25, -0.3, 0.9], [-0.85, 0, 0.5]], la: [[0.25, -0.25, 0.9], [-0.85, 0.05, 0.5]], head: { turn: 20 } }],
  ['push', 'pushing with both hands, a foot braced behind', { spine: [0, 1, 0.25], ra: [[0.05, -0.1, 1], [-0.05, 0.1, 1]], la: [[0.05, -0.1, 1], [-0.05, 0.1, 1]], rl: [[0, -1, -0.35], [0, -1, -0.45]], ll: [[0, -1, 0.3], [0, -1, 0]] }, 'both'],
  ['pull', 'pulling hard with both hands, leaning back', { spine: [0, 1, -0.3], ra: [[0.05, -0.2, 1], [0, 0, 1]], la: [[0.05, -0.2, 1], [0, 0, 1]], rl: [[0, -1, -0.2], [0, -1, -0.1]], ll: [[0, -1, 0.4], [0, -1, 0.15]] }, 'both'],
  ['slap', 'slapping with an open hand', { twist: 20, ra: [[0.7, 0.3, 0.6], [-0.4, 0, 1]] }, 'right'],
  ['carry_piggyback', 'carrying someone on the back, bent forward, hands behind', { spine: [0, 0.8, 0.55], head: { down: -25 }, ra: [[0.3, -0.8, -0.4], [-0.2, 0.3, -1]], la: [[0.3, -0.8, -0.4], [-0.2, 0.3, -1]], rl: [[0, -1, 0.3], [0, -1, -0.2]], ll: [[0, -1, 0.3], [0, -1, -0.2]] }],
  ['ride_piggyback', 'carried on someone\'s back, arms over their shoulders (place them "from" the carrier, bearing "behind", distance 0.3, elevation about 0.45)', { air: true, spine: [0, 0.8, 0.45], ra: [[0.1, -0.2, 1], [-0.4, -0.6, 0.6]], la: [[0.1, -0.2, 1], [-0.4, -0.6, 0.6]], rl: [[0.4, -0.15, 1], [0, -1, -0.2]], ll: [[0.4, -0.15, 1], [0, -1, -0.2]] }],
  ['carry_princess', 'carrying someone in both arms', { spine: [0, 1, -0.1], ra: [[0.15, -0.7, 0.6], [-0.3, 0, 1]], la: [[0.15, -0.7, 0.6], [-0.3, 0, 1]] }],
  ['carried_in_arms', 'carried in someone\'s arms, legs over one arm (place them "from" the carrier, bearing "front", distance 0.35, elevation about 0.6)', { air: true, spine: [0, 0.7, -0.7], ra: [[0.1, 0.4, 0.9], [-0.5, 0.2, 0.6]], la: [[0.1, -0.5, 0.5], [-0.3, 0, 1]], rl: [[0, 0, 1], [0, -1, 0.1]], ll: [[0, 0, 1], [0, -1, 0.1]] }],
  // fighting and action
  ['fighting_stance', 'fists up, guard raised, feet apart', { twist: -20, ra: [[0.3, -0.6, 0.5], [-0.25, 0.8, 0.5]], la: [[0.3, -0.6, 0.6], [-0.25, 0.8, 0.6]], rl: [[0.15, -1, -0.25], [0, -1, -0.1]], ll: [[0.15, -1, 0.25], [0, -1, 0]] }],
  ['block', 'both forearms crossed before the face, bracing', { ra: [[0.25, -0.3, 0.9], [-0.9, 0.9, 0.1]], la: [[0.25, -0.3, 0.9], [-0.9, 0.95, 0.15]], head: { down: 15 }, rl: [[0.15, -1, -0.2], [0, -1, -0.1]], ll: [[0.15, -1, 0.2], [0, -1, 0]] }],
  ['kick', 'a high front kick', { spine: [0, 1, -0.2], ra: [[0.8, -0.4, 0], [0.8, -0.2, 0.2]], la: [[0.8, -0.4, 0], [0.8, -0.2, 0.2]], rl: [[0, 0.3, 1], [0, 0.1, 1]] }],
  ['lunge', 'lunging forward, front knee bent, an arm thrust out', { spine: [0, 1, 0.3], ra: [[0, 0, 1], [0, 0, 1]], rl: [[0, -0.6, 0.8], [0, -1, 0]], ll: [[0, -0.6, -0.8], [0, -0.6, -0.8]] }, 'right'],
  ['throw', 'an arm drawn back to throw', { twist: -30, ra: [[0.5, 0.4, -0.6], [0, 1, 0.2]], la: [[0.2, -0.2, 0.9], [0, 0, 1]], rl: [[0, -1, -0.3], [0, -1, -0.1]], ll: [[0, -1, 0.3], [0, -1, 0]] }],
  ['sword_overhead', 'a sword (or a staff) raised over the head in both hands', { ra: [[0.15, 1, 0.2], [-0.25, 1, -0.2]], la: [[0.15, 1, 0.2], [-0.25, 1, -0.2]], rl: [[0.1, -1, -0.2], [0, -1, -0.1]], ll: [[0.1, -1, 0.2], [0, -1, 0]] }],
  ['sword_ready', 'a sword held forward in both hands, point up, on guard', { ra: [[0.15, -0.8, 0.45], [-0.4, 0.3, 0.85]], la: [[0.15, -0.8, 0.45], [-0.4, 0.3, 0.85]], rl: [[0.15, -1, -0.2], [0, -1, -0.1]], ll: [[0.15, -1, 0.25], [0, -1, 0]] }],
  ['sword_slash', 'mid-swing, a blade cut down and forward in both hands', { spine: [0, 1, 0.25], ra: [[0.1, -0.5, 0.85], [-0.2, -0.6, 0.8]], la: [[0.1, -0.5, 0.85], [-0.2, -0.6, 0.8]], rl: [[0, -0.7, -0.7], [0, -0.7, -0.7]], ll: [[0, -0.6, 0.8], [0, -1, 0]] }],
  ['cast_spell', 'both palms thrust forward, casting (a spell, a barrier)', { spine: [0, 1, 0.1], ra: [[0.1, 0, 1], [0, 0.15, 1]], la: [[0.1, 0, 1], [0, 0.15, 1]], rl: [[0.1, -1, -0.25], [0, -1, -0.1]], ll: [[0.1, -1, 0.25], [0, -1, 0]] }, 'both'],
  ['hurt_stomach', 'doubled over, clutching the stomach (hit, in pain)', { spine: [0, 0.75, 0.65], ra: [[0.1, -0.6, 0.6], [-0.8, -0.2, 0.2]], la: [[0.1, -0.6, 0.6], [-0.8, -0.15, 0.25]], rl: [[0, -1, 0.25], [0, -1, -0.15]], ll: [[0, -1, 0.25], [0, -1, -0.15]] }],
  ['stagger', 'staggering, a hand to the head, about to fall', { spine: [0.25, 1, 0.05], ra: [[0.4, 0.7, 0.4], [-0.6, 0.5, -0.1]], la: [[0.7, -0.6, 0], [0.5, -0.8, 0.1]], rl: [[0.35, -1, 0], [0, -1, 0]], ll: [[0.05, -1, 0.2], [0, -1, 0]] }],
  ['cower', 'cowering, crouched with the arms over the head', { spine: [0, 0.7, 0.7], ...CROUCH_LEGS, ra: [[0.3, 0.5, 0.6], [-0.75, 0.6, 0]], la: [[0.3, 0.5, 0.6], [-0.75, 0.6, 0.05]], head: { down: 40 } }],
  // moving
  ['sprint', 'sprinting flat out, leaning hard into it', { spine: [0, 1, 0.45], ra: [[0.1, -0.7, -0.7], [0, 0.5, -0.9]], la: [[0.1, -0.6, 0.8], [-0.1, 0.9, 0.4]], rl: [[0, -0.25, 1], [0, -1, -0.2]], ll: [[0, -0.8, -0.6], [0, -0.3, -1]] }],
  ['trudge', 'walking slowly, head down (tired, sad)', { ...WALK_LEGS, spine: [0, 1, 0.12], head: { down: 30 } }],
  ['walk_pockets', 'walking, hands in the pockets', { ...WALK_LEGS, ra: [[0.25, -1, -0.05], [-0.3, -0.9, 0.25]], la: [[0.25, -1, -0.05], [-0.3, -0.9, 0.25]] }],
  ['trip', 'tripping, pitching forward, arms flung out', { spine: [0, 0.55, 0.85], ra: [[0.25, -0.3, 1], [0, -0.5, 1]], la: [[0.25, -0.3, 1], [0, -0.5, 1]], rl: [[0, -0.7, -0.6], [0, -0.3, -1]], ll: [[0, -1, 0.2], [0, -1, 0]] }],
  ['leap', 'a flying leap forward, body stretched out (in the air: give the elevation)', { air: true, spine: [0, 0.55, 0.85], ra: [[0.1, 0.2, 1], [0, 0.2, 1]], la: [[0.3, -0.5, -0.4], [0, -0.6, -0.6]], rl: [[0, -0.4, 0.9], [0, -1, -0.3]], ll: [[0, -0.6, -0.8], [0, -0.3, -1]] }],
  ['land', 'landing from a jump, crouched, one hand on the ground', { spine: [0, 0.6, 0.8], ...CROUCH_LEGS, ra: [[0.1, -0.9, 0.4], [0, -1, 0]], la: [[0.8, 0, -0.3], [0.6, 0.2, -0.5]], head: { down: -30 } }],
  ['climb', 'climbing (a ladder, a wall): arms up, one knee raised', { ra: [[0.1, 1, 0.3], [0, 1, 0.1]], la: [[0.1, 0.8, 0.4], [0, 1, 0.1]], rl: [[0, 0, 1], [0, -1, 0]], head: { down: -30 } }],
  // sitting
  ['sit_dejected', 'sitting on a seat, slumped forward, elbows on the knees, head down', { ...SEAT_LEGS, spine: [0, 0.8, 0.6], ra: [[0.1, -0.7, 0.6], [-0.1, -0.25, 1]], la: [[0.1, -0.7, 0.6], [-0.1, -0.25, 1]], head: { down: 30 } }],
  ['sit_lean_back', 'sitting back on a seat, relaxed, hands behind the head', { ...SEAT_LEGS, spine: [0, 1, -0.25], ra: [[0.6, 0.8, -0.2], [-0.8, 0.2, -0.3]], la: [[0.6, 0.8, -0.2], [-0.8, 0.2, -0.3]] }],
  ['sit_write', 'sitting at a desk, writing, leaning over it', { ...SEAT_LEGS, spine: [0, 0.9, 0.35], ra: [[0.1, -0.7, 0.6], [-0.1, 0, 1]], la: [[0.1, -0.7, 0.6], [-0.2, 0, 1]], head: { down: 35 } }],
  ['sit_desk_asleep', 'sitting at a desk, head down on the folded arms (asleep, or hiding the face)', { ...SEAT_LEGS, spine: [0, 0.55, 0.85], ra: [[0.15, -0.35, 1], [-0.9, 0, 0.3]], la: [[0.15, -0.35, 1], [-0.9, 0, 0.35]], head: { down: 50 } }],
  ['sit_read', 'sitting, reading a book held in the lap', { ...SEAT_LEGS, ra: [[0.05, -0.85, 0.3], [-0.15, 0.1, 1]], la: [[0.05, -0.85, 0.3], [-0.15, 0.1, 1]], head: { down: 35 } }],
  ['sit_ground', 'sitting on the ground, legs out, leaning back on the hands', { spine: [0, 1, -0.3], ra: [[0.15, -0.8, -0.5], [0, -1, -0.1]], la: [[0.15, -0.8, -0.5], [0, -1, -0.1]], rl: [[0.05, -0.1, 1], [0, -0.15, 1]], ll: [[0.05, -0.1, 1], [0, -0.15, 1]] }],
  ['fallen_sitting', 'just fallen on the ground, sitting back on the hands, knees up (after a fall)', { spine: [0, 1, -0.45], head: { down: 15 }, ra: [[0.2, -0.8, -0.5], [0, -1, -0.1]], la: [[0.2, -0.8, -0.5], [0, -1, -0.1]], rl: [[0.05, 0.4, 1], [0, -1, 0.3]], ll: [[0.15, 0.1, 1], [0, -0.6, 0.8]] }],
  ['sit_hold_ankle', 'sitting on the ground holding an injured ankle, the knee drawn up', { spine: [0, 1, 0.3], head: { down: 35 }, rl: [[0.15, 0.55, 0.85], [0, -1, 0.05]], ll: [[0.1, -0.1, 1], [0, -0.1, 1]], ra: [[0.1, -0.5, 0.8], [0, -0.7, 0.7]], la: [[0, -0.6, 0.8], [-0.45, -0.55, 0.7]] }],
  ['sit_hug_knees', 'sitting on the ground hugging the knees (sad, lonely, waiting)', { spine: [0, 1, 0.2], head: { down: 20 }, rl: [[0.05, 0.6, 0.8], [0, -1, 0.1]], ll: [[0.05, 0.6, 0.8], [0, -1, 0.1]], ra: [[0.15, -0.5, 0.85], [-0.8, 0, 0.5]], la: [[0.15, -0.5, 0.85], [-0.8, 0.05, 0.5]] }],
  ['sit_cross_legged', 'sitting cross-legged on the floor, hands on the knees', { rl: [[0.7, -0.1, 0.7], [-0.8, -0.05, 0.4]], ll: [[0.7, -0.1, 0.7], [-0.8, -0.05, 0.4]], ra: [[0.2, -0.85, 0.4], [0.2, -0.5, 0.85]], la: [[0.2, -0.85, 0.4], [0.2, -0.5, 0.85]] }],
  ['seiza', 'kneeling sitting on the heels (seiza), hands on the thighs', { rl: [[0, -0.15, 1], [0, -0.12, -1]], ll: [[0, -0.15, 1], [0, -0.12, -1]], ra: [[0.1, -0.85, 0.35], [0, -0.3, 1]], la: [[0.1, -0.85, 0.35], [0, -0.3, 1]] }],
  // kneeling, on the ground
  ['kneel_both', 'kneeling upright on both knees', { ...KNEEL_BOTH }],
  ['kneel_crying', 'on both knees, the face in the hands (grief)', { ...KNEEL_BOTH, spine: [0, 0.8, 0.55], ...FACE_IN_HANDS, head: { down: 30 } }],
  ['kneel_despair', 'on both knees, bent forward, hands on the ground (defeat, despair)', { ...KNEEL_BOTH, spine: [0, 0.5, 0.9], ra: [[0.1, -0.9, 0.4], [0, -1, 0.1]], la: [[0.1, -0.9, 0.4], [0, -1, 0.1]], head: { down: 30 } }],
  ['kneel_aid', 'kneeling on one knee beside someone, reaching down to them (helping, checking an injury)', { spine: [0, 1, 0.3], head: { down: 35 }, rl: [[0, -1, 0.05], [0, -0.1, -1]], ll: [[0, -0.1, 1], [0, -1, 0]], ra: [[0.05, -0.7, 0.7], [0, -0.6, 0.8]] }, 'right'],
  ['squat_look', 'squatting down to look at something on the ground, forearms on the knees', { spine: [0, 0.8, 0.5], ...CROUCH_LEGS, ra: [[0.1, -0.6, 0.8], [0, -0.3, 1]], la: [[0.1, -0.6, 0.8], [0, -0.3, 1]], head: { down: 40 } }],
  ['crawl', 'on hands and knees, crawling', { spine: [0, 0.05, 1], ra: [[0.05, -1, 0.05], [0, -1, 0.05]], la: [[0.05, -1, 0.05], [0, -1, 0.05]], rl: [[0, -1, 0], [0, -0.05, -1]], ll: [[0, -1, 0.1], [0, -0.05, -1]], head: { down: -45 } }],
  // lying
  ['lie_side', 'lying on one side, curled up (asleep, hurt)', { orient: { roll: 90 }, head: { down: 15 }, ra: [[0.05, -0.3, 1], [0, 0, 1]], la: [[0.05, -0.3, 1], [0, 0.1, 1]], rl: [[0, -0.4, 1], [0, -1, -0.3]], ll: [[0, -0.4, 1], [0, -1, -0.3]] }],
  ['lie_face_down', 'lying face down, collapsed', { orient: { pitch: 90 }, head: { turn: 70 }, ra: [[0.4, 0.9, 0], [0.1, 1, 0]], la: [[0.6, -0.8, 0], [0.1, -1, 0]] }],
  ['lie_sprawled', 'lying on the back, arms and legs flung out (knocked down, exhausted)', { orient: { pitch: -90 }, ra: [[1, 0.15, 0], [1, 0.3, 0]], la: [[1, -0.2, 0], [1, -0.1, 0]], rl: [[0.35, -1, 0], [0.2, -1, 0]], ll: [[0.25, -1, 0], [0.1, -1, 0]] }],
  ['lie_prop_elbows', 'lying on the front propped on the elbows, chin in the hands', { orient: { pitch: 75 }, head: { down: -60 }, ra: [[0.1, -0.2, 1], [-0.3, 1, 0]], la: [[0.1, -0.2, 1], [-0.3, 1, 0]] }],
];
for (const [name, description, spec, aim] of BUILT) P.push({ name, description, aim: aim ?? null, points: build(spec) });

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
