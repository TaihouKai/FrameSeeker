// Who points the eye at whom. A viewer looks where the people in the picture look, point, aim or move, so the person
// the others point at is often the one to watch, and is often neither the biggest nor the most central (in the
// annotated reference shots, people pointed at by 0, 1 and 2+ others got 1.7, 2.0 and 2.7 of 4 attention votes;
// DESIGN.md §15). Read from the scene's facts only: looks_at (else the id they face: the solver's gaze), aim (a
// pointing, firing or punching pose), and line effects (a beam, a throw, a slash) from one person to another. Moving
// toward someone is a locomotion pose facing them, so it is the facing. Speaking is not pointing: the one watched is
// the speaker, not whom they speak to.
import { isLine, type Scene } from './types.ts';

export type PointHow = 'looks' | 'faces' | 'aims' | 'effect';
export interface Pointer { from: string; to: string; how: PointHow }

const owner = (ref: string) => ref.split('.')[0];
/** how many people must point at someone else before the focus is questioned */
export const MIN_POINTERS = 2;

/** Every person-to-person pointing fact in the scene. */
export function pointers(scene: Scene): Pointer[] {
  const people = new Set(scene.actors.map((a) => a.id));
  const out: Pointer[] = [];
  const add = (from: string, to: string, how: PointHow) => {
    if (people.has(from) && people.has(to) && from !== to) out.push({ from, to, how });
  };
  for (const a of scene.actors) {
    if (typeof a.looks_at === 'string') add(a.id, owner(a.looks_at), 'looks');
    else if (a.looks_at === undefined && typeof a.facing === 'string') add(a.id, a.facing, 'faces');
    if (a.aim) add(a.id, owner(a.aim), 'aims');
  }
  for (const e of scene.effects) if (isLine(e) && typeof e.to === 'string') add(owner(e.from), owner(e.to), 'effect');
  return out;
}

/**
 * The person more others point at than at anyone else (each other person counts once, however they point), or
 * undefined when nobody is pointed at or the most pointed-at are tied (two who look at each other). `except`: whose
 * pointing is left out.
 */
export function pointedAt(scene: Scene, except?: string): { id: string; by: Pointer[] } | undefined {
  const by = new Map<string, Pointer[]>();
  for (const p of pointers(scene)) {
    if (p.from === except) continue;
    const l = by.get(p.to) ?? [];
    if (!l.some((q) => q.from === p.from)) l.push(p);
    by.set(p.to, l);
  }
  const ranked = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!ranked.length || (ranked.length > 1 && ranked[1][1].length === ranked[0][1].length)) return undefined;
  return { id: ranked[0][0], by: ranked[0][1] };
}

/**
 * A note when the focus an LLM chose (the moment's focus, an intent's subject) is a person and at least two others
 * point at someone else. The focus's own pointing is left out: what they look at is what they see, not a rival; and so
 * is one person's alone (one who looks at a clerk reading a letter does not make the clerk the focus). A check, not a
 * rule: a reaction shot is about the one who looks, and the text may say so.
 */
export function checkFocus(scene: Scene, focus: string = scene.moment.focus): string[] {
  if (!scene.actors.some((a) => a.id === focus)) return [];
  const p = pointedAt(scene, focus);
  if (!p || p.id === focus || p.by.length < MIN_POINTERS) return [];
  const how = p.by.map((q) => `${q.from} ${q.how}`).join(', ');
  return [`focus "${focus}", but the others point the eye at "${p.id}" (${how})`];
}
