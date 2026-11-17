// Module 3 — generation (phase 6): the shot's structure maps (composition: depth, line art, pose; who is where:
// region masks) plus the prompt (content) go to an image backend.
//  - comfy: a ComfyUI server (SDXL + ControlNet depth/line art/pose + a regional prompt per person), configured by
//    environment (comfy.ts); not configured → GeneratorUnavailable.
//  - novelai: a stub (NovelAI has no structure control for its V4 models; it may come back for its character
//    positions, which the region centres give).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { comfyConfigFromEnv, comfyGenerator } from './comfy.ts';
import { NotImplemented, type Generator } from './types.ts';

export { promptOf, shotTags, viewTags, countTags, NEGATIVE, type Prompt, type CharacterPrompt } from './prompt.ts';
export { GeneratorUnavailable, NotImplemented, type GenerateInput, type Generator } from './types.ts';
export { comfyGenerator, comfyConfigFromEnv, COMFY_CLOUD_URL, type ComfyConfig } from './comfy.ts';
export { workflow, DEFAULT_CONTROL, DEFAULT_SAMPLING, type ComfyModels } from './workflow.ts';

/** ComfyUI, configured from the environment when called; the API key may also sit in ~/.secrets/comfy.key. */
export const comfy: Generator = comfyGenerator(() => {
  const keyFile = join(homedir(), '.secrets', 'comfy.key');
  const key = process.env.COMFY_API_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : undefined);
  return comfyConfigFromEnv({ ...process.env, ...(key ? { COMFY_API_KEY: key } : {}) });
});
/** NovelAI image generation (stub). */
export const novelai: Generator = { name: 'novelai', generate: async () => { throw new NotImplemented('novelai'); } };

export const GENERATORS: Record<string, Generator> = { comfy, novelai };
