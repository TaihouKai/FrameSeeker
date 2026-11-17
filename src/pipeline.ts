// The modules wired together: scene (phases 1–3) → intent → camera (4–5) → generate (6).
// Each module only sees the one before it through its index.ts contract; swap any module by keeping that contract.
import { buildScenes, realize, type Built, type Chat, type Scene, type World3D } from './scene/index.ts';
import { maps, rate, shoot, SIZE, type SearchOpts, type Shot, type ShotMaps } from './camera/index.ts';
import { GeneratorUnavailable, type Generator } from './generate/index.ts';
import { extractIntent, preferences, applyIntent, type IntentWeights, type ShotIntent } from './intent/index.ts';
import type { Image } from './shared/image.ts';

/** meta: what the renderer reported (its prompt, its checks) */
export interface ShotResult { shot: Shot; maps: ShotMaps; image: Image | null; meta?: Record<string, unknown>; note?: string }
export interface RunResult { built: Built | null; world: World3D; shots: ShotResult[]; intent?: ShotIntent; intentNotes?: string[] }

export interface RunOpts {
  /** cameras to keep (default 3) */
  k?: number;
  search?: SearchOpts;
  /** phase 6; omitted or unavailable (not configured, not implemented) → the maps only */
  generator?: Generator;
  /** what the shot must make the viewer understand: its devices become the camera search's preferences */
  intent?: ShotIntent;
  /** how much each kind of intent weighs (frameseeker.config.json) */
  intentWeights?: Partial<IntentWeights>;
}

/** From story text (needs an LLM for phases 1–2). */
export async function runText(text: string, opts: RunOpts & { chat: Chat; focus?: string; people?: { name: string; description: string }[]; withIntent?: boolean }): Promise<RunResult> {
  const built = await buildScenes(text, { chat: opts.chat, focus: opts.focus, people: opts.people, rate: (w) => rate(w) });
  // the intent from the same text, unless one is given
  const got = !opts.intent && opts.withIntent ? await extractIntent(text, built.winner.scene, opts.chat) : null;
  const r = await runScene(built.winner.scene, { ...opts, intent: opts.intent ?? got?.intent });
  return { ...r, built, ...(got ? { intentNotes: got.notes } : {}) };
}

/** From a scene JSON (phases 3–6, no LLM). */
export async function runScene(scene: Scene, opts: RunOpts = {}): Promise<RunResult> {
  if (opts.intent) scene = applyIntent(scene, opts.intent);
  const world = realize(scene);
  const { shots } = shoot(world, { k: opts.k ?? 3, ...opts.search, ...(opts.intent ? { prefer: preferences(opts.intent, opts.intentWeights) } : {}) });
  const results: ShotResult[] = [];
  for (const shot of shots) {
    const m = maps(world, shot.cam);
    let image: Image | null = null, note: string | undefined, meta: Record<string, unknown> | undefined;
    if (opts.generator) {
      try {
        ({ image, meta } = await opts.generator.generate({ scene, shot, maps: m, width: SIZE[shot.cam.aspect].w, height: SIZE[shot.cam.aspect].h }));
      } catch (e) {
        if (!(e instanceof GeneratorUnavailable)) throw e;
        note = e.message;
      }
    }
    results.push({ shot, maps: m, image, meta, note });
  }
  return { built: null, world, shots: results, ...(opts.intent ? { intent: opts.intent } : {}) };
}
