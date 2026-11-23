// The scene JSON: relations and rough numbers only; the solver (solve.ts) computes exact geometry.
import type { BodyPart } from './parts.ts';

export const PLACE_KINDS = ['street', 'plaza', 'bridge', 'rooftop', 'room', 'classroom', 'corridor', 'field', 'forest', 'shore', 'other'] as const;
export type PlaceKind = typeof PLACE_KINDS[number];
/** places with walls and a ceiling (seen past the walls: through a window) */
export const INDOOR_KINDS: ReadonlySet<PlaceKind> = new Set(['room', 'classroom', 'corridor']);
/**
 * Indoors, the room: centred at the origin, x across (from -hx to hx: the place's width), z along (from -hz to hz: its
 * length), the ceiling at h. Fixed by the place alone, so the scene's coordinates mean the same in every beat.
 */
export function roomOf(place: Scene['place']): { hx: number; hz: number; h: number } | null {
  if (!INDOOR_KINDS.has(place.kind)) return null;
  const corridor = place.kind === 'corridor';
  return { hx: (place.width ?? (corridor ? 3.2 : 9)) / 2, hz: (place.length ?? (corridor ? 30 : 7)) / 2, h: place.height ?? 3 };
}
export type Intent = 'scale' | 'action' | 'emotion' | 'reveal';

export interface Scene {
  version: 1;
  /** width: a street's width; indoors the room's width, length its length, height its ceiling (metres) */
  /** tags: image-board words naming the place itself (laboratory, hospital room), for its walls and floor */
  place: { kind: PlaceKind; description: string; tags?: string[]; width?: number; length?: number; height?: number };
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
  /** who or what they face (an id), or a world yaw in degrees (0 faces +Z, 90 faces +X); default: whom they approach, else the aim, else the other actors' centre */
  facing?: string | number;
  /**
   * what they look at, when the moment says: an id or anchor ("b", "tower.top", "beam"), or a world point [x, y, z] for
   * something not built (helicopters in the sky, the view). Default: the id they face, if they face one.
   */
  looks_at?: string | [number, number, number];
  /** whom or what they walk, run or move toward at this instant (an id); default facing */
  approaches?: string;
  /** they speak at this instant (the eye goes to the speaker) */
  speaking?: boolean;
}

export type StructureKind = 'building' | 'tower' | 'wall' | 'bridge' | 'truss' | 'vehicle' | 'tree' | 'rock' | 'crate' | 'pillar' | 'other';

export interface Structure {
  id: string;
  kind: StructureKind;
  size?: { floors?: number; height?: number; width?: number; depth?: number };
  /** for kind 'other' (and crate, pillar): a box (default), an upright cylinder (a tank, a pod, a column) or a sphere */
  shape?: 'box' | 'cylinder' | 'sphere';
  /** see-through (a glass tank, a window pane): who stands inside or behind it stays visible */
  glass?: boolean;
  place: Placement;
  /**
   * which way its front (+Z side) faces: an id, or a world yaw in degrees (as an actor's); else towards whoever places
   * it ("seen_from"/"from"), else the world's +Z
   */
  facing?: string | number;
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
  /**
   * an insert (a detail shot): the eye goes to this part of the focus, not to the whole person (the injured foot, the
   * hand that holds the letter); the shot is judged on the part
   */
  part?: BodyPart;
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

/**
 * One instant of a sequence on the same set (a panel of a strip): who is there and how. The place and the structures
 * stay where the scene puts them; the people present are the beat's, each taking the scene's values for what the
 * beat leaves out. The other people are not there.
 */
export interface Beat {
  /** what happens at this instant, in the story's words */
  what: string;
  /** the people present (at least one) */
  actors: BeatActor[];
  /** the scene's effects that happen at this instant (default: none) */
  effects?: string[];
}
export type BeatActor = { id: string; expression?: string[] } & Partial<Pick<Actor, 'pose' | 'place' | 'facing' | 'looks_at' | 'approaches' | 'speaking' | 'aim'>>;

export const isLine = (e: Effect): e is Extract<Effect, { kind: LineKind }> => ['beam', 'lightning', 'projectile', 'slash'].includes(e.kind);
export const isVolume = (e: Effect): e is Extract<Effect, { kind: VolumeKind }> => ['explosion', 'shockwave', 'aura', 'barrier'].includes(e.kind);
export const isDamage = (e: Effect): e is Extract<Effect, { kind: DamageKind }> => ['melting', 'burning', 'shattering', 'collapsing'].includes(e.kind);
