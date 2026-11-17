// The scene JSON: relations and rough numbers only; the solver (solve.ts) computes exact geometry.

export type PlaceKind = 'street' | 'plaza' | 'bridge' | 'rooftop' | 'room' | 'corridor' | 'field' | 'forest' | 'shore' | 'other';
export type Intent = 'scale' | 'action' | 'emotion' | 'reveal';

export interface Scene {
  version: 1;
  place: { kind: PlaceKind; description: string; width?: number };
  time: { of_day: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'sunset' | 'dusk' | 'night'; weather?: 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' };
  actors: Actor[];
  structures: Structure[];
  effects: Effect[];
  moment: Moment;
}

export interface ActorPrompt { tag?: string; series?: string; look: string[]; outfit: string[]; expression: string[] }

export interface Actor {
  id: string;
  prompt: ActorPrompt;
  /** metres; default 1.6 */
  height?: number;
  /** a name from the pose library (poses.ts) */
  pose: string;
  /** what a pointing/firing pose aims at */
  aim?: Anchor;
  place: Placement;
  /** who or what they face (an id), or a world yaw in degrees (0 faces +Z, 90 faces +X); default: the aim, else the other actors' centre */
  facing?: string | number;
}

export type StructureKind = 'building' | 'tower' | 'wall' | 'bridge' | 'truss' | 'vehicle' | 'tree' | 'rock' | 'crate' | 'pillar' | 'other';

export interface Structure {
  id: string;
  kind: StructureKind;
  size?: { floors?: number; height?: number; width?: number; depth?: number };
  place: Placement;
  /** which way its front (+Z side) faces: an id, else towards whoever places it ("seen_from"/"from"), else the world's +Z */
  facing?: string;
  prompt: string[];
}

interface PlacementCommon {
  /** height above the ground (floating, leaping) */
  elevation?: number;
  /** sideways shift (metres) off the line that defines the placement, to the right of that line's direction (negative: left) */
  side_offset?: number;
}
export type Placement = PlacementCommon & (
  | { at: [number, number] }
  | { from: string; distance: number; bearing?: 'front' | 'behind' | 'left' | 'right' | number }
  | { behind: string; seen_from: string; distance: number }
  | { on_line: [string, string]; at_fraction: number }
  | { on: string; part?: 'top' | 'roof_edge'; offset?: number }
);

/** '<id>.<part>': actors head|eyes|chest|right_hand|left_hand|feet; structures top|center|base|floor_<n> */
export type Anchor = string;
/** A direction instead of an end point (into the sky, off the frame): unit-less direction and a length. */
export interface Toward { toward: [number, number, number]; length: number }

export type LineKind = 'beam' | 'lightning' | 'projectile' | 'slash';
export type VolumeKind = 'explosion' | 'shockwave' | 'aura' | 'barrier';
export type DamageKind = 'melting' | 'burning' | 'shattering' | 'collapsing';

export type Effect =
  | { id: string; kind: LineKind; from: Anchor; to: Anchor | Toward; radius?: number; grazes?: { actor: string; part: 'head' | 'shoulder' | 'side'; clearance?: number; side?: 'left' | 'right' }; prompt: string[] }
  | { id: string; kind: VolumeKind; at: Anchor; radius: number; prompt: string[] }
  | { id: string; kind: DamageKind; target: string; floors?: [number, number]; prompt: string[] };

export interface Moment {
  /** what the eye goes to first (an actor id) */
  focus: string;
  /** the effect that runs through the picture */
  action_line?: string;
  /** what the action does (an effect or structure id) */
  payoff?: string;
  /** who does it (may be out of frame) */
  source?: string;
  intent: Intent;
  /** ids that must be in frame (default: focus, action_line, payoff) */
  must_show?: string[];
  /** ids that may leave the frame or be hidden */
  may_hide?: string[];
}

export const isLine = (e: Effect): e is Extract<Effect, { kind: LineKind }> => ['beam', 'lightning', 'projectile', 'slash'].includes(e.kind);
export const isVolume = (e: Effect): e is Extract<Effect, { kind: VolumeKind }> => ['explosion', 'shockwave', 'aura', 'barrier'].includes(e.kind);
export const isDamage = (e: Effect): e is Extract<Effect, { kind: DamageKind }> => ['melting', 'burning', 'shattering', 'collapsing'].includes(e.kind);
