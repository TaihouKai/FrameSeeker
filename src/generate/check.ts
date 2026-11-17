// Did the picture follow the plan? A measurement, not a judgement of the picture: a pose detector (DWPose, run on the
// image server) finds the people in the generated image; this compares them with the people the camera module
// planned — who is found, how far their joints are from where they should be, and which way they face. Geometry
// only; the detector is an instrument (coordinates out), no model decides anything here.

/** OpenPose body-18 joints, [u, v] in 0..1 of the frame, null where not seen. */
export type Joints = ([number, number] | null)[];
export interface PlannedPose { id: string; faceAngle: number; joints: Joints }

export interface PersonCheck {
  id: string;
  found: boolean;
  /** mean distance of the joints both have, as a fraction of the frame's diagonal */
  error?: number;
  facing?: 'ok' | 'flipped' | 'unknown';
}
export interface PoseCheck {
  /** (people found facing the right way − extra people) / people judged, at least 0; 1 = all as planned */
  score: number;
  /** planned people judged: those with enough joints in frame for a detector to find */
  judged: number;
  people: PersonCheck[];
  /** detected people that match no planned one (a person drawn where none was planned) */
  extra: number;
  /** mean joint error of the people found */
  error: number;
}

const R_SHOULDER = 2, L_SHOULDER = 5;
/** a detected person farther than this from a planned one (mean joint distance / diagonal) is someone else */
export const MAX_ERROR = 0.15;
/** fewer planned joints in frame than this, and a detector cannot be expected to find the person */
export const MIN_JOINTS = 4;
/** a detection with fewer joints than this is not counted as an extra person (a stray hand, a poster) */
const EXTRA_JOINTS = 6;

/**
 * Facing from the shoulders' order: a person facing the camera has their right shoulder on the image's left.
 * (Detectors are trained with left and right marked on backs too: COCO.) Profiles cannot be told.
 */
function facingOf(j: Joints): 'front' | 'back' | null {
  const r = j[R_SHOULDER], l = j[L_SHOULDER];
  if (!r || !l || Math.abs(l[0] - r[0]) < 0.01) return null;
  return r[0] < l[0] ? 'front' : 'back';
}
const plannedFacing = (angle: number): 'front' | 'back' | null => angle < 60 ? 'front' : angle > 120 ? 'back' : null;

/** aspect: frame width / height (distances are measured in the frame, not in 0..1 of each side) */
export function checkPose(planned: PlannedPose[], detected: Joints[], aspect: number): PoseCheck {
  const diag = Math.hypot(aspect, 1);
  const dist = (a: Joints, b: Joints): number => {
    const ds: number[] = [];
    a.forEach((p, k) => { const q = b[k]; if (p && q) ds.push(Math.hypot((p[0] - q[0]) * aspect, p[1] - q[1]) / diag); });
    return ds.length >= 2 ? ds.reduce((x, y) => x + y, 0) / ds.length : Infinity;
  };
  const judgedPeople = planned.filter((p) => p.joints.filter(Boolean).length >= MIN_JOINTS);
  // one-to-one: as many matches within MAX_ERROR as possible, then the least total error (few people: exhaustive)
  let best = { n: -1, err: Infinity, pick: [] as number[] };
  const pick: number[] = [];
  const walk = (i: number, used: Set<number>, n: number, err: number) => {
    if (i === judgedPeople.length) { if (n > best.n || (n === best.n && err < best.err)) best = { n, err, pick: [...pick] }; return; }
    pick[i] = -1; walk(i + 1, used, n, err);
    detected.forEach((d, j) => {
      if (used.has(j)) return;
      const e = dist(judgedPeople[i].joints, d);
      if (e > MAX_ERROR) return;
      pick[i] = j; used.add(j); walk(i + 1, used, n + 1, err + e); used.delete(j);
    });
    pick[i] = -1;
  };
  walk(0, new Set(), 0, 0);

  const people: PersonCheck[] = judgedPeople.map((p, i) => {
    const j = best.pick[i];
    if (j === undefined || j < 0) return { id: p.id, found: false };
    const want = plannedFacing(p.faceAngle), got = facingOf(detected[j]);
    return { id: p.id, found: true, error: dist(p.joints, detected[j]), facing: !want || !got ? 'unknown' : want === got ? 'ok' : 'flipped' };
  });
  const matched = new Set(best.pick.filter((j) => j >= 0));
  const extra = detected.filter((d, j) => !matched.has(j) && d.filter(Boolean).length >= EXTRA_JOINTS).length;
  const ok = people.filter((p) => p.found && p.facing !== 'flipped').length;
  const found = people.filter((p) => p.found);
  return {
    score: judgedPeople.length ? Math.max(0, (ok - extra) / judgedPeople.length) : 1,
    judged: judgedPeople.length, people, extra,
    error: found.length ? found.reduce((s, p) => s + p.error!, 0) / found.length : 0,
  };
}

/** The best of several candidates: the highest score, then the smallest error, then the first. */
export function bestCandidate(checks: PoseCheck[]): number {
  let b = 0;
  checks.forEach((c, i) => { if (c.score > checks[b].score || (c.score === checks[b].score && c.error < checks[b].error)) b = i; });
  return b;
}
