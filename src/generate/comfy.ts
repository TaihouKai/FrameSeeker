// A ComfyUI client (its standard HTTP API: /upload/image, /prompt, /history, /view): uploads the shot's maps and
// masks, queues the workflow (workflow.ts), waits, downloads the picture. Works with any ComfyUI server — local,
// RunPod, or a hosted service that keeps this API — given its base URL and, if needed, an auth header.
import { randomUUID } from 'node:crypto';
import { toPng, type Image } from '../shared/image.ts';
import { decodePng } from '../shared/png.ts';
import { bestCandidate, checkPose, genderVerdict, type Joints, type PoseCheck, type Verdict } from './check.ts';
import { loadTagger, type Tagger } from './tagger.ts';
import { OUTPUT_NODE, POSE_NODE, workflow, type ComfyModels, type ComfySampling, type Graph, type WorkflowInput } from './workflow.ts';
import { GeneratorUnavailable, type GenerateInput, type GenerateResult, type Generator } from './types.ts';

export interface ComfyConfig {
  url: string;
  /** extra request headers (e.g. an API key) */
  headers?: Record<string, string>;
  models: ComfyModels;
  sampling?: Partial<ComfySampling>;
  control?: WorkflowInput['control'];
  backgroundControl?: WorkflowInput['backgroundControl'];
  refine?: WorkflowInput['refine'];
  maskGrow?: number;
  /** a shot with effects starts from their colour hint (maps.hint) and redraws this much of it; 1 = from noise (default 0.9) */
  hintDenoise?: number;
  /** pictures per shot (one batch); with detectPose the one whose people best follow the plan is kept */
  candidates?: number;
  /** run a pose detector on each picture (needs comfyui_controlnet_aux's DWPreprocessor on the server) */
  detectPose?: boolean;
  /** the image-board tagger for each person's gender: null = none; absent = loaded if installed (npm run get-tagger) */
  tagger?: Tagger | null;
  /** give up after this long (ms) */
  timeout?: number;
  pollEvery?: number;
}

export const COMFY_CLOUD_URL = 'https://cloud.comfy.org/api';
const CLOUD_DEFAULTS: Record<string, string> = {
  COMFY_CHECKPOINT: 'wai-illustrious-sdxl.safetensors',
  COMFY_CN_DEPTH: 'controlnet-depth-sdxl-1.0.safetensors',
  COMFY_CN_POSE: 'controlnet-openpose-sdxl-1.0.safetensors',
  COMFY_CN_LINEART: 'controlnet-scribble-sdxl-1.0.safetensors',
  COMFY_POSITIVE: 'masterpiece, best quality, amazing quality',
  COMFY_NEGATIVE: 'worst quality, low quality, bad hands',
  // four pictures per shot, the one whose people best follow the plan kept (DWPose is installed there)
  COMFY_CANDIDATES: '4',
  COMFY_DETECT_POSE: '1',
};

/**
 * Configuration from the environment: COMFY_URL, COMFY_API_KEY (sent as X-API-Key), COMFY_HEADERS (JSON),
 * COMFY_CHECKPOINT, COMFY_VPRED=1, COMFY_CN_DEPTH / _LINEART / _POSE, COMFY_POSITIVE / _NEGATIVE (quality tags),
 * COMFY_CANDIDATES, COMFY_DETECT_POSE=1. With an API key and no URL, Comfy Cloud.
 */
export function comfyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComfyConfig | null {
  const url = env.COMFY_URL ?? (env.COMFY_API_KEY ? COMFY_CLOUD_URL : undefined);
  // on Comfy Cloud, models it has installed (checked through /api/object_info), unless named
  if (url === COMFY_CLOUD_URL) env = { ...CLOUD_DEFAULTS, ...env };
  if (!url || !env.COMFY_CHECKPOINT) return null;
  const headers: Record<string, string> = { ...(env.COMFY_HEADERS ? JSON.parse(env.COMFY_HEADERS) : {}), ...(env.COMFY_API_KEY ? { 'X-API-Key': env.COMFY_API_KEY } : {}) };
  return {
    url,
    headers: Object.keys(headers).length ? headers : undefined,
    models: {
      checkpoint: env.COMFY_CHECKPOINT, vpred: env.COMFY_VPRED === '1',
      controlnet: { depth: env.COMFY_CN_DEPTH, lineart: env.COMFY_CN_LINEART, pose: env.COMFY_CN_POSE },
      positive: list(env.COMFY_POSITIVE), negative: list(env.COMFY_NEGATIVE),
    },
    candidates: env.COMFY_CANDIDATES ? Number(env.COMFY_CANDIDATES) : undefined,
    detectPose: env.COMFY_DETECT_POSE === '1',
  };
}

