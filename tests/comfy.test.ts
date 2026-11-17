import { describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { COMFY_CLOUD_URL, comfyConfigFromEnv, comfyGenerator, GeneratorUnavailable, promptOf, workflow, type ComfyConfig } from '../src/generate/index.ts';
import { realize, type Scene } from '../src/scene/index.ts';
import { maps, shoot } from '../src/camera/index.ts';
import { decodePng, encodePng } from '../src/shared/png.ts';
import { runScene } from '../src/pipeline.ts';

// the ComfyUI core nodes the workflow may use, with their required inputs
const NODES: Record<string, string[]> = {
  CheckpointLoaderSimple: ['ckpt_name'], ModelSamplingDiscrete: ['model', 'sampling', 'zsnr'], CLIPTextEncode: ['clip', 'text'],
  LoadImage: ['image'], LoadImageMask: ['image', 'channel'], ConditioningSetMask: ['conditioning', 'mask', 'strength', 'set_cond_area'],
  ConditioningCombine: ['conditioning_1', 'conditioning_2'], ControlNetLoader: ['control_net_name'],
  GrowMask: ['mask', 'expand', 'tapered_corners'], MaskComposite: ['destination', 'source', 'x', 'y', 'operation'], InvertMask: ['mask'],
  ControlNetApplyAdvanced: ['positive', 'negative', 'control_net', 'image', 'strength', 'start_percent', 'end_percent'],
  EmptyLatentImage: ['width', 'height', 'batch_size'], KSampler: ['model', 'positive', 'negative', 'latent_image', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  VAEDecode: ['samples', 'vae'], SaveImage: ['images', 'filename_prefix'],
  VAEEncode: ['pixels', 'vae'], ImageScale: ['image', 'upscale_method', 'width', 'height', 'crop'], RepeatLatentBatch: ['samples', 'amount'],
  // comfyui_controlnet_aux (installed on Comfy Cloud)
  DWPreprocessor: ['image'], PreviewImage: ['images'],
};
// outputs per node class (to check link indices)
const OUTPUTS: Record<string, number> = { CheckpointLoaderSimple: 3, ControlNetApplyAdvanced: 2 };

const body = (req: IncomingMessage) => new Promise<Buffer>((res) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });

/** A fake ComfyUI: checks uploads and the graph, "renders" a 4x2 picture after two polls. */
/** cloud: imitates Comfy Cloud — routes under /api, no /history (outputs from /api/jobs/{id}), /view redirects to a signed URL that refuses our key */
async function fakeComfy(cloud = false, result?: { outputs: Record<string, unknown>; files: Record<string, Uint8Array> }) {
  const uploaded = new Set<string>();
  const seen: { graph?: Record<string, { class_type: string; inputs: Record<string, unknown> }>; problems: string[]; auth: string[] } = { problems: [], auth: [] };
  let polls = 0;
  const picture = encodePng(4, 2, new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 3);
  const outputs = result?.outputs ?? { save: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } };
  const files: Record<string, Uint8Array> = result?.files ?? { 'out.png': picture };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (cloud && url.pathname === '/signed/out.png') {
      if (req.headers['x-api-key']) seen.problems.push('key sent to the signed storage URL');
      res.setHeader('content-type', 'image/png'); res.end(picture); return;
    }
    seen.auth.push(String(req.headers['x-api-key']));
    if (cloud) {
      if (!url.pathname.startsWith('/api/')) { res.statusCode = 404; res.end('no'); return; }
      url.pathname = url.pathname.slice(4);
      if (url.pathname.startsWith('/history')) { res.statusCode = 404; res.end('no'); return; }
      if (url.pathname === '/jobs/p1') {
        polls++;
        res.end(JSON.stringify(polls < 2 ? { id: 'p1', status: 'in_progress' } : { id: 'p1', status: 'completed', outputs }));
        return;
      }
      if (url.pathname === '/view') { res.statusCode = 302; res.setHeader('location', '/signed/out.png?sig=1'); res.end(); return; }
    }
    if (url.pathname === '/upload/image' && req.method === 'POST') {
      const text = (await body(req)).toString('latin1');
      const name = /filename="([^"]+)"/.exec(text)?.[1];
      if (!name || !text.includes('\x89PNG')) seen.problems.push('upload without a PNG');
      uploaded.add(name!);
      res.end(JSON.stringify({ name, subfolder: '', type: 'input' }));
    } else if (url.pathname === '/prompt' && req.method === 'POST') {
      const { prompt } = JSON.parse((await body(req)).toString());
      seen.graph = prompt;
      for (const [id, n] of Object.entries(prompt as Record<string, { class_type: string; inputs: Record<string, unknown> }>)) {
        if (!NODES[n.class_type]) seen.problems.push(`${id}: unknown node ${n.class_type}`);
        for (const k of NODES[n.class_type] ?? []) if (!(k in n.inputs)) seen.problems.push(`${id}: ${n.class_type} lacks ${k}`);
        for (const v of Object.values(n.inputs)) if (Array.isArray(v)) {
          const src = prompt[v[0]];
          if (!src) seen.problems.push(`${id}: link to missing ${v[0]}`);
          else if (v[1] >= (OUTPUTS[src.class_type] ?? 1)) seen.problems.push(`${id}: output ${v[1]} of ${src.class_type}`);
        }
        if ((n.class_type === 'LoadImage' || n.class_type === 'LoadImageMask') && !uploaded.has(n.inputs.image as string)) seen.problems.push(`${id}: image not uploaded`);
      }
      res.end(JSON.stringify({ prompt_id: 'p1', number: 0, node_errors: {} }));
    } else if (url.pathname === '/history/p1') {
      polls++;
      res.end(JSON.stringify(polls < 2 ? {} : { p1: { status: { status_str: 'success' }, outputs } }));
    } else if (url.pathname === '/view' && files[url.searchParams.get('filename')!]) {
      res.setHeader('content-type', 'image/png'); res.end(files[url.searchParams.get('filename')!]);
    } else { res.statusCode = 404; res.end('no'); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, picture, close: () => server.close() };
}

