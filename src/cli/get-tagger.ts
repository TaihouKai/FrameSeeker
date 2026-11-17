// npm run get-tagger — downloads the image-board tagger used to check each person's gender (src/generate/tagger.ts)
// from HuggingFace into ~/.cache/frameseeker/wd-swinv2-tagger-v3 (or FRAMESEEKER_TAGGER). About 470 MB.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAGGER_REPO, taggerDir } from '../generate/tagger.ts';

const dir = taggerDir();
mkdirSync(dir, { recursive: true });
for (const f of ['selected_tags.csv', 'model.onnx']) {
  const to = join(dir, f);
  if (existsSync(to)) { console.log(`${to}: already there`); continue; }
  const r = await fetch(`https://huggingface.co/${TAGGER_REPO}/resolve/main/${f}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  writeFileSync(to, new Uint8Array(await r.arrayBuffer()));
  console.log(`${to}: done`);
}
