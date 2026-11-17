import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { solve } from '../src/scene/solve.ts';
import { POSES } from '../src/scene/poses.ts';
import { cross, dot, len, norm, sub } from '../src/shared/vec.ts';
import type { Scene } from '../src/scene/types.ts';

const scene = (name: string) => JSON.parse(readFileSync(`scenes/${name}.json`, 'utf8')) as Scene;
const lineDistance = (p: number[], a: number[], b: number[]) => {
  const d = norm(sub(b as never, a as never));
  return len(cross(sub(p as never, a as never), d));
};

describe('solver', () => {
  it('SV1 places by relations: from + distance, behind + seen_from', () => {
    const s = solve(scene('beam-clash'));
    const shooter = s.actors.get('shooter')!, dodger = s.actors.get('dodger')!, tower = s.structures.get('tower')!;
    expect(len(sub(dodger.pos, shooter.pos))).toBeCloseTo(30, 5);
    // the tower is behind dodger as seen from shooter: on the ray shooter -> dodger, 80 m beyond
    expect(len(sub(tower.pos, dodger.pos))).toBeCloseTo(80, 5);
    expect(dot(norm(sub(tower.pos, dodger.pos)), norm(sub(dodger.pos, shooter.pos)))).toBeCloseTo(1, 5);
  });

  it('SV2 a grazing line passes the head at the clearance, on the side asked, and the dodge moves away from it', () => {
    const s = solve(scene('beam-clash'));
    const beam = s.lines.get('beam')!, m = s.actors.get('dodger')!;
    expect(lineDistance(m.head, beam.a, beam.b) - m.headR).toBeCloseTo(0.25, 2);
    // on dodger's left (her right is fwd x up)
    const right = [-m.fwd[2], 0, m.fwd[0]];
    const t = dot(sub(m.head, beam.a), norm(sub(beam.b, beam.a)));
    const closest = beam.a.map((x, i) => x + norm(sub(beam.b, beam.a))[i] * t);
    expect(dot(sub(closest as never, m.head), right as never)).toBeLessThan(0);
    // the beam starts at shooter's hand and runs straight on into the tower
    expect(beam.hits).toBe('tower');
    expect(m.mirrored).toBe(true);
  });

  it('SV3 the solver says when a straight line cannot reach the floor asked for, and the damage follows the hit', () => {
    const s = solve(scene('beam-clash'));
    expect(s.notes.some((n) => /floor 1, not 15/.test(n))).toBe(true);
    const melt = s.damages.get('melt')!;
    expect(melt.floors).toEqual([1, 4]);
  });

  it('SV4 every pose has 18 keypoints; unknown poses and cycles are refused', () => {
    for (const p of POSES.values()) expect(p.points).toHaveLength(18);
    const bad = scene('beam-clash');
    bad.actors[0].pose = 'moonwalk';
    expect(() => solve(bad)).toThrow(/no pose "moonwalk"/);
    const cyc = scene('beam-clash');
    cyc.actors[0].place = { from: 'dodger', distance: 5 };
    expect(() => solve(cyc)).toThrow(/cycle/);
  });

  it('SV5 standing on a structure: the figure is on the gantry top', () => {
    const s = solve(scene('reference-truss'));
    const g = s.structures.get('gantry')!, f = s.actors.get('figure')!;
    expect(f.pos[1]).toBeCloseTo(g.box.c[1] + g.box.half[1], 5);
  });
});
