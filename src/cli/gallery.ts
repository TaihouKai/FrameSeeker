// npm run gallery -- <scene.json | storyboard.json ...> [--poses] [--out docs/gallery]
// The README's figures, all phases 3–5 (deterministic, no model, no network):
//   for a scene,
//     <name>-shots.png  the top three shots as gray-box previews (people in colours, the focus red; thirds grid)
//     <name>-maps.png   the first shot's structure maps, what a renderer receives, two by two: depth · line art /
//                       OpenPose · region masks (each person, effect, structure and part of the set in its own colour)
//   for a storyboard (a strip saved by `npm run frameseeker -- story.txt --panels N`),
//     <name>-strip.png  each panel's best shot, side by side
//   with --poses, poses.png: every pose in the library, in its order, seen from the front three-quarters
// and gallery.json with each shot's score and camera.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { POSES, realize, type Scene } from '../scene/index.ts';
import { maps, preview, shoot, type Cam, type Region } from '../camera/index.ts';
import { hstack, toPng, vstack, type Image } from '../shared/image.ts';
import { runStoryboard, type Storyboard } from '../pipeline.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
const out = opt('out') ?? join('docs', 'gallery');
const poses = flag('poses');
if (!args.length && !poses) { console.error('usage: npm run gallery -- <scene.json | storyboard.json ...> [--poses] [--out docs/gallery]'); process.exit(2); }
mkdirSync(out, { recursive: true });

const SHOTS_H = 360, MAPS_H = 300;
const PEOPLE: [number, number, number][] = [[230, 70, 70], [70, 120, 235], [70, 180, 100], [235, 160, 50], [160, 90, 210], [50, 190, 200]];
const ENV: Record<string, [number, number, number]> = {
  'env-wall': [110, 110, 120], 'env-ceiling': [150, 150, 130], 'env-floor': [120, 95, 75], 'env-window': [120, 170, 220],
  'env-desk': [175, 130, 80], 'env-blackboard': [60, 110, 80],
};

/** The regions in one picture: set parts first, then structures, effects and people on top. */
function regionMap(regions: Region[], people: string[]): Image {
  const { width: W, height: H } = regions[0]?.mask ?? { width: 1, height: 1 };
  const px = new Uint8Array(W * H * 3).fill(40);
  const order: Region['kind'][] = ['environment', 'structure', 'damage', 'volume', 'line', 'person'];
  for (const kind of order) for (const r of regions.filter((g) => g.kind === kind)) {
    const c: [number, number, number] = kind === 'person' ? PEOPLE[people.indexOf(r.id) % PEOPLE.length]
      : kind === 'environment' ? ENV[r.id] ?? [100, 100, 100]
      : kind === 'structure' ? (r.glass ? [170, 225, 235] : [150, 165, 160])
      : kind === 'line' ? [255, 235, 120] : kind === 'volume' ? [255, 190, 90] : [255, 120, 40];
    for (let i = 0; i < W * H; i++) if (r.mask.pixels[i]) px.set(c, i * 3);
  }
  return { width: W, height: H, channels: 3, pixels: px };
}

const summary: unknown[] = [];
for (const file of args) {
  const name = basename(file, extname(file));
  const json = JSON.parse(readFileSync(file, 'utf8')) as Scene | Storyboard;
  if ('panels' in json) {
    const r = await runStoryboard(json, { k: 1 });
    const firsts = r.panels.map((p) => p.shots[0].maps.preview);
    writeFileSync(join(out, `${name}-strip.png`), toPng(hstack(firsts, SHOTS_H, 12)));
    summary.push({
      storyboard: file, notes: r.notes,
      panels: r.panels.map((p) => ({ beat: p.beat?.what, intent: p.intent, shot: shotInfo(p.shots[0].shot), prefs: p.shots[0].shot.prefs })),
    });
    console.log(`${file}: ${r.panels.map((p) => p.shots[0].shot.total.toFixed(3)).join(' ')} -> ${out}/${name}-strip.png`);
    continue;
  }
  const scene = json;
  const w = realize(scene);
  const { shots } = shoot(w, { k: 3 });
  const all = shots.map((s) => maps(w, s.cam, { scale: 0.75, previewScale: 0.75 }));
  writeFileSync(join(out, `${name}-shots.png`), toPng(hstack(all.map((m) => m.preview), SHOTS_H)));
  // the focus first, as in the previews' colours
  const people = [scene.moment.focus, ...scene.actors.map((a) => a.id).filter((id) => id !== scene.moment.focus)];
  const m = all[0];
  writeFileSync(join(out, `${name}-maps.png`), toPng(vstack([hstack([m.depth, m.lineart], MAPS_H), hstack([m.pose, regionMap(m.regions, people)], MAPS_H)])));
  summary.push({
    scene: file, moment: scene.moment,
    shots: shots.map(shotInfo),
    regions: m.regions.map((r) => ({ id: r.id, kind: r.kind })),
  });
  console.log(`${file}: ${shots.map((s) => s.total.toFixed(3)).join(' ')} -> ${out}/${name}-{shots,maps}.png`);
}
if (poses) {
  // one person in each pose on an empty ground, the camera at their front right, aimed at the body's middle
  const names = [...POSES.keys()];
  const tiles = names.map((pose) => {
    const air = ['leap', 'ride_piggyback', 'carried_in_arms'].includes(pose);
    const w = realize({
      version: 1, place: { kind: 'other', description: 'empty ground' }, time: { of_day: 'midday' }, structures: [], effects: [],
      actors: [{ id: 'a', pose, facing: 0, place: { at: [0, 0], ...(air ? { elevation: 0.5 } : {}) }, prompt: { look: [], outfit: [], expression: [] } }],
      moment: { focus: 'a', intent: 'emotion' },
    });
    const pts = w.solved.actors.get('a')!.points;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const cam: Cam = { pos: [1.6, cy + 0.35, 2.3], target: [0, cy, 0], roll: 0, focal: 35, aspect: 'portrait' };
    return preview(w, cam, 0.3);
  });
  const rows: Image[] = [];
  for (let i = 0; i < tiles.length; i += 12) rows.push(hstack(tiles.slice(i, i + 12), 200, 4));
  writeFileSync(join(out, 'poses.png'), toPng(vstack(rows, 4)));
  writeFileSync(join(out, 'poses.txt'), names.map((n, i) => `${i + 1}. ${n}`).join('\n') + '\n');
  console.log(`${names.length} poses -> ${out}/poses.png`);
}
if (summary.length) writeFileSync(join(out, 'gallery.json'), JSON.stringify(summary, null, 1));

function shotInfo(s: { total: number; cam: Cam; info: { pitch_deg?: number } }) {
  return { total: +s.total.toFixed(3), height_m: +s.cam.pos[1].toFixed(2), pitch_deg: +(s.info.pitch_deg ?? 0).toFixed(0), focal_mm: s.cam.focal, aspect: s.cam.aspect };
}
