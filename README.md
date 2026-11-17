# FrameSeeker

From a moment in a story to a cinematic shot: an LLM writes the moment as a scene (who stands where, what hits
what), code builds a gray-box 3D stage of it, a camera search scores thousands of viewpoints with **deterministic
composition rules** from the film and photography literature (no AI judge), and the best shots are rendered as
structure maps (depth, line art, pose) to steer an image model through ControlNet.

Why: image models draw well but cannot be told *where the camera is*. A striking frame is mostly composition:
camera height, angle, lens, what frames the subject. That part is geometry, so it is solved as geometry.

## Pipeline

| Module | Phases | Entry (`index.ts`) |
|---|---|---|
| `src/scene/` | 1. text → scene JSON (LLM, faithful to the text) · 2. staging: the LLM may only *add* set pieces, and each one is kept only if the camera score rises · 3. scene JSON → 3D world (relation solver + set dressing) | `buildScenes`, `realize` |
| `src/camera/` | 4. camera search scored by composition rules · 5. 2D structure maps of each shot | `shoot`, `maps`, `rate` |
| `src/generate/` | 6. structure maps + prompt → image backend: a ComfyUI client (SDXL, ControlNet depth / line art / pose, a regional prompt per person); NovelAI is a stub | `promptOf`, `Generator`, `workflow` |

`src/pipeline.ts` wires them. Each module talks to the next only through its `index.ts`, so any one can be swapped.
Staging needs the camera's score; it gets it as an injected function, so the scene module never imports the camera.

## The scorer

Hard constraints (the subject and the payoff visible, the action line not running into the lens, …), then terms in
[0, 1] combined by a weighted geometric mean, each from a published rule or measured data:

- picture-plane composition: rule of thirds for subjects and lines, diagonal dominance, visual balance, region size
  (Liu, Chen, Wolf, Cohen-Or 2010, with the paper's constants);
- shot scale: the frequencies of film shot scales (Cutting 2015, 13 956 frames from 48 films); action shots blend
  these with reference action shots;
- face angle: how often reference shots show the front, three-quarter and back, over a uniform camera;
- camera tilt, the same way: near top-down shots (over 45° down) are 2 of 88 reference shots against 13% of random
  cameras; other tilts are as common as chance, or too rare among random cameras to judge;
- framing, lead room, foreshortening of the action line, joint cuts on the subject, occlusion of the subject by
  nearer people (Bares et al. 2000), mergers.

## Does it agree with directors?

Frames are sampled every 10 s from anime episodes and filtered by fixed rules (no cherry-picking); 15 per episode
are annotated by hand (horizon, people's crowns and feet) and rebuilt as gray-box scenes with the camera that shot
them, by single-view metrology. The measure: where the director's camera ranks among random valid cameras.

Held-out episodes (the scorer frozen before each one, each run once):

| Episode | Studio | Director's shot in the top 5% |
|---|---|---|
| Oregairu S1 ep 12 | Brain's Base | 8 / 15 |
| Log Horizon ep 4 | Satelight | 5 / 14 (action shots wider than expected; fixed after) |
| Mahouka ep 22 | Madhouse | 12 / 15 |
| GATE ep 6 | A-1 Pictures | 11 / 15 |

Known weak spots: backs and wide establishing shots; the shot scale of action scenes (two episodes disagree).
The frames and the annotations stay local; the evaluation code is in `src/eval/`.

## Run

Node ≥ 24 (runs TypeScript directly, no build); one optional dependency (onnxruntime-node, for the gender check).

```
npm install
npm test
npm run frameseeker -- scenes/reference-truss.json   # phases 3–6 from a scene → out/run-reference-truss/
npm run frameseeker -- stories/rooftop-chase.txt     # phases 1–6 (needs VENICE_API_KEY)
npm run shot -- scenes/beam-clash.json               # camera search with every score term
```

Each shot comes out as a gray-box preview, depth, line art, pose, region masks and a prompt.

## Generation (phase 6)

`--generator comfy` sends each shot to a ComfyUI server through its standard HTTP API (upload, queue, poll, download),
so it works with a local ComfyUI, RunPod, or a hosted service that keeps the API. The workflow uses core nodes only:
an SDXL checkpoint (optionally v-prediction), ControlNets for depth, line art and pose (strengths and step ranges in
`src/generate/workflow.ts`), and each person's tags inside their mask. Configuration by environment:

```
COMFY_URL=http://127.0.0.1:8188   COMFY_CHECKPOINT=<sdxl>.safetensors   [COMFY_VPRED=1]
COMFY_CN_DEPTH=<...>   COMFY_CN_LINEART=<...>   COMFY_CN_POSE=<...>   [COMFY_HEADERS='{"Authorization":"Bearer ..."}']
```

For [Comfy Cloud](https://cloud.comfy.org) (a paid plan includes API access), an API key from platform.comfy.org as
`COMFY_API_KEY` or in `~/.secrets/comfy.key` is enough: the client talks to `https://cloud.comfy.org/api` and uses
models Cloud has installed (WAI-Illustrious SDXL; the SDXL depth, OpenPose and scribble ControlNets), each overridable.

What the first runs on it taught (details in `src/generate/`):

- **Regional prompts, strictly.** Each person's and each effect's tags go only inside their own mask, the setting
  only outside them all. With everyone in one prompt, hair and gender swapped between people, and "melting" melted
  whatever the model chose.
- **Depth under pose.** A featureless mannequin has the same depth from the front and the back, so which way someone
  faces must come from the pose (and the tag `facing viewer` / `from behind`); depth 0.8 under pose 1.0.
- **Check, then keep the best.** Each shot is drawn 4 times (one batch); a pose detector (DWPose, an instrument:
  coordinates out) finds the people in each picture, and plain geometry (`src/generate/check.ts`) compares them
  with the planned skeletons: everyone found, near their place, facing the right way (the shoulders' left-right
  order). On 12 hand-judged pictures it passed no wrong one; it misses some right ones (a back at the frame's edge).
  Each person's gender is measured too, by an image-board tagger (SmilingWolf's WD SwinV2 v3, on the CPU) on that
  person's own pixels: `1boy` against `1girl`, the same vocabulary the prompts use. Optional: `npm run get-tagger`
  (470 MB) and the optional dependency onnxruntime-node; without them the gender is not checked.
- **The set says what it is.** Indoors, the gray box's parts carry labels (wall, ceiling, floor, desk,
  blackboard; past the walls: a window), and each gets its own words in its own region, not the scene's free-text
  description. With "evening light through the windows" over a gray-box wall, the model either painted windows flat
  on the wall (depth firm) or knocked the wall out for glass (depth loose). A `classroom` place has a blackboard and
  rows of desks.
- **Effects need a colour hint.** A beam is a few pixels in depth and line art; a shot with an effect in frame starts
  from a colour hint (the gray box with the sky of the scene's time of day, people grey) at denoise 0.9.

Without a server the pipeline still writes the maps and prompts and notes that nothing was generated.

## Status

Phases 1–6 run end to end on Comfy Cloud. The generated pictures keep the gray box's composition (camera height,
angle, lens, who is where). One picture alone gets every person right about 3 times in 4 in the hardest test so far
(a back-view person in the foreground); with 4 candidates and the pose check, both classroom shots came out right.
The check cannot see effects.
