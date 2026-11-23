// Body parts a shot can be about (an insert: the injured foot, the hand that holds the letter, the eyes), as points on
// the posed body. The body-18 skeleton ends at the wrists and ankles; a hand and a foot are reckoned from there with
// rough proportions (a hand about a tenth of the height, a foot about 0.15 of it, pointing where the body faces).
import { add, lerp, mul, norm, sub, type V3 } from '../shared/vec.ts';
import { KP } from '../shared/skeleton.ts';

export const BODY_PARTS = ['eyes', 'chest', 'right_hand', 'left_hand', 'hands', 'right_foot', 'left_foot', 'feet'] as const;
export type BodyPart = typeof BODY_PARTS[number];

/** A posed body as the parts need it: its body-18 points, which way it faces, its height. */
export interface Body { points: V3[]; fwd: V3; height: number }

/** A hand: wrist, palm centre, finger tips (along the forearm). */
export function hand(b: Body, side: 'right' | 'left'): V3[] {
  const [el, wr] = side === 'right' ? [KP.rElbow, KP.rWrist] : [KP.lElbow, KP.lWrist];
  const d = norm(sub(b.points[wr], b.points[el]));
  return [b.points[wr], add(b.points[wr], mul(d, 0.05 * b.height)), add(b.points[wr], mul(d, 0.1 * b.height))];
}
/** A foot: heel, ankle, toes (forward, where the body faces, at the ankle's height). */
export function foot(b: Body, side: 'right' | 'left'): V3[] {
  const a = b.points[side === 'right' ? KP.rAnkle : KP.lAnkle];
  return [add(a, mul(b.fwd, -0.03 * b.height)), a, add(a, mul(b.fwd, 0.12 * b.height))];
}

/** The points that stand for a part (for whether it is in frame and seen, and how big it is on the screen). */
export function partPoints(b: Body, part: BodyPart): V3[] {
  const p = b.points;
  switch (part) {
    case 'eyes': return [p[KP.rEye], p[KP.lEye], p[KP.nose]];
    case 'chest': return [p[KP.neck], p[KP.rShoulder], p[KP.lShoulder], lerp(p[KP.neck], lerp(p[KP.rHip], p[KP.lHip], 0.5), 0.4)];
    case 'right_hand': return hand(b, 'right');
    case 'left_hand': return hand(b, 'left');
    case 'hands': return [...hand(b, 'right'), ...hand(b, 'left')];
    case 'right_foot': return foot(b, 'right');
    case 'left_foot': return foot(b, 'left');
    case 'feet': return [...foot(b, 'right'), ...foot(b, 'left')];
  }
}
