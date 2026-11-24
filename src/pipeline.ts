// The modules wired together: scene (phases 1–3) → intent → camera (4–5) → generate (6).
// Each module only sees the one before it through its index.ts contract; swap any module by keeping that contract.
//
// A story is drawn as one or more panels (a strip). With one panel, the scene's own instant; with several, the scene
// is the set and the cast, and each panel is one instant on it (a beat: who is where) with its own intent, searched
// on its own. One camera need not carry everything the moment has to say: as a director cuts between a low angle on
// one person and a high angle on the other, each panel carries one or two things.
import { atBeat, extractScene, realize, stageScene, type Beat, type Built, type Chat, type Rating, type Scene, type World3D } from './scene/index.ts';
import { keepSide, maps, newShot, ON_LINE, rate, shoot, sideOf, SIZE, type Preference, type SearchOpts, type Shot, type ShotMaps } from './camera/index.ts';
import { GeneratorUnavailable, type Generator } from './generate/index.ts';
import { storyboard, checkIntent, preferences, backLift, applyIntent, type IntentWeights, type Panel, type ShotIntent } from './intent/index.ts';
import type { Image } from './shared/image.ts';
import type { V3 } from './shared/vec.ts';

/** meta: what the renderer reported (its prompt, its checks) */
export interface ShotResult { shot: Shot; maps: ShotMaps; image: Image | null; meta?: Record<string, unknown>; note?: string }
/** One panel: its instant, its intent, its world and the cameras found for it. */
export interface PanelResult { beat?: Beat; intent?: ShotIntent; world: World3D; shots: ShotResult[] }
export interface RunResult { built: Built | null; panels: PanelResult[]; notes: string[] }
/**
 * A strip as the LLM wrote it: the set and cast (staged), each panel's beat and intent, and the story they came from.
 * `run` saves one (storyboard.json); replaying it needs no LLM and gives the same pictures (phases 3–6).
 */
export interface Storyboard { version: 1; story?: string; scene: Scene; panels: Panel[] }

export interface RunOpts {
  /** cameras to keep per panel (default 3 for one panel, 1 for several) */
  k?: number;
  search?: SearchOpts;
  /** phase 6; omitted or unavailable (not configured, not implemented) → the maps only */
  generator?: Generator;
  /** what the shot must make the viewer understand (one panel): its devices become the camera search's preferences */
  intent?: ShotIntent;
  /** how much each kind of intent weighs (frameseeker.config.json) */
  intentWeights?: Partial<IntentWeights>;
}

/**
 * From story text (needs an LLM for phases 1–2 and the storyboard). panels: how many pictures tell it (default 1).
 * withIntent: the LLM writes each panel's intent (always with several panels: the storyboard places the people too).
 */
export async function runText(text: string, opts: RunOpts & { chat: Chat; focus?: string; people?: { name: string; description: string }[]; panels?: number; withIntent?: boolean }): Promise<RunResult> {
  const n = Math.max(1, Math.round(opts.panels ?? 1));
  const extracted = await extractScene(text, { chat: opts.chat, focus: opts.focus, people: opts.people, panels: n });
  let board: Panel[] = [opts.intent ? { intent: opts.intent } : {}];
  const notes: string[] = [];
  if (n > 1 || (opts.withIntent && !opts.intent)) {
    const got = await storyboard(text, extracted, opts.chat, n);
    board = opts.withIntent === false ? got.panels.map(({ beat }) => (beat ? { beat } : {})) : got.panels;
    notes.push(...got.notes);
  }
  // staging is judged on every panel: a set piece stays only if the strip as a whole gains
  const built = await stageScene(text, extracted, { chat: opts.chat, rate: (w) => rateStrip(w.scene, board, opts.intentWeights) });
  const r = await runStoryboard({ version: 1, story: text, scene: built.winner.scene, panels: board }, opts);
  return { built, panels: r.panels, notes: [...notes, ...r.notes] };
}

/**
 * From a storyboard (phases 3–6, no LLM): each panel's beat is solved on the set, its intent checked against it. The
 * panels are shot in order and cut together: while the same two people face each other, the camera keeps to the side
 * of the line between them it took first (the 180° rule); two panels in a row about the same person differ by 30° or
 * a shot size (the 30° rule). An insert neither follows nor sets either.
 */
