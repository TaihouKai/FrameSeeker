// node src/cli.ts <scene.json> [--out dir] [--n 4000] [--seed 1] [--k 3] [--camera cam.json]
// Solves the scene, dresses it, searches cameras (or evaluates the given one), writes previews, depth maps and a report.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { solve } from './solve.ts';
import { dress } from './dress.ts';
import { context, evaluate } from './score.ts';
import { search, type Candidate } from './search.ts';
import { depthMap, preview } from './render.ts';
import { encodePng } from './png.ts';
import { frame, pitch, type Cam } from './camera.ts';
import type { Scene } from './scene.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = opt('out'), n = opt('n'), seed = opt('seed'), k = opt('k'), camFile = opt('camera');
const file = args[0];
if (!file) { console.error('usage: node src/cli.ts <scene.json> [--out dir] [--n 4000] [--seed 1] [--k 3] [--camera cam.json]'); process.exit(2); }

const scene = JSON.parse(readFileSync(file, 'utf8')) as Scene;
const solved = solve(scene);
const world = dress(solved);
const ctx = context(solved, world);
const dir = out ?? join('out', basename(file).replace(/\.json$/, ''));
mkdirSync(dir, { recursive: true });

const t0 = Date.now();
let picked: Candidate[];
let stats: Record<string, unknown> = {};
if (camFile) {
  const cam = JSON.parse(readFileSync(camFile, 'utf8')) as Cam;
  picked = [{ cam, ev: evaluate(ctx, cam) }];
} else {
  const r = search(ctx, { n: n ? Number(n) : undefined, seed: seed ? Number(seed) : undefined, k: k ? Number(k) : undefined });
  picked = r.candidates;
  stats = { sampled: r.sampled, accepted: r.accepted, rejects: r.rejects };
}
const ms = Date.now() - t0;

const report = {
  scene: file, notes: solved.notes, seconds: ms / 1000, ...stats,
  lines: [...solved.lines.values()].map((l) => ({ id: l.id, hits: l.hits, floor: l.floor })),
  candidates: picked.map((c, i) => {
    const name = `cand-${i + 1}`;
    writeFileSync(join(dir, `${name}.png`), png(preview(solved, world, c.cam)));
    writeFileSync(join(dir, `${name}-depth.png`), png(depthMap(world, c.cam, 0.5)));
    const f = frame(c.cam);
    return { name, total: round(c.ev.total), ok: c.ev.ok, reject: c.ev.reject, terms: mapRound(c.ev.terms), info: mapRound(c.ev.info),
      camera: { ...c.cam, pos: c.cam.pos.map(round), target: c.cam.target.map(round), roll: round(c.cam.roll), height: round(c.cam.pos[1]), pitch_deg: round(pitch(f) * 180 / Math.PI) } };
  }),
};
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${file}: ${picked.length} candidate(s) in ${(ms / 1000).toFixed(1)} s -> ${dir}`);
for (const c of report.candidates) console.log(`  ${c.name}: ${c.ok ? c.total : 'REJECTED ' + c.reject}  h=${c.camera.height} m pitch=${c.camera.pitch_deg}° f=${c.camera.focal}mm ${c.camera.aspect}`);
if (solved.notes.length) console.log('notes:\n  ' + solved.notes.join('\n  '));

function png(img: { width: number; height: number; channels: 1 | 3; pixels: Uint8Array }) { return encodePng(img.width, img.height, img.pixels, img.channels); }
function round(x: number) { return Math.round(x * 1000) / 1000; }
function mapRound(o: Record<string, number | undefined>) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? v : round(v)])); }
