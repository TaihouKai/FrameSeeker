# FrameSeeker

From a moment in a story to a cinematic shot: an LLM writes the moment as a scene (who stands where, what hits
what), code builds a gray-box 3D stage of it, a camera search scores thousands of viewpoints with **deterministic
composition rules** from the film and photography literature (no AI judge), and the best shots are rendered as
structure maps (depth, later line art and pose) to steer an image model through ControlNet.

The idea: image models draw well but cannot be told *where the camera is*. A striking frame is mostly composition:
camera height, angle, lens, what frames the subject. That part is geometry, so it is solved as geometry.

## Pipeline

| Module | Phases | Entry |
|---|---|---|
| `src/scene/` | 1. text → scene JSON (LLM, faithful) · 2. staging (LLM may only add set pieces; each kept only if the camera score rises) · 3. scene JSON → 3D world (solver + set dressing) | `buildScenes`, `realize` |
| `src/camera/` | 4. camera search scored by composition rules · 5. 2D structure maps of each shot | `shoot`, `maps`, `rate` |
| `src/generate/` | 6. structure maps + prompt → image backend (ComfyUI / NovelAI: **stubs for now**) | `promptOf`, `Generator` |

`src/pipeline.ts` wires them; each module talks to the next only through its `index.ts`, so any one can be replaced.

## Is the scorer any good?

Measured against real directors: frames sampled at fixed intervals from anime episodes (no cherry-picking) are
rebuilt as gray-box scenes by single-view metrology, and the director's camera is ranked among random valid cameras.
On four held-out episodes from four studios, with the scorer frozen before each run, 36–80% of the directors' shots
rank in the top 5%. The latest version scored 80% and 73% on the two episodes tested after it was frozen. Method,
numbers and known weaknesses are in [DESIGN.md](DESIGN.md) §6.6 (in Chinese). The frames themselves are not in
the repository, only the hand annotations (`eval/refs/`).

## Run

Node ≥ 24 (runs TypeScript directly, no build), no runtime dependencies.

```
npm install
npm test
npm run frameseeker -- scenes/reference-truss.json   # phases 3–6 from a scene → out/run-reference-truss/
npm run frameseeker -- stories/clash.txt             # phases 1–6 (needs VENICE_API_KEY)
npm run shot -- scenes/clash.json                    # camera search with every score term
npm run eval                                         # the reference-shot evaluation (needs the frames in refs/)
```

## Status

Phases 1–5 work end to end (gray-box preview and depth map). Next: line art / pose / mask maps (M2), then a ComfyUI
ControlNet workflow (M3). See DESIGN.md §11.
