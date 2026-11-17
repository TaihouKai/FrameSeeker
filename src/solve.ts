// Stage 1 (DESIGN.md §5): relations in the scene JSON -> exact geometry. Deterministic; errors are readable.
import { add, dist, lerp, mul, norm, sub, yawDir, yawTo, type V3 } from './vec.ts';
import { HEAD, KP, POSES, mirror, toWorld, type Local } from './poses.ts';
import { cast, type Prim, type World } from './geom.ts';
import { isDamage, isLine, isVolume, type Actor, type Effect, type Placement, type Scene, type Structure, type Toward } from './scene.ts';

export const FLOOR_H = 3.5;

export interface SolvedActor {
  id: string; height: number; pos: V3; fwd: V3; pose: string; mirrored: boolean;
  points: V3[]; head: V3; headR: number; prims: Prim[];
}
export interface SolvedStructure {
  id: string; kind: Structure['kind']; pos: V3; yaw: number; front: V3;
  /** the main box (anchors, floors, damage) */
  box: { c: V3; half: V3; yaw: number };
  height: number; prims: Prim[];
}
export interface SolvedLine { id: string; kind: string; a: V3; b: V3; radius: number; hits: string | null; floor: number | null }
export interface SolvedVolume { id: string; kind: string; c: V3; r: number }
export interface SolvedDamage { id: string; kind: string; target: string; box: { c: V3; half: V3; yaw: number }; floors: [number, number] | null }

export interface Solved {
  scene: Scene;
  actors: Map<string, SolvedActor>;
  structures: Map<string, SolvedStructure>;
  lines: Map<string, SolvedLine>;
  volumes: Map<string, SolvedVolume>;
  damages: Map<string, SolvedDamage>;
  world: World;
  notes: string[];
}

const DEFAULT_HEIGHT = 1.6;

