// npm run stage -- <story.txt> [--focus "..."] [--people people.json] [--out dir] [--model id]
// Phases 1–3 in detail, for inspecting extraction and staging: the extracted scene, each staging plan with what was
// kept, dropped (did not raise the score) or refused (broke a rule), and each plan's best shot.
// Uses Venice with the local test key (testing only).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildScenes, realize, veniceChat, type Op } from '../scene/index.ts';
import { maps, rate, shoot } from '../camera/index.ts';
import { toPng } from '../shared/image.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const focus = opt('focus'), peopleFile = opt('people'), outOpt = opt('out'), model = opt('model');
const file = args[0];
if (!file) { console.error('usage: npm run stage -- <story.txt> [--focus "..."] [--people people.json] [--out dir] [--model id]'); process.exit(2); }
const text = readFileSync(file, 'utf8');
const people = peopleFile ? JSON.parse(readFileSync(peopleFile, 'utf8')) : [];
const out = outOpt ?? join('out', 'stage-' + basename(file).replace(/\.txt$/, ''));
mkdirSync(out, { recursive: true });
const chat = veniceChat(model);

const t0 = Date.now();
const built = await buildScenes(text, { chat, focus, people, rate: (w) => rate(w) });
writeFileSync(join(out, 'extract.json'), JSON.stringify(built.extracted, null, 1));
const ex = built.extracted;
console.log(`extracted: ${ex.actors.map((a) => `${a.id}(${a.pose})`).join(', ')}; structures: ${ex.structures.map((s) => s.id).join(', ') || '-'}; effects: ${ex.effects.map((e) => e.id).join(', ') || '-'}; moment: ${JSON.stringify(ex.moment)}`);
if (built.notes.length) console.log('notes: ' + built.notes.join(' / '));

built.stagings.forEach((s, i) => {
  const w = realize(s.scene), best = shoot(w, { seed: 1, k: 1 }).shots[0];
  if (best) writeFileSync(join(out, `plan-${i}-${s.name.replace(/\W+/g, '_')}.png`), toPng(maps(w, best.cam).preview));
  const weak = Object.entries(s.rating.terms).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([t, v]) => `${t} ${v.toFixed(2)}`);
  console.log(`\nplan ${i} "${s.name}": ${s.rating.total.toFixed(3)}  (${weak.join(', ')})`);
  for (const op of s.accepted) console.log(`  + ${describe(op)}`);
  for (const d of s.dropped) console.log(`  - ${describe(d.op)}  -- dropped: no better than without it (${d.without})`);
  for (const r of s.refused) console.log(`  x ${describe(r.op)}  -- refused: ${r.why}`);
});
writeFileSync(join(out, 'report.json'), JSON.stringify({
  file, focus, seconds: (Date.now() - t0) / 1000, usd: chat.spent(), winner: built.winner.name,
  plans: built.stagings.map((s) => ({ name: s.name, rating: s.rating, accepted: s.accepted, dropped: s.dropped, refused: s.refused })),
}, null, 1));
writeFileSync(join(out, 'winner.json'), JSON.stringify(built.winner.scene, null, 1));
console.log(`\nwinner: ${built.winner.name} (${built.winner.rating.total.toFixed(3)})   ${((Date.now() - t0) / 1000).toFixed(0)} s, $${chat.spent().toFixed(4)}`);

function describe(op: Op): string {
  return `${op.op} ${op.structure?.kind} "${op.structure?.id}" ${JSON.stringify(op.structure?.place)} [${op.purpose}] ${op.why}`;
}