export async function runStoryboard(board: Storyboard, opts: RunOpts = {}): Promise<RunResult> {
  const notes: string[] = [], panels: PanelResult[] = [];
  const k = opts.k ?? (board.panels.length > 1 ? 1 : 3);
  let line: { pair: [string, string]; side: number; panel: number } | undefined;
  let prev: { who: string; at: V3; cam: V3; scale: number } | undefined;
  for (const [i, p] of board.panels.entries()) {
    let panel = p;
    if (p.intent) {
      const c = checkIntent(p.intent, p.beat ? atBeat(board.scene, p.beat) : board.scene);
      notes.push(...c.notes.map((x) => `panel ${i + 1}: ${x}`));
      panel = { ...p, intent: c.intent };
    }
    const s = panelScene(board.scene, panel), world = realize(s, panel.beat ? board.scene : undefined);
    const insert = !!s.moment.part;
    const at = (id: string) => world.solved.actors.get(id)?.pos;
    const keep: Preference[] = [];
    const name = line && `180°: ${line.pair.join('–')} as in panel ${line.panel}`;
    if (line && !insert && at(line.pair[0]) && at(line.pair[1])) keep.push(keepSide(at(line.pair[0])!, at(line.pair[1])!, line.side, name!));
    const cut = prev && !insert && prev.who === s.moment.focus && at(prev.who) ? `30°: a new shot of ${prev.who} after panel ${i}` : undefined;
    if (cut) keep.push(newShot(prev!.who, world.solved.actors.get(prev!.who)!.head, prev!, cut));
    const r = await runPanel(s, world, panel, { ...opts, k }, keep);
    panels.push(r);
    const shot = r.shots[0]?.shot;
    if (name && shot?.prefs?.[name] !== undefined && shot.prefs[name] < 0.5) notes.push(`panel ${i + 1}: crosses the line between ${line!.pair.join(' and ')} (180° rule): no good camera on panel ${line!.panel}'s side`);
    if (cut && shot?.prefs?.[cut] !== undefined && shot.prefs[cut] < 0.5) notes.push(`panel ${i + 1}: a jump cut from panel ${i} (the 30° rule): no good camera far enough from the last`);
    prev = !insert && shot ? { who: s.moment.focus, at: world.solved.actors.get(s.moment.focus)!.head, cam: shot.cam.pos, scale: shot.info.subject_size ?? 0 } : undefined;
    if (insert || !shot) continue;
    const pair = axis(world, s.moment.focus);
    if (!pair) continue;
    const d = sideOf(shot.cam.pos, at(pair[0])!, at(pair[1])!);
    if (Math.abs(d) >= ON_LINE) line = { pair, side: Math.sign(d), panel: i + 1 };
    else if (line && line.pair.join() !== pair.join()) line = undefined;
  }
  return { built: null, panels, notes };
}

/**
 * The line of action at an instant: the focus and the person they look at, face or approach (else the nearest other
 * person present), in a fixed order so that "which side" means the same from panel to panel.
 */
function axis(w: World3D, focus: string): [string, string] | null {
  const me = w.solved.actors.get(focus), a = w.scene.actors.find((x) => x.id === focus);
  if (!me || !a) return null;
  const others = [...w.solved.actors.values()].filter((o) => o.id !== focus);
  if (!others.length) return null;
  const named = [a.looks_at, a.facing, a.approaches].find((id) => typeof id === 'string' && w.solved.actors.has(id)) as string | undefined;
  const other = named ?? others.reduce((m, o) => (Math.hypot(o.pos[0] - me.pos[0], o.pos[2] - me.pos[2]) < Math.hypot(m.pos[0] - me.pos[0], m.pos[2] - me.pos[2]) ? o : m)).id;
  return [focus, other].sort() as [string, string];
}

/** From a scene JSON (phases 3–6, no LLM): one panel, the scene's own instant. */
export async function runScene(scene: Scene, opts: RunOpts = {}): Promise<RunResult> {
  return runStoryboard({ version: 1, scene, panels: [opts.intent ? { intent: opts.intent } : {}] }, opts);
}

/** The scene at a panel: its beat (who is where), then its intent (what must be in frame). */
export function panelScene(scene: Scene, p: Panel): Scene {
  const s = p.beat ? atBeat(scene, p.beat) : scene;
  return p.intent ? applyIntent(s, p.intent) : s;
}

/** The strip's rating: each panel's best shot with its intent, averaged (a panel that no longer solves counts 0). */
function rateStrip(scene: Scene, board: Panel[], weights?: Partial<IntentWeights>): Rating {
  const rs = board.map((p) => {
    try { return rate(realize(panelScene(scene, p), scene), { seed: 1, k: 1, ...(p.intent ? { prefer: preferences(p.intent, weights), backLift: backLift(p.intent, weights) } : {}) }); } catch { return { total: 0, terms: {} }; }
  });
  const terms: Record<string, number> = {};
  for (const t of new Set(rs.flatMap((r) => Object.keys(r.terms)))) terms[t] = rs.reduce((a, r) => a + (r.terms[t] ?? 0), 0) / rs.length;
  return { total: rs.reduce((a, r) => a + r.total, 0) / rs.length, terms };
}

async function runPanel(s: Scene, world: World3D, p: Panel, opts: RunOpts, extra: Preference[] = []): Promise<PanelResult> {
  const prefer = [...(p.intent ? preferences(p.intent, opts.intentWeights) : []), ...extra];
  const { shots } = shoot(world, { k: opts.k ?? 3, ...opts.search, ...(prefer.length ? { prefer } : {}), ...(p.intent ? { backLift: backLift(p.intent, opts.intentWeights) } : {}) });
  const results: ShotResult[] = [];
  for (const shot of shots) {
    const m = maps(world, shot.cam);
    let image: Image | null = null, note: string | undefined, meta: Record<string, unknown> | undefined;
    if (opts.generator) {
      try {
        ({ image, meta } = await opts.generator.generate({ scene: s, shot, maps: m, width: SIZE[shot.cam.aspect].w, height: SIZE[shot.cam.aspect].h }));
      } catch (e) {
        if (!(e instanceof GeneratorUnavailable)) throw e;
        note = e.message;
      }
    }
    results.push({ shot, maps: m, image, meta, note });
  }
  return { ...(p.beat ? { beat: p.beat } : {}), ...(p.intent ? { intent: p.intent } : {}), world, shots: results };
}
