// A ComfyUI client (its standard HTTP API: /upload/image, /prompt, /history, /view): uploads the shot's maps and
// masks, queues the workflow (workflow.ts), waits, downloads the picture. Works with any ComfyUI server — local,
// RunPod, or a hosted service that keeps this API — given its base URL and, if needed, an auth header.
import { randomUUID } from 'node:crypto';
import { toPng, type Image } from '../shared/image.ts';
import { decodePng } from '../shared/png.ts';
import { OUTPUT_NODE, workflow, type ComfyModels, type ComfySampling, type Graph } from './workflow.ts';
import { GeneratorUnavailable, type GenerateInput, type Generator } from './types.ts';

export interface ComfyConfig {
  url: string;
  /** extra request headers (e.g. an API key) */
  headers?: Record<string, string>;
  models: ComfyModels;
  sampling?: Partial<ComfySampling>;
  /** give up after this long (ms) */
  timeout?: number;
  pollEvery?: number;
}

/** Configuration from the environment: COMFY_URL, COMFY_HEADERS (JSON), COMFY_CHECKPOINT, COMFY_VPRED=1, COMFY_CN_DEPTH / _LINEART / _POSE. */
export function comfyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComfyConfig | null {
  if (!env.COMFY_URL || !env.COMFY_CHECKPOINT) return null;
  return {
    url: env.COMFY_URL,
    headers: env.COMFY_HEADERS ? JSON.parse(env.COMFY_HEADERS) : undefined,
    models: {
      checkpoint: env.COMFY_CHECKPOINT, vpred: env.COMFY_VPRED === '1',
      controlnet: { depth: env.COMFY_CN_DEPTH, lineart: env.COMFY_CN_LINEART, pose: env.COMFY_CN_POSE },
    },
  };
}

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

async function run(cfg: ComfyConfig, input: GenerateInput, signal?: AbortSignal): Promise<Image> {
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
  const images = {
    depth: cfg.models.controlnet.depth ? await upload(maps.depth, 'depth') : undefined,
    lineart: cfg.models.controlnet.lineart ? await upload(maps.lineart, 'lineart') : undefined,
    pose: cfg.models.controlnet.pose ? await upload(maps.pose, 'pose') : undefined,
  };
  const masks: Record<string, string> = {};
  for (const r of maps.regions) if (r.kind === 'person' && prompt.characters.some((c) => c.id === r.id)) masks[r.id] = await upload(r.mask, `mask-${r.id}`);

  const graph: Graph = workflow({
    models: cfg.models, prompt, width: input.width, height: input.height, images, masks,
    sampling: { ...cfg.sampling, ...(input.seed !== undefined ? { seed: input.seed } : {}) },
  });
  const queued = await (await call('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: tag }) })).json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
  if (!queued.prompt_id) throw new Error(`ComfyUI refused the workflow: ${JSON.stringify(queued.error ?? queued.node_errors)}`);

  const deadline = Date.now() + (cfg.timeout ?? 10 * 60_000);
  for (;;) {
    const h = await (await call(`/history/${queued.prompt_id}`)).json() as Record<string, { status?: { status_str?: string; messages?: unknown }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
    const entry = h[queued.prompt_id];
    if (entry?.status?.status_str === 'error') throw new Error(`ComfyUI failed: ${JSON.stringify(entry.status.messages).slice(0, 500)}`);
    const img = entry?.outputs?.[OUTPUT_NODE]?.images?.[0];
    if (img) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
      return decodePng(new Uint8Array(await (await call(`/view?${q}`)).arrayBuffer()));
    }
    if (Date.now() > deadline) throw new Error('ComfyUI: timed out');
    await new Promise((r) => setTimeout(r, cfg.pollEvery ?? 1500));
  }
}
