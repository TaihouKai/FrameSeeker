// npm run gallery -- <scene.json ...> [--out docs/gallery]
// The README's gallery: for each scene, phases 3–5 (deterministic, no model, no network) and two images:
//   <name>-shots.png  the top three shots as gray-box previews (people in colours, the focus red; thirds grid)
//   <name>-maps.png   the first shot's structure maps, what a renderer receives: depth · line art · OpenPose ·
//                     region masks (each person, effect, structure and labelled part of the set in its own colour)
// and gallery.json with each shot's score and camera.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { realize, type Scene } from '../scene/index.ts';
import { maps, shoot, type Region } from '../camera/index.ts';
import { hstack, toPng, type Image } from '../shared/image.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = opt('out') ?? join('docs', 'gallery');
if (!args.length) { console.error('usage: npm run gallery -- <scene.json ...> [--out docs/gallery]'); process.exit(2); }
mkdirSync(out, { recursive: true });

const SHOTS_H = 240, MAPS_H = 200;
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
  const scene = JSON.parse(readFileSync(file, 'utf8')) as Scene;
  const w = realize(scene);
  const { shots } = shoot(w, { k: 3 });
  const all = shots.map((s) => maps(w, s.cam, { scale: 0.5, previewScale: 0.5 }));
  writeFileSync(join(out, `${name}-shots.png`), toPng(hstack(all.map((m) => m.preview), SHOTS_H)));
  // the focus first, as in the previews' colours
  const people = [scene.moment.focus, ...scene.actors.map((a) => a.id).filter((id) => id !== scene.moment.focus)];
  const m = all[0];
  writeFileSync(join(out, `${name}-maps.png`), toPng(hstack([m.depth, m.lineart, m.pose, regionMap(m.regions, people)], MAPS_H)));
  summary.push({
    scene: file, moment: scene.moment,
    shots: shots.map((s) => ({ total: +s.total.toFixed(3), height_m: +s.cam.pos[1].toFixed(2), pitch_deg: +(s.info.pitch_deg ?? 0).toFixed(0), focal_mm: s.cam.focal, aspect: s.cam.aspect })),
    regions: m.regions.map((r) => ({ id: r.id, kind: r.kind })),
  });
  console.log(`${file}: ${shots.map((s) => s.total.toFixed(3)).join(' ')} -> ${out}/${name}-{shots,maps}.png`);
}
writeFileSync(join(out, 'gallery.json'), JSON.stringify(summary, null, 1));