const list = (s?: string) => s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined;

export function comfyGenerator(config: ComfyConfig | null | (() => ComfyConfig | null)): Generator {
  return {
    name: 'comfy',
    async generate(input, signal) {
      const cfg = typeof config === 'function' ? config() : config;
      if (!cfg) throw new GeneratorUnavailable('comfy: not configured (set COMFY_URL and COMFY_CHECKPOINT)');
      return run(cfg, input, signal);
    },
  };
}

async function run(cfg: ComfyConfig, input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
  const base = cfg.url.replace(/\/+$/, '');
  const headers = cfg.headers ?? {};
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, signal });
    if (!r.ok) throw new Error(`ComfyUI ${init.method ?? 'GET'} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r;
  };
  const tag = randomUUID().slice(0, 8);
  const upload = async (img: Image, name: string): Promise<string> => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(toPng(img))], { type: 'image/png' }), `frameseeker-${tag}-${name}.png`);
    form.append('overwrite', 'true');
    form.append('type', 'input');
    const j = await (await call('/upload/image', { method: 'POST', body: form })).json() as { name: string; subfolder?: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  };

  const { maps, prompt } = input;
  const candidates = Math.max(1, input.candidates ?? cfg.candidates ?? 1), detectPose = !!cfg.detectPose;
  const hintDenoise = cfg.hintDenoise ?? 0.9;
  const images = {
    depth: cfg.models.controlnet.depth ? await upload(maps.depth, 'depth') : undefined,
    lineart: cfg.models.controlnet.lineart ? await upload(maps.lineart, 'lineart') : undefined,
    pose: cfg.models.controlnet.pose ? await upload(maps.pose, 'pose') : undefined,
    init: maps.hint && hintDenoise < 1 ? await upload(maps.hint, 'hint') : undefined,
  };
  const masks: Record<string, string> = {};
  const named = new Set([...prompt.characters, ...prompt.effects].map((c) => c.id));
  for (const r of maps.regions) if (named.has(r.id)) masks[r.id] = await upload(r.mask, `mask-${r.id}`);

  const graph: Graph = workflow({
    models: cfg.models, prompt, width: input.width, height: input.height, images, masks, control: cfg.control, backgroundControl: cfg.backgroundControl, refine: cfg.refine, maskGrow: cfg.maskGrow, initDenoise: hintDenoise, batch: candidates, detectPose,
    sampling: { ...cfg.sampling, ...(input.seed !== undefined ? { seed: input.seed } : {}) },
  });
  const queued = await (await call('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: tag }) })).json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
  if (!queued.prompt_id) throw new Error(`ComfyUI refused the workflow: ${JSON.stringify(queued.error ?? queued.node_errors)}`);

  const id = queued.prompt_id;
  const deadline = Date.now() + (cfg.timeout ?? 10 * 60_000);
  // local ComfyUI answers /history/{id}; Comfy Cloud has no such route and answers /jobs/{id} instead
  let cloud = false;
  for (;;) {
    let entry: Entry | undefined;
    if (!cloud) {
      const r = await fetch(`${base}/history/${id}`, { headers, signal });
      if (r.status === 404 || r.status === 405) cloud = true;
      else if (!r.ok) throw new Error(`ComfyUI GET /history/${id}: ${r.status} ${(await r.text()).slice(0, 300)}`);
      else entry = ((await r.json()) as Record<string, Entry>)[id];
    }
    if (cloud) {
      const j = await (await call(`/jobs/${id}`)).json() as { status?: string; outputs?: Entry['outputs']; execution_error?: unknown; error_message?: unknown };
      if (j.status && FAILED.has(j.status)) throw new Error(`ComfyUI failed (${j.status}): ${JSON.stringify(j.execution_error ?? j.error_message ?? '').slice(0, 500)}`);
      entry = { outputs: j.outputs };
    }
    if (entry?.status?.status_str === 'error') throw new Error(`ComfyUI failed: ${JSON.stringify(entry.status.messages).slice(0, 500)}`);
    const imgs = entry?.outputs?.[OUTPUT_NODE]?.images;
    if (imgs?.length) return pickAndFetch(imgs, entry!.outputs![POSE_NODE]?.openpose_json);
    if (Date.now() > deadline) throw new Error('ComfyUI: timed out');
    await new Promise((r) => setTimeout(r, cfg.pollEvery ?? 1500));
  }

  /** the candidate whose people best follow the plan (when measured); only that one is downloaded */
  async function pickAndFetch(imgs: OutImage[], poseJson?: string[]): Promise<GenerateResult> {
    let checks: PoseCheck[] | undefined;
    // each person's gender, by the tagger on their own pixels (every candidate is downloaded for it)
    const tagger = cfg.tagger === undefined ? await loadTagger() : cfg.tagger;
    const people = prompt.characters.filter((c) => c.tags.includes('1boy') || c.tags.includes('1girl'));
    const pictures: (Image | undefined)[] = [];
    const genders: Record<string, Verdict>[] = [];
    if (tagger && people.length) for (const [k, im] of imgs.entries()) {
      const pic = pictures[k] = decodePng(await view(im));
      genders[k] = {};
      for (const c of people) {
        const r = maps.regions.find((g) => g.kind === 'person' && g.id === c.id);
        if (r) genders[k][c.id] = genderVerdict(c.tags, await tagger.tag(pic, r.box, r.mask))!;
      }
    }
    if (detectPose && poseJson?.length) {
      // one JSON list of frames per string; a batch may come as one string or one per picture
      const frames = poseJson.flatMap((s) => JSON.parse(s) as DetectedFrame[]);
      if (frames.length === imgs.length) checks = frames.map((f, k) => checkPose(maps.people, detectedJoints(f), f.canvas_width / f.canvas_height, genders[k]));
    }
    const k = checks ? bestCandidate(checks) : 0;
    return { image: pictures[k] ?? decodePng(await view(imgs[k])), check: checks?.[k], checks };
  }

  /** /view returns the bytes (local) or a redirect to a signed storage URL (cloud), which must be fetched without our key */
  async function view(img: OutImage): Promise<Uint8Array> {
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
    const r = await fetch(`${base}/view?${q}`, { headers, redirect: 'manual', signal });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) throw new Error('ComfyUI /view: redirect without a location');
      const s = await fetch(new URL(loc, base + '/'), { signal });
      if (!s.ok) throw new Error(`ComfyUI output download: ${s.status}`);
      return new Uint8Array(await s.arrayBuffer());
    }
    if (!r.ok) throw new Error(`ComfyUI GET /view: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

type OutImage = { filename: string; subfolder: string; type: string };
type Entry = { status?: { status_str?: string; messages?: unknown }; outputs?: Record<string, { images?: OutImage[]; openpose_json?: string[] }> };
/** one picture's people as an OpenPose-format detector writes them (pixels; [x, y, confidence] per joint) */
interface DetectedFrame { canvas_width: number; canvas_height: number; people: { pose_keypoints_2d: number[] }[] }
function detectedJoints(f: DetectedFrame): Joints[] {
  const k = (p: number[], n: number): [number, number] | null => p[3 * n + 2] > 0 ? [p[3 * n] / f.canvas_width, p[3 * n + 1] / f.canvas_height] : null;
  return f.people.map((p) => Array.from({ length: 18 }, (_, n) => k(p.pose_keypoints_2d, n)));
}
const FAILED = new Set(['failed', 'error', 'non_retryable_error', 'lost', 'cancelled', 'canceled']);
