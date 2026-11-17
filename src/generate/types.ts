import type { ShotMaps } from '../camera/index.ts';
import type { Image } from '../shared/image.ts';
import type { PoseCheck } from './check.ts';
import type { Prompt } from './prompt.ts';

export interface GenerateInput {
  maps: ShotMaps; prompt: Prompt; width: number; height: number; seed?: number;
  /** pictures to make; with more than one, the one whose people best follow the plan is kept (check.ts) */
  candidates?: number;
}
export interface GenerateResult {
  image: Image;
  /** how the kept picture's people match the plan, when measured */
  check?: PoseCheck;
  /** every candidate's check, in order (the kept one is bestCandidate of these) */
  checks?: PoseCheck[];
}
export interface Generator { readonly name: string; generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> }

/** The backend cannot run here (not configured, not implemented): the pipeline keeps the maps and prompts and notes it. */
export class GeneratorUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'GeneratorUnavailable'; }
}
export class NotImplemented extends GeneratorUnavailable {
  constructor(backend: string) { super(`generator "${backend}" is not implemented yet`); this.name = 'NotImplemented'; }
}
