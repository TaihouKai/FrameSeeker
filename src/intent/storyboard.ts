// The storyboard: an LLM reads the story and the set it was staged as, and splits it into panels, each one instant
// (who is there, where, how: a beat) and one intent (what that panel must make the viewer understand). One panel
// carries one or two things: several that one camera cannot show together (a low angle on one person and a high angle
// on the other) belong to different panels, as a director would cut between them. Everything is checked against the
// scene's ids and solved; what is unknown is dropped with a note; what cannot be solved, and what the camera cannot
// show (review.ts), goes back to the model.
// The camera never sees the LLM: it gets each panel's devices as preferences (devices.ts).
import { atBeat, BODY_PARTS, layoutOf, realize, vocabulary, type Beat, type Chat, type ChatMsg, type Scene } from '../scene/index.ts';
import type { SearchOpts } from '../camera/index.ts';
import { review, type Problem } from './review.ts';
import type { Convey, ShotIntent } from './types.ts';

/** At most this many things to convey in one panel. */
export const MAX_CONVEY = 2;

const CONVEY = `{"what":"face","who":id} the viewer must read their face (a reaction, an emotion)
{"what":"sees","who":id,"target":id or "gaze"} the viewer must see what they look at ("gaze": what the panel says they look at)
{"what":"power","who":id,"over":id?} they hold power (over someone)
{"what":"vulnerable","who":id} they are small, weak, overwhelmed
{"what":"alone","who":id} they are alone
{"what":"together","who":[id,id]} these belong together in this moment (a relation, a confrontation)
{"what":"scale","who":id,"against":id} how small they are against something big
{"what":"detail","who":id,"part":"${BODY_PARTS.join('|')}"} an insert: the viewer must see this part of them up close (an injured foot, a hand holding something, the eyes); the panel shows the part, not the whole person`;

export const STORYBOARD_PROMPT = (n: number) => `You are a film director making a storyboard. The story below is drawn as ${n} panel${n > 1 ? 's' : ''}${n > 1 ? ', like a comic strip: each panel one instant, in story order, all on the same set (the SCENE: its place and structures stay where they are; people come, go and move)' : ''}. For each panel say ${n > 1 ? 'what happens, where everyone present is at that instant, and ' : ''}what the panel must make the viewer understand: not how to frame it, only what must come across. Answer with one JSON object and nothing else:
{"panels":[{${n > 1 ? '"what":"<the story\'s words for this instant>","actors":[{"id":"","pose":"","place":{...},"facing":null,"looks_at":null,"approaches":null,"speaking":false,"aim":null,"expression":[]}],"effects":[],' : ''}"intent":{"subject":"<id>","why":"<one sentence>","convey":[ ...most important first, at most ${MAX_CONVEY}... ],"withdrawn":[]}}]}
${n > 1 ? `
- panels: exactly ${n}, in story order. Together they tell the story: choose the instants that carry it (the setup, the turn, the reaction, the aftermath). Only what the text states or plainly implies.
- actors: the people present at that instant (at least one), by the scene's ids. The scene places everyone at ONE instant only: give every person a "place" for THIS panel's instant (packing a bag: at their desk; leaving: at the door), one PLACEMENT form, relative to the set's structures or to people present in the same panel, or {"at":[x,z]} read off "layout". pose: a name from POSES. facing (an id), looks_at, approaches, speaking, aim and expression (English image-board tags) as at that instant.
- effects: ids of the scene's effects that happen at that instant (often none).
` : `
- The one panel is the scene's own instant: give only "intent".
`}
- intent.subject: the id the eye goes to first (a person present in the panel). convey items, each one of:
${CONVEY}
- intent.withdrawn: the ids of the people present who, at this instant, grieve, hold back what they feel, or walk away (often none). A fact of the story, not a way to frame it.
- When the text dwells on a part of someone (an injury, what a hand holds or does, a look in the eyes), films usually give it an insert: a "detail" panel.
- A "detail" is a panel of its own (with nothing else to convey but "sees"): the panels around it show who it is and what happens.
- A panel's convey items must be things ONE camera can show together. A low angle on one person and a high angle on another, two faces turned away from each other, a face read up close and the same person small and alone in the frame, or one face read up close while someone metres away is "together" with them: each is two panels, not one. One strong thing is better than two weak ones. The program tries every panel with a camera and sends back what no camera can show.
- Each panel is a different moment: do not draw the same instant twice.

"layout" says where everything stands in the scene (metres; x across, z along; y up).

${n > 1 ? vocabulary() : ''}`;

export interface Panel {
  /** the instant (absent: the scene's own instant, a one-panel storyboard) */
  beat?: Beat;
  /** what it must make the viewer understand (absent: composition alone) */
  intent?: ShotIntent;
}

