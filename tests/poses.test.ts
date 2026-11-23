import { describe, expect, it } from 'vitest';
import { POSES } from '../src/scene/poses.ts';
import { KP } from '../src/shared/skeleton.ts';

const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const stand = POSES.get('stand')!.points;
const BONES: [number, number][] = [[KP.rShoulder, KP.rElbow], [KP.rElbow, KP.rWrist], [KP.lShoulder, KP.lElbow], [KP.lElbow, KP.lWrist], [KP.rHip, KP.rKnee], [KP.rKnee, KP.rAnkle], [KP.lHip, KP.lKnee], [KP.lKnee, KP.lAnkle]];
const AIR = new Set(['run', 'jump', 'float', 'leap', 'ride_piggyback', 'carried_in_arms']);

describe('the pose library', () => {
  it('PS1 a large library: every pose has 18 finite keypoints, a name and a description', () => {
    expect(POSES.size).toBeGreaterThanOrEqual(100);
    for (const p of POSES.values()) {
      expect(p.points).toHaveLength(18);
      for (const q of p.points) for (const v of q) expect(Number.isFinite(v)).toBe(true);
      expect(p.description.length).toBeGreaterThan(5);
    }
  });

  it('PS2 everyone not in the air touches the ground, and nothing is under it', () => {
    for (const p of POSES.values()) {
      const low = Math.min(...p.points.map((q) => q[1]));
      expect(low, p.name).toBeGreaterThanOrEqual(0.015);
      if (!AIR.has(p.name)) expect(low, p.name).toBeLessThan(0.1);
    }
  });

  it('PS3 poses built from joint directions keep the body\'s bone lengths', () => {
    const built = [...POSES.values()].slice(20);
    for (const p of built) for (const [a, b] of BONES) expect(d(p.points[a], p.points[b]), `${p.name} ${a}-${b}`).toBeCloseTo(d(stand[a], stand[b]), 1);
  });
});
