import { describe, expect, it } from 'vitest';
import type { Chat, Scene } from '../src/scene/index.ts';
import { backLift, checkIntent, review, storyboard, type ShotIntent } from '../src/intent/index.ts';
import { BACK_LIFT, NEW_ANGLE, NEW_SIZE, sideOf } from '../src/camera/index.ts';
import { faceBins, faceScore, FACE_BINS } from '../src/camera/score.ts';
import { runStoryboard } from '../src/pipeline.ts';

// two people talking in a classroom, 2 m apart, facing each other
const set: Scene = {
  version: 1,
  place: { kind: 'classroom', description: 'classroom', width: 8, length: 10, height: 3 },
  time: { of_day: 'sunset' },
  actors: [
    { id: 'ken', pose: 'talk', place: { at: [0, 0] }, facing: 'yuki', prompt: { look: ['1boy'], outfit: [], expression: ['smile'] } },
    { id: 'yuki', pose: 'stand', place: { at: [0, 2] }, facing: 'ken', prompt: { look: ['1girl'], outfit: [], expression: ['sad'] } },
  ],
  structures: [], effects: [],
  moment: { focus: 'ken', intent: 'emotion' },
};
const search = { n: 1200, refine: 8, iters: 20 };
const faceAlone: ShotIntent = { subject: 'ken', convey: [{ what: 'face', who: 'ken' }, { what: 'alone', who: 'ken' }] };
const both = { actors: [{ id: 'ken' }, { id: 'yuki' }] };

