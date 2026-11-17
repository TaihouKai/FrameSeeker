// The ComfyUI workflow (API format) for phase 6: an SDXL checkpoint, the prompt, ControlNets for the shot's depth,
// line art and pose, and one regional prompt per visible person (its mask, ConditioningSetMask). Pure: names of
// the uploaded images in, a graph out. Node classes are ComfyUI core only (no custom nodes).
import type { Prompt } from './prompt.ts';

export interface ComfyModels {
  checkpoint: string;
  /** v-prediction checkpoints (e.g. NoobAI-XL v-pred) need ModelSamplingDiscrete v_prediction */
  vpred?: boolean;
  controlnet: { depth?: string; lineart?: string; pose?: string };
  /** the checkpoint's own quality tags (e.g. Illustrious: masterpiece, best quality), put before every prompt */
  positive?: string[];
  negative?: string[];
}
export interface ComfySampling { steps: number; cfg: number; sampler: string; scheduler: string; seed: number }
/** ControlNet strengths and the part of the denoising they act on. Composition is fixed early, details left free. */
export interface ControlStrength { strength: number; start: number; end: number }

export const DEFAULT_SAMPLING: ComfySampling = { steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', seed: 0 };
/**
 * From runs on Comfy Cloud (WAI-Illustrious SDXL, the SDXL depth / openpose / scribble ControlNets), an over-the-
 * shoulder shot with a back-view person in front, 4 seeds each: depth 0.55 lost the near person (drawn as wall);
 * depth 1.0 turned the facing person around too (a featureless mannequin has the same depth front and back, so
 * which way someone faces must come from the pose); depth 0.8 under pose 1.0 got both people right in 3 of 4.
 */
export const DEFAULT_CONTROL: Record<'depth' | 'lineart' | 'pose', ControlStrength> = {
  depth: { strength: 0.8, start: 0, end: 0.7 },
  lineart: { strength: 0.45, start: 0, end: 0.5 },
  pose: { strength: 1, start: 0, end: 0.9 },
};

export interface WorkflowInput {
  models: ComfyModels;
  prompt: Prompt;
  width: number;
  height: number;
  /** uploaded image names (ComfyUI input folder) */
  images: { depth?: string; lineart?: string; pose?: string; init?: string };
  /** with images.init: how much of it is redrawn (1 = all, as from noise) */
  initDenoise?: number;
  /** per character: the uploaded mask image name (white = the person) */
  masks: Record<string, string>;
  sampling?: Partial<ComfySampling>;
  control?: Partial<typeof DEFAULT_CONTROL>;
  /** how far each person's mask grows, as a fraction of the image's long side */
  maskGrow?: number;
}

/** head-count tags ("2girls", "1boy"): for the whole picture, not for one person's region */
const COUNT = /^(\d|6\+)(girl|boy|other)s?$/;

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
  // Regional prompts: each person's tags only inside their mask, and the whole-picture prompt (head count, setting,
  // shot) only outside every mask. With the global prompt over the people too, its "1girl, 1boy" let the model put
  // the genders either way, and with everyone's tags in it, one person's hair turned up on the other. Masks grow a
  // little: the drawn person (hair, clothes) is bigger than the gray-box body.
  const quality = input.models.positive ?? [];
  const setting = input.prompt.scene.filter((t) => !COUNT.test(t));
  let negative = text([...input.prompt.negative, ...(input.models.negative ?? [])]);
  const grow = Math.round((input.maskGrow ?? 0.02) * Math.max(input.width, input.height));

  let positive: Ref | null = null, union: Ref | null = null;
  // people and effects alike: their tags inside their own region
  for (const c of [...input.prompt.characters, ...input.prompt.effects]) {
    const maskName = input.masks[c.id];
    if (!maskName || !c.tags.length) continue;
    let mask = node('LoadImageMask', { image: maskName, channel: 'red' });
    if (grow > 0) mask = node('GrowMask', { mask, expand: grow, tapered_corners: true });
    const local = node('ConditioningSetMask', { conditioning: text([...quality, ...c.tags, ...setting]), mask, strength: 1, set_cond_area: 'default' });
    positive = positive ? node('ConditioningCombine', { conditioning_1: positive, conditioning_2: local }) : local;
    union = union ? node('MaskComposite', { destination: union, source: mask, x: 0, y: 0, operation: 'add' }) : mask;
  }
  if (positive && union) {
    // outside the people the head count would only add more of them (small figures in the windows)
    const background = node('ConditioningSetMask', { conditioning: text([...quality, ...setting]), mask: node('InvertMask', { mask: union }), strength: 1, set_cond_area: 'default' });
    positive = node('ConditioningCombine', { conditioning_1: positive, conditioning_2: background });
  } else positive = text([...quality, ...input.prompt.scene, ...input.prompt.characters.flatMap((c) => c.tags), ...input.prompt.effects.flatMap((e) => e.tags)]);

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

  const init = input.images.init && (input.initDenoise ?? 1) < 1;
  const latent = init ? node('VAEEncode', { pixels: node('ImageScale', { image: node('LoadImage', { image: input.images.init }), upscale_method: 'bilinear', width: input.width, height: input.height, crop: 'disabled' }), vae }) : node('EmptyLatentImage', { width: input.width, height: input.height, batch_size: 1 });
  const sampled = node('KSampler', {
    model, positive, negative, latent_image: latent, seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: init ? input.initDenoise! : 1,
  });
  const decoded = node('VAEDecode', { samples: sampled, vae });
  node('SaveImage', { images: decoded, filename_prefix: 'frameseeker' }, OUTPUT_NODE);
  return g;
}
