// A sequence on one set (the panels of a strip): the scene is the set and its cast; each beat is one instant of it,
// with the people present placed and posed anew. The place and the structures do not move between beats: they are
// pinned where the scene puts them, so a structure placed beside someone stays put when that person walks away.
import { solve } from './solve.ts';
import type { Actor, Beat, Effect, Scene, Structure } from './types.ts';

/** The scene at one beat. Throws (readably) when the beat names unknown ids or cannot be solved. */
export function atBeat(scene: Scene, beat: Beat): Scene {
  const cast = new Map(scene.actors.map((a) => [a.id, a]));
  if (!beat.actors.length) throw new Error(`beat "${beat.what}": nobody is present (at least one person)`);
  const actors: Actor[] = beat.actors.map((b) => {
    const a = cast.get(b.id);
    if (!a) throw new Error(`beat "${beat.what}": "${b.id}" is not one of the scene's people (${[...cast.keys()].join(', ')})`);
    const { id: _, expression, ...over } = b;
    return { ...a, ...over, prompt: expression?.length ? { ...a.prompt, expression } : a.prompt };
  });
  const present = new Set(actors.map((a) => a.id));
  for (const a of actors) {
    const p = a.place as unknown as Record<string, unknown>;
    const refs = [p.from, p.behind, p.seen_from, ...(Array.isArray(p.on_line) ? p.on_line : [])].filter((x): x is string => typeof x === 'string');
    for (const r of refs) if (cast.has(r) && !present.has(r)) throw new Error(`beat "${beat.what}": "${a.id}" is placed relative to "${r}", who is not present: give "${a.id}" its own place`);
  }
  const structures = pinned(scene);
  const effectIds = new Set(beat.effects ?? []);
  for (const id of effectIds) if (!scene.effects.some((e) => e.id === id)) throw new Error(`beat "${beat.what}": no effect "${id}" in the scene`);
  const effects = scene.effects.filter((e) => effectIds.has(e.id));
  for (const e of effects) for (const ref of refsOf(e)) if (cast.has(ref) && !present.has(ref)) throw new Error(`beat "${beat.what}": effect "${e.id}" involves "${ref}", who is not present`);
  // the ids that exist at this beat
  const here = new Set([...present, ...structures.map((s) => s.id), ...effects.map((e) => e.id)]);
  const m = scene.moment;
  const keep = (ids?: string[]) => ids?.filter((id) => here.has(id));
  const moment = {
    ...m,
    focus: present.has(m.focus) ? m.focus : actors[0].id,
    action_line: m.action_line && here.has(m.action_line) ? m.action_line : undefined,
    payoff: m.payoff && here.has(m.payoff) ? m.payoff : undefined,
    source: m.source && here.has(m.source) ? m.source : undefined,
    must_show: keep(m.must_show), may_hide: keep(m.may_hide),
  };
  // what a present person faces, looks at or walks to must be here (else it falls back to the scene's defaults)
  for (const a of actors) {
    const gone = (v: unknown) => typeof v === 'string' && !here.has(v.split('.')[0]);
    if (gone(a.facing)) delete a.facing;
    if (gone(a.looks_at)) delete a.looks_at;
    if (gone(a.approaches)) delete a.approaches;
    if (gone(a.aim)) delete a.aim;
  }
  const out: Scene = { ...scene, actors, structures, effects, moment };
  solve(out);
  return out;
}

/** The scene's structures pinned where it solves them: absolute position, height above ground and yaw. */
export function pinned(scene: Scene): Structure[] {
  const s = solve(scene);
  return scene.structures.map((st) => {
    const g = s.structures.get(st.id)!;
    return { ...st, place: { at: [g.pos[0], g.pos[2]], ...(g.pos[1] ? { elevation: g.pos[1] } : {}) }, facing: g.yaw * 180 / Math.PI };
  });
}

function refsOf(e: Effect): string[] {
  const ids: string[] = [];
  const add = (x: unknown) => { if (typeof x === 'string') ids.push(x.split('.')[0]); };
  if ('from' in e) { add(e.from); add(e.to); if (e.grazes) ids.push(e.grazes.actor); }
  if ('at' in e) add(e.at);
  if ('target' in e) add(e.target);
  return ids;
}
