import { describe, expect, it } from 'vitest';
import { realize, type Scene } from '../src/scene/index.ts';
import { measure, shoot } from '../src/camera/index.ts';
import { applyIntent, checkIntent, preferences, type ShotIntent } from '../src/intent/index.ts';

const street: Scene = {
  version: 1,
  place: { kind: 'street', description: 'street', width: 12 },
  time: { of_day: 'afternoon' },
  actors: [
    { id: 'a', pose: 'stand', place: { at: [0, 0] }, facing: 'b', prompt: { look: ['1girl'], outfit: [], expression: [] } },
    { id: 'b', pose: 'stand', place: { from: 'a', distance: 1.6, bearing: 'front' }, facing: 'a', prompt: { look: ['1boy'], outfit: [], expression: [] } },
  ],
  structures: [], effects: [],
  moment: { focus: 'a', intent: 'emotion' },
};

describe('insert: a shot about a part of someone (the injured foot)', () => {
  it('IS1 a detail makes an insert: the camera comes near the part, fills the frame with it, and need not show the head', () => {
    const intent: ShotIntent = { subject: 'a', convey: [{ what: 'detail', who: 'a', part: 'right_foot' }] };
    const scene = applyIntent(street, intent);
    expect(scene.moment.part).toBe('right_foot');
    const w = realize(scene);
    const shot = shoot(w, { n: 1500, refine: 8, iters: 20, k: 1, prefer: preferences(intent) }).shots[0];
    expect(shot).toBeDefined();
    expect(shot.info.part_size).toBeGreaterThan(0.25);
    expect(shot.info.face_angle).toBeUndefined();
    const v = measure(w, shot.cam);
    expect(v.things.get('a.right_foot')!.seen).toBeGreaterThan(0.6);
    // the head is not what the shot is about: it is out of frame
    expect(v.actors.get('a')!.headSeen).toBe(false);
  });

  it('IS2 a detail with an unknown part is dropped; without a detail nothing is an insert', () => {
    const { intent, notes } = checkIntent({ subject: 'a', convey: [{ what: 'detail', who: 'a', part: 'tail' }, { what: 'detail', who: 'a', part: 'left_hand' }] }, street);
    expect(intent.convey).toEqual([{ what: 'detail', who: 'a', part: 'left_hand' }]);
    expect(notes.length).toBe(1);
    expect(applyIntent(street, { subject: 'a', convey: [{ what: 'face', who: 'a' }] }).moment.part).toBeUndefined();
  });
});
