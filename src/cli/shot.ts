// npm run shot -- <scene.json> [--out dir] [--n 4000] [--seed 1] [--k 3] [--camera cam.json] [--intent intent.json]
// Phases 3–5 on a scene file, for inspecting the camera search: previews, depth maps and every term of the score
// (or the score of one given camera). With --intent, the search also weighs the intent's devices (src/intent/).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { realize, type Scene } from '../scene/index.ts';
import { maps, rateCamera, shoot, type Cam, type Shot } from '../camera/index.ts';
import { toPng } from '../shared/image.ts';
import { preferences, backLift, applyIntent, type ShotIntent } from '../intent/index.ts';
import { loadConfig } from './config.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = opt('out'), n = opt('n'), seed = opt('seed'), k = opt('k'), camFile = opt('camera'), intentFile = opt('intent');
const file = args[0];
if (!file) { console.error('usage: npm run shot -- <scene.json> [--out dir] [--n 4000] [--seed 1] [--k 3] [--camera cam.json] [--intent intent.json]'); process.exit(2); }

const intent = intentFile ? JSON.parse(readFileSync(intentFile, 'utf8')) as ShotIntent : undefined;
const scene0 = JSON.parse(readFileSync(file, 'utf8')) as Scene;
const w = realize(intent ? applyIntent(scene0, intent) : scene0);
const dir = out ?? join('out', basename(file).replace(/\.json$/, '') + (intentFile ? '-' + basename(intentFile).replace(/\.json$/, '') : ''));
mkdirSync(dir, { recursive: true });

const t0 = Date.now();
let picked: (Shot & { ok: boolean; reject?: string })[];
let stats: Record<string, unknown> = {};
if (camFile) {
  const cam = JSON.parse(readFileSync(camFile, 'utf8')) as Cam;
  const ev = rateCamera(w, cam);
  picked = [{ cam, total: ev.total, terms: ev.terms, info: ev.info, ok: ev.ok, reject: ev.reject }];
} else {
  const r = shoot(w, { n: n ? Number(n) : undefined, seed: seed ? Number(seed) : undefined, k: k ? Number(k) : undefined, ...(intent ? { prefer: preferences(intent, loadConfig().intent), backLift: backLift(intent, loadConfig().intent) } : {}) });
  picked = r.shots.map((s) => ({ ...s, ok: true }));
  stats = { sampled: r.sampled, accepted: r.accepted, rejects: r.rejects };
}
const ms = Date.now() - t0;

const report = {
  scene: file, notes: w.solved.notes, seconds: ms / 1000, ...stats,
  lines: [...w.solved.lines.values()].map((l) => ({ id: l.id, hits: l.hits, floor: l.floor })),
  candidates: picked.map((c, i) => {
    const name = `cand-${i + 1}`;
    const m = maps(w, c.cam);
    writeFileSync(join(dir, `${name}.png`), toPng(m.preview));
    writeFileSync(join(dir, `${name}-depth.png`), toPng(m.depth));
    writeFileSync(join(dir, `${name}-lineart.png`), toPng(m.lineart));
    writeFileSync(join(dir, `${name}-pose.png`), toPng(m.pose));
    return { name, total: round(c.total), ok: c.ok, reject: c.reject, terms: mapRound(c.terms), ...(c.prefs ? { intent: mapRound(c.prefs) } : {}), info: mapRound(c.info),
      camera: { ...c.cam, pos: c.cam.pos.map(round), target: c.cam.target.map(round), roll: round(c.cam.roll), height: round(c.cam.pos[1]), pitch_deg: round(c.info.pitch_deg ?? NaN) } };
  }),
};
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${file}: ${picked.length} candidate(s) in ${(ms / 1000).toFixed(1)} s -> ${dir}`);
for (const c of report.candidates) console.log(`  ${c.name}: ${c.ok ? c.total : 'REJECTED ' + c.reject}  h=${c.camera.height} m pitch=${c.camera.pitch_deg}° f=${c.camera.focal}mm ${c.camera.aspect}${c.intent ? '  intent ' + Object.entries(c.intent).map(([key, v]) => key + '=' + v).join(' ') : ''}`);
if (w.solved.notes.length) console.log('notes:\n  ' + w.solved.notes.join('\n  '));

function round(x: number) { return Math.round(x * 1000) / 1000; }
function mapRound(o: Record<string, number | undefined>) { return Object.fromEntries(Object.entries(o).map(([key, v]) => [key, v === undefined ? v : round(v)])); }
