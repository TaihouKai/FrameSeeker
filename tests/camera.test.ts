import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { frame, project, ray } from '../src/camera/camera.ts';
import { solve } from '../src/scene/solve.ts';
import { dress } from '../src/scene/dress.ts';
import { context, evaluate } from '../src/camera/score.ts';
import { search } from '../src/camera/search.ts';
import { add, mul, sub, type V3 } from '../src/shared/vec.ts';
import type { Scene } from '../src/scene/types.ts';

const load = (name: string) => {
  const s = solve(JSON.parse(readFileSync(`scenes/${name}.json`, 'utf8')) as Scene);
  const w = dress(s);
  return { s, w, ctx: context(s, w) };
};

describe('camera', () => {
  it('CM1 projection and rays agree; the target is the centre of the frame', () => {
    const f = frame({ pos: [1, 2, 3], target: [4, 3, 20], roll: 0.1, focal: 35, aspect: 'portrait' });
    const c = project(f, [4, 3, 20])!;
    expect(c.u).toBeCloseTo(0.5, 6); expect(c.v).toBeCloseTo(0.5, 6);
    const d = ray(f, 0.2, 0.9);
    const p = project(f, add([1, 2, 3], mul(d, 17)))!;
    expect(p.u).toBeCloseTo(0.2, 6); expect(p.v).toBeCloseTo(0.9, 6);
  });
});

describe('composition search (calibration)', () => {
  it('CS1 reference anime frame rebuilt as a gray box: a found shot is the reference one — low, looking up, the bolt across the frame', () => {
    const { ctx } = load('reference-truss');
    const r = search(ctx, { seed: 1, k: 5 });
    const like = r.candidates.filter((c) => c.ev.info.camera_height < 3 && c.ev.info.pitch > 12 && c.ev.info.pitch < 45 && c.ev.info.line_angle > 20 && c.ev.info.line_angle < 60);
    expect(like.length).toBeGreaterThan(0);
  });

  it('CS2 the failed compositions of the image-model experiments lose: looking down the beam is refused; a bland eye-level centred shot from the same place scores clearly lower', () => {
    const { s, ctx } = load('beam-clash');
    const beam = s.lines.get('beam')!;
    // 06/07: the beam running away from the lens
    const behind = sub(beam.a, mul(sub(beam.b, beam.a), 0.05));
    const down = evaluate(ctx, { pos: [behind[0], 1.8, behind[2]], target: beam.b, roll: 0, focal: 35, aspect: 'portrait' });
    expect(down.ok).toBe(false);
    // bland: the best shot's place at eye level, looking straight at the focus, 50 mm
    const best = search(ctx, { seed: 1, k: 1 }).candidates[0];
    const m = s.actors.get('dodger')!;
    const bland = evaluate(ctx, { pos: [best.cam.pos[0], 1.6, best.cam.pos[2]] as V3, target: m.head, roll: 0, focal: 50, aspect: 'landscape' });
    expect(bland.ok ? bland.total : 0).toBeLessThan(best.ev.total * 0.85);
  });

  it('CS3 every candidate keeps the hard rules, and the search is deterministic', () => {
    for (const name of ['beam-clash', 'reference-truss', 'classroom-talk', 'rooftop-strike', 'street-lookback']) {
      const { ctx } = load(name);
      const a = search(ctx, { seed: 7, k: 3, n: 1500 }), b = search(ctx, { seed: 7, k: 3, n: 1500 });
      expect(a.candidates.length).toBeGreaterThan(0);
      for (const c of a.candidates) expect(c.ev.ok).toBe(true);
      expect(a.candidates.map((c) => c.cam)).toEqual(b.candidates.map((c) => c.cam));
    }
  });
});
