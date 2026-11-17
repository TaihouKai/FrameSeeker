import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runScene } from '../src/pipeline.ts';
import { comfy, NotImplemented, promptOf } from '../src/generate/index.ts';
import type { Scene } from '../src/scene/index.ts';

const scene = JSON.parse(readFileSync('scenes/classroom-talk.json', 'utf8')) as Scene;

describe('pipeline: scene → camera → generate', () => {
  it('PL1 a scene file gives shots, each with maps and a prompt; the stub generator reports itself, nothing crashes', async () => {
    const r = await runScene(scene, { k: 2, search: { n: 600, refine: 5, iters: 10 }, generator: comfy });
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

  it('PL2 the generator stubs throw NotImplemented', async () => {
    await expect(comfy.generate({ maps: {} as never, prompt: promptOf(scene), width: 1, height: 1 })).rejects.toBeInstanceOf(NotImplemented);
  });

  it('PL3 the prompt puts the focus first and always keeps nsfw negative', () => {
    const p = promptOf(scene);
    expect(p.characters[0].id).toBe(scene.moment.focus);
    expect(p.negative[0]).toBe('nsfw');
  });
});