describe('the storyboard checked with the camera; panels cut together', () => {
  it('CT1 two things one camera cannot serve together are a conflict (the second one is the one to drop)', () => {
    const p = review(set, [{ intent: faceAlone }], { search });
    expect(p.length).toBe(1);
    expect(p[0]).toMatchObject({ panel: 1, kind: 'conflict', drop: 1 });
    expect(p[0].text).toMatch(/face\(ken\) and alone\(ken\)|alone\(ken\) and face\(ken\)/);
    // a face alone is fine
    expect(review(set, [{ intent: { subject: 'ken', convey: [{ what: 'face', who: 'ken' }] } }], { search })).toEqual([]);
  });

  it('CT2 two panels in a row at the same instant with the same intent are a repeat', () => {
    const face: ShotIntent = { subject: 'ken', convey: [{ what: 'face', who: 'ken' }] };
    const panel = { beat: { what: 'they talk', ...both }, intent: face };
    const p = review(set, [panel, { ...panel, beat: { ...panel.beat, what: 'still talking' } }], { search });
    expect(p.map((x) => x.kind)).toEqual(['repeat']);
  });

  it('CT3 the problems go back to the model; an answer it cannot fix loses the less important thing', async () => {
    const two = (intent: ShotIntent) => JSON.stringify({ panels: [{ what: 'they talk', ...both, intent }, { what: 'she turns', actors: [{ id: 'yuki' }, { id: 'ken' }], intent: { subject: 'yuki', convey: [{ what: 'face', who: 'yuki' }] } }] });
    let calls = 0;
    const learns: Chat = async () => (++calls === 1 ? two(faceAlone) : two({ subject: 'ken', convey: [{ what: 'face', who: 'ken' }] }));
    const b = await storyboard('x', set, learns, 2, { search });
    expect(calls).toBe(2);
    expect(b.panels[0].intent!.convey).toEqual([{ what: 'face', who: 'ken' }]);
    expect(b.notes.some((x) => /answer 2 kept/.test(x))).toBe(true);
    const stubborn: Chat = async () => two(faceAlone);
    const c = await storyboard('x', set, stubborn, 2, { search });
    expect(c.panels[0].intent!.convey).toEqual([{ what: 'face', who: 'ken' }]);
    expect(c.notes.some((x) => /panel 1: dropped .*alone/.test(x))).toBe(true);
  });

  it('CT4 sides of a line: left positive, right negative, on it zero', () => {
    expect(sideOf([-1, 0, 0.5], [0, 0, 0], [0, 0, 1])).toBeCloseTo(1, 6);
    expect(sideOf([2, 5, 0.5], [0, 0, 0], [0, 0, 1])).toBeCloseTo(-2, 6);
    expect(sideOf([0, 1, 7], [0, 0, 0], [0, 0, 1])).toBeCloseTo(0, 6);
  });

  it('CT5 a strip keeps the camera on one side of the line between the two people (an insert in between changes nothing)', async () => {
    const r = await runStoryboard({ version: 1, scene: set, panels: [
      { beat: { what: 'he talks', ...both }, intent: { subject: 'ken', convey: [{ what: 'face', who: 'ken' }] } },
      { beat: { what: 'his hand', ...both }, intent: { subject: 'ken', convey: [{ what: 'detail', who: 'ken', part: 'right_hand' }] } },
      { beat: { what: 'she answers', ...both }, intent: { subject: 'yuki', convey: [{ what: 'face', who: 'yuki' }] } },
    ] }, { search });
    const pos = (i: number, id: string) => r.panels[i].world.solved.actors.get(id)!.pos;
    const side = (i: number) => Math.sign(sideOf(r.panels[i].shots[0].shot.cam.pos, pos(i, 'ken'), pos(i, 'yuki')));
    expect(side(2)).toBe(side(0));
    expect(Object.keys(r.panels[1].shots[0].shot.prefs!)).not.toContain('180°: ken–yuki as in panel 1');
    expect(r.panels[2].shots[0].shot.prefs!['180°: ken–yuki as in panel 1']).toBe(1);
  });

  it('CT6 someone who grieves or walks away is shown from behind about twice as often: the back bin rises, the rest stay', () => {
    expect(BACK_LIFT).toBeCloseTo((34 / 117) / (19 / 126), 9);
    expect(faceBins(1)).toBe(FACE_BINS);
    const lifted = faceBins(BACK_LIFT);
    expect(lifted.slice(0, -1)).toEqual(FACE_BINS.slice(0, -1));
    expect(lifted[lifted.length - 1][1]).toBeCloseTo(0.42 * Math.sqrt(BACK_LIFT * (1 - 15 / 117) / (1 - BACK_LIFT * 15 / 117)), 9);
    expect(faceScore(170, lifted)).toBeGreaterThan(faceScore(170));
    expect(faceScore(10, lifted)).toBe(1);
    // only for the shot's subject, only when the storyboard says so, and the config can turn it off
    const sad: ShotIntent = { subject: 'yuki', convey: [], withdrawn: ['yuki'] };
    expect(backLift(sad)).toBeCloseTo(BACK_LIFT, 9);
    expect(backLift(sad, { back: 0 })).toBe(1);
    expect(backLift({ ...sad, subject: 'ken' })).toBe(1);
    expect(checkIntent({ subject: 'yuki', convey: [], withdrawn: ['yuki', 'ghost'] }, set).intent.withdrawn).toEqual(['yuki']);
  });

  it('CT7 two panels in a row about the same person are not the same picture (the 30° rule)', async () => {
    const face: ShotIntent = { subject: 'ken', convey: [{ what: 'face', who: 'ken' }] };
    const r = await runStoryboard({ version: 1, scene: set, panels: [
      { beat: { what: 'he talks', ...both }, intent: face },
      { beat: { what: 'he talks on', ...both }, intent: face },
    ] }, { search });
    const [a, b] = r.panels.map((p) => p.shots[0].shot);
    const head = r.panels[0].world.solved.actors.get('ken')!.head;
    const dir = (c: number[]) => Math.atan2(c[2] - head[2], c[0] - head[0]) * 180 / Math.PI;
    const turn = Math.abs(((dir(a.cam.pos) - dir(b.cam.pos) + 540) % 360) - 180);
    const size = Math.max(a.info.subject_size, b.info.subject_size) / Math.min(a.info.subject_size, b.info.subject_size);
    expect(turn >= NEW_ANGLE - 0.5 || size >= NEW_SIZE - 0.01).toBe(true);
    expect(b.prefs!['30°: a new shot of ken after panel 1']).toBeGreaterThan(0.99);
  });
});