export function solve(scene: Scene): Solved {
  const notes: string[] = [];
  const actorsById = new Map(scene.actors.map((a) => [a.id, a]));
  const structById = new Map(scene.structures.map((s) => [s.id, s]));
  const effectById = new Map(scene.effects.map((e) => [e.id, e]));
  for (const id of [...actorsById.keys(), ...structById.keys(), ...effectById.keys()]) {
    const n = [actorsById.has(id), structById.has(id), effectById.has(id)].filter(Boolean).length;
    if (n > 1) throw new Error(`id "${id}" is used more than once`);
  }
  for (const a of scene.actors) if (!POSES.has(a.pose)) throw new Error(`actor "${a.id}": no pose "${a.pose}" in the pose library (${[...POSES.keys()].join(', ')})`);

  // --- positions (topological, by the placement references) ---
  const pos = new Map<string, V3>();
  const placing = new Set<string>();
  const structures = new Map<string, SolvedStructure>();
  const placementOf = (id: string): Placement => {
    const p = actorsById.get(id)?.place ?? structById.get(id)?.place;
    if (!p) throw new Error(`unknown id "${id}" in a placement`);
    return p;
  };
  const position = (id: string): V3 => {
    const got = pos.get(id);
    if (got) return got;
    if (placing.has(id)) throw new Error(`placements form a cycle through "${id}"`);
    placing.add(id);
    const p = placementOf(id);
    let at: V3, along: V3 = [0, 0, 1];
    if ('at' in p) at = [p.at[0], 0, p.at[1]];
    else if ('from' in p) {
      const ref = position(p.from);
      along = bearingDir(p.from, p.bearing ?? 'front');
      at = add(ref, mul(along, p.distance));
      at[1] = 0;
    } else if ('behind' in p) {
      const b = position(p.behind), s = position(p.seen_from);
      along = flat(sub(b, s));
      at = add(b, mul(along, p.distance));
      at[1] = 0;
    } else if ('on_line' in p) {
      const a = position(p.on_line[0]), b = position(p.on_line[1]);
      along = flat(sub(b, a));
      at = lerp(a, b, p.at_fraction);
      at[1] = 0;
    } else {
      const s = structure(p.on);
      const off = p.offset ?? 0;
      const side = yawDir(s.yaw + Math.PI / 2);
      at = add([s.box.c[0], s.box.c[1] + s.box.half[1], s.box.c[2]], mul(side, off));
      if (p.part === 'roof_edge') at = add(at, mul(s.front, s.box.half[2] - 0.5));
    }
    if (p.side_offset) at = add(at, mul([-along[2], 0, along[0]], p.side_offset));
    if (p.elevation) at = add(at, [0, p.elevation, 0]);
    placing.delete(id);
    pos.set(id, at);
    return at;
  };
  // the direction a bearing points, relative to the reference's facing when that is already known (else the world's +Z)
  const bearingDir = (refId: string, bearing: NonNullable<Extract<Placement, { from: string }>['bearing']>): V3 => {
    const ref = actorsById.get(refId) ?? structById.get(refId);
    const faceId = ref && 'facing' in ref ? ref.facing : undefined;
    const base = typeof faceId === 'number' ? faceId * Math.PI / 180
      : faceId && pos.has(faceId) && pos.has(refId) ? yawTo(pos.get(refId)!, pos.get(faceId)!) : 0;
    const off = bearing === 'front' ? 0 : bearing === 'behind' ? Math.PI : bearing === 'left' ? -Math.PI / 2 : bearing === 'right' ? Math.PI / 2 : (bearing * Math.PI) / 180;
    // yaw +90° turns +Z towards +X, which is the facing person's left (their right is fwd × up = -X for +Z)
    return yawDir(base - off);
  };
  const structure = (id: string): SolvedStructure => {
    const got = structures.get(id);
    if (got) return got;
    const s = structById.get(id);
    if (!s) throw new Error(`"${id}" is not a structure`);
    const at = position(id);
    const p = s.place;
    const lookId = s.facing ?? ('seen_from' in p ? p.seen_from : 'from' in p ? p.from : null);
    // no facing given: the world's +Z (deterministic; a structure others stand on cannot wait for them)
    const yaw = lookId ? yawTo(at, position(lookId)) : 0;
    const solved = buildStructure(s, at, yaw);
    structures.set(id, solved);
    return solved;
  };
  for (const a of scene.actors) position(a.id);
  for (const s of scene.structures) structure(s.id);

  // --- actors: facing, pose, aim ---
  const actors = new Map<string, SolvedActor>();
  const aimAt = new Map<string, V3>();
  const anchor = (ref: string, toward?: V3): V3 => {
    const [id, part = 'center'] = ref.split('.');
    const a = actors.get(id);
    if (a) {
      const p = a.points;
      if (part === 'head') return a.head;
      if (part === 'eyes') return lerp(p[KP.rEye], p[KP.lEye], 0.5);
      if (part === 'chest') return lerp(p[KP.neck], lerp(p[KP.rHip], p[KP.lHip], 0.5), 0.3);
      if (part === 'right_hand') return p[KP.rWrist];
      if (part === 'left_hand') return p[KP.lWrist];
      if (part === 'feet') return lerp(p[KP.rAnkle], p[KP.lAnkle], 0.5);
      if (part === 'center') return lerp(p[KP.neck], lerp(p[KP.rHip], p[KP.lHip], 0.5), 0.5);
      throw new Error(`no anchor part "${part}" on actor "${id}"`);
    }
    const s = structures.get(id);
    if (s) {
      const { c, half } = s.box;
      const base = c[1] - half[1];
      if (part === 'top') return [c[0], base + 2 * half[1], c[2]];
      if (part === 'center') return c;
      if (part === 'base') return [c[0], base, c[2]];
      const m = /^floor_(\d+)$/.exec(part);
      if (m) {
        const y = base + (Number(m[1]) - 0.5) * FLOOR_H;
        // on the face towards whatever points at it (else its front)
        const face = toward ? flat(sub(toward, c)) : s.front;
        return [c[0] + face[0] * half[2], y, c[2] + face[2] * half[2]];
      }
      throw new Error(`no anchor part "${part}" on structure "${id}"`);
    }
    throw new Error(`unknown anchor "${ref}"`);
  };
  const buildActor = (a: Actor, mirrored: boolean): SolvedActor => {
    const h = a.height ?? DEFAULT_HEIGHT;
    const at = pos.get(a.id)!;
    const faceTarget = typeof a.facing === 'string' ? position(a.facing) : a.aim ? position(a.aim.split('.')[0]) : others(a.id);
    const fwd = typeof a.facing === 'number' ? yawDir(a.facing * Math.PI / 180) : faceTarget ? flat(sub(faceTarget, at)) : [0, 0, 1] as V3;
    const pose = POSES.get(a.pose)!;
    const local: Local[] = mirrored ? mirror(pose.points) : pose.points;
    const points = local.map((l) => toWorld(l, at, fwd, h));
    const target = aimAt.get(a.id);
    if (target && pose.aim) for (const side of pose.aim === 'both' ? ['r', 'l'] : ['r']) {
      const [sh, el, wr] = side === 'r' ? [KP.rShoulder, KP.rElbow, KP.rWrist] : [KP.lShoulder, KP.lElbow, KP.lWrist];
      const d = norm(sub(target, points[sh]));
      const upper = dist(points[sh], points[el]), fore = dist(points[el], points[wr]);
      points[el] = add(points[sh], mul(d, upper));
      points[wr] = add(points[el], mul(d, fore));
    }
    const head = lerp(points[KP.rEar], points[KP.lEar], 0.5);
    const headR = 0.075 * h;
    const solved: SolvedActor = { id: a.id, height: h, pos: at, fwd, pose: a.pose, mirrored, points, head, headR, prims: [] };
    solved.prims = bodyPrims(solved);
    return solved;
  };
  const others = (id: string): V3 | null => {
    const ps = scene.actors.filter((x) => x.id !== id).map((x) => position(x.id));
    return ps.length ? mul(ps.reduce((x, y) => add(x, y), [0, 0, 0]), 1 / ps.length) : null;
  };
  const mirroredOf = new Map<string, boolean>();
  const rebuild = (id: string) => actors.set(id, buildActor(actorsById.get(id)!, mirroredOf.get(id) ?? false));
  for (const a of scene.actors) rebuild(a.id);
  // a first aim at the named anchors (refined by the lines below)
  for (const a of scene.actors) if (a.aim) { aimAt.set(a.id, anchor(a.aim)); rebuild(a.id); }

  // --- effects ---
  const lines = new Map<string, SolvedLine>();
  const structWorld = (only?: string): World => ({ groundY: 0, prims: [...structures.values()].filter((s) => !only || s.id === only).flatMap((s) => s.prims) });
  for (const e of scene.effects) {
    if (!isLine(e)) continue;
    const shooter = e.from.split('.')[0];
    const toward = typeof e.to === 'object' ? (e.to as Toward) : null;
    const toRef = typeof e.to === 'string' ? e.to : null;
    let a = anchor(e.from), dir: V3;
    if (e.grazes) {
      const g = actors.get(e.grazes.actor);
      if (!g) throw new Error(`effect "${e.id}": grazes unknown actor "${e.grazes.actor}"`);
      // the side the line passes on, relative to the grazed person; a dodge moves the head away from it
      const pose = POSES.get(g.pose)!;
      const side = e.grazes.side ?? (pose.headSide === 'left' ? 'right' : pose.headSide === 'right' ? 'left' : 'left');
      if (pose.headSide && pose.headSide === side) { mirroredOf.set(g.id, true); rebuild(g.id); }
      const gs = actors.get(g.id)!;
      const part = e.grazes.part === 'head' ? gs.head : e.grazes.part === 'shoulder' ? (side === 'right' ? gs.points[KP.rShoulder] : gs.points[KP.lShoulder]) : lerp(gs.points[KP.neck], lerp(gs.points[KP.rHip], gs.points[KP.lHip], 0.5), 0.4);
      const right: V3 = [-gs.fwd[2], 0, gs.fwd[0]];
      const sideVec = side === 'right' ? right : mul(right, -1);
      const gap = (e.grazes.part === 'head' ? gs.headR : 0.12 * gs.height) + (e.grazes.clearance ?? 0.25);
      let graze: V3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const d0 = norm(sub(part, a));
        // the side vector made perpendicular to the line, so the gap is measured across it
        const across = norm(sub(sideVec, mul(d0, d0[0] * sideVec[0] + d0[1] * sideVec[1] + d0[2] * sideVec[2])));
        graze = add(part, mul(across, gap));
        if (actors.has(shooter)) { aimAt.set(shooter, graze); rebuild(shooter); a = anchor(e.from); }
      }
      dir = norm(sub(graze, a));
    } else if (toward) {
      dir = norm(toward.toward);
      if (actors.has(shooter)) { aimAt.set(shooter, add(a, mul(dir, 10))); rebuild(shooter); a = anchor(e.from); }
    } else {
      let target = anchor(toRef!, a);
      if (actors.has(shooter)) { aimAt.set(shooter, target); rebuild(shooter); a = anchor(e.from); target = anchor(toRef!, a); }
      dir = norm(sub(target, a));
    }
    let b: V3, hits: string | null = null, floor: number | null = null;
    if (toward) b = add(a, mul(dir, toward.length));
    else {
      const owner = toRef!.split('.')[0];
      const onTarget = structures.has(owner) ? cast(structWorld(owner), a, dir) : null;
      const first = cast(structWorld(), a, dir);
      if (onTarget) {
        b = add(a, mul(dir, onTarget.t));
        hits = owner;
        if (first && first.prim && first.prim.owner !== owner && first.t < onTarget.t - 0.01) notes.push(`${e.id}: "${first.prim.owner}" stands between the source and "${owner}"`);
      } else if (structures.has(owner)) {
        b = add(a, mul(dir, 300));
        notes.push(`${e.id}: the line through the graze misses "${owner}"`);
      } else b = e.grazes ? add(a, mul(dir, Math.max(dist(a, anchor(toRef!)), 5))) : anchor(toRef!);
      if (hits) {
        const s = structures.get(hits)!;
        floor = Math.max(1, Math.ceil((b[1] - (s.box.c[1] - s.box.half[1])) / FLOOR_H));
        const asked = /floor_(\d+)/.exec(toRef!);
        if (asked && Math.abs(Number(asked[1]) - floor) > 1) notes.push(`${e.id}: hits "${hits}" at floor ${floor}, not ${asked[1]} (a straight line from the source through the graze cannot reach floor ${asked[1]})`);
      }
    }
    lines.set(e.id, { id: e.id, kind: e.kind, a, b, radius: e.radius ?? 0.15, hits, floor });
  }
  const volumes = new Map<string, SolvedVolume>();
  for (const e of scene.effects) if (isVolume(e)) volumes.set(e.id, { id: e.id, kind: e.kind, c: anchor(e.at), r: e.radius });
  const damages = new Map<string, SolvedDamage>();
  for (const e of scene.effects) {
    if (!isDamage(e)) continue;
    const s = structures.get(e.target);
    if (!s) throw new Error(`effect "${e.id}": target "${e.target}" is not a structure`);
    const base = s.box.c[1] - s.box.half[1];
    const top = Math.max(1, Math.round(s.height / FLOOR_H));
    let floors: [number, number] | null = e.floors ?? null;
    if (!floors) {
      const hit = [...lines.values()].find((l) => l.hits === e.target && l.floor !== null);
      if (hit) floors = [Math.max(1, hit.floor! - 3), Math.min(top, hit.floor! + 3)];
    }
    const lo = floors ? base + (floors[0] - 1) * FLOOR_H : base, hi = floors ? Math.min(base + floors[1] * FLOOR_H, base + s.height) : base + s.height;
    damages.set(e.id, { id: e.id, kind: e.kind, target: e.target, floors, box: { c: [s.box.c[0], (lo + hi) / 2, s.box.c[2]], half: [s.box.half[0] + 0.3, (hi - lo) / 2, s.box.half[2] + 0.3], yaw: s.box.yaw } });
  }

  // --- checks ---
  for (const a of actors.values()) {
    const feet = lerp(a.points[KP.rAnkle], a.points[KP.lAnkle], 0.5);
    for (const s of structures.values()) if (s.prims.some((p) => p.kind === 'box' && insideBox(p, add(feet, [0, 0.3, 0])))) throw new Error(`actor "${a.id}" stands inside structure "${s.id}"`);
  }

  const world: World = { groundY: 0, prims: [...[...actors.values()].flatMap((a) => a.prims), ...[...structures.values()].flatMap((s) => s.prims)] };
  return { scene, actors, structures, lines, volumes, damages, world, notes };
}

