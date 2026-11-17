import { describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { comfyGenerator, GeneratorUnavailable, promptOf, workflow, type ComfyConfig } from '../src/generate/index.ts';
import { realize, type Scene } from '../src/scene/index.ts';
import { maps, shoot } from '../src/camera/index.ts';
import { decodePng, encodePng } from '../src/shared/png.ts';
import { runScene } from '../src/pipeline.ts';

// the ComfyUI core nodes the workflow may use, with their required inputs
const NODES: Record<string, string[]> = {
  CheckpointLoaderSimple: ['ckpt_name'], ModelSamplingDiscrete: ['model', 'sampling', 'zsnr'], CLIPTextEncode: ['clip', 'text'],
  LoadImage: ['image'], LoadImageMask: ['image', 'channel'], ConditioningSetMask: ['conditioning', 'mask', 'strength', 'set_cond_area'],
  ConditioningCombine: ['conditioning_1', 'conditioning_2'], ControlNetLoader: ['control_net_name'],
  ControlNetApplyAdvanced: ['positive', 'negative', 'control_net', 'image', 'strength', 'start_percent', 'end_percent'],
  EmptyLatentImage: ['width', 'height', 'batch_size'], KSampler: ['model', 'positive', 'negative', 'latent_image', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  VAEDecode: ['samples', 'vae'], SaveImage: ['images', 'filename_prefix'],
};
// outputs per node class (to check link indices)
const OUTPUTS: Record<string, number> = { CheckpointLoaderSimple: 3, ControlNetApplyAdvanced: 2 };

const body = (req: IncomingMessage) => new Promise<Buffer>((res) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });

/** A fake ComfyUI: checks uploads and the graph, "renders" a 4x2 picture after two polls. */
async function fakeComfy() {
  const uploaded = new Set<string>();
  const seen: { graph?: Record<string, { class_type: string; inputs: Record<string, unknown> }>; problems: string[]; auth: string[] } = { problems: [], auth: [] };
  let polls = 0;
  const picture = encodePng(4, 2, new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 3);
  const server = createServer(async (req, res) => {
    seen.auth.push(String(req.headers['x-api-key']));
    const url = new URL(req.url!, 'http://x');
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
      res.end(JSON.stringify(polls < 2 ? {} : { p1: { status: { status_str: 'success' }, outputs: { save: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }));
    } else if (url.pathname === '/view' && url.searchParams.get('filename') === 'out.png') {
      res.setHeader('content-type', 'image/png'); res.end(picture);
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
      const img = await gen.generate({ maps: m, prompt: promptOf(scene, shot), width: 1216, height: 832, seed: 7 });
      expect(srv.seen.problems).toEqual([]);
      expect(srv.seen.auth.every((a) => a === 'k')).toBe(true);
      expect(img).toEqual(decodePng(srv.picture));
      const g = srv.seen.graph!, kinds = Object.values(g).map((n) => n.class_type);
      expect(kinds.filter((k) => k === 'ControlNetApplyAdvanced')).toHaveLength(3);
      expect(kinds).toContain('ModelSamplingDiscrete');
      // a regional prompt per visible person
      expect(kinds.filter((k) => k === 'ConditioningSetMask')).toHaveLength(m.regions.filter((r) => r.kind === 'person').length);
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
    const g = workflow({ models: { checkpoint: 'x', controlnet: {} }, prompt: { scene: ['street'], characters: [], negative: ['nsfw'] }, width: 64, height: 64, images: {}, masks: {} });
    const kinds = Object.values(g).map((n) => n.class_type).sort();
    expect(kinds).toEqual(['CLIPTextEncode', 'CLIPTextEncode', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'KSampler', 'SaveImage', 'VAEDecode']);
  });

  it('CF4 PNG round trip (the decoder reads what the encoder writes, grey and RGB)', () => {
    const rgb = new Uint8Array(5 * 3 * 3).map((_, i) => (i * 37) & 255), grey = new Uint8Array(6 * 2).map((_, i) => i * 20);
    expect(decodePng(encodePng(5, 3, rgb, 3)).pixels).toEqual(rgb);
    expect(decodePng(encodePng(6, 2, grey, 1)).pixels).toEqual(grey);
  });
});
