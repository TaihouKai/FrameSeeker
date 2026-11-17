// npm run refs:select -- [--per 15]
// The reference sample: the frames kept by eval/refs/selection.json, one per shot (K6, from the
// cuts in refs/<episode>/cuts.txt), then `per` of them at equal intervals. Writes eval/refs/sample.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const per = Number(args[args.indexOf('--per') + 1] || 15) || 15;
const sel = JSON.parse(readFileSync('eval/refs/selection.json', 'utf8')) as { episodes: Record<string, { kept: number[] }> };

/** Frame k (1-based) of `fps=1/10` sits at about (k-1)*10+5 s. */
export const frameTime = (k: number) => (k - 1) * 10 + 5;

const out: Record<string, { frame: number; t: number; shot: number }[]> = {};
for (const [ep, { kept }] of Object.entries(sel.episodes)) {
  const cutsFile = `refs/${ep}/cuts.txt`;
  if (!existsSync(cutsFile)) throw new Error(`${cutsFile} missing (ffmpeg scene detection)`);
  const cuts = readFileSync(cutsFile, 'utf8').split(/\s+/).filter(Boolean).map(Number).sort((a, b) => a - b);
  const shotOf = (t: number) => cuts.filter((c) => c <= t).length;
  const seen = new Set<number>();
  const oneEach = kept.map((k) => ({ frame: k, t: frameTime(k), shot: shotOf(frameTime(k)) })).filter((x) => !seen.has(x.shot) && (seen.add(x.shot), true));
  const n = oneEach.length;
  out[ep] = Array.from({ length: Math.min(per, n) }, (_, i) => oneEach[Math.floor((i + 0.5) * n / Math.min(per, n))]);
  console.log(`${ep}: ${kept.length} kept, ${n} after one per shot, sample: ${out[ep].map((x) => x.frame).join(' ')}`);
}
writeFileSync('eval/refs/sample.json', JSON.stringify(out, null, 1) + '\n');
