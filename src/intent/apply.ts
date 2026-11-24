// The intent applied to a scene: what it needs in frame becomes the moment's.
import type { Scene } from '../scene/index.ts';
import type { ShotIntent } from './types.ts';

/** The ids the intent needs in frame: its subject and what each thing to convey involves. */
export function needs(intent: ShotIntent): string[] {
  const ids = new Set<string>([intent.subject]);
  for (const c of intent.convey) {
    if ('who' in c) for (const w of Array.isArray(c.who) ? c.who : [c.who]) ids.add(w);
    if (c.what === 'sees' && c.target !== 'gaze') ids.add(c.target);
    if (c.what === 'scale') ids.add(c.against);
    if (c.what === 'power' && c.over) ids.add(c.over);
  }
  return [...ids];
}

/**
 * The scene's moment as the intent has it. The moment's own fields were a first, rough intent (a focus, what must be
 * in frame, the action and its payoff as hard constraints); with an intent given, the subject is the focus, what the
 * intent needs is what must be in frame, and the action line and payoff stay hard constraints only when the intent
 * names them. (A reaction shot need not show the tower the beam melts.)
 */
export function applyIntent(scene: Scene, intent: ShotIntent): Scene {
  const m = scene.moment, need = needs(intent);
  // a detail makes the shot an insert of that part: its person is the focus
  const detail = intent.convey.find((c) => c.what === 'detail');
  const focus = detail && scene.actors.some((a) => a.id === detail.who) ? detail.who : scene.actors.some((a) => a.id === intent.subject) ? intent.subject : m.focus;
  return {
    ...scene,
    moment: {
      ...m, focus, part: detail && detail.who === focus ? detail.part : undefined,
      must_show: need.filter((id) => id !== focus),
      action_line: m.action_line && need.includes(m.action_line) ? m.action_line : undefined,
      payoff: m.payoff && need.includes(m.payoff) ? m.payoff : undefined,
      may_hide: (m.may_hide ?? []).filter((id) => !need.includes(id)),
    },
  };
}
