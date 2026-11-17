// Stage 2: set dressing by the kind of place, so the camera search has something to frame with.
// Deterministic (seeded by the scene); nothing is put where it would block the action, the focus or the payoff.
import { add, hash, lerp, mul, norm, rng, sub, yawTo, type V3 } from '../shared/vec.ts';
import { clear, inside, type Prim, type World } from '../shared/geom.ts';
import { FLOOR_H, type Solved } from './solve.ts';

export function dress(s: Solved): World {
  const rand = rng(hash(JSON.stringify(s.scene)));
  const keep: Prim[] = [];
  const kind = s.scene.place.kind;
  const actors = [...s.actors.values()];
  const centre: V3 = actors.length ? mul(actors.reduce((x, a) => add(x, a.pos), [0, 0, 0] as V3), 1 / actors.length) : [0, 0, 0];
  // the street runs under a gantry or bridge (across its span); else along the longest line effect, else between the
  // first two actors, else +Z
  const span = [...s.structures.values()].find((x) => x.kind === 'truss' || x.kind === 'bridge');
  const longest = [...s.lines.values()].sort((a, b) => len2(sub(b.b, b.a)) - len2(sub(a.b, a.a)))[0];
  const axis: V3 = span ? span.front : longest ? flat(sub(longest.b, longest.a)) : actors.length > 1 ? flat(sub(actors[1].pos, actors[0].pos)) : [0, 0, 1];
  const across: V3 = [-axis[2], 0, axis[0]];
  const yawAlong = yawTo([0, 0, 0], axis);
  const box = (c: V3, half: V3, yaw: number, thin = false, label?: string): Prim => ({ kind: 'box', c, half, yaw, owner: `dress${keep.length}`, role: 'dressing', thin, ...(label ? { label } : {}) });
  // always kept (a room's floor: the actors stand on it)
  const base: Prim[] = [];
  const scale = Math.max(40, ...[...s.lines.values()].map((l) => Math.sqrt(len2(sub(l.b, l.a)))), ...[...s.structures.values()].map((x) => Math.hypot(x.pos[0] - centre[0], x.pos[2] - centre[2]) + 20));

  if (kind === 'street' || kind === 'plaza' || kind === 'bridge') {
    const width = s.scene.place.width ?? (kind === 'plaza' ? 60 : 20);
    for (const sideSign of [-1, 1]) {
      // buildings in a row along each side
      let u = -scale - 30;
      while (u < scale + 60) {
        const lot = 14 + rand() * 22, depth = 14 + rand() * 12, floors = Math.round(3 + rand() * rand() * 30);
        const mid = u + lot / 2;
        const c = add(add(centre, mul(axis, mid)), mul(across, sideSign * (width / 2 + 2 + depth / 2)));
        const h = floors * FLOOR_H;
        // box local x runs across the street, local z along it
        keep.push(box([c[0], h / 2, c[2]], [depth / 2, h / 2, lot / 2 - 0.5], yawAlong));
        u += lot;
      }
      // street lamps every 25 m
      for (let k = -Math.ceil(scale / 25); k <= Math.ceil((scale + 40) / 25); k++) {
        const c = add(add(centre, mul(axis, k * 25 + sideSign * 6)), mul(across, sideSign * (width / 2 - 0.6)));
        keep.push({ kind: 'capsule', a: [c[0], 0, c[2]], b: [c[0], 7, c[2]], r: 0.09, owner: `dress${keep.length}`, role: 'dressing', thin: true });
      }
    }
    // half the time a gantry or footbridge across the street, somewhere along the action
    if (kind === 'street' && rand() < 0.5) {
      const at = add(centre, mul(axis, (rand() - 0.3) * scale));
      keep.push(box([at[0], 6.9, at[2]], [width / 2 + 1, 0.9, 1], yawAlong));
      for (const sg of [-1, 1]) { const p = add(at, mul(across, sg * (width / 2 + 0.5))); keep.push(box([p[0], 3, p[2]], [0.35, 3, 0.35], yawAlong, true)); }
    }
  } else if (kind === 'rooftop') {
    // parapet around the roof, a water tank, units; the city lies below (ground is the roof)
    const r = 16;
    for (const [dx, dz, hx, hz] of [[0, r, r, 0.15], [0, -r, r, 0.15], [r, 0, 0.15, r], [-r, 0, 0.15, r]] as const) {
      const c = add(centre, add(mul(axis, dz), mul(across, dx)));
      keep.push(box([c[0], 0.55, c[2]], [hx, 0.55, hz], yawAlong));
    }
    const tank = add(centre, add(mul(axis, -r + 4), mul(across, r - 4)));
    keep.push({ kind: 'capsule', a: [tank[0], 0, tank[2]], b: [tank[0], 4, tank[2]], r: 1.8, owner: `dress${keep.length}`, role: 'dressing' });
    const mast = add(centre, add(mul(axis, r - 3), mul(across, -r + 3)));
    keep.push({ kind: 'capsule', a: [mast[0], 0, mast[2]], b: [mast[0], 12, mast[2]], r: 0.15, owner: `dress${keep.length}`, role: 'dressing', thin: true });
    for (let k = 0; k < 4; k++) { const c = add(centre, add(mul(axis, (rand() - 0.5) * 2 * (r - 3)), mul(across, (rand() - 0.5) * 2 * (r - 3)))); keep.push(box([c[0], 0.6, c[2]], [0.9, 0.6, 0.6], yawAlong)); }
  } else if (kind === 'room' || kind === 'classroom' || kind === 'corridor') {
    const hx = kind === 'corridor' ? 1.6 : 4.5, hz = kind === 'corridor' ? 15 : 3.5, h = 3;
    const c = centre;
    const wall = (dx: number, dz: number, ax: number, az: number) => { const p = add(c, add(mul(axis, dz), mul(across, dx))); keep.push(box([p[0], h / 2, p[2]], [ax, h / 2, az], yawAlong, false, 'wall')); };
    // window wall on one side: low wall + top band (windows between)
    const wp = add(c, mul(across, hx));
    keep.push(box([wp[0], 0.45, wp[2]], [0.12, 0.45, hz], yawAlong, false, 'wall'), box([wp[0], h - 0.3, wp[2]], [0.12, 0.3, hz], yawAlong, false, 'wall'));
    // mullions: real windows have frames (a bare opening let the image model invent them, frames inside frames)
    for (let z = -hz + 1.8; z < hz - 0.5; z += 1.8) {
      const m = add(wp, mul(axis, z));
      keep.push(box([m[0], (0.9 + h - 0.6) / 2, m[2]], [0.1, (h - 0.6 - 0.9) / 2, 0.05], yawAlong, true, 'window'));
    }
    wall(-hx, 0, 0.12, hz); wall(0, hz, hx, 0.12); wall(0, -hz, hx, 0.12);
    keep.push(box([c[0], h + 0.1, c[2]], [hx + 4, 0.1, hz + 4], yawAlong, false, 'ceiling'));
    // the floor, inside the walls: what is seen through the windows is then outside (ground or sky)
    base.push({ ...box([c[0], -0.049, c[2]], [hx, 0.05, hz], yawAlong, false, 'floor'), owner: 'room-floor' });
    if (kind === 'classroom') {
      // a blackboard on the front wall, desks in rows facing it
      const bb = add(c, mul(axis, -hz + 0.14));
      keep.push(box([bb[0], 1.45, bb[2]], [2.5, 0.6, 0.02], yawAlong, true, 'blackboard'));
      for (const dz of [-1.2, 0, 1.2, 2.4]) for (const dx of [-3, -1.5, 0, 1.5, 3]) { const p = add(c, add(mul(axis, dz), mul(across, dx))); keep.push(box([p[0], 0.38, p[2]], [0.3, 0.38, 0.25], yawAlong, false, 'desk')); }
    } else if (kind === 'room') for (let k = 0; k < 6; k++) { const p = add(c, add(mul(axis, (rand() - 0.5) * 2 * (hz - 1)), mul(across, (rand() - 0.5) * 2 * (hx - 1.2)))); keep.push(box([p[0], 0.38, p[2]], [0.6, 0.38, 0.3], yawAlong, false, 'desk')); }
  } else if (kind === 'forest' || kind === 'field') {
    const n = kind === 'forest' ? 60 : 8;
    for (let k = 0; k < n; k++) {
      const p = add(centre, add(mul(axis, (rand() - 0.5) * 2 * scale), mul(across, (rand() - 0.5) * 2 * scale * 0.6)));
      const h = 6 + rand() * 8;
      keep.push({ kind: 'capsule', a: [p[0], 0, p[2]], b: [p[0], h * 0.6, p[2]], r: 0.25, owner: `dress${keep.length}`, role: 'dressing', thin: true });
      keep.push({ kind: 'sphere', c: [p[0], h * 0.7, p[2]], r: h * 0.3, owner: `dress${keep.length}`, role: 'dressing' });
    }
  }

  // nothing may stand in a scene thing, nor block a line, the focus or the payoff from the actors' side
  const scene = s.world;
  const keyPoints: V3[] = [...actors.map((a) => a.head), ...[...s.lines.values()].flatMap((l) => [l.a, lerp(l.a, l.b, 0.5), l.b])];
  const ok = (p: Prim) => {
    if (scene.prims.some((q) => q.role !== 'actor' && overlaps(p, q))) return false;
    if (actors.some((a) => inside(p, a.pos, 1) || inside(p, a.head, 1))) return false;
    for (const l of s.lines.values()) if (!clear({ groundY: -1e9, prims: [p] }, l.a, lerp(l.a, l.b, 0.98))) return false;
    if (keyPoints.length > 1 && !clear({ groundY: -1e9, prims: [p] }, keyPoints[0], keyPoints[keyPoints.length - 1])) return false;
    return true;
  };
  return { groundY: 0, prims: [...scene.prims, ...keep.filter(ok), ...base] };
}

const len2 = (d: V3) => d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
const flat = (d: V3): V3 => norm([d[0], 0, d[2]]);

/** Rough overlap of two primitives by their centres and extents (dressing must not stand inside scene things). */
function overlaps(p: Prim, q: Prim): boolean {
  const c = (x: Prim): V3 => x.kind === 'capsule' ? lerp(x.a, x.b, 0.5) : x.c;
  const r = (x: Prim): number => x.kind === 'box' ? Math.hypot(x.half[0], x.half[2]) : x.kind === 'sphere' ? x.r : Math.max(x.r, Math.hypot(...sub(x.b, x.a)) / 2);
  if (q.kind === 'box') return inside(q, c(p), p.kind === 'box' ? Math.min(p.half[0], p.half[2]) : 0.5);
  return Math.hypot(c(p)[0] - c(q)[0], c(p)[2] - c(q)[2]) < r(p) + r(q);
}
