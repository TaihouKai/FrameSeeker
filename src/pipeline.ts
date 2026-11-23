// The modules wired together: scene (phases 1–3) → intent → camera (4–5) → generate (6).
// Each module only sees the one before it through its index.ts contract; swap any module by keeping that contract.
//
// A story is drawn as one or more panels (a strip). With one panel, the scene's own instant; with several, the scene
// is the set and the cast, and each panel is one instant on it (a beat: who is where) with its own intent, searched
// on its own. One camera need not carry everything the moment has to say: as a director cuts between a low angle on
// one person and a high angle on the other, each panel carries one or two things.
import { atBeat, extractScene, realize, stageScene, type Beat, type Built, type Chat, type Rating, type Scene, type World3D } from './scene/index.ts';
import { maps, rate, shoot, SIZE, type SearchOpts, type Shot, type ShotMaps } from './camera/index.ts';
import { GeneratorUnavailable, type Generator } from './generate/index.ts';
import { storyboard, checkIntent, preferences, applyIntent, type IntentWeights, type Panel, type ShotIntent } from './intent/index.ts';
import type { Image } from './shared/image.ts';

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

/** From a storyboard (phases 3–6, no LLM): each panel's beat is solved on the set, its intent checked against it. */
export async function runStoryboard(board: Storyboard, opts: RunOpts = {}): Promise<RunResult> {
  const notes: string[] = [], panels: PanelResult[] = [];
  const k = opts.k ?? (board.panels.length > 1 ? 1 : 3);
  for (const [i, p] of board.panels.entries()) {
    let panel = p;
    if (p.intent) {
      const c = checkIntent(p.intent, p.beat ? atBeat(board.scene, p.beat) : board.scene);
      notes.push(...c.notes.map((x) => `panel ${i + 1}: ${x}`));
      panel = { ...p, intent: c.intent };
    }
    panels.push(await runPanel(board.scene, panel, { ...opts, k }));
  }
  return { built: null, panels, notes };
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
    try { return rate(realize(panelScene(scene, p), scene), { seed: 1, k: 1, ...(p.intent ? { prefer: preferences(p.intent, weights) } : {}) }); } catch { return { total: 0, terms: {} }; }
  });
  const terms: Record<string, number> = {};
  for (const t of new Set(rs.flatMap((r) => Object.keys(r.terms)))) terms[t] = rs.reduce((a, r) => a + (r.terms[t] ?? 0), 0) / rs.length;
  return { total: rs.reduce((a, r) => a + r.total, 0) / rs.length, terms };
}

async function runPanel(scene: Scene, p: Panel, opts: RunOpts): Promise<PanelResult> {
  const s = panelScene(scene, p);
  const world = realize(s, p.beat ? scene : undefined);
  const { shots } = shoot(world, { k: opts.k ?? 3, ...opts.search, ...(p.intent ? { prefer: preferences(p.intent, opts.intentWeights) } : {}) });
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