const scene = JSON.parse(readFileSync('scenes/classroom-talk.json', 'utf8')) as Scene;
const models: ComfyConfig['models'] = { checkpoint: 'anime-xl.safetensors', vpred: true, controlnet: { depth: 'cn-depth.safetensors', lineart: 'cn-lineart.safetensors', pose: 'cn-pose.safetensors' } };

describe('ComfyUI generator', () => {
  it('CF1 uploads the maps and masks, queues a valid graph, waits, and returns the picture', async () => {
    const srv = await fakeComfy();
    try {
      const w = realize(scene), shot = shoot(w, { n: 400, refine: 3, iters: 5, k: 1 }).shots[0], m = maps(w, shot.cam, { scale: 0.25 });
      const gen = comfyGenerator({ url: srv.url, headers: { 'x-api-key': 'k' }, models, pollEvery: 5 });
      const { image: img } = await gen.generate({ maps: m, prompt: promptOf(scene, shot), width: 1216, height: 832, seed: 7 });
      expect(srv.seen.problems).toEqual([]);
      expect(srv.seen.auth.every((a) => a === 'k')).toBe(true);
      expect(img).toEqual(decodePng(srv.picture));
      const g = srv.seen.graph!, kinds = Object.values(g).map((n) => n.class_type);
      expect(kinds.filter((k) => k === 'ControlNetApplyAdvanced')).toHaveLength(3);
      expect(kinds).toContain('ModelSamplingDiscrete');
      // a regional prompt per visible person, and the whole-picture prompt outside them all
      const people = m.regions.filter((r) => r.kind === 'person').length;
      expect(kinds.filter((k) => k === 'ConditioningSetMask')).toHaveLength(people + 1);
      expect(kinds).toContain('InvertMask');
      // the head count ("2girls") stays out of the people's regions and the background
      const texts = Object.values(g).filter((n) => n.class_type === 'CLIPTextEncode').map((n) => n.inputs.text as string);
      expect(texts.some((t) => /\b\dgirls\b|\b\dboys\b/.test(t))).toBe(false);
      const sampler = Object.values(g).find((n) => n.class_type === 'KSampler')!;
      expect(sampler.inputs.seed).toBe(7);
      const neg = Object.values(g).filter((n) => n.class_type === 'CLIPTextEncode').map((n) => n.inputs.text as string);
      expect(neg.some((t) => t.startsWith('nsfw'))).toBe(true);
    } finally { srv.close(); }
  });

  it('CF2 without configuration the generator is unavailable, and the pipeline keeps going with maps and prompts', async () => {
    const gen = comfyGenerator(null);
    await expect(gen.generate({ maps: {} as never, prompt: promptOf(scene), width: 8, height: 8 })).rejects.toBeInstanceOf(GeneratorUnavailable);
    const r = await runScene(scene, { k: 1, search: { n: 300, refine: 2, iters: 4 }, generator: gen });
    expect(r.shots[0].image).toBeNull();
    expect(r.shots[0].note).toMatch(/not configured/);
  });

  it('CF3 the graph without ControlNets or people is still complete (a plain text-to-image)', () => {
    const g = workflow({ models: { checkpoint: 'x', controlnet: {} }, prompt: { scene: ['street'], characters: [], effects: [], negative: ['nsfw'] }, width: 64, height: 64, images: {}, masks: {} });
    const kinds = Object.values(g).map((n) => n.class_type).sort();
    expect(kinds).toEqual(['CLIPTextEncode', 'CLIPTextEncode', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'KSampler', 'SaveImage', 'VAEDecode']);
  });

  it('CF5 Comfy Cloud: /api routes, outputs from /jobs/{id}, the signed download fetched without the key', async () => {
    const srv = await fakeComfy(true);
    try {
      const w = realize(scene), shot = shoot(w, { n: 300, refine: 2, iters: 4, k: 1 }).shots[0], m = maps(w, shot.cam, { scale: 0.25 });
      const cfg = comfyConfigFromEnv({ COMFY_URL: `${srv.url}/api`, COMFY_API_KEY: 'k', COMFY_CHECKPOINT: 'x.safetensors', COMFY_CN_DEPTH: 'd.safetensors' })!;
      const { image: img } = await comfyGenerator({ ...cfg, pollEvery: 5, candidates: 1, detectPose: false }).generate({ maps: m, prompt: promptOf(scene, shot), width: 1216, height: 832 });
      expect(srv.seen.problems).toEqual([]);
      expect(srv.seen.auth.every((a) => a === 'k')).toBe(true);
      expect(img).toEqual(decodePng(srv.picture));
    } finally { srv.close(); }
  });

  it('CF7 several candidates and a pose detector: the picture whose people follow the plan is kept', async () => {
    const w = realize(scene), shot = shoot(w, { n: 400, refine: 3, iters: 5, k: 1 }).shots[0], m = maps(w, shot.cam, { scale: 0.25 });
    const W = 1216, H = 832;
    // the detector's view: candidate 0 has one person, mirrored (facing the wrong way) and shifted; candidate 1 everyone as planned
    const asDetected = (flip: boolean, people: typeof m.people) => ({ canvas_width: W, canvas_height: H, people: people.map((p) => ({
      pose_keypoints_2d: p.joints.flatMap((j, n) => { const k = flip ? [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16][n] : n; const q = flip ? p.joints[k] : j; return q ? [(flip ? 1 - q[0] : q[0]) * W, q[1] * H, 1] : [0, 0, 0]; }) })) });
    const pic = (v: number) => encodePng(2, 1, new Uint8Array([v, v, v, v, v, v]), 3);
    const srv = await fakeComfy(false, {
      outputs: { save: { images: [0, 1].map((i) => ({ filename: `c${i}.png`, subfolder: '', type: 'output' })) }, pose: { openpose_json: [JSON.stringify([asDetected(true, m.people.slice(0, 1)), asDetected(false, m.people)])] } },
      files: { 'c0.png': pic(10), 'c1.png': pic(200) },
    });
    try {
      const r = await comfyGenerator({ url: srv.url, models, pollEvery: 5, candidates: 2, detectPose: true }).generate({ maps: m, prompt: promptOf(scene, shot, m.people), width: W, height: H });
      expect(srv.seen.problems).toEqual([]);
      const g = srv.seen.graph!;
      expect(Object.values(g).find((n) => n.class_type === 'EmptyLatentImage')!.inputs.batch_size).toBe(2);
      expect(g.pose.class_type).toBe('DWPreprocessor');
      expect(r.checks!.map((c) => c.score)).toEqual([0, 1]);
      expect(r.image.pixels[0]).toBe(200);
      expect(r.check!.people.every((p) => p.found && p.facing !== 'flipped')).toBe(true);
    } finally { srv.close(); }
  });

  it('CF6 an API key alone means Comfy Cloud', () => {
    const cfg = comfyConfigFromEnv({ COMFY_API_KEY: 'k', COMFY_CHECKPOINT: 'x' })!;
    expect(cfg.url).toBe(COMFY_CLOUD_URL);
    expect(cfg.headers).toEqual({ 'X-API-Key': 'k' });
    expect(comfyConfigFromEnv({ COMFY_CHECKPOINT: 'x' })).toBeNull();
    // with only a key: Comfy Cloud's installed models
    const d = comfyConfigFromEnv({ COMFY_API_KEY: 'k' })!;
    expect(d.models.checkpoint).toMatch(/illustrious/);
    expect(Object.values(d.models.controlnet).every(Boolean)).toBe(true);
    expect(cfg.models.checkpoint).toBe('x');
  });

  it('CF4 PNG round trip (the decoder reads what the encoder writes, grey and RGB)', () => {
    const rgb = new Uint8Array(5 * 3 * 3).map((_, i) => (i * 37) & 255), grey = new Uint8Array(6 * 2).map((_, i) => i * 20);
    expect(decodePng(encodePng(5, 3, rgb, 3)).pixels).toEqual(rgb);
    expect(decodePng(encodePng(6, 2, grey, 1)).pixels).toEqual(grey);
  });
});