/** Keeps what refers to the scene's ids; returns the notes on what was dropped. */
export function checkIntent(raw: unknown, scene: Scene): { intent: ShotIntent; notes: string[] } {
  const ids = new Set([...scene.actors.map((a) => a.id), ...scene.structures.map((s) => s.id), ...scene.effects.map((e) => e.id)]);
  const actors = new Set(scene.actors.map((a) => a.id));
  const notes: string[] = [];
  const r = (raw ?? {}) as { subject?: unknown; why?: unknown; convey?: unknown; withdrawn?: unknown };
  const subject = typeof r.subject === 'string' && ids.has(r.subject) ? r.subject : scene.moment.focus;
  if (subject !== r.subject) notes.push(`subject "${String(r.subject)}" is not in the scene: the moment's focus "${subject}" instead`);
  const convey: Convey[] = [];
  for (const c of Array.isArray(r.convey) ? r.convey : []) {
    const x = c as Record<string, unknown>;
    const who = x.who;
    const ok = KINDS.has(String(x.what)) && (Array.isArray(who) ? who.every((w) => ids.has(String(w))) : actors.has(String(who)))
      && (x.what !== 'sees' || x.target === 'gaze' || ids.has(String(x.target)))
      && (x.what !== 'scale' || ids.has(String(x.against)))
      && (x.what !== 'power' || x.over === undefined || x.over === null || ids.has(String(x.over)))
      && (x.what !== 'detail' || (BODY_PARTS as readonly string[]).includes(String(x.part)));
    if (!ok) { notes.push(`dropped ${JSON.stringify(c)}: unknown kind or id`); continue; }
    if (convey.length === MAX_CONVEY) { notes.push(`dropped ${JSON.stringify(c)}: more than ${MAX_CONVEY} things for one panel`); continue; }
    if (x.what === 'power' && (x.over === null || x.over === undefined)) delete x.over;
    convey.push(x as unknown as Convey);
  }
  const withdrawn = (Array.isArray(r.withdrawn) ? r.withdrawn : []).map(String).filter((id) => actors.has(id));
  return { intent: { subject, convey, ...(typeof r.why === 'string' ? { why: r.why } : {}), ...(withdrawn.length ? { withdrawn } : {}) }, notes };
}
const KINDS = new Set(['face', 'sees', 'power', 'vulnerable', 'alone', 'together', 'scale', 'detail']);

/**
 * The story as n panels on the scene's set (n = 1: the scene's own instant and its intent). An answer the program
 * cannot use goes back to the model with the reason; so does one the camera finds problems with (review.ts). After
 * three answers the best is kept: a conflict left in it loses its less important thing, the rest become notes.
 */
export async function storyboard(text: string, scene: Scene, chat: Chat, n = 1, opts: { search?: SearchOpts } = {}): Promise<{ panels: Panel[]; notes: string[] }> {
  const messages: ChatMsg[] = [
    { role: 'system', content: STORYBOARD_PROMPT(n) },
    { role: 'user', content: `STORY:\n${text}\n\nSCENE:\n${JSON.stringify(scene)}\n\nLAYOUT:\n${JSON.stringify(layoutOf(scene))}` },
  ];
  let last = '', best: { panels: Panel[]; notes: string[]; problems: Problem[]; attempt: number } | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = await chat(messages, { temperature: 0.3 });
    let got: { panels: Panel[]; notes: string[] };
    try {
      got = read(answer, scene, n);
    } catch (e) {
      last = (e as Error).message;
      messages.push({ role: 'assistant', content: answer }, { role: 'user', content: `The program could not use this: ${last}. Answer again with the corrected JSON only.` });
      continue;
    }
    const problems = review(scene, got.panels, opts);
    if (!best || problems.length < best.problems.length) best = { ...got, problems, attempt: attempt + 1 };
    if (!problems.length) break;
    messages.push({ role: 'assistant', content: answer }, { role: 'user', content: `The camera tried every panel. Problems:\n${problems.map((p) => '- ' + p.text).join('\n')}\nAnswer again with the whole corrected JSON only (still exactly ${n} panels).` });
  }
  if (!best) throw new Error(`storyboard failed: ${last}`);
  return settle(best);
}

/** What is left after the last answer: a conflict loses its less important thing; the rest are noted. */
function settle(b: { panels: Panel[]; notes: string[]; problems: Problem[]; attempt: number }): { panels: Panel[]; notes: string[] } {
  const notes = [...b.notes, ...(b.attempt > 1 ? [`storyboard: answer ${b.attempt} kept`] : [])];
  const panels = b.panels.map((p, i) => {
    const c = b.problems.find((x) => x.panel === i + 1 && x.kind === 'conflict');
    if (!c || !p.intent || c.drop === undefined) return p;
    notes.push(`panel ${i + 1}: dropped ${JSON.stringify(p.intent.convey[c.drop])}: one camera cannot show it with the rest`);
    return { ...p, intent: { ...p.intent, convey: p.intent.convey.filter((_, k) => k !== c.drop) } };
  });
  for (const x of b.problems) if (x.kind !== 'conflict') notes.push(x.text);
  return { panels, notes };
}

/** The model's answer as panels: each beat solved on the scene, each intent checked against its beat. */
export function read(answer: string, scene: Scene, n: number): { panels: Panel[]; notes: string[] } {
  const s = answer.indexOf('{'), e = answer.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('no JSON object in the answer');
  const raw = JSON.parse(answer.slice(s, e + 1)) as { panels?: unknown };
  const list = Array.isArray(raw.panels) ? raw.panels as Record<string, unknown>[] : [];
  if (list.length !== n) throw new Error(`${list.length} panels, not ${n}`);
  const notes: string[] = [];
  const panels = list.map((p, i): Panel => {
    let beat: Beat | undefined, at = scene;
    if (n > 1) {
      beat = noNulls({ what: String(p.what ?? `panel ${i + 1}`), actors: Array.isArray(p.actors) ? p.actors : [], effects: Array.isArray(p.effects) ? p.effects : [] }) as Beat;
      // a beat cannot invent an effect: one the scene does not have is dropped
      const known = new Set(scene.effects.map((x) => x.id));
      for (const id of beat.effects ?? []) if (!known.has(id)) notes.push(`panel ${i + 1}: dropped effect "${id}": not in the scene`);
      beat.effects = (beat.effects ?? []).filter((id) => known.has(id));
      at = atBeat(scene, beat);
      realize(at);
    }
    const got = checkIntent(p.intent, at);
    notes.push(...got.notes.map((x) => `panel ${i + 1}: ${x}`));
    return { ...(beat ? { beat } : {}), intent: got.intent };
  });
  return { panels, notes };
}

function noNulls<T>(x: T): T {
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, strip(v)]));
    return o;
  };
  return strip(x) as T;
}
