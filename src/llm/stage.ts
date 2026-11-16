// Stage 0b (DESIGN.md §4.3.1): the model, as director and layout artist, proposes changes to the stage; code decides
// which ones stand. A proposal may only add set pieces or move what the text leaves open, must name its purpose,
// and is refused when it breaks the scene (the solver) or stands in the action's way.
import { solve } from '../solve.ts';
import { clear } from '../geom.ts';
import { lerp } from '../vec.ts';
import type { Placement, Scene, Structure } from '../scene.ts';
import { jsonOf, type Chat } from './chat.ts';
import { STRUCTURE_KINDS, vocabulary } from './vocab.ts';
import type { Extracted } from './extract.ts';

export const PURPOSES = ['foreground_frame', 'line_of_fire', 'elevation', 'backdrop', 'separation'] as const;
export type Purpose = typeof PURPOSES[number];
export type Op =
  | { op: 'add_structure'; structure: Structure; purpose: Purpose; why: string }
  | { op: 'place_actor'; actor: string; place: Placement; purpose: Purpose; why: string }
  | { op: 'place_structure'; structure: string; place?: Placement; facing?: string; purpose: Purpose; why: string };
export interface Plan { name: string; ops: Op[] }

const SHAPE = `{"plans":[{"name":"","ops":[
{"op":"add_structure","structure":{"id":"","kind":"","size":{},"place":{...},"facing":null,"prompt":[]},"purpose":"","why":""},
{"op":"place_actor","actor":"","place":{...},"purpose":"","why":""},
{"op":"place_structure","structure":"","place":{...},"facing":null,"purpose":"","why":""}]}]}`;

export const STAGE_PROMPT = `You are the director and layout artist for ONE moment of a story. A program will try thousands of camera positions on this stage and keep the best by composition rules: a low camera looking up for size and power; the action line running diagonally across the frame, never straight at or away from the lens; near objects at the frame's edges framing the shot; the focus readable, its face visible; the payoff in frame; open sky for scale. Propose changes to the STAGE that give the camera better shots of exactly this moment. Answer with one JSON object in the SHAPE below and nothing else.

You may:
- add_structure: one set piece this place plausibly has at this time and in this world, placed RELATIVE to someone or something in the scene ("from" + distance + bearing, "behind" + "seen_from", "on_line") — never by absolute coordinates; read "layout" for where everything is (a street: a footbridge or gantry across the road, a parked car, a bus shelter, a pillar or signpost, a low wall; a rooftop: a water tank, a railing, an antenna mast, a stairwell hut; a room: a shelf, a pillar; a platform: a canopy pillar, a bench). kind from STRUCTURE KINDS, a new short ASCII id, real-world size.
- place_actor: a new place for an actor whose "fixed" is false — only within what the text allows (never somewhere the text contradicts, never making the moment physically different).
- place_structure: a new place or facing for a structure whose "fixed" is false.
Every operation names its purpose — foreground_frame (near the camera side of the action, to frame it), line_of_fire (so the action line reaches or clears what it must), elevation (someone higher or lower for a stronger angle), backdrop (something behind the focus that shows scale or place), separation (people far enough apart to read) — and why, in one sentence about this shot.

Never: change what the text states (who does what, the poses, anything fixed, the time, the weather); add people, animals or anything that moves; change anyone's looks, clothes or powers; add effects; put anything on the action line, between the focus and the action, or inside another thing. Only what the shot needs: 1 to 3 operations per plan, each serving this moment, not decoration. When the stage is already right, an empty plan is a good answer.

"layout" says where everything stands now (metres; x across, z along; y up) and where each action line runs. "bare_stage" tells you what the camera search found without your changes: its best score, the weakest rules (each with what staging can do about it), and the solver's notes (a note may say the action cannot reach what the text says it hits from where people stand: fix that with place_actor or elevation only when "fixed" allows). Aim your changes at the weakest rules; a change that does not raise the score is removed by the program, so do not decorate.

Give 3 plans with different ideas.

${vocabulary()}

SHAPE: ${SHAPE}`;

/** What each weak rule means for staging (sent with the bare stage's weakest rules). */
export const RULE_HINTS: Record<string, string> = {
  diagonal: 'the action line crosses the frame flat or upright: a height difference between its ends (elevation) makes it diagonal',
  foreshortening: 'good cameras look along the action line: room beside the line for a camera, or a different angle between the people',
  thirds: 'the focus cannot sit on a third of the frame: usually crowding at the edges',
  scale: 'nothing big reads from a low camera: a tall thing behind the focus, or the focus lower than what it faces',
  sky: 'no open sky in the good shots: the scene is boxed in where the camera would look up',
  framing: 'nothing near the frame edges: a set piece close beside the action (a pillar, a car, a gantry overhead) that a camera can shoot past',
  subject_size: 'the focus is tiny or huge in every good shot: things that must be in frame are too far apart, or too close',
  face: 'the focus faces away from where good cameras stand',
  lead_room: 'no space in front of where the focus faces',
  joint_cut: 'people are cropped at the joints',
  overlap: 'the people overlap on the screen: separate them',
  aspect: 'the format does not fit the shot',
  merger: "something thin rises out of the focus's head",
};

