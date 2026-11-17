// npm run eval -- [eval/refs/<episode>.annot.json ...] [--only id] [--n 3000] [--previews] [--objective full|thirds|liu]
// Evaluation A over the annotated reference shots: prints a table, a summary over all shots and one per episode, and
// writes out/eval/report.json (a baseline: report-<objective>.json); with --previews, the rebuilt scene seen by each
// reference camera, to check the rebuild against the frame. The baselines rank under the same hard constraints and
// the same random cameras: --objective thirds by the rule of thirds alone, --objective liu by Liu et al. 2010's
// whole composition score.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalRef, rebuild, type RefFrame, type RefResult } from '../eval/index.ts';
import { realize } from '../scene/index.ts';
import { preview, type Objective } from '../camera/index.ts';
import { encodePng } from '../shared/png.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
const only = opt('only'), n = Number(opt('n') ?? 3000), previews = flag('previews');
const objective = (opt('objective') ?? 'full') as Objective;
if (!['full', 'thirds', 'liu'].includes(objective)) { console.error('--objective full|thirds|liu'); process.exit(2); }
const files = args.length ? args : readdirSync('eval/refs').filter((f) => f.endsWith('.annot.json')).map((f) => join('eval/refs', f));
const refs: RefFrame[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as RefFrame[]).filter((r) => !only || r.id === only);
mkdirSync('out/eval', { recursive: true });

const results: RefResult[] = [];
for (const r of refs) {
  if (previews) {
    const b = rebuild(r), img = preview(realize(b.scene), b.cam);
    writeFileSync(join('out/eval', r.id.replace('#', '-') + '.png'), encodePng(img.width, img.height, img.pixels, img.channels));
  }
  const x = evalRef(r, { n, objective });
  results.push(x);
  const status = !x.rebuild_ok ? 'REBUILD FAILED (focus hidden)' : x.ref.ok ? x.ref.total.toFixed(3) : `REJECTED (${x.ref.reject})`;
  console.log(`${x.id.padEnd(18)} ref ${status.padEnd(28)} pct ${isNaN(x.percentile) ? '-' : (x.percentile * 100).toFixed(0).padStart(3)}%  top3 ${x.near_in_top3 ? 'HIT ' : 'miss'}  reproj ${x.reprojection_px.toFixed(0)}px  h ${x.camera.height.toFixed(2)}m pitch ${x.camera.pitch_deg.toFixed(0)}° ${x.camera.focal.toFixed(0)}mm${x.estimated.length ? '  est: ' + x.estimated.join(',') : ''}`);
}

/** The scorer is judged on the shots whose rebuild agrees with the frame; rebuild failures are reported apart. */
function summarize(rs: RefResult[]) {
  const valid = rs.filter((x) => x.rebuild_ok);
  const ok = valid.filter((x) => x.ref.ok);
  // a rejected reference counts as the 0th percentile
  const pcts = valid.map((x) => (x.ref.ok ? x.percentile : 0)).sort((a, b) => a - b);
  return {
    refs: rs.length,
    rebuild_failed: rs.length - valid.length,
    scored: valid.length,
    rejected: valid.length - ok.length,
    rejections: Object.fromEntries([...new Set(valid.filter((x) => !x.ref.ok).map((x) => x.ref.reject!))].map((k) => [k, valid.filter((x) => x.ref.reject === k).length])),
    median_percentile: pcts.length ? pcts[Math.floor(pcts.length / 2)] : null,
    at_or_above_95: ok.filter((x) => x.percentile >= 0.95).length,
    top3_hits: valid.filter((x) => x.near_in_top3).length,
  };
}
const summary = { objective, ...summarize(results) };
// per episode (the id's prefix, e.g. gate-06): held-out episodes are reported on their own
const episodes = Object.fromEntries([...new Set(results.map((x) => x.id.split('#')[0]))].map((e) => [e, summarize(results.filter((x) => x.id.startsWith(e + '#')))]));
console.log('\n' + JSON.stringify(summary));
for (const [e, s] of Object.entries(episodes)) {
  console.log(`  ${e.padEnd(14)} top 5%: ${s.at_or_above_95}/${s.refs}  top-3: ${s.top3_hits}/${s.refs}  median ${s.median_percentile === null ? '-' : (s.median_percentile * 100).toFixed(0) + '%'}`);
}
writeFileSync(objective === 'full' ? 'out/eval/report.json' : `out/eval/report-${objective}.json`, JSON.stringify({ summary, episodes, results }, null, 1));
