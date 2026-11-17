// Staging is kept only where it measurably helps: each accepted operation is taken out in turn and
// the plan searched again; an operation whose removal does not lower the best score is dropped. A plan must then beat
// the bare stage by a margin, or it is not used.
import type { Op, Plan } from './llm/stage.ts';
import type { Extracted } from './llm/extract.ts';
import { applyPlan } from './llm/stage.ts';

export const MARGIN = 0.02;

export interface Judged { plan: Plan; total: number; dropped: { op: Op; without: number }[] }

/** shoot: a scene's best camera score (0 when no camera is acceptable). */
export function judge(base: Extracted, accepted: Op[], name: string, shoot: (scene: ReturnType<typeof applyPlan>['scene']) => number): Judged {
  let ops = [...accepted];
  let total = shoot(applyPlan(base, { name, ops }).scene);
  const dropped: { op: Op; without: number }[] = [];
  for (const op of [...ops]) {
    const rest = ops.filter((o) => o !== op);
    const without = shoot(applyPlan(base, { name, ops: rest }).scene);
    if (without >= total - 0.005) { dropped.push({ op, without }); ops = rest; total = Math.max(total, without); }
  }
  return { plan: { name, ops }, total, dropped };
}
