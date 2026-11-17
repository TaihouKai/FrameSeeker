// The intent of a shot: what it must make the viewer understand, separate from how the frame is composed. A small
// structured vocabulary, so that an LLM can write it from a story and code can act on it deterministically.

/** One thing the viewer must understand from the shot. */
export type Convey =
  /** read their face: a reaction, an emotion */
  | { what: 'face'; who: string }
  /** what they look at (target: an id; or 'gaze', what the scene says they look at) */
  | { what: 'sees'; who: string; target: string }
  /** they hold power (over someone) */
  | { what: 'power'; who: string; over?: string }
  /** they are small, weak, overwhelmed */
  | { what: 'vulnerable'; who: string }
  /** they are alone */
  | { what: 'alone'; who: string }
  /** these belong together in this moment: a relation, a confrontation */
  | { what: 'together'; who: string[] }
  /** how small they are against something big */
  | { what: 'scale'; who: string; against: string };

export type ConveyKind = Convey['what'];

export interface ShotIntent {
  /** the centre of attention: the id the viewer's eye goes to first */
  subject: string;
  /** what the viewer must understand, most important first */
  convey: Convey[];
  /** one sentence: what the shot is for (for people reading the plan) */
  why?: string;
}
