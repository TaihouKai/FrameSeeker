// Where the eye is pointed. Films point the viewer's eye at someone or something in many ways: the people in the
// picture look, point, aim or walk toward it; someone speaks (the eye goes to the speaker); a beam or a throw flies at
// it; later, light falls on it or lines lead to it. Each such fact is a *cue*: what it points at, its kind, where it
// comes from, a weight. Cues come from small sources, one per kind, so a new kind is a new source and nothing else.
//
// Two layers use the same cues:
// - story cues (here): facts of the scene, true whatever the camera. They tell whom the moment is about, so the
//   focus an LLM chose is checked against them (checkFocus, a solver note).
// - frame cues (not built): light, leading lines, size and place in the picture. They depend on the camera and the
//   lighting; they are how a director sends the eye to the focus, so they belong to the camera search and the
//   lighting layer, as preferences ("the frame's cues point at the focus"), not to choosing the focus.
//
// Evidence (DESIGN.md §15): in the annotated reference shots, people others face got more attention votes (0/1/2+
// others: 1.7/2.0/2.7 of 4); the annotators often chose someone because they speak; pointing at someone draws nothing
// to the one who points. Weights are a first choice (all 1), to be measured.
import { isLine, type Scene } from './types.ts';

export type CueKind = 'looks' | 'faces' | 'approaches' | 'aims' | 'effect' | 'speaks';
export interface Cue {
  /** the id it points at (a person or a structure) */
  to: string;
  kind: CueKind;
  /** whose cue it is: the person who looks, aims, walks or speaks (a speaker's cue points at themselves) */
  from: string;
  weight: number;
}
/** a source of cues of one kind */
export type CueSource = (scene: Scene) => Cue[];

/** first choice, not measured: every kind counts the same */
export const CUE_WEIGHT: Record<CueKind, number> = { looks: 1, faces: 1, approaches: 1, aims: 1, effect: 1, speaks: 1 };
/** how much support (distinct sources) the one the cues point to needs before the focus is questioned */
export const MIN_SUPPORT = 2;

const owner = (ref: string) => ref.split('.')[0];
const cue = (from: string, to: string, kind: CueKind): Cue => ({ from, to: owner(to), kind, weight: CUE_WEIGHT[kind] });

/** looks_at (an id or anchor), else the id they face */
const gaze: CueSource = (s) => s.actors.flatMap((a) =>
  typeof a.looks_at === 'string' ? [cue(a.id, a.looks_at, 'looks')] : a.looks_at === undefined && typeof a.facing === 'string' ? [cue(a.id, a.facing, 'faces')] : []);
const approach: CueSource = (s) => s.actors.flatMap((a) => (a.approaches ? [cue(a.id, a.approaches, 'approaches')] : []));
/** a pointing, firing or punching pose's aim */
const aim: CueSource = (s) => s.actors.flatMap((a) => (a.aim ? [cue(a.id, a.aim, 'aims')] : []));
/** a line effect (a beam, a throw, a slash) from someone to someone or something */
const effect: CueSource = (s) => s.effects.flatMap((e) => (isLine(e) && typeof e.to === 'string' ? [cue(owner(e.from), e.to, 'effect')] : []));
/** the speaker draws the eye to themselves, not to whom they speak to */
const speech: CueSource = (s) => s.actors.flatMap((a) => (a.speaking ? [cue(a.id, a.id, 'speaks')] : []));

export const STORY_CUES: CueSource[] = [gaze, approach, aim, effect, speech];

/** Every story cue that points at a person or a structure of the scene (and comes from a person). */
export function cues(scene: Scene, sources: CueSource[] = STORY_CUES): Cue[] {
  const people = new Set(scene.actors.map((a) => a.id));
  const targets = new Set([...people, ...scene.structures.map((s) => s.id)]);
  return sources.flatMap((f) => f(scene)).filter((c) => people.has(c.from) && targets.has(c.to) && (c.from !== c.to || c.kind === 'speaks'));
}

/**
 * Support per target: each source counts once per target (its strongest cue), so one person who both aims and fires
 * counts once. `except`: a candidate focus, whose cues at others are left out (what they look at is what they see,
 * not a rival focus); their own speaking still counts for them.
 */
export function support(scene: Scene, except?: string): Map<string, { score: number; by: Cue[] }> {
  const best = new Map<string, Cue>();
  for (const c of cues(scene)) {
    if (c.from === except && c.to !== except) continue;
    const k = `${c.to}\0${c.from}`, o = best.get(k);
    if (!o || c.weight > o.weight) best.set(k, c);
  }
  const out = new Map<string, { score: number; by: Cue[] }>();
  for (const c of best.values()) {
    const t = out.get(c.to) ?? { score: 0, by: [] };
    t.score += c.weight; t.by.push(c); out.set(c.to, t);
  }
  return out;
}

/** The one the cues point to most, or undefined when nothing is pointed at or the top is tied. */
export function attended(scene: Scene, except?: string): { id: string; score: number; by: Cue[] } | undefined {
  const ranked = [...support(scene, except).entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length || (ranked.length > 1 && ranked[1][1].score === ranked[0][1].score)) return undefined;
  return { id: ranked[0][0], ...ranked[0][1] };
}

/**
 * A note when the focus an LLM chose (the moment's focus, an intent's subject) is not the one the story cues point to,
 * and that one has the support of at least MIN_SUPPORT sources (one person's gaze is only what they see). A check,
 * not a rule: a reaction shot is about the one who looks, and the text may say so.
 */
export function checkFocus(scene: Scene, focus: string = scene.moment.focus): string[] {
  if (!scene.actors.some((a) => a.id === focus) && !scene.structures.some((s) => s.id === focus)) return [];
  const p = attended(scene, focus);
  if (!p || p.id === focus || p.score < MIN_SUPPORT) return [];
  const how = p.by.map((c) => (c.kind === 'speaks' ? `${c.from} speaks` : `${c.from} ${c.kind}`)).join(', ');
  return [`focus "${focus}", but the cues point the eye at "${p.id}" (${how})`];
}
