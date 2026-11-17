// Module 3 — generation (phase 6): the shot's structure maps (composition: depth, later lineart and pose) plus the
// prompt (content) go to an image backend. Backends are stubs for now (ComfyUI workflow with
// ControlNet on Comfy Cloud or RunPod; NovelAI as an alternative); every call throws NotImplemented.
import type { ShotMaps } from '../camera/index.ts';
import type { Image } from '../shared/image.ts';
import type { Prompt } from './prompt.ts';

export { promptOf, shotTags, NEGATIVE, type Prompt, type CharacterPrompt } from './prompt.ts';

export interface GenerateInput { maps: ShotMaps; prompt: Prompt; width: number; height: number; seed?: number }
export interface Generator { readonly name: string; generate(input: GenerateInput, signal?: AbortSignal): Promise<Image> }

export class NotImplemented extends Error {
  constructor(backend: string) { super(`generator "${backend}" is not implemented yet`); this.name = 'NotImplemented'; }
}

const stub = (name: string): Generator => ({ name, generate: async () => { throw new NotImplemented(name); } });

/** ComfyUI (ControlNet depth/lineart/pose) through a hosted API. */
export const comfy = stub('comfy');
/** NovelAI image generation (V4 multi-character prompts). */
export const novelai = stub('novelai');

export const GENERATORS: Record<string, Generator> = { comfy, novelai };
