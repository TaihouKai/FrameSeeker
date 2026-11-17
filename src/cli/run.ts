// npm run frameseeker -- <story.txt | scene.json> [--focus "..."] [--people people.json] [--k 3] [--generator comfy|novelai] [--out dir]
// The whole pipeline. A .txt goes through all six phases (phases 1–2 call the LLM: Venice, the local test key);
// a .json scene starts at phase 3. Writes per shot: preview, depth, lineart, pose, a mask per person, the prompt; and report.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { runScene, runText } from '../pipeline.ts';
import { veniceChat, type Scene } from '../scene/index.ts';
import { GENERATORS } from '../generate/index.ts';
import { toPng } from '../shared/image.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const focus = opt('focus'), peopleFile = opt('people'), k = Number(opt('k') ?? 3), genName = opt('generator'), outOpt = opt('out');
const file = args[0];
if (!file) { console.error('usage: npm run frameseeker -- <story.txt | scene.json> [--focus "..."] [--people people.json] [--k 3] [--generator comfy|novelai] [--out dir]'); process.exit(2); }
const generator = genName ? GENERATORS[genName] : undefined;
if (genName && !generator) { console.error(`unknown generator "${genName}" (${Object.keys(GENERATORS).join(', ')})`); process.exit(2); }

const out = outOpt ?? join('out', 'run-' + basename(file, extname(file)));
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const isText = extname(file) === '.txt';
const chat = isText ? veniceChat() : null;
const r = isText
  ? await runText(readFileSync(file, 'utf8'), { chat: chat!, focus, people: peopleFile ? JSON.parse(readFileSync(peopleFile, 'utf8')) : [], k, generator })
  : await runScene(JSON.parse(readFileSync(file, 'utf8')) as Scene, { k, generator });

if (r.built) writeFileSync(join(out, 'scene.json'), JSON.stringify(r.built.winner.scene, null, 1));
r.shots.forEach((s, i) => {
  const n = `shot-${i + 1}`;
  writeFileSync(join(out, `${n}-preview.png`), toPng(s.maps.preview));
  writeFileSync(join(out, `${n}-depth.png`), toPng(s.maps.depth));
  writeFileSync(join(out, `${n}-lineart.png`), toPng(s.maps.lineart));
  writeFileSync(join(out, `${n}-pose.png`), toPng(s.maps.pose));
  for (const g of s.maps.regions) writeFileSync(join(out, `${n}-mask-${g.id}.png`), toPng(g.mask));
  writeFileSync(join(out, `${n}-prompt.json`), JSON.stringify(s.prompt, null, 1));
  if (s.image) writeFileSync(join(out, `${n}.png`), toPng(s.image));
});
const report = {
  input: file, seconds: (Date.now() - t0) / 1000, usd: chat ? (chat as unknown as { spent: () => number }).spent() : 0,
  staging: r.built ? { winner: r.built.winner.name, plans: r.built.stagings.map((s) => ({ name: s.name, total: +s.rating.total.toFixed(3), accepted: s.accepted.length, dropped: s.dropped.length, refused: s.refused.length })) } : null,
  notes: r.world.solved.notes,
  shots: r.shots.map((s, i) => ({ name: `shot-${i + 1}`, total: +s.shot.total.toFixed(3), camera: s.shot.cam, info: s.shot.info,
    regions: s.maps.regions.map((g) => ({ id: g.id, kind: g.kind, area: +g.area.toFixed(4), centre: g.centre.map((v) => +v.toFixed(3)), box: g.box.map((v) => +v.toFixed(3)) })),
    generated: !!s.image, note: s.note })),
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${file}: ${r.shots.length} shot(s) in ${report.seconds.toFixed(1)} s -> ${out}${r.built ? `  (staging: ${r.built.winner.name}, $${report.usd.toFixed(4)})` : ''}`);
for (const s of report.shots) console.log(`  ${s.name}: ${s.total}  h=${s.info.camera_height?.toFixed(2)} m pitch=${s.info.pitch_deg?.toFixed(0)}° ${s.camera.focal}mm ${s.camera.aspect}${s.note ? '  [' + s.note + ']' : ''}`);
