// The three modules wired together: scene (phases 1–3) → camera (4–5) → generate (6).
// Each module only sees the one before it through its index.ts contract; swap any module by keeping that contract.
import { buildScenes, realize, type Built, type Chat, type Scene, type World3D } from './scene/index.ts';
import { maps, rate, shoot, SIZE, type SearchOpts, type Shot, type ShotMaps } from './camera/index.ts';
import { GeneratorUnavailable, promptOf, type Generator, type PoseCheck, type Prompt } from './generate/index.ts';
import type { Image } from './shared/image.ts';

/** check: how the picture's people follow the plan (pose detector), when the generator measured it */
export interface ShotResult { shot: Shot; maps: ShotMaps; prompt: Prompt; image: Image | null; check?: PoseCheck; candidates?: PoseCheck[]; note?: string }
export interface RunResult { built: Built | null; world: World3D; shots: ShotResult[] }

export interface RunOpts {
  /** cameras to keep (default 3) */
  k?: number;
  search?: SearchOpts;
  /** phase 6; omitted or unavailable (not configured, not implemented) → maps and prompts only */
  generator?: Generator;
}

/** From story text (needs an LLM for phases 1–2). */
export async function runText(text: string, opts: RunOpts & { chat: Chat; focus?: string; people?: { name: string; description: string }[] }): Promise<RunResult> {
  const built = await buildScenes(text, { chat: opts.chat, focus: opts.focus, people: opts.people, rate: (w) => rate(w) });
  return { ...(await runScene(built.winner.scene, opts)), built };
}

/** From a scene JSON (phases 3–6, no LLM). */
export async function runScene(scene: Scene, opts: RunOpts = {}): Promise<RunResult> {
  const world = realize(scene);
  const { shots } = shoot(world, { k: opts.k ?? 3, ...opts.search });
  const results: ShotResult[] = [];
  for (const shot of shots) {
    const m = maps(world, shot.cam);
    const prompt = promptOf(scene, shot, m.people, m.regions.filter((r) => r.kind === 'environment').map((r) => r.id));
    let image: Image | null = null, note: string | undefined, check: PoseCheck | undefined, candidates: PoseCheck[] | undefined;
    if (opts.generator) {
      try {
        ({ image, check, checks: candidates } = await opts.generator.generate({ maps: m, prompt, width: SIZE[shot.cam.aspect].w, height: SIZE[shot.cam.aspect].h }));
      } catch (e) {
        if (!(e instanceof GeneratorUnavailable)) throw e;
        note = e.message;
      }
    }
    results.push({ shot, maps: m, prompt, image, check, candidates, note });
  }
  return { built: null, world, shots: results };
}
