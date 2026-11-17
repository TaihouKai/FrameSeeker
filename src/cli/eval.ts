// npm run eval -- [eval/refs/<episode>.annot.json ...] [--only id] [--n 3000] [--previews]
// Evaluation A over the annotated reference shots: prints a table and writes out/eval/report.json (and, with
// --previews, the rebuilt scene seen by each reference camera, to check the rebuild against the frame).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalRef, type RefResult } from '../eval/eval.ts';
import { rebuild, type RefFrame } from '../eval/refs.ts';
import { solve } from '../scene/solve.ts';
import { dress } from '../scene/dress.ts';
import { preview } from '../camera/render.ts';
import { encodePng } from '../shared/png.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
const only = opt('only'), n = Number(opt('n') ?? 3000), previews = flag('previews');
const files = args.length ? args : readdirSync('eval/refs').filter((f) => f.endsWith('.annot.json')).map((f) => join('eval/refs', f));
const refs: RefFrame[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as RefFrame[]).filter((r) => !only || r.id === only);
mkdirSync('out/eval', { recursive: true });

const results: RefResult[] = [];
for (const r of refs) {
  if (previews) {
    const b = rebuild(r), s = solve(b.scene), w = dress(s), img = preview(s, w, b.cam);
    writeFileSync(join('out/eval', r.id.replace('#', '-') + '.png'), encodePng(img.width, img.height, img.pixels, img.channels));
  }
  const x = evalRef(r, { n });
  results.push(x);
  const status = !x.rebuild_ok ? 'REBUILD FAILED (focus hidden)' : x.ref.ok ? x.ref.total.toFixed(3) : `REJECTED (${x.ref.reject})`;
  console.log(`${x.id.padEnd(18)} ref ${status.padEnd(28)} pct ${isNaN(x.percentile) ? '-' : (x.percentile * 100).toFixed(0).padStart(3)}%  top3 ${x.near_in_top3 ? 'HIT ' : 'miss'}  reproj ${x.reprojection_px.toFixed(0)}px  h ${x.camera.height.toFixed(2)}m pitch ${x.camera.pitch_deg.toFixed(0)}° ${x.camera.focal.toFixed(0)}mm${x.estimated.length ? '  est: ' + x.estimated.join(',') : ''}`);
}
// the scorer is judged on the shots whose rebuild agrees with the frame; rebuild failures are reported apart
const valid = results.filter((x) => x.rebuild_ok);
const ok = valid.filter((x) => x.ref.ok);
// a rejected reference counts as the 0th percentile
const pcts = valid.map((x) => (x.ref.ok ? x.percentile : 0)).sort((a, b) => a - b);
const summary = {
  refs: results.length,
  rebuild_failed: results.length - valid.length,
  scored: valid.length,
  rejected: valid.length - ok.length,
  rejections: Object.fromEntries([...new Set(valid.filter((x) => !x.ref.ok).map((x) => x.ref.reject!))].map((k) => [k, valid.filter((x) => x.ref.reject === k).length])),
  median_percentile: pcts.length ? pcts[Math.floor(pcts.length / 2)] : null,
  at_or_above_95: ok.filter((x) => x.percentile >= 0.95).length,
  top3_hits: valid.filter((x) => x.near_in_top3).length,
};
console.log('\n' + JSON.stringify(summary));
writeFileSync('out/eval/report.json', JSON.stringify({ summary, results }, null, 1));
