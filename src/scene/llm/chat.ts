// A minimal OpenAI-compatible chat client (the caller chooses the provider). Tests use Venice with the key file.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_FILE = join(homedir(), '.secrets', 'venice.key');

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export type Chat = (messages: ChatMsg[], opts?: { maxTokens?: number; temperature?: number }) => Promise<string>;

export function openAiChat(cfg: { baseUrl: string; apiKey: string; model: string; extra?: Record<string, unknown> }): Chat & { spent: () => number } {
  let usd = 0;
  const chat = async (messages: ChatMsg[], opts: { maxTokens?: number; temperature?: number } = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: opts.maxTokens ?? 6000, temperature: opts.temperature ?? 0.4, ...cfg.extra }),
      });
      const j = await r.json().catch(() => ({})) as { choices?: { message?: { content?: string } }[]; cost?: { usd?: number } };
      if (!r.ok) { if (attempt === 2) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); continue; }
      usd += Number(j.cost?.usd ?? 0);
      return String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }
    throw new Error('unreachable');
  };
  return Object.assign(chat, { spent: () => usd });
}

/** Venice: the key from VENICE_API_KEY, else the local test key file (testing only). */
export function veniceChat(model = 'deepseek-v4-1-flash') {
  return openAiChat({
    baseUrl: 'https://api.venice.ai/api/v1', apiKey: process.env.VENICE_API_KEY ?? readFileSync(KEY_FILE, 'utf8').trim(), model,
    extra: { venice_parameters: { include_venice_system_prompt: false, enable_web_search: 'off' } },
  });
}

/** The first JSON object in a model's answer (code fences and prose around it allowed). */
export function jsonOf(text: string): unknown {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('no JSON object in the answer');
  return JSON.parse(text.slice(s, e + 1));
}
