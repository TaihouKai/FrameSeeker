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
| `src/generate/` | 6. scene + shot + structure maps → an image renderer (the contract only: the first renderer is archived, see below) | `Generator` |

`src/pipeline.ts` wires them. Staging needs the camera's score; it gets it as an injected function, so the scene
module never imports the camera.

**Modules meet only at their `index.ts`**, so each can be reworked on its own behind it:

| Module | May use | Its `index.ts` offers |
|---|---|---|
| `shared/` | nothing | vectors, ray casting, PNG, the skeleton format (OpenPose body-18) |
| `scene/` | shared | `buildScenes`, `realize` → `World3D`; the world's types; the pose library |
| `camera/` | shared, scene | `shoot`, `rate`, `scorer` (score / sample / search on one world), `maps`, `preview`, camera geometry |
| `generate/` | shared, scene, camera | the renderer contract |
| `eval/` | shared, scene, camera | `evalRef`, `rebuild` (reference shots) |

`tests/architecture.test.ts` fails on any import that crosses a module other than through its `index.ts`, or that
points up the list.

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

Node ≥ 24 (runs TypeScript directly, no build), no runtime dependencies.

```
npm install
npm test
npm run frameseeker -- scenes/reference-truss.json   # phases 3–5 from a scene → out/run-reference-truss/
npm run frameseeker -- stories/rooftop-chase.txt     # phases 1–5 (needs VENICE_API_KEY)
npm run shot -- scenes/beam-clash.json               # camera search with every score term
```

Each shot comes out as a gray-box preview, depth, line art, OpenPose, a mask per region (each person, effect,
structure and labelled part of the set), each person's planned joints and facing (report.json), and a colour hint
when an effect is in frame.

## Generation (phase 6): archived, under review

A renderer gets the scene, the shot and its maps, and makes its own prompt (`src/generate/types.ts`): an
image-board model wants tags, another XML or sentences.

The first renderer, SDXL + ControlNet on ComfyUI (run on Comfy Cloud), is on branch
[`archive/phase6-sdxl-comfy`](../../tree/archive/phase6-sdxl-comfy) (tag `phase6-sdxl-comfy-v1`). Most of its work
went into patching known weaknesses of that stack, which newer multi-character, structure-controlled renderers may
already solve; so phase 6 is being reconsidered as a thin adapter onto one of them. What the archived renderer
learned, as requirements for whatever comes next:

- **Each thing's words only in its own region.** People, effects, structures and the labelled parts of the set each
  get their own prompt inside their own mask; the free-text description of the place never reaches a wall. With
  everyone in one prompt, hair and gender swapped between people, "melting" melted whatever the model chose, and
  "evening light through the windows" put windows on gray-box walls.
- **Which way someone faces comes from the pose, not the depth** (a featureless mannequin has the same depth front and
  back); a person seen from behind gets no expression tags.
- **The set loosely, the people firmly**: firm depth on bare stand-in walls fights the prompt (windows painted flat).
- **Thin effects need more than structure maps** (a beam is a few pixels of depth): a colour hint helped.
- **Glass**: its shape in the depth, except over a person behind it.
- **Measure, then pick**: the image model leaned to drawing girls and no prompt lever fixed it. Drawing 4 candidates
  and measuring each with existing instruments (DWPose for who is where and facing which way, a Danbooru tagger for
  each person's gender), compared with the plan by plain geometry, picked a right picture whenever there was one.

## Status

Phases 1–5 work end to end. Phase 6 ran on Comfy Cloud with the archived renderer (the pictures kept the gray box's
composition); which renderer to use next is being decided after an outside review.
