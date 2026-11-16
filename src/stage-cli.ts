// node src/stage-cli.ts <story.txt> [--focus "..."] [--people people.json] [--out dir] [--model id]
// Text -> extract (0a) -> camera search on the bare stage -> staging plans (0b) -> camera search on each -> the best.
// Uses Venice with the local test key (testing only).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { veniceChat } from './llm/chat.ts';
import { extract } from './llm/extract.ts';
import { applyPlan, propose, RULE_HINTS, type Op } from './llm/stage.ts';
import { judge, MARGIN } from './judge.ts';
import { solve } from './solve.ts';
import { dress } from './dress.ts';
import { context, TERMS } from './score.ts';
import { search, type Candidate } from './search.ts';
import { preview } from './render.ts';
import { encodePng } from './png.ts';
import type { Scene } from './scene.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const focus = opt('focus'), peopleFile = opt('people'), outOpt = opt('out'), model = opt('model');
const file = args[0];
if (!file) { console.error('usage: node src/stage-cli.ts <story.txt> [--focus "..."] [--people people.json] [--out dir] [--model id]'); process.exit(2); }
const text = readFileSync(file, 'utf8');
const people = peopleFile ? JSON.parse(readFileSync(peopleFile, 'utf8')) : [];
const out = outOpt ?? join('out', 'stage-' + basename(file).replace(/\.txt$/, ''));
mkdirSync(out, { recursive: true });
const chat = veniceChat(model);

const shoot = (scene: Scene) => {
  const s = solve(scene), w = dress(s), ctx = context(s, w);
  const r = search(ctx, { seed: 1, k: 1 });
  return { solved: s, world: w, best: r.candidates[0] as Candidate | undefined };
};
const weakTerms = (c: Candidate | undefined) => c ? Object.entries(c.ev.terms).filter(([t]) => TERMS.includes(t as never)).sort((a, b) => a[1]! - b[1]!).slice(0, 4) : [];
const weakest = (c: Candidate | undefined) => weakTerms(c).map(([t, v]) => `${t} ${v!.toFixed(2)}`);

const t0 = Date.now();
const ex = await extract(chat, { text, focus, people });
writeFileSync(join(out, 'extract.json'), JSON.stringify(ex, null, 1));
const bare = shoot(ex);
const bareInfo = { best_score: bare.best ? +bare.best.ev.total.toFixed(3) : 0, weakest_rules: weakTerms(bare.best).filter(([, v]) => v! < 0.9).map(([t, v]) => ({ rule: t, score: +v!.toFixed(2), staging_can: RULE_HINTS[t] })), notes: bare.solved.notes, found_a_shot: !!bare.best };
console.log(`extracted: ${ex.actors.map((a) => `${a.id}(${a.pose})`).join(', ')}; structures: ${ex.structures.map((s) => s.id).join(', ') || '-'}; effects: ${ex.effects.map((e) => e.id).join(', ') || '-'}; moment: ${JSON.stringify(ex.moment)}`);
console.log(`bare stage: ${bareInfo.best_score}  weakest: ${weakest(bare.best).join(', ')}${bare.solved.notes.length ? '  notes: ' + bare.solved.notes.join(' / ') : ''}`);
if (bare.best) writeFileSync(join(out, 'plan-0-bare.png'), png(preview(bare.solved, bare.world, bare.best.cam)));

const plans = await propose(chat, { text, scene: ex, bare: bareInfo });
const results = [{ name: 'bare', total: bareInfo.best_score, accepted: [] as Op[], refused: [] as { op: Op; why: string }[], dropped: [] as { op: Op; without: number }[], scene: ex as Scene }];
const score = (scene: Scene) => { const b = shoot(scene).best; return b ? +b.ev.total.toFixed(3) : 0; };
plans.forEach((p, i) => {
  const applied = applyPlan(ex, p);
  // every kept operation must earn its place in the score
  const j = judge(ex, applied.accepted, p.name, score);
  const final = applyPlan(ex, j.plan);
  const shot = shoot(final.scene);
  const total = shot.best ? +shot.best.ev.total.toFixed(3) : 0;
  results.push({ name: p.name, total, accepted: j.plan.ops, refused: applied.refused, dropped: j.dropped, scene: final.scene });
  if (shot.best) writeFileSync(join(out, `plan-${i + 1}.png`), png(preview(shot.solved, shot.world, shot.best.cam)));
  console.log(`\nplan ${i + 1} "${p.name}": ${total}  (${weakest(shot.best).join(', ')})`);
  for (const op of j.plan.ops) console.log(`  + ${describe(op)}`);
  for (const d of j.dropped) console.log(`  - ${describe(d.op)}  -- dropped: no better than without it (${d.without})`);
  for (const r of applied.refused) console.log(`  x ${describe(r.op)}  -- refused: ${r.why}`);
});
// a plan is used only when it beats the bare stage by the margin
const best = results.slice(1).reduce((a, b) => (b.total > a.total ? b : a), results[0]);
const winner = best !== results[0] && best.total >= results[0].total + MARGIN ? best : results[0];
writeFileSync(join(out, 'report.json'), JSON.stringify({ file, focus, seconds: (Date.now() - t0) / 1000, usd: chat.spent(), bare: bareInfo, plans: results.map((r) => ({ name: r.name, total: r.total, accepted: r.accepted, dropped: r.dropped, refused: r.refused })), winner: winner.name }, null, 1));
writeFileSync(join(out, 'winner.json'), JSON.stringify(winner.scene, null, 1));
console.log(`\nwinner: ${winner.name} (${winner.total})   ${((Date.now() - t0) / 1000).toFixed(0)} s, $${chat.spent().toFixed(4)}`);

function describe(op: Op): string {
  if (op.op === 'add_structure') return `add ${op.structure?.kind} "${op.structure?.id}" ${JSON.stringify(op.structure?.place)} [${op.purpose}] ${op.why}`;
  if (op.op === 'place_actor') return `move ${op.actor} -> ${JSON.stringify(op.place)} [${op.purpose}] ${op.why}`;
  return `move structure ${op.structure} -> ${JSON.stringify(op.place ?? op.facing)} [${op.purpose}] ${op.why}`;
}
function png(img: { width: number; height: number; channels: 1 | 3; pixels: Uint8Array }) { return encodePng(img.width, img.height, img.pixels, img.channels); }
