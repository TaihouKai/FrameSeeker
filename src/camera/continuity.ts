// Continuity between shots: the 180° rule. Two people facing each other define a line; while the camera stays on one
// side of it, the first stays on the left of the screen and the second on the right from shot to shot, and their
// looks meet. A camera that crosses it swaps them on the screen and the cut reads as a jump (Arijon, Grammar of the
// Film Language, ch. 2: the line of interest; Katz, Film Directing Shot by Shot: the 180° rule). On the line itself
// (a camera looking along it) either side may follow: films use that to cross it.
import type { V3 } from '../shared/vec.ts';
import type { Preference, View } from './view.ts';

/** A camera this close to the line counts as on it (metres). */
export const ON_LINE = 0.3;

/**
 * Where a point stands against the line from a to b, on the ground: its distance from the line in metres, positive
 * on the left of a → b (seen from above, x across, z along), negative on the right.
 */
export function sideOf(p: V3, a: V3, b: V3): number {
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  return (dx * (p[2] - a[2]) - dz * (p[0] - a[0])) / len;
}

/** A gate for cameras on one side of the line a → b (side +1 or −1): 1 there or on the line, 0 half a metre across. */
export function keepSide(a: V3, b: V3, side: number, name: string): Preference {
  return { name, weight: 0, gate: true, score: (v: View) => Math.max(0, Math.min(1, (side * sideOf(v.cam.pos, a, b) + 0.5) / 0.5)) };
}

/** Cutting to the same person, the camera turns at least this far around them (degrees)... */
export const NEW_ANGLE = 30;
/** ...or their size in the frame changes at least this many times. */
export const NEW_SIZE = 1.5;

/**
 * The 30° rule (Katz, Film Directing Shot by Shot; Arijon): two shots in a row of the same person must differ, the
 * camera turned at least 30° around them or the shot size changed by about one step (Cutting's scales are about ×1.5
 * apart), or the cut reads as a jump. A gate: before, the camera's direction from the person (from `at`, where they
 * stood) and their size (person height over frame height) in the shot before; now, where they stand.
 */
export function newShot(who: string, now: V3, before: { at: V3; cam: V3; scale: number }, name: string): Preference {
  const flat = (p: V3, o: V3) => { const x = p[0] - o[0], z = p[2] - o[2], l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  const d0 = flat(before.cam, before.at);
  const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  return {
    name, weight: 0, gate: true,
    score: (v: View) => {
      const a = v.actors.get(who);
      if (!a || before.scale <= 0) return 1;
      const d1 = flat(v.cam.pos, now);
      const angle = Math.acos(Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1]))) * 180 / Math.PI;
      const size = Math.abs(Math.log(Math.max(1e-3, a.scale) / before.scale));
      return Math.max(ramp(angle, NEW_ANGLE - 10, NEW_ANGLE), ramp(size, Math.log(1.3), Math.log(NEW_SIZE)));
    },
  };
}
