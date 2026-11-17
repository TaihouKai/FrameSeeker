// Module 4 — evaluation of the camera scorer against reference shots from films (Evaluation A): a reference frame,
// hand-annotated (horizon, people's crowns and feet), is rebuilt as a gray-box scene with the camera that shot it
// (single-view metrology); then where does that camera rank among the search's random cameras, and does the search
// find it? Reads the scene and camera modules through their index.ts only.
export { evalRef, NEAR_ANGLE, NEAR_RATIO, type RefResult } from './eval.ts';
export { rebuild, REF_W, REF_H, MIN_CAMERA_HEIGHT, type RefFrame, type RefPerson } from './refs.ts';
