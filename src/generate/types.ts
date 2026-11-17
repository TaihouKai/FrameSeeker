import type { Scene } from '../scene/index.ts';
import type { Shot, ShotMaps } from '../camera/index.ts';
import type { Image } from '../shared/image.ts';

/**
 * What a renderer gets for one shot: the scene (who and what, in the scene's own words), the shot (the camera and
 * its measurements) and the shot's maps (depth, line art, OpenPose, a mask per person / effect / structure / set
 * part, each person's planned joints and facing, a colour hint when an effect is in frame). How to turn that into a
 * prompt is the renderer's own business: an image-board model wants tags, another XML or sentences.
 */
export interface GenerateInput {
  scene: Scene; shot: Shot; maps: ShotMaps; width: number; height: number; seed?: number;
  /** pictures to make; a renderer that measures its pictures keeps the one that best follows the plan */
  candidates?: number;
}
export interface GenerateResult {
  image: Image;
  /** whatever the renderer reports (its prompt, its own checks) for the run's report */
  meta?: Record<string, unknown>;
}
export interface Generator { readonly name: string; generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> }

/** The backend cannot run here (not configured, not implemented): the pipeline keeps the maps and notes it. */
export class GeneratorUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'GeneratorUnavailable'; }
}
export class NotImplemented extends GeneratorUnavailable {
  constructor(backend: string) { super(`generator "${backend}" is not implemented yet`); this.name = 'NotImplemented'; }
}
