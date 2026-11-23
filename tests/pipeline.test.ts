import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runScene } from '../src/pipeline.ts';
import { GeneratorUnavailable, type GenerateInput, type Generator } from '../src/generate/index.ts';
import { realize, type Scene } from '../src/scene/index.ts';
import { maps, shoot } from '../src/camera/index.ts';
import { cast, rayPrim } from '../src/shared/geom.ts';

const scene = JSON.parse(readFileSync('scenes/classroom-talk.json', 'utf8')) as Scene;

describe('pipeline: scene → camera → generate', () => {
  it('PL1 a scene file gives shots with their maps; an unavailable renderer is noted, nothing crashes', async () => {
    const off: Generator = { name: 'off', generate: async () => { throw new GeneratorUnavailable('off: not configured'); } };
    const r = await runScene(scene, { k: 2, search: { n: 600, refine: 5, iters: 10 }, generator: off });
    expect(r.panels[0].shots.length).toBeGreaterThan(0);
    for (const s of r.panels[0].shots) {
      expect(s.shot.total).toBeGreaterThan(0);
      expect(s.maps.preview.pixels.length).toBe(s.maps.preview.width * s.maps.preview.height * 3);
      expect(s.maps.depth.channels).toBe(1);
      expect(s.image).toBeNull();
      expect(s.note).toMatch(/not configured/);
    }
  });

  it('PL2 a renderer gets the scene, the shot and its maps (it makes its own prompt)', async () => {
    let got: GenerateInput | undefined;
    const spy: Generator = { name: 'spy', generate: async (input) => { got = input; return { image: input.maps.depth, meta: { seen: true } }; } };
    const r = await runScene(scene, { k: 1, search: { n: 300, refine: 2, iters: 4 }, generator: spy });
    expect(got!.scene).toBe(scene);
    expect(got!.maps.people.map((p) => p.id).sort()).toEqual(scene.actors.map((a) => a.id).sort());
    expect(got!.width).toBeGreaterThan(got!.height * 0.5);
    expect(r.panels[0].shots[0].image).not.toBeNull();
    expect(r.panels[0].shots[0].meta).toEqual({ seen: true });
  });

  it('PL6 a colour hint only for shots with an effect in frame', () => {
    const quiet = realize(scene), beam = realize(JSON.parse(readFileSync('scenes/beam-clash.json', 'utf8')) as Scene);
    const s1 = shoot(quiet, { n: 300, refine: 2, iters: 4, k: 1 }).shots[0], s2 = shoot(beam, { n: 600, refine: 3, iters: 6, k: 1 }).shots[0];
    expect(maps(quiet, s1.cam, { scale: 0.25 }).hint).toBeNull();
    const m = maps(beam, s2.cam, { scale: 0.25 });
    expect(m.regions.some((r) => r.kind === 'line' || r.kind === 'volume' || r.kind === 'damage')).toBe(true);
    expect(m.hint).not.toBeNull();
  });

  it('PL7 indoors the set\'s parts are regions of their own, named by their labels', () => {
    const room = { ...scene, place: { ...scene.place, kind: 'classroom' as const } };
    const w = realize(room), s = shoot(w, { n: 600, refine: 3, iters: 6, k: 1 }).shots[0], m = maps(w, s.cam, { scale: 0.25 });
    const env = m.regions.filter((r) => r.kind === 'environment').map((r) => r.id);
    expect(env.length).toBeGreaterThan(0);
    expect(env.every((id) => /^env-(wall|ceiling|floor|desk|window|blackboard)$/.test(id))).toBe(true);
  });

  it('PL8 glass: rays pass it, a person inside stands; a cylinder has flat ends; its region shows it', () => {
    const lab = JSON.parse(readFileSync('scenes/lab-tanks.json', 'utf8')) as Scene;
    const w = realize(lab);
    const tank = w.world.prims.find((p) => p.owner === 'tank2')!;
    expect(tank.glass).toBe(true);
    expect(tank.kind === 'capsule' && tank.flat).toBe(true);
    // straight down onto the top of a 2.6 m tank: the flat end at 2.6 m (a round cap would be higher at the centre)
    const c = tank.kind === 'capsule' ? tank.b : [0, 0, 0] as const;
    const h = rayPrim([c[0], 5, c[2]], [0, -1, 0], tank);
    expect(h!.t).toBeCloseTo(5 - 2.6, 3);
    // rays pass glass
    expect(cast({ groundY: -1e9, prims: [tank] }, [c[0], 5, c[2]], [0, -1, 0], 10)).toBeNull();
    // a person in a glass capsule is allowed (the solver refuses one inside a solid thing)
    const ward = JSON.parse(readFileSync('scenes/ward-pods.json', 'utf8')) as Scene;
    expect(() => realize(ward)).not.toThrow();
    const s = shoot(w, { n: 600, refine: 3, iters: 6, k: 1 }).shots[0], m = maps(w, s.cam, { scale: 0.25 });
    expect(m.regions.some((r) => r.kind === 'structure' && r.glass)).toBe(true);
  });
});
