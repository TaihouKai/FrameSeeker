// npm run frameseeker -- <story.txt | scene.json> [--panels 1] [--focus "..."] [--people people.json] [--k 3] [--intent intent.json] [--no-intent] [--generator <name>] [--out dir]
// The whole pipeline. A .txt goes through all six phases (phases 1–2 and the storyboard call the LLM: Venice, the
// local test key). --panels N draws the story as N pictures, each one instant with its own intent (a strip); with one,
// the LLM writes the shot's intent unless --intent gives one or --no-intent skips it. A .json scene starts at phase 3
// (one panel). Writes per shot: preview, depth, lineart, pose, a mask per region, the colour hint (effects); with
// several panels each file is prefixed panel-<i>-, and strip.png puts the panels' first shots side by side;
// report.json has everything.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { runScene, runText } from '../pipeline.ts';
import { veniceChat, type Scene } from '../scene/index.ts';
import { GENERATORS } from '../generate/index.ts';
import { hstack, toPng } from '../shared/image.ts';
import type { ShotIntent } from '../intent/index.ts';
import { loadConfig } from './config.ts';

const USAGE = 'usage: npm run frameseeker -- <story.txt | scene.json> [--panels 1] [--focus "..."] [--people people.json] [--k 3] [--intent intent.json] [--no-intent] [--generator <name>] [--out dir]';
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const noIntent = flag('no-intent');
const focus = opt('focus'), peopleFile = opt('people'), kOpt = opt('k'), genName = opt('generator'), outOpt = opt('out'), intentFile = opt('intent'), panels = Number(opt('panels') ?? 1);
const k = kOpt ? Number(kOpt) : undefined;
const intent = intentFile ? JSON.parse(readFileSync(intentFile, 'utf8')) as ShotIntent : undefined, intentWeights = loadConfig().intent;
const file = args[0];
if (!file || !(panels >= 1)) { console.error(USAGE); process.exit(2); }
if (panels > 1 && intent) { console.error('--intent is for one panel; with several, the storyboard writes each panel\'s intent'); process.exit(2); }
const generator = genName ? GENERATORS[genName] : undefined;
if (genName && !generator) { console.error(`unknown generator "${genName}" (available: ${Object.keys(GENERATORS).join(', ') || 'none: phase 6 is archived, see src/generate/index.ts'})`); process.exit(2); }

const out = outOpt ?? join('out', 'run-' + basename(file, extname(file)));
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const isText = extname(file) === '.txt';
if (!isText && panels > 1) { console.error('--panels needs a story text: a scene JSON is one instant'); process.exit(2); }
const chat = isText ? veniceChat() : null;
const r = isText
  ? await runText(readFileSync(file, 'utf8'), { chat: chat!, focus, people: peopleFile ? JSON.parse(readFileSync(peopleFile, 'utf8')) : [], k, generator, intent, intentWeights, panels, withIntent: !noIntent })
  : await runScene(JSON.parse(readFileSync(file, 'utf8')) as Scene, { k, generator, intent, intentWeights });

if (r.built) writeFileSync(join(out, 'scene.json'), JSON.stringify(r.built.winner.scene, null, 1));
const many = r.panels.length > 1;
r.panels.forEach((p, pi) => p.shots.forEach((s, i) => {
  const n = `${many ? `panel-${pi + 1}-` : ''}shot-${i + 1}`;
  writeFileSync(join(out, `${n}-preview.png`), toPng(s.maps.preview));
  writeFileSync(join(out, `${n}-depth.png`), toPng(s.maps.depth));
  writeFileSync(join(out, `${n}-lineart.png`), toPng(s.maps.lineart));
  writeFileSync(join(out, `${n}-pose.png`), toPng(s.maps.pose));
  for (const g of s.maps.regions) writeFileSync(join(out, `${n}-mask-${g.id}.png`), toPng(g.mask));
  if (s.maps.hint) writeFileSync(join(out, `${n}-hint.png`), toPng(s.maps.hint));
  if (s.image) writeFileSync(join(out, `${n}.png`), toPng(s.image));
}));
if (many) {
  const firsts = r.panels.map((p) => p.shots[0]?.maps.preview).filter((x) => !!x);
  if (firsts.length) writeFileSync(join(out, 'strip.png'), toPng(hstack(firsts, 480, 12)));
}
const round = (v: number) => +v.toFixed(3);
const report = {
  input: file, seconds: (Date.now() - t0) / 1000, usd: chat ? (chat as unknown as { spent: () => number }).spent() : 0,
  staging: r.built ? { winner: r.built.winner.name, plans: r.built.stagings.map((s) => ({ name: s.name, total: round(s.rating.total), accepted: s.accepted.length, dropped: s.dropped.length, refused: s.refused.length })) } : null,
  notes: r.notes,
  panels: r.panels.map((p, pi) => ({
    panel: pi + 1, beat: p.beat ?? null, intent: p.intent ?? null, notes: p.world.solved.notes,
    shots: p.shots.map((s, i) => ({ name: `${many ? `panel-${pi + 1}-` : ''}shot-${i + 1}`, total: round(s.shot.total), camera: s.shot.cam, info: s.shot.info, intent: s.shot.prefs ?? null,
      regions: s.maps.regions.map((g) => ({ id: g.id, kind: g.kind, area: round(g.area), centre: g.centre.map(round), box: g.box.map(round) })),
      generated: !!s.image, meta: s.meta, note: s.note })),
  })),
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${file}: ${r.panels.length} panel(s) in ${report.seconds.toFixed(1)} s -> ${out}${r.built ? `  (staging: ${r.built.winner.name}, $${report.usd.toFixed(4)})` : ''}`);
for (const n of r.notes) console.log(`  note: ${n}`);
for (const p of report.panels) {
  if (many || p.intent) console.log(`  panel ${p.panel}${p.beat ? `: ${p.beat.what}` : ''}${p.intent ? `\n    intent: ${p.intent.subject} ← ${JSON.stringify(p.intent.convey)}` : ''}`);
  for (const s of p.shots) console.log(`    ${s.name}: ${s.total}  h=${s.info.camera_height?.toFixed(2)} m pitch=${s.info.pitch_deg?.toFixed(0)}° ${s.camera.focal}mm ${s.camera.aspect}${s.intent ? '  ' + Object.entries(s.intent).map(([key, v]) => `${key}=${(+v).toFixed(2)}`).join(' ') : ''}${s.note ? '  [' + s.note + ']' : ''}`);
}
