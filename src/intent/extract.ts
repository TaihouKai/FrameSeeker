// The intent from the story: an LLM reads the text and the scene it was staged as, and says what the shot must make
// the viewer understand, in the vocabulary of types.ts. Checked against the scene's ids; anything unknown is dropped
// with a note. The camera never sees the LLM: it gets the intent's devices as preferences (devices.ts).
import type { Chat, Scene } from '../scene/index.ts';
import type { Convey, ShotIntent } from './types.ts';

export const INTENT_PROMPT = `You are a film director. For ONE shot of the moment below, say what the shot must make the viewer understand: not
how to frame it, only what must come across. Answer with one JSON object and nothing else:
{"subject": "<id>", "why": "<one sentence>", "convey": [ ...most important first, at most 3... ]}
Each convey item is one of:
{"what":"face","who":id} the viewer must read their face (a reaction, an emotion)
{"what":"sees","who":id,"target":id or "gaze"} the viewer must see what they look at ("gaze": what the scene says they look at)
{"what":"power","who":id,"over":id?} they hold power (over someone)
{"what":"vulnerable","who":id} they are small, weak, overwhelmed
{"what":"alone","who":id} they are alone
{"what":"together","who":[id,id]} these belong together in this moment (a relation, a confrontation)
{"what":"scale","who":id,"against":id} how small they are against something big
Use only ids from the scene. Say only what the text supports.`;

const KINDS = new Set(['face', 'sees', 'power', 'vulnerable', 'alone', 'together', 'scale']);

/** Keeps what refers to the scene's ids; returns the notes on what was dropped. */
export function checkIntent(raw: unknown, scene: Scene): { intent: ShotIntent; notes: string[] } {
  const ids = new Set([...scene.actors.map((a) => a.id), ...scene.structures.map((s) => s.id), ...scene.effects.map((e) => e.id)]);
  const actors = new Set(scene.actors.map((a) => a.id));
  const notes: string[] = [];
  const r = (raw ?? {}) as { subject?: unknown; why?: unknown; convey?: unknown };
  const subject = typeof r.subject === 'string' && ids.has(r.subject) ? r.subject : scene.moment.focus;
  if (subject !== r.subject) notes.push(`subject "${String(r.subject)}" is not in the scene: the moment's focus "${subject}" instead`);
  const convey: Convey[] = [];
  for (const c of Array.isArray(r.convey) ? r.convey : []) {
    const x = c as Record<string, unknown>;
    const who = x.who;
    const ok = KINDS.has(String(x.what)) && (Array.isArray(who) ? who.every((w) => ids.has(String(w))) : actors.has(String(who)))
      && (x.what !== 'sees' || x.target === 'gaze' || ids.has(String(x.target)))
      && (x.what !== 'scale' || ids.has(String(x.against)))
      && (x.what !== 'power' || x.over === undefined || x.over === null || ids.has(String(x.over)));
    if (!ok) { notes.push(`dropped ${JSON.stringify(c)}: unknown kind or id`); continue; }
    if (x.what === 'power' && (x.over === null || x.over === undefined)) delete x.over;
    convey.push(x as unknown as Convey);
    if (convey.length === 3) break;
  }
  return { intent: { subject, convey, ...(typeof r.why === 'string' ? { why: r.why } : {}) }, notes };
}

export async function extractIntent(text: string, scene: Scene, chat: Chat): Promise<{ intent: ShotIntent; notes: string[] }> {
  const answer = await chat([
    { role: 'system', content: INTENT_PROMPT },
    { role: 'user', content: `STORY:\n${text}\n\nSCENE (ids and what they are):\n${JSON.stringify({ actors: scene.actors.map((a) => ({ id: a.id, pose: a.pose, looks_at: a.looks_at ?? null })), structures: scene.structures.map((s) => ({ id: s.id, kind: s.kind, prompt: s.prompt })), effects: scene.effects.map((e) => ({ id: e.id, kind: e.kind })), moment: scene.moment })}` },
  ], { temperature: 0.2 });
  const s = answer.indexOf('{'), e = answer.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('intent: no JSON object in the answer');
  return checkIntent(JSON.parse(answer.slice(s, e + 1)), scene);
}
