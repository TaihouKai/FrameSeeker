import { describe, expect, it } from 'vitest';
import { rebuild, REF_H, REF_W, type RefFrame } from '../src/eval/refs.ts';
import { solve } from '../src/scene/solve.ts';
import { frame, project, type Cam } from '../src/camera/camera.ts';
import { KP } from '../src/scene/poses.ts';
import { ACTION_SCALES, faceScore, shotScaleScore } from '../src/camera/score.ts';
import type { Scene } from '../src/scene/types.ts';

describe('reference rebuild (single-view metrology)', () => {
  it('RF1 annotations made from a known camera give that camera and those positions back', () => {
    const truth: Cam = { pos: [0, 1.3, 0], target: [0, 1.3 - Math.tan(0.12), 1], roll: 0, focal: 35, aspect: 'wide' };
    const scene: Scene = {
      version: 1, place: { kind: 'other', description: '' }, time: { of_day: 'afternoon' }, structures: [], effects: [],
      actors: [
        { id: 'a', pose: 'stand', height: 1.6, place: { at: [-1, 6] }, facing: 180, prompt: { look: [], outfit: [], expression: [] } },
        { id: 'b', pose: 'stand', height: 1.6, place: { at: [1.5, 9] }, facing: 90, prompt: { look: [], outfit: [], expression: [] } },
      ],
      moment: { focus: 'a', intent: 'emotion' },
    };
    const s = solve(scene), f = frame(truth);
    const px = (p: [number, number, number]): [number, number] => { const q = project(f, p)!; return [q.u * REF_W, q.v * REF_H]; };
    const ann = (id: string) => {
      const a = s.actors.get(id)!;
      const feet = [(a.points[KP.rAnkle][0] + a.points[KP.lAnkle][0]) / 2, 0, (a.points[KP.rAnkle][2] + a.points[KP.lAnkle][2]) / 2] as [number, number, number];
      return { crown: px([a.head[0], a.head[1] + a.headR, a.head[2]]), feet: px(feet) };
    };
    // the horizon: where level rays land
    const yh = px([0, 1.3, 1e6])[1];
    const r: RefFrame = {
      id: 't#1', intent: 'emotion', focus: 'a', horizon: [yh, yh],
      people: [{ id: 'a', pose: 'stand', face: 0, ...ann('a') }, { id: 'b', pose: 'stand', face: -90, ...ann('b') }],
    };
    const b = rebuild(r);
    expect(b.cam.pos[1]).toBeCloseTo(1.3, 1);
    const at = (id: string) => (b.scene.actors.find((x) => x.id === id)!.place as { at: [number, number] }).at;
    expect(at('a')[0]).toBeCloseTo(-1, 0);
    expect(at('a')[1]).toBeCloseTo(6, 0);
    expect(at('b')[1]).toBeCloseTo(9, 0);
  });

  it('RF2 shot scale follows Cutting 2015: the medium shot most, then MLS, MCU, LS; extremes least', () => {
    const at = (n: string) => shotScaleScore({ XLS: 0.45, LS: 0.92, MLS: 1.33, MS: 2.15, MCU: 3.8, CU: 6.7, XCU: 12 }[n]!);
    expect(at('MS')).toBeCloseTo(1, 6);
    expect(at('MLS')).toBeGreaterThan(at('MCU'));
    expect(at('MCU')).toBeGreaterThan(at('LS'));
    expect(at('LS')).toBeGreaterThan(at('XLS'));
    expect(at('CU')).toBeGreaterThan(at('XCU'));
    expect(shotScaleScore(0.01)).toBe(0);
  });

  it('RF4 action shots: the extreme long shot about as good as the medium shot; other intents keep the medium shot', () => {
    const xls = shotScaleScore(0.45, ACTION_SCALES), ms = shotScaleScore(2.15, ACTION_SCALES);
    expect(Math.max(xls, ms)).toBeCloseTo(1, 6);
    expect(Math.abs(xls - ms)).toBeLessThan(0.1);
    expect(shotScaleScore(0.45)).toBeLessThan(0.3);
    expect(shotScaleScore(2.15)).toBeCloseTo(1, 6);
  });

  it('RF3 face angle: the front preferred, three-quarter less, a back still a choice (never zero)', () => {
    expect(faceScore(0)).toBe(1);
    expect(faceScore(30)).toBe(1);
    expect(faceScore(80)).toBeCloseTo(0.44, 6);
    expect(faceScore(180)).toBeCloseTo(0.22, 6);
    for (let a = 0; a < 180; a += 5) expect(faceScore(a + 5)).toBeLessThanOrEqual(faceScore(a));
  });
});