function flat(d: V3): V3 { return norm([d[0], 0, d[2]]); }

function insideBox(p: Extract<Prim, { kind: 'box' }>, q: V3): boolean {
  const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
  const dx = q[0] - p.c[0], dy = q[1] - p.c[1], dz = q[2] - p.c[2];
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.abs(lx) < p.half[0] && Math.abs(dy) < p.half[1] && Math.abs(lz) < p.half[2];
}

/** Capsules and a sphere for a body (only for depth and occlusion; the skeleton is drawn from the keypoints). */
function bodyPrims(a: SolvedActor): Prim[] {
  const p = a.points, h = a.height;
  const midHip = lerp(p[KP.rHip], p[KP.lHip], 0.5);
  const cap = (x: V3, y: V3, r: number): Prim => ({ kind: 'capsule', a: x, b: y, r: r * h, owner: a.id, role: 'actor' });
  return [
    { kind: 'sphere', c: a.head, r: a.headR, owner: a.id, role: 'actor' },
    cap(p[KP.neck], midHip, 0.1),
    cap(p[KP.rShoulder], p[KP.lShoulder], 0.05),
    cap(p[KP.rHip], p[KP.lHip], 0.06),
    cap(p[KP.rShoulder], p[KP.rElbow], 0.035), cap(p[KP.rElbow], p[KP.rWrist], 0.03),
    cap(p[KP.lShoulder], p[KP.lElbow], 0.035), cap(p[KP.lElbow], p[KP.lWrist], 0.03),
    cap(p[KP.rHip], p[KP.rKnee], 0.05), cap(p[KP.rKnee], p[KP.rAnkle], 0.04),
    cap(p[KP.lHip], p[KP.lKnee], 0.05), cap(p[KP.lKnee], p[KP.lAnkle], 0.04),
  ];
}

