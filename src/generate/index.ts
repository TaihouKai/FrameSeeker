// Module 3 — generation (phase 6): a shot's scene, camera and structure maps go to an image renderer.
//
// The first renderer (SDXL + ControlNet on ComfyUI, with regional prompts, a colour hint for effects and a
// pose / gender check on candidates) is archived on branch archive/phase6-sdxl-comfy (tag phase6-sdxl-comfy-v1)
// while existing multi-character, structure-controlled renderers are reviewed. Phase 6 is meant to be a thin
// adapter from the maps onto one of them.
import type { Generator } from './types.ts';

export { GeneratorUnavailable, NotImplemented, type GenerateInput, type GenerateResult, type Generator } from './types.ts';

/** Renderers by name (none in this version: see the archive). */
export const GENERATORS: Record<string, Generator> = {};
