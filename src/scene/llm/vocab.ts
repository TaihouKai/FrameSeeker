// The words the models may use, written from the code itself (pose library, kinds, placement forms), so a prompt
// never drifts from what the solver accepts.
import { POSES } from '../poses.ts';

export const STRUCTURE_KINDS = ['building', 'tower', 'wall', 'bridge', 'truss', 'vehicle', 'tree', 'rock', 'crate', 'pillar', 'other'] as const;
export const EFFECT_KINDS = { line: ['beam', 'lightning', 'projectile', 'slash'], volume: ['explosion', 'shockwave', 'aura', 'barrier'], damage: ['melting', 'burning', 'shattering', 'collapsing'] };
export const PLACE_KINDS = ['street', 'plaza', 'bridge', 'rooftop', 'room', 'corridor', 'field', 'forest', 'shore', 'other'];

export function vocabulary(): string {
  return [
    'POSES (name: what it is):',
    ...[...POSES.values()].map((p) => `- ${p.name}: ${p.description}`),
    '',
    `STRUCTURE KINDS: ${STRUCTURE_KINDS.join(', ')}. size: {floors} for buildings (one floor = 3.5 m), else {height, width, depth} in metres. truss = a steel gantry spanning a street (width = span, height = clearance); bridge = a footbridge or overpass (same).`,
    `EFFECT KINDS: lines ${EFFECT_KINDS.line.join(', ')} ({"from": anchor, "to": anchor or {"toward":[x,y,z],"length":m}, "grazes"?: {"actor","part":"head|shoulder|side","side":"left|right","clearance":m}}); volumes ${EFFECT_KINDS.volume.join(', ')} ({"at": anchor, "radius": m}); damage ${EFFECT_KINDS.damage.join(', ')} ({"target": structure id, "floors"?: [from, to]}). Every effect has "prompt": English image tags.`,
    'ANCHORS: "<actor>.head|eyes|chest|right_hand|left_hand|feet|center", "<structure>.top|center|base|floor_<n>".',
    'PLACEMENT (one form, metres): {"at":[x,z]} | {"from":id,"distance":m,"bearing":"front|behind|left|right"} (relative to where that one faces) | {"behind":id,"seen_from":id,"distance":m} (on the line from seen_from through behind, beyond it) | {"on_line":[id,id],"at_fraction":0..1} | {"on":structure id,"part":"top|roof_edge","offset":m along its width}. Optional on any: "elevation" (metres above ground), "side_offset" (metres to the right of the placement\'s direction).',
    `PLACE KINDS: ${PLACE_KINDS.join(', ')}.`,
  ].join('\n');
}
