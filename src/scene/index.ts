// Module 1 — the scene (phases 1–3): story text → scene JSON (extract, faithful) → staging plans (additive only,
// each operation kept only if the camera score says it helps) → 3D worlds (solve relations to coordinates, then
// deterministic set dressing). The camera module's score is injected (`score`), so this module never imports it.
import type { Scene } from './types.ts';
import { solve, type Solved } from './solve.ts';
import { dress } from './dress.ts';
import { extract } from './llm/extract.ts';
import { applyPlan, propose, RULE_HINTS, type Op } from './llm/stage.ts';
export { layoutOf } from './llm/stage.ts';
export { atBeat, pinned } from './beat.ts';
import { judge, MARGIN } from './judge.ts';
import type { Chat } from './llm/chat.ts';
import type { World } from '../shared/geom.ts';

export type * from './types.ts';
export { INDOOR_KINDS, PLACE_KINDS, roomOf } from './types.ts';
// the solved 3D world, as the camera module reads it
export type { Solved, SolvedActor, SolvedStructure, SolvedLine, SolvedVolume, SolvedDamage } from './solve.ts';
// the pose library (the names the solver accepts)
export { POSES, type Pose } from './poses.ts';
// who points the eye at whom (looks, faces, aims, line effects), and the check of a chosen focus against it
export { cues, support, attended, checkFocus, STORY_CUES, CUE_WEIGHT, MIN_SUPPORT, type Cue, type CueKind, type CueSource } from './attention.ts';
export type { Op } from './llm/stage.ts';
export type { Chat, ChatMsg } from './llm/chat.ts';
export { vocabulary } from './llm/vocab.ts';
export { veniceChat, openAiChat } from './llm/chat.ts';

/** A scene made concrete: the JSON, its solved geometry, and the dressed world the camera looks at. */
export interface World3D { scene: Scene; solved: Solved; world: World }

/**
 * Phase 3: the scene JSON → the 3D world (deterministic). Throws on an unsolvable scene. set: for one beat of a
 * sequence (atBeat), the whole scene, so the set dressing is the same in every panel.
 */
export function realize(scene: Scene, set?: Scene): World3D {
  const solved = solve(scene);
  return { scene, solved, world: dress(solved, set ? solve(set) : solved) };
}

/** What the camera module reports about a world: its best shot's score and per-rule terms (0 / {} when none is acceptable). */
export interface Rating { total: number; terms: Record<string, number> }

export interface Staging {
  name: string;
  scene: Scene;
  rating: Rating;
  accepted: Op[];
  dropped: { op: Op; without: number }[];
  refused: { op: Op; why: string }[];
}
export interface Built {
  extracted: Scene;
  /** 'bare' (the extracted scene) first, then each staging plan */
  stagings: Staging[];
  /** the bare scene unless a plan beats it by MARGIN */
  winner: Staging;
  notes: string[];
}

/** Phases 1–3 from text. `rate` is the camera module's judgement of a world (see pipeline.ts). */
export async function buildScenes(text: string, opts: {
  chat: Chat;
  rate: (w: World3D) => Rating;
  focus?: string;
  people?: { name: string; description: string }[];
}): Promise<Built> {
  return stageScene(text, await extractScene(text, opts), opts);
}

/**
 * Phase 1: the text's scene, faithful to it. With panels > 1 it is the set and the cast of a sequence: the place,
 * the structures, everyone who appears, every effect (each panel's beat then places the people anew, atBeat).
 */
export function extractScene(text: string, opts: { chat: Chat; focus?: string; people?: { name: string; description: string }[]; panels?: number }): Promise<Scene> {
  return extract(opts.chat, { text, focus: opts.focus, people: opts.people, panels: opts.panels });
}

/** Phase 2: staging plans on the extracted scene, each kept only where `rate` says it helps; then the winner. */
export async function stageScene(text: string, extracted: Scene, opts: { chat: Chat; rate: (w: World3D) => Rating }): Promise<Built> {
  const bareWorld = realize(extracted);
  const bareRating = opts.rate(bareWorld);
  const weakest = Object.entries(bareRating.terms).filter(([t, v]) => v < 0.9 && RULE_HINTS[t]).sort((a, b) => a[1] - b[1]).slice(0, 4)
    .map(([t, v]) => ({ rule: t, score: +v.toFixed(2), staging_can: RULE_HINTS[t] }));
  const bare: Staging = { name: 'bare', scene: extracted, rating: bareRating, accepted: [], dropped: [], refused: [] };
  const plans = await propose(opts.chat, {
    text, scene: extracted,
    bare: { best_score: +bareRating.total.toFixed(3), weakest_rules: weakest, notes: bareWorld.solved.notes, found_a_shot: bareRating.total > 0 },
  });
  const total = (scene: Scene) => opts.rate(realize(scene)).total;
  const stagings: Staging[] = [bare];
  for (const p of plans) {
    const applied = applyPlan(extracted, p);
    const j = judge(extracted, applied.accepted, p.name, total);
    const final = applyPlan(extracted, j.plan);
    stagings.push({ name: p.name, scene: final.scene, rating: opts.rate(realize(final.scene)), accepted: j.plan.ops, dropped: j.dropped, refused: applied.refused });
  }
  const best = stagings.slice(1).reduce((a, b) => (b.rating.total > a.rating.total ? b : a), bare);
  const winner = best !== bare && best.rating.total >= bare.rating.total + MARGIN ? best : bare;
  return { extracted, stagings, winner, notes: bareWorld.solved.notes };
}
