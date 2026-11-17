// The ComfyUI workflow (API format) for phase 6: an SDXL checkpoint, the prompt, ControlNets for the shot's depth,
// line art and pose, and one regional prompt per visible person (its mask, ConditioningSetMask). Pure: names of
// the uploaded images in, a graph out. Node classes are ComfyUI core only (no custom nodes).
import type { Prompt } from './prompt.ts';

export interface ComfyModels {
  checkpoint: string;
  /** v-prediction checkpoints (e.g. NoobAI-XL v-pred) need ModelSamplingDiscrete v_prediction */
  vpred?: boolean;
  controlnet: { depth?: string; lineart?: string; pose?: string };
}
export interface ComfySampling { steps: number; cfg: number; sampler: string; scheduler: string; seed: number }
/** ControlNet strengths and the part of the denoising they act on. Composition is fixed early, details left free. */
export interface ControlStrength { strength: number; start: number; end: number }

export const DEFAULT_SAMPLING: ComfySampling = { steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', seed: 0 };
export const DEFAULT_CONTROL: Record<'depth' | 'lineart' | 'pose', ControlStrength> = {
  depth: { strength: 0.55, start: 0, end: 0.6 },
  lineart: { strength: 0.45, start: 0, end: 0.5 },
  pose: { strength: 0.8, start: 0, end: 0.8 },
};

export interface WorkflowInput {
  models: ComfyModels;
  prompt: Prompt;
  width: number;
  height: number;
  /** uploaded image names (ComfyUI input folder) */
  images: { depth?: string; lineart?: string; pose?: string };
  /** per character: the uploaded mask image name (white = the person) */
  masks: Record<string, string>;
  sampling?: Partial<ComfySampling>;
  control?: Partial<typeof DEFAULT_CONTROL>;
}

type Ref = [string, number];
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export const OUTPUT_NODE = 'save';

export function workflow(input: WorkflowInput): Graph {
  const g: Graph = {};
  let n = 0;
  const node = (class_type: string, inputs: Record<string, unknown>, id = `n${++n}`): Ref => { g[id] = { class_type, inputs }; return [id, 0]; };
  const out = (r: Ref, i: number): Ref => [r[0], i];
  const s = { ...DEFAULT_SAMPLING, ...input.sampling };
  const ctl = { ...DEFAULT_CONTROL, ...input.control };

  const ckpt = node('CheckpointLoaderSimple', { ckpt_name: input.models.checkpoint });
  let model: Ref = out(ckpt, 0);
  const clip = out(ckpt, 1), vae = out(ckpt, 2);
  if (input.models.vpred) model = node('ModelSamplingDiscrete', { model, sampling: 'v_prediction', zsnr: false });

  const text = (t: string[]) => node('CLIPTextEncode', { clip, text: t.join(', ') });
  let positive = text([...input.prompt.scene, ...input.prompt.characters.flatMap((c) => c.tags)]);
  let negative = text(input.prompt.negative);

  // each person's own tags inside their mask, on top of the whole-picture prompt
  for (const c of input.prompt.characters) {
    const maskName = input.masks[c.id];
    if (!maskName || !c.tags.length) continue;
    const mask = node('LoadImageMask', { image: maskName, channel: 'red' });
    const local = node('ConditioningSetMask', { conditioning: text(c.tags), mask, strength: 1, set_cond_area: 'default' });
    positive = node('ConditioningCombine', { conditioning_1: positive, conditioning_2: local });
  }

  for (const kind of ['depth', 'lineart', 'pose'] as const) {
    const image = input.images[kind], net = input.models.controlnet[kind];
    if (!image || !net) continue;
    const loaded = node('LoadImage', { image });
    const cn = node('ControlNetLoader', { control_net_name: net });
    const applied = node('ControlNetApplyAdvanced', {
      positive, negative, control_net: cn, image: loaded, strength: ctl[kind].strength, start_percent: ctl[kind].start, end_percent: ctl[kind].end, vae,
    });
    positive = out(applied, 0); negative = out(applied, 1);
  }

  const latent = node('EmptyLatentImage', { width: input.width, height: input.height, batch_size: 1 });
  const sampled = node('KSampler', {
    model, positive, negative, latent_image: latent, seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: 1,
  });
  const decoded = node('VAEDecode', { samples: sampled, vae });
  node('SaveImage', { images: decoded, filename_prefix: 'frameseeker' }, OUTPUT_NODE);
  return g;
}
