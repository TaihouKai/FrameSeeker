import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { realize, type Scene } from '../src/scene/index.ts';
import { measure, shoot } from '../src/camera/index.ts';
import { applyIntent, checkIntent, needs, preferences, type ShotIntent } from '../src/intent/index.ts';

const load = (name: string) => JSON.parse(readFileSync(`scenes/${name}.json`, 'utf8')) as Scene;
const best = (scene: Scene, intent?: ShotIntent) => {
  const s = intent ? applyIntent(scene, intent) : scene, w = realize(s);
  const shot = shoot(w, { n: 1500, refine: 8, iters: 20, k: 1, ...(intent ? { prefer: preferences(intent) } : {}) }).shots[0];
  return { w, shot, view: measure(w, shot.cam) };
};

describe('intent: what a shot is for, as preferences on the camera search', () => {
  const classroom = load('classroom-talk');

  it('IN1 power puts the camera below their eyes, looking up; vulnerable puts it above, looking down', () => {
    const p = best(classroom, { subject: 'a', convey: [{ what: 'power', who: 'a', over: 'b' }] });
    expect(p.view.actors.get('a')!.above).toBeLessThan(0);
    expect(p.view.pitchDeg).toBeGreaterThan(0);
    const v = best(classroom, { subject: 'b', convey: [{ what: 'vulnerable', who: 'b' }] });
    expect(v.view.actors.get('b')!.above).toBeGreaterThan(0.3);
    expect(v.view.pitchDeg).toBeLessThan(-5);
  });

  it('IN2 "sees" frames the one who looks with what they look at; "face" turns the camera to the face', () => {
    const lab = load('lab-tanks');
    const s = best(lab, { subject: 'researcher', convey: [{ what: 'sees', who: 'researcher', target: 'tank2' }] });
    expect(s.view.actors.get('researcher')!.headSeen).toBe(true);
    expect(s.view.things.get('tank2')!.seen).toBeGreaterThan(0.1);
    const f = best(lab, { subject: 'researcher', convey: [{ what: 'face', who: 'researcher' }] });
    expect(f.view.actors.get('researcher')!.faceAngle).toBeLessThan(60);
  });

  it('IN3 the intent decides what must be in frame (the moment\'s must_show no longer forbids a reaction shot)', () => {
    const lab = load('lab-tanks');
    expect(lab.moment.must_show).toContain('tank2');
    const face: ShotIntent = { subject: 'researcher', convey: [{ what: 'face', who: 'researcher' }] };
    expect(applyIntent(lab, face).moment.must_show).toEqual([]);
    expect(needs({ subject: 'a', convey: [{ what: 'sees', who: 'a', target: 'b' }, { what: 'scale', who: 'a', against: 't' }] }).sort()).toEqual(['a', 'b', 't']);
    const beam = load('beam-clash');
    const reaction = applyIntent(beam, { subject: 'dodger', convey: [{ what: 'face', who: 'dodger' }] });
    expect(reaction.moment.payoff).toBeUndefined();
    expect(reaction.moment.action_line).toBeUndefined();
  });

  it('IN4 an LLM\'s answer is checked against the scene: unknown ids and kinds are dropped with a note', () => {
    const { intent, notes } = checkIntent({ subject: 'nobody', convey: [{ what: 'face', who: 'a' }, { what: 'sees', who: 'a', target: 'ghost' }, { what: 'dance', who: 'b' }, { what: 'power', who: 'b', over: null }] }, classroom);
    expect(intent.subject).toBe(classroom.moment.focus);
    expect(intent.convey).toEqual([{ what: 'face', who: 'a' }, { what: 'power', who: 'b' }]);
    expect(notes.length).toBe(3);
  });

  it('IN5 without an intent the search is unchanged', () => {
    const a = shoot(realize(classroom), { n: 800, refine: 4, iters: 10, k: 1 }).shots[0];
    const b = shoot(realize(classroom), { n: 800, refine: 4, iters: 10, k: 1, prefer: [] }).shots[0];
    expect(b.total).toBe(a.total);
    expect(b.cam).toEqual(a.cam);
  });
});