/** A structure's primitives by its kind (DESIGN.md §5.1 step 4); its front (+Z local) faces `yaw`. */
function buildStructure(s: Structure, at: V3, yaw: number): SolvedStructure {
  const sz = s.size || {};
  const prims: Prim[] = [];
  const box = (c: V3, half: V3, thin = false): Prim => ({ kind: 'box', c, half, yaw, owner: s.id, role: 'structure', thin });
  const rot = (x: number, y: number, z: number): V3 => {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return [at[0] + x * c + z * sn, at[1] + y, at[2] - x * sn + z * c];
  };
  let main: Extract<Prim, { kind: 'box' }>;
  let height: number;
  switch (s.kind) {
    case 'building': case 'tower': {
      height = sz.height ?? (sz.floors ?? (s.kind === 'tower' ? 40 : 10)) * FLOOR_H;
      const w = sz.width ?? (s.kind === 'tower' ? 18 : 24), d = sz.depth ?? (s.kind === 'tower' ? 18 : 20);
      main = box(rot(0, height / 2, 0), [w / 2, height / 2, d / 2]) as typeof main;
      prims.push(main);
      break;
    }
    case 'truss': case 'bridge': {
      const span = sz.width ?? 20, clearance = sz.height ?? (s.kind === 'bridge' ? 5 : 6), deck = s.kind === 'bridge' ? 2.2 : 1.8, thick = s.kind === 'bridge' ? 1.2 : 0.5;
      main = box(rot(0, clearance + deck / 2, 0), [span / 2, deck / 2, s.kind === 'bridge' ? 2 : 0.8]) as typeof main;
      prims.push(main, box(rot(-span / 2, clearance / 2, 0), [thick, clearance / 2, thick], true), box(rot(span / 2, clearance / 2, 0), [thick, clearance / 2, thick], true));
      height = clearance + deck;
      break;
    }
    case 'wall': height = sz.height ?? 3; main = box(rot(0, height / 2, 0), [(sz.width ?? 10) / 2, height / 2, (sz.depth ?? 0.4) / 2]) as typeof main; prims.push(main); break;
    case 'vehicle': height = 1.5; main = box(rot(0, 0.75, 0), [0.95, 0.75, 2.25]) as typeof main; prims.push(main); break;
    case 'crate': height = sz.height ?? 1; main = box(rot(0, height / 2, 0), [height / 2, height / 2, height / 2]) as typeof main; prims.push(main); break;
    case 'rock': height = sz.height ?? 1.5; main = box(rot(0, height / 2, 0), [height * 0.7, height / 2, height * 0.6]) as typeof main; prims.push(main); break;
    case 'pillar': height = sz.height ?? 6; main = box(rot(0, height / 2, 0), [0.4, height / 2, 0.4], true) as typeof main; prims.push(main); break;
    case 'tree': {
      height = sz.height ?? 7;
      main = box(rot(0, height / 2, 0), [1.5, height / 2, 1.5]) as typeof main;
      prims.push({ kind: 'capsule', a: rot(0, 0, 0), b: rot(0, height * 0.6, 0), r: 0.25, owner: s.id, role: 'structure', thin: true }, { kind: 'sphere', c: rot(0, height * 0.7, 0), r: height * 0.32, owner: s.id, role: 'structure' });
      break;
    }
    default: height = sz.height ?? 2; main = box(rot(0, height / 2, 0), [(sz.width ?? 2) / 2, height / 2, (sz.depth ?? 2) / 2]) as typeof main; prims.push(main);
  }
  return { id: s.id, kind: s.kind, pos: at, yaw, front: yawDir(yaw), box: { c: main.c, half: main.half, yaw }, height, prims };
}

export { HEAD };
