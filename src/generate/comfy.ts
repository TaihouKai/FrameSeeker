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

export const COMFY_CLOUD_URL = 'https://cloud.comfy.org/api';

/**
 * Configuration from the environment: COMFY_URL, COMFY_API_KEY (sent as X-API-Key), COMFY_HEADERS (JSON),
 * COMFY_CHECKPOINT, COMFY_VPRED=1, COMFY_CN_DEPTH / _LINEART / _POSE. With an API key and no URL, Comfy Cloud.
 */
export function comfyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComfyConfig | null {
  const url = env.COMFY_URL ?? (env.COMFY_API_KEY ? COMFY_CLOUD_URL : undefined);
  if (!url || !env.COMFY_CHECKPOINT) return null;
  const headers: Record<string, string> = { ...(env.COMFY_HEADERS ? JSON.parse(env.COMFY_HEADERS) : {}), ...(env.COMFY_API_KEY ? { 'X-API-Key': env.COMFY_API_KEY } : {}) };
  return {
    url,
    headers: Object.keys(headers).length ? headers : undefined,
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
    const img = entry?.outputs?.[OUTPUT_NODE]?.images?.[0];
    if (img) return decodePng(await view(img));
    if (Date.now() > deadline) throw new Error('ComfyUI: timed out');
    await new Promise((r) => setTimeout(r, cfg.pollEvery ?? 1500));
  }

  /** /view returns the bytes (local) or a redirect to a signed storage URL (cloud), which must be fetched without our key */
  async function view(img: { filename: string; subfolder: string; type: string }): Promise<Uint8Array> {
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

type Entry = { status?: { status_str?: string; messages?: unknown }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> };
const FAILED = new Set(['failed', 'error', 'non_retryable_error', 'lost', 'cancelled', 'canceled']);
