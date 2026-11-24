// Module — the intent of a shot (between the scene and the camera): what the shot must make the viewer understand
// (types.ts), and the devices films use to convey it (devices.ts), handed to the camera search as preferences.
// Composition (the camera module's own rules) says whether a frame is well made; the intent says what it is for.
// Reads the scene and camera modules through their index.ts; nothing below depends on this module.
export type { Convey, ConveyKind, ShotIntent } from './types.ts';
export { preferences, backLift, DEVICES, DEFAULT_WEIGHTS, label, type Device, type IntentWeights } from './devices.ts';
export { storyboard, checkIntent, read as readStoryboard, STORYBOARD_PROMPT, MAX_CONVEY, type Panel } from './storyboard.ts';
export { needs, applyIntent } from './apply.ts';
export { review, MET, type Problem } from './review.ts';