/** Where everything stands, in words a model can place things against. */
export function layoutOf(scene: Scene): unknown {
  const s = solve(scene);
  const r = (v: number[]) => v.map((x) => Math.round(x * 10) / 10);
  return {
    actors: [...s.actors.values()].map((a) => ({ id: a.id, at: r([a.pos[0], a.pos[2]]), elevation: r([a.pos[1]])[0], faces: r([a.fwd[0], a.fwd[2]]) })),
    structures: [...s.structures.values()].map((x) => ({ id: x.id, kind: x.kind, at: r([x.pos[0], x.pos[2]]), height: r([x.height])[0], front_faces: r([x.front[0], x.front[2]]) })),
    action_lines: [...s.lines.values()].map((l) => ({ id: l.id, from: r(l.a), to: r(l.b), hits: l.hits, floor: l.floor })),
  };
}

export async function propose(chat: Chat, input: { text: string; scene: Extracted; bare: unknown }): Promise<Plan[]> {
  const answer = await chat([
    { role: 'system', content: STAGE_PROMPT },
    { role: 'user', content: JSON.stringify({ text: input.text, scene: input.scene, layout: layoutOf(input.scene), bare_stage: input.bare }) },
  ], { temperature: 0.6 });
  const out = jsonOf(answer) as { plans?: Plan[] };
  return (out.plans || []).slice(0, 3).map((p, i) => ({ name: String(p.name || `plan ${i + 1}`), ops: Array.isArray(p.ops) ? p.ops.slice(0, 3) : [] }));
}

const INDOOR = new Set(['room', 'corridor']);
const NOT_INDOORS = new Set(['building', 'tower', 'bridge', 'truss', 'tree', 'rock', 'vehicle']);

export interface Applied { scene: Scene & { origin: Record<string, 'text' | 'staged'> }; accepted: Op[]; refused: { op: Op; why: string }[] }

/** The plan's operations, one by one, on the extracted scene; each is kept only if it passes every check. */
export function applyPlan(base: Extracted, plan: Plan): Applied {
  let scene = structuredClone(base) as Extracted;
  const origin: Record<string, 'text' | 'staged'> = Object.fromEntries([...base.actors, ...base.structures].map((x) => [x.id, 'text' as const]));
  const accepted: Op[] = [], refused: { op: Op; why: string }[] = [];
  const ids = () => new Set([...scene.actors.map((a) => a.id), ...scene.structures.map((s) => s.id), ...scene.effects.map((e) => e.id)]);
  for (const op of plan.ops) {
    const why = check(op);
    if (why) { refused.push({ op, why }); continue; }
    const next = structuredClone(scene) as Extracted;
    if (op.op === 'add_structure') next.structures.push({ ...op.structure, prompt: op.structure.prompt ?? [] });
    else if (op.op === 'place_actor') next.actors.find((a) => a.id === op.actor)!.place = op.place;
    else { const s = next.structures.find((x) => x.id === op.structure)!; if (op.place) s.place = op.place; if (op.facing) s.facing = op.facing; }
    try {
      const solved = solve(stripNulls(next));
      // nothing staged may stand in the action's way
      if (op.op === 'add_structure') {
        const mine = { groundY: -1e9, prims: solved.structures.get(op.structure.id)!.prims };
        for (const l of solved.lines.values()) if (!clear(mine, l.a, lerp(l.a, l.b, 0.97))) throw new Error('stands on the action line');
        const focus = solved.actors.get(next.moment.focus)!;
        for (const a of solved.actors.values()) if (a.id !== focus.id && !clear(mine, focus.head, a.head)) throw new Error('stands between the people');
      }
      scene = next;
      if (op.op === 'add_structure') origin[op.structure.id] = 'staged';
      if (op.op === 'place_actor') origin[op.actor] = 'staged';
      if (op.op === 'place_structure') origin[op.structure] = 'staged';
      accepted.push(op);
    } catch (e) { refused.push({ op, why: (e as Error).message }); }
  }
  return { scene: { ...stripNulls(scene), origin }, accepted, refused };

  function check(op: Op): string | null {
    if (!PURPOSES.includes(op.purpose)) return `purpose "${op.purpose}" is not one of ${PURPOSES.join(', ')}`;
    if (!op.why || !String(op.why).trim()) return 'no reason given';
    if (op.op === 'add_structure') {
      const s = op.structure;
      if (!s || !s.id || ids().has(s.id)) return `structure id "${s?.id}" missing or taken`;
      if (!(STRUCTURE_KINDS as readonly string[]).includes(s.kind)) return `kind "${s.kind}" unknown`;
      if (INDOOR.has(scene.place.kind) && NOT_INDOORS.has(s.kind)) return `a ${s.kind} does not fit in a ${scene.place.kind}`;
      if ((s.size?.floors ?? 0) > 80 || (s.size?.height ?? 0) > 40) return 'too big for a set piece';
      if (!s.place || 'at' in s.place) return 'a set piece is placed relative to something in the scene, not by coordinates';
      return null;
    }
    if (op.op === 'place_actor') {
      if (!scene.actors.some((a) => a.id === op.actor)) return `no actor "${op.actor}"`;
      if (base.fixed[op.actor] !== false) return `the text fixes where "${op.actor}" is`;
      return null;
    }
    if (op.op === 'place_structure') {
      if (!scene.structures.some((s) => s.id === op.structure)) return `no structure "${op.structure}"`;
      if (base.fixed[op.structure] !== false) return `the text fixes where "${op.structure}" is`;
      return null;
    }
    return `unknown operation "${(op as { op: string }).op}"`;
  }
}

function stripNulls<T>(x: T): T {
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, strip(v)]));
    return o;
  };
  return strip(x) as T;
}
