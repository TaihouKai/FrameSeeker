import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { realize, type Scene } from '../src/scene/index.ts';
import { maps, shoot, type Cam } from '../src/camera/index.ts';
import { gbuffer, lineartOf, keypoints, OPENPOSE_COLOURS } from '../src/camera/maps.ts';
import { frame, project } from '../src/camera/camera.ts';
import { KP } from '../src/shared/skeleton.ts';

const load = (name: string) => realize(JSON.parse(readFileSync(`scenes/${name}.json`, 'utf8')) as Scene);
const px = (img: { width: number; channels: number; pixels: Uint8Array }, x: number, y: number) =>
  Array.from(img.pixels.slice((Math.round(y) * img.width + Math.round(x)) * img.channels, (Math.round(y) * img.width + Math.round(x)) * img.channels + img.channels));

describe('structure maps', () => {
  const w = load('classroom-talk');
  const a = [...w.solved.actors.values()][0];
  // a camera 3 m from the first person at three-quarter front (the other person stands straight in front of them)
  const at = a.pos, fwd = a.fwd, right: [number, number, number] = [-fwd[2], 0, fwd[0]];
  const from = (f: number, r: number): [number, number, number] => [at[0] + (fwd[0] * f + right[0] * r) * 3, 1.5, at[2] + (fwd[2] * f + right[2] * r) * 3];
  const cam: Cam = { pos: from(0.7, 0.7), target: [at[0], 1.2, at[2]], roll: 0, focal: 35, aspect: 'landscape' };
  const m = maps(w, cam, { scale: 0.5 });
  const W = m.depth.width, H = m.depth.height;

  it('MP1 every map has the output size (at the given scale); depth is near-bright', () => {
    for (const img of [m.depth, m.lineart, m.pose]) { expect(img.width).toBe(608); expect(img.height).toBe(416); }
    const p = project(frame(cam), a.points[KP.neck])!;
    const near = px(m.depth, p.u * W, p.v * H)[0];
    expect(near).toBeGreaterThan(150);
  });

  it('MP2 the pose map has the nose in OpenPose red where the face is, facing the camera', () => {
    const kp = keypoints(a, w.world, cam, W, H);
    expect(kp[KP.nose]).not.toBeNull();
    // joints are discs of radius 4 drawn in order, so the ears may cover part of the nose at this size
    let found = false;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (JSON.stringify(px(m.pose, kp[KP.nose]![0] + dx, kp[KP.nose]![1] + dy)) === JSON.stringify(OPENPOSE_COLOURS[KP.nose])) found = true;
    }
    expect(found).toBe(true);
  });

  it('MP3 seen from behind, no nose or eyes are drawn; the ears are', () => {
    const back: Cam = { ...cam, pos: from(-0.7, 0.7) };
    const kp = keypoints(a, w.world, back, W, H);
    expect(kp[KP.nose]).toBeNull();
    expect(kp[KP.rEye]).toBeNull();
    expect(kp[KP.rEar] ?? kp[KP.lEar]).not.toBeNull();
  });

  it('MP4 each person gets a region; line art has no lines inside a person', () => {
    const r = m.regions.find((x) => x.id === a.id)!;
    expect(r.kind).toBe('person');
    expect(r.area).toBeGreaterThan(0.005);
    let inside = 0;
    for (let i = 0; i < r.mask.pixels.length; i++) if (r.mask.pixels[i] && m.lineart.pixels[i]) inside++;
    expect(inside).toBe(0);
  });

  it('MP5 a beam gets its region and its outline in the line art', () => {
    const wb = load('beam-clash');
    const shot = shoot(wb, { n: 400, refine: 3, iters: 5, k: 1 }).shots[0];
    const mb = maps(wb, shot.cam, { scale: 0.5 });
    const beam = mb.regions.find((x) => x.id === 'beam')!;
    expect(beam.kind).toBe('line');
    let outline = 0;
    for (let i = 0; i < beam.mask.pixels.length; i++) if (beam.mask.pixels[i] && mb.lineart.pixels[i]) outline++;
    expect(outline).toBeGreaterThan(20);
  });

  it('MP6 a box seen straight on: its outline is drawn, its face is not', () => {
    const g = gbuffer({ groundY: -100, prims: [{ kind: 'box', c: [0, 0, 10], half: [2, 2, 1], yaw: 0, owner: 'b', role: 'structure' }] }, { pos: [0, 0, 0], target: [0, 0, 1], roll: 0, focal: 35, aspect: 'landscape' }, 0.25);
    const l = lineartOf(g, { groundY: -100, prims: [] });
    const cx = Math.floor(g.width / 2), cy = Math.floor(g.height / 2);
    expect(l.pixels[cy * g.width + cx]).toBe(0);
    let row = 0;
    for (let x = 0; x < g.width; x++) row += l.pixels[cy * g.width + x] ? 1 : 0;
    expect(row).toBeGreaterThanOrEqual(2);
  });
});
