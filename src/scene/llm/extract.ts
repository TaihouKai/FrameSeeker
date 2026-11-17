// Stage 0a (DESIGN.md §4.3.1): one moment of a story -> scene JSON, faithful to the text. The solver validates the
// answer; its error goes back to the model once for a fix.
import { solve } from '../solve.ts';
import type { Scene } from '../types.ts';
import { jsonOf, type Chat, type ChatMsg } from './chat.ts';
import { vocabulary } from './vocab.ts';

/** The scene as the text has it: absolute for every later step (staging only adds to it). */
export type Extracted = Scene;

const SHAPE = `{"place":{"kind":"street","description":"","width":20},"time":{"of_day":"sunset","weather":"clear"},
"actors":[{"id":"a","pose":"stand","aim":null,"facing":null,"height":null,"place":{...},"prompt":{"tag":"","series":"","look":[],"outfit":[],"expression":[]}}],
"structures":[{"id":"","kind":"building","size":{},"place":{...},"facing":null,"prompt":[]}],
"effects":[...],
"moment":{"focus":"a","action_line":null,"payoff":null,"source":null,"intent":"scale|action|emotion|reveal","may_hide":[]}}`;

export const EXTRACT_PROMPT = `You turn ONE moment of a story into a scene description for a program that builds a simple 3D stage of boxes and posed mannequins and then searches for a camera. Answer with one JSON object in the SHAPE below and nothing else.

THE MOMENT: if "focus" is given (the reader's own words for what to draw), that moment, as it says; otherwise the most striking instant of the text. Describe that one instant only.

FAITHFUL: only what the text states or plainly implies. Do not add people, objects, powers, looks, clothes or effects; do not decorate (another step does staging). The place itself is fine (a street has a road).
- actors: the people visible at that instant who matter, at most 6. pose: the closest name from POSES. aim: the anchor a pointing, firing or punching pose aims at (else null). facing: the id they face (else null). height: metres if the text or the description gives it (else null). prompt: English image tags; tag/series only for a known character of a published work whose image-board tag you know; look/outfit only from the text or their description.
- structures: only the big things the moment involves (the building that is hit, the bridge someone stands on). Rough sizes, true to the world (a 30-storey tower is ~105 m; a street ~20 m wide; people talking stand ~1.5 m apart).
- every actor and structure has "place" (one PLACEMENT form, as the text says or implies it: on the bridge, in the middle of the road, rising from the roof he left, behind her). What you write here is final: no later step moves anything.
- effects: what flies or happens, with English "prompt" tags. A line that narrowly misses someone has "grazes".
- moment: focus = the actor the eye goes to; action_line = the line effect, if any; payoff = what the action does (an effect or structure id), if any; source = who does it; intent: scale (size and power), action, emotion (a face, a feeling), reveal; may_hide = ids that may be out of frame (often the one who fires, when the focus is the target).
- ids: short ASCII.

${vocabulary()}

SHAPE: ${SHAPE}`;

export async function extract(chat: Chat, input: { text: string; focus?: string; people?: { name: string; description: string }[] }): Promise<Extracted> {
  const messages: ChatMsg[] = [
    { role: 'system', content: EXTRACT_PROMPT },
    { role: 'user', content: JSON.stringify({ text: input.text, focus: input.focus ?? '', people: input.people ?? [] }) },
  ];
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await chat(messages, { temperature: 0.2 });
    let scene: Extracted;
    try {
      scene = clean(jsonOf(answer) as Extracted);
      solve(scene);
      return scene;
    } catch (e) {
      last = (e as Error).message;
      messages.push({ role: 'assistant', content: answer }, { role: 'user', content: `The program could not use this: ${last}. Answer again with the corrected JSON only.` });
    }
  }
  throw new Error(`extraction failed: ${last}`);
}

/** Model JSON -> the scene types: nulls dropped, version set. */
export function clean<T extends Extracted>(x: T): T {
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, strip(v)]));
    return o;
  };
  const s = strip(x) as T;
  s.version = 1;
  s.structures ??= []; s.effects ??= [];
  for (const a of s.actors) { a.prompt ??= { look: [], outfit: [], expression: [] }; a.prompt.look ??= []; a.prompt.outfit ??= []; a.prompt.expression ??= []; }
  for (const st of s.structures) st.prompt ??= [];
  return s;
}
