import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runScene } from '../src/pipeline.ts';
import { countTags, novelai, NotImplemented, promptOf, viewTags } from '../src/generate/index.ts';
import { realize, type Scene } from '../src/scene/index.ts';
import { maps, shoot } from '../src/camera/index.ts';
import { cast, rayPrim } from '../src/shared/geom.ts';

const scene = JSON.parse(readFileSync('scenes/classroom-talk.json', 'utf8')) as Scene;

describe('pipeline: scene → camera → generate', () => {
  it('PL1 a scene file gives shots, each with maps and a prompt; the stub generator reports itself, nothing crashes', async () => {
    const r = await runScene(scene, { k: 2, search: { n: 600, refine: 5, iters: 10 }, generator: novelai });
    expect(r.shots.length).toBeGreaterThan(0);
    for (const s of r.shots) {
      expect(s.shot.total).toBeGreaterThan(0);
      expect(s.maps.preview.pixels.length).toBe(s.maps.preview.width * s.maps.preview.height * 3);
      expect(s.maps.depth.channels).toBe(1);
      expect(s.prompt.negative).toContain('nsfw');
      expect(s.image).toBeNull();
      expect(s.note).toMatch(/not implemented/);
    }
  });

  it('PL2 the NovelAI stub throws NotImplemented', async () => {
    await expect(novelai.generate({ maps: {} as never, prompt: promptOf(scene), width: 1, height: 1 })).rejects.toBeInstanceOf(NotImplemented);
  });

  it('PL4 head count from each person\'s own tag, none when one is unknown; view tags by face angle', () => {
    expect(countTags([['1girl', 'x'], ['1boy']])).toEqual(['1girl', '1boy']);
    expect(countTags([['1girl'], ['1girl'], ['1boy']])).toEqual(['2girls', '1boy']);
    expect(countTags([['1girl'], ['long hair']])).toEqual([]);
    expect(viewTags(170)).toContain('from behind');
    expect(viewTags(10)).toEqual(['facing viewer']);
    expect(viewTags(undefined)).toEqual([]);
  });

  it('PL5 a person seen from behind has no expression; effects are their own prompts', () => {
    const p = promptOf(scene, undefined, [{ id: 'b', faceAngle: 170 }]);
    const b = p.characters.find((c) => c.id === 'b')!;
    expect(b.tags).toContain('from behind');
    expect(b.tags).not.toContain('doubtful');
    const beam = JSON.parse(readFileSync('scenes/beam-clash.json', 'utf8')) as Scene;
    const q = promptOf(beam);
    expect(q.effects.map((e) => e.id)).toEqual(['beam', 'melt']);
    expect(q.scene).not.toContain('white beam');
  });

  it('PL6 a colour hint only for shots with an effect in frame', () => {
    const quiet = realize(scene), beam = realize(JSON.parse(readFileSync('scenes/beam-clash.json', 'utf8')) as Scene);
    const s1 = shoot(quiet, { n: 300, refine: 2, iters: 4, k: 1 }).shots[0], s2 = shoot(beam, { n: 600, refine: 3, iters: 6, k: 1 }).shots[0];
    expect(maps(quiet, s1.cam, { scale: 0.25 }).hint).toBeNull();
    const m = maps(beam, s2.cam, { scale: 0.25 });
    expect(m.regions.some((r) => r.kind !== 'person')).toBe(true);
    expect(m.hint).not.toBeNull();
  });

  it('PL7 indoors the set\'s parts are regions of their own, named from their labels and not from the description', () => {
    const room = { ...scene, place: { ...scene.place, kind: 'classroom' as const } };
    const w = realize(room), s = shoot(w, { n: 600, refine: 3, iters: 6, k: 1 }).shots[0], m = maps(w, s.cam, { scale: 0.25 });
    const env = m.regions.filter((r) => r.kind === 'environment').map((r) => r.id);
    expect(env.length).toBeGreaterThan(0);
    expect(env.every((id) => /^env-(wall|ceiling|floor|desk|window|blackboard)$/.test(id))).toBe(true);
    const p = promptOf(room, s, m.people, env);
    expect(p.environment.map((e) => e.id)).toEqual(env);
    // the description ("…evening light through the windows") stays out of the walls
    for (const e of p.environment) expect(e.tags.join(' ')).not.toContain(room.place.description.split(',')[0]);
    expect(p.environment.find((e) => e.id === 'env-wall')?.tags ?? ['wall']).not.toContain('window');
  });

  it('PL8 glass: rays pass it, a person inside stands; a cylinder has flat ends; its region and depth show it', () => {
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

  it('PL3 the prompt puts the focus first and always keeps nsfw negative', () => {
    const p = promptOf(scene);
    expect(p.characters[0].id).toBe(scene.moment.focus);
    expect(p.negative[0]).toBe('nsfw');
  });
});
