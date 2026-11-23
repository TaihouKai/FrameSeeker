// The words the models may use, written from the code itself (pose library, kinds, placement forms), so a prompt
// never drifts from what the solver accepts.
import { POSES } from '../poses.ts';
import { PLACE_KINDS } from '../types.ts';

export const STRUCTURE_KINDS = ['building', 'tower', 'wall', 'bridge', 'truss', 'vehicle', 'tree', 'rock', 'crate', 'pillar', 'other'] as const;
export const EFFECT_KINDS = { line: ['beam', 'lightning', 'projectile', 'slash'], volume: ['explosion', 'shockwave', 'aura', 'barrier'], damage: ['melting', 'burning', 'shattering', 'collapsing'] };
export { PLACE_KINDS } from '../types.ts';

export function vocabulary(): string {
  return [
    'POSES (name: what it is):',
    ...[...POSES.values()].map((p) => `- ${p.name}: ${p.description}`),
    '',
    `STRUCTURE KINDS: ${STRUCTURE_KINDS.join(', ')}. size: {floors} for buildings (one floor = 3.5 m), else {height, width, depth} in metres. truss = a steel gantry spanning a street (width = span, height = clearance); bridge = a footbridge or overpass (same). vehicle: a car unless the size says otherwise (a bus, a train: depth is its length). Something lying down (a fallen statue, a felled tree) has its lying size: low height, long depth. Anything else is "other" with its size, "shape": "box" | "cylinder" (a tank, a pod, a column) | "sphere", and "glass": true when it is see-through (a glass tank someone floats in); its "prompt" says what it is.`,
    `EFFECT KINDS: lines ${EFFECT_KINDS.line.join(', ')} ({"from": anchor, "to": anchor or {"toward":[x,y,z],"length":m}, "grazes"?: {"actor","part":"head|shoulder|side","side":"left|right","clearance":m}}); volumes ${EFFECT_KINDS.volume.join(', ')} ({"at": anchor, "radius": m}); damage ${EFFECT_KINDS.damage.join(', ')} ({"target": structure id, "floors"?: [from, to]}). Every effect has "prompt": English image tags.`,
    'ANCHORS: "<actor>.head|eyes|chest|right_hand|left_hand|feet|center", "<structure>.top|center|base|floor_<n>".',
    'PLACEMENT (one form, metres): {"at":[x,z]} | {"from":id,"distance":m,"bearing":"front|behind|left|right"} (relative to where that one faces) | {"behind":id,"seen_from":id,"distance":m} (on the line from seen_from through behind, beyond it) | {"on_line":[id,id],"at_fraction":0..1} | {"on":structure id,"part":"top|roof_edge","offset":m along its width}. Optional on any: "elevation" (metres above ground), "side_offset" (metres to the right of the placement\'s direction).',
    `PLACE KINDS: ${PLACE_KINDS.join(', ')}. Indoors (room, classroom, corridor) the place may give width, length and height in metres (default 9 × 7 × 3; a corridor 3.2 × 30); a room is bare walls, so what is in it (machines, beds, tanks, a door, windows) are structures. The room is centred at [0, 0]: x runs from -width/2 to width/2, z from -length/2 to length/2; everyone and everything stands inside it, and a door or a window sits on a wall (e.g. z = -length/2).`,
  ].join('\n');
}
