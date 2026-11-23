import { describe, expect, it } from 'vitest';
import { atBeat, realize, type Scene } from '../src/scene/index.ts';
import { checkIntent, readStoryboard } from '../src/intent/index.ts';
import { runScene } from '../src/pipeline.ts';

// a set: a classroom, a door placed beside "ken", ken talking to "yuki" who sits
const set: Scene = {
  version: 1,
  place: { kind: 'classroom', description: 'classroom', width: 8, length: 10, height: 3 },
  time: { of_day: 'sunset' },
  actors: [
    { id: 'ken', pose: 'talk', place: { at: [0, 2] }, facing: 'yuki', prompt: { look: ['1boy'], outfit: [], expression: ['smile'] } },
    { id: 'yuki', pose: 'sit', place: { from: 'ken', distance: 2, bearing: 'front' }, facing: 'ken', prompt: { look: ['1girl'], outfit: [], expression: ['sad'] } },
  ],
  structures: [{ id: 'door', kind: 'other', size: { height: 2, width: 1, depth: 0.1 }, place: { from: 'ken', distance: 2, bearing: 'behind' }, prompt: ['door'] }],
  effects: [],
  moment: { focus: 'ken', intent: 'emotion' },
};

describe('beats: one set, several instants (the panels of a strip)', () => {
  it('BT1 the people present are the beat\'s, with the scene\'s values for what it leaves out; the others are gone', () => {
    const s = atBeat(set, { what: 'she waits', actors: [{ id: 'yuki', place: { at: [0, 4] }, expression: ['head down'] }] });
    expect(s.actors.map((a) => a.id)).toEqual(['yuki']);
    expect(s.actors[0].pose).toBe('sit');
    expect(s.actors[0].prompt.expression).toEqual(['head down']);
    expect(s.actors[0].facing).toBeUndefined();
    expect(s.moment.focus).toBe('yuki');
  });

  it('BT2 the structures stay where the scene puts them, even when the one they were placed beside walks away', () => {
    const door = (sc: Scene) => realize(sc).solved.structures.get('door')!;
    const before = door(set);
    const moved = atBeat(set, { what: 'he is at the door', actors: [{ id: 'ken', place: { from: 'door', distance: 0.8, bearing: 'front' } }, { id: 'yuki' }] });
    const after = door(moved);
    expect(after.pos[0]).toBeCloseTo(before.pos[0], 6);
    expect(after.pos[2]).toBeCloseTo(before.pos[2], 6);
    expect(after.yaw).toBeCloseTo(before.yaw, 6);
    // and ken now stands by the door
    const ken = realize(moved).solved.actors.get('ken')!;
    expect(Math.hypot(ken.pos[0] - after.pos[0], ken.pos[2] - after.pos[2])).toBeLessThan(1.2);
  });

  it('BT3 a beat that cannot stand says why', () => {
    expect(() => atBeat(set, { what: 'x', actors: [] })).toThrow(/nobody/);
    expect(() => atBeat(set, { what: 'x', actors: [{ id: 'ghost' }] })).toThrow(/not one of the scene's people/);
    // yuki is placed relative to ken in the scene; without ken she needs her own place
    expect(() => atBeat(set, { what: 'x', actors: [{ id: 'yuki' }] })).toThrow(/relative to "ken", who is not present/);
  });

  it('BT4 the storyboard answer: n panels, each beat solved, each intent checked against its beat, at most 2 things', () => {
    const answer = JSON.stringify({ panels: [
      { what: 'he packs', actors: [{ id: 'ken' }, { id: 'yuki' }], intent: { subject: 'ken', convey: [{ what: 'face', who: 'ken' }] } },
      { what: 'at the door', actors: [{ id: 'ken', place: { from: 'door', distance: 0.8, bearing: 'front' }, facing: 'door' }],
        intent: { subject: 'ken', convey: [{ what: 'alone', who: 'ken' }, { what: 'face', who: 'yuki' }, { what: 'sees', who: 'ken', target: 'door' }, { what: 'face', who: 'ken' }] } },
    ] });
    const { panels, notes } = readStoryboard(answer, set, 2);
    expect(panels.length).toBe(2);
    expect(panels[1].beat!.actors.map((a) => a.id)).toEqual(['ken']);
    // yuki is not in panel 2: her face is dropped; then only 2 of the rest are kept
    expect(panels[1].intent!.convey).toEqual([{ what: 'alone', who: 'ken' }, { what: 'sees', who: 'ken', target: 'door' }]);
    expect(notes.some((n) => /panel 2.*unknown/.test(n))).toBe(true);
    expect(notes.some((n) => /more than 2/.test(n))).toBe(true);
    expect(() => readStoryboard(answer, set, 3)).toThrow(/2 panels, not 3/);
    expect(checkIntent({ subject: 'ken', convey: [] }, set).intent.subject).toBe('ken');
  });

  it('BT5 a scene file runs as one panel', async () => {
    const r = await runScene(set, { k: 1, search: { n: 300, refine: 2, iters: 4 } });
    expect(r.panels.length).toBe(1);
    expect(r.panels[0].shots.length).toBe(1);
  });

  it('BT6 indoors the room is fixed at the origin: people outside it are refused; one pressed against a tall thing is moved out', () => {
    const out = { ...set, actors: [{ ...set.actors[0], place: { at: [6, 0] as [number, number] } }, set.actors[1]] };
    expect(() => realize(out)).toThrow(/outside the room/);
    const shelf = { id: 'shelf', kind: 'other' as const, size: { height: 2, width: 2, depth: 0.5 }, place: { at: [-2, -2] as [number, number] }, prompt: ['shelf'] };
    const near = { ...set, structures: [...set.structures, shelf], actors: [{ ...set.actors[0], place: { at: [-2, -1.6] as [number, number] } }, set.actors[1]] };
    const w = realize(near);
    expect(w.solved.notes.some((n) => /ken stood against "shelf"/.test(n))).toBe(true);
    expect(w.solved.actors.get('ken')!.pos[2]).toBeCloseTo(-2 + 0.25 + 0.3, 6);
    expect(w.world.room).toEqual({ hx: 4, hz: 5, h: 3 });
  });
});
