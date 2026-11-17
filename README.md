# FrameSeeker

From a moment in a story to a cinematic shot: an LLM writes the moment as a scene (who stands where, what hits
what), code builds a gray-box 3D stage of it, a camera search scores thousands of viewpoints with **deterministic
composition rules** from the film and photography literature (no AI judge), and the best shots are rendered as
structure maps (depth, later line art and pose) to steer an image model through ControlNet.

Why: image models draw well but cannot be told *where the camera is*. A striking frame is mostly composition:
camera height, angle, lens, what frames the subject. That part is geometry, so it is solved as geometry.

## Pipeline

| Module | Phases | Entry (`index.ts`) |
|---|---|---|
| `src/scene/` | 1. text → scene JSON (LLM, faithful to the text) · 2. staging: the LLM may only *add* set pieces, and each one is kept only if the camera score rises · 3. scene JSON → 3D world (relation solver + set dressing) | `buildScenes`, `realize` |
| `src/camera/` | 4. camera search scored by composition rules · 5. 2D structure maps of each shot | `shoot`, `maps`, `rate` |
| `src/generate/` | 6. structure maps + prompt → image backend (ComfyUI / NovelAI: **stubs for now**) | `promptOf`, `Generator` |

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

Node ≥ 24 (runs TypeScript directly, no build), no runtime dependencies.

```
npm install
npm test
npm run frameseeker -- scenes/reference-truss.json   # phases 3–6 from a scene → out/run-reference-truss/
npm run frameseeker -- stories/rooftop-chase.txt     # phases 1–6 (needs VENICE_API_KEY)
npm run shot -- scenes/beam-clash.json               # camera search with every score term
```

Each shot comes out as a gray-box preview, a depth map and a prompt.

## Status

Phases 1–5 work end to end. Next: line art, pose and region masks; then a ComfyUI ControlNet workflow for phase 6.
