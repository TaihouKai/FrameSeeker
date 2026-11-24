// A storyboard's panels checked with the camera before anything is drawn. The LLM writes what each panel must convey
// without seeing a camera; some pairs no single camera can serve at that instant (a face read up close and a person
// small and alone; two faces three metres apart, turned to each other). That is measured, not listed: the camera
// search is run on the panel with both things and with each alone. A thing met alone but not with the other is a
// conflict; one not met even alone cannot be shown at that instant (the pose or facing hides it). Two panels in a row
// that are the same instant with the same intent are a repeat. The problems go back to the storyboard's author.
import { atBeat, realize, type Scene, type World3D } from '../scene/index.ts';
import { shoot, type SearchOpts } from '../camera/index.ts';
import { applyIntent } from './apply.ts';
import { label, preferences } from './devices.ts';
import type { Panel } from './storyboard.ts';
import type { Convey, ShotIntent } from './types.ts';

/** A thing to convey counts as met when its device scores this much in the best shot (the middle of its ramps). */
export const MET = 0.5;

export interface Problem {
  /** 1-based, as the storyboard's author counts them */
  panel: number;
  kind: 'conflict' | 'unshowable' | 'repeat';
  /** for the storyboard's author */
  text: string;
  /** for a conflict: the index of the thing to drop if the author cannot fix it (the less important one) */
  drop?: number;
}

const show = (c: Convey): string => {
  switch (c.what) {
    case 'sees': return `sees(${c.who} → ${c.target})`;
    case 'together': return `together(${c.who.join(', ')})`;
    case 'scale': return `scale(${c.who} against ${c.against})`;
    case 'detail': return `detail(${c.who}, ${c.part})`;
    case 'power': return c.over ? `power(${c.who} over ${c.over})` : `power(${c.who})`;
    default: return `${c.what}(${c.who})`;
  }
};

/** How well the best shot meets each thing (by its label), searched for the intent at the panel's instant. */
function met(scene: Scene, set: Scene | undefined, intent: ShotIntent, search: SearchOpts): Record<string, number> {
  const w = realize(applyIntent(scene, intent), set);
  const best = shoot(w, { seed: 1, k: 1, ...search, prefer: preferences(intent) }).shots[0];
  return best?.prefs ?? {};
}

export function review(scene: Scene, panels: Panel[], opts: { search?: SearchOpts } = {}): Problem[] {
  const search = { ...opts.search };
  const problems: Problem[] = [];
  const worlds: (World3D | null)[] = [];
  panels.forEach((p, i) => {
    const at = p.beat ? atBeat(scene, p.beat) : scene, set = p.beat ? scene : undefined;
    worlds.push(realize(at, set));
    const intent = p.intent;
    if (!intent?.convey.length) return;
    const both = met(at, set, intent, search);
    intent.convey.forEach((c, j) => {
      if ((both[label(c)] ?? 0) >= MET) return;
      const alone = intent.convey.length > 1 ? met(at, set, { ...intent, convey: [c] }, search)[label(c)] ?? 0 : both[label(c)] ?? 0;
      if (alone >= MET) {
        if (problems.some((x) => x.panel === i + 1 && x.kind === 'conflict')) return;
        const other = intent.convey.filter((_, k) => k !== j).map(show).join(', ');
        problems.push({ panel: i + 1, kind: 'conflict', drop: intent.convey.length - 1,
          text: `panel ${i + 1}: ${show(c)} and ${other} cannot be shown by one camera at this instant (a camera that serves ${other} meets ${show(c)} at ${(both[label(c)] ?? 0).toFixed(2)}, on its own at ${alone.toFixed(2)}). Keep one of them for this panel, give the other its own panel, or change the instant (where the people are, which way they face) so one camera can show both.` });
      } else {
        problems.push({ panel: i + 1, kind: 'unshowable',
          text: `panel ${i + 1}: ${show(c)} cannot be shown at this instant: even a camera looking for nothing else meets it at ${alone.toFixed(2)} (for a face: they must face somewhere a camera can stand, not into a wall or the ground). Change the instant (pose, facing, place) or what the panel conveys.` });
      }
    });
  });
  for (let i = 1; i < panels.length; i++) if (same(panels[i - 1], panels[i], worlds[i - 1], worlds[i])) {
    problems.push({ panel: i + 1, kind: 'repeat', text: `panels ${i} and ${i + 1} are the same instant (the same people, poses and places) with the same intent: make each panel a different moment of the story.` });
  }
  return problems;
}

/** The same people in the same poses within half a metre, and the same things to convey. */
function same(a: Panel, b: Panel, wa: World3D | null, wb: World3D | null): boolean {
  if (!wa || !wb) return false;
  const ia = [...wa.solved.actors.keys()].sort(), ib = [...wb.solved.actors.keys()].sort();
  if (ia.join() !== ib.join()) return false;
  for (const id of ia) {
    const x = wa.solved.actors.get(id)!, y = wb.solved.actors.get(id)!;
    const pose = (w: World3D) => w.scene.actors.find((q) => q.id === id)?.pose;
    if (pose(wa) !== pose(wb) || Math.hypot(x.pos[0] - y.pos[0], x.pos[2] - y.pos[2]) > 0.5) return false;
  }
  const kinds = (p: Panel) => (p.intent?.convey ?? []).map(label).sort().join('|');
  return kinds(a) === kinds(b);
}
