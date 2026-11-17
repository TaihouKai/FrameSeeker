// The text half of a generation request, built deterministically from the scene JSON (what is there, written by the
// extract step from the story) and the shot (how it is seen, measured by the camera module). The structure maps carry
// the composition; the prompt only names things. SFW always: `nsfw` is always negative (DESIGN.md §9).
import type { Scene } from '../scene/index.ts';
import type { Shot } from '../camera/index.ts';

export interface CharacterPrompt { id: string; tags: string[] }
export interface Prompt {
  /** the whole picture: setting, time, effects, and how it is shot */
  scene: string[];
  /** one entry per person, focus first (multi-character backends such as NovelAI V4 take these separately) */
  characters: CharacterPrompt[];
  negative: string[];
}

export const NEGATIVE = ['nsfw', 'lowres', 'bad anatomy', 'extra limbs', 'text', 'watermark'];

/** How the shot looks, in image-board vocabulary, from the camera's measurements. */
export function shotTags(shot: Shot): string[] {
  const t: string[] = [];
  const pitch = shot.info.pitch_deg ?? 0, size = shot.info.subject_size ?? 1, face = shot.info.face_angle ?? 0;
  if (pitch < -25) t.push('from above'); else if (pitch > 12) t.push('from below');
  // subject_size: person height / frame height (DESIGN.md §6.6.3, Cutting's scales)
  if (size < 0.6) t.push('wide shot', 'scenery'); else if (size < 1.1) t.push('full body'); else if (size < 1.7) t.push('cowboy shot');
  else if (size < 3) t.push('upper body'); else t.push('portrait');
  if (face > 120) t.push('from behind'); else if (face > 60) t.push('from side');
  if (Math.abs(shot.cam.roll) > 0.1) t.push('dutch angle');
  return t;
}

export function promptOf(scene: Scene, shot?: Shot): Prompt {
  const tags = (xs: (string | undefined)[] | undefined) => (xs ?? []).map((x) => x?.trim()).filter((x): x is string => !!x);
  const focusFirst = [...scene.actors].sort((a, b) => Number(b.id === scene.moment.focus) - Number(a.id === scene.moment.focus));
  const characters = focusFirst.map((a) => ({
    id: a.id,
    tags: tags([a.prompt.tag, a.prompt.series, ...a.prompt.look, ...a.prompt.outfit, ...a.prompt.expression]),
  }));
  const sceneTags = [
    ...tags([scene.place.description, scene.time.of_day, scene.time.weather]),
    ...scene.structures.flatMap((s) => tags(s.prompt)),
    ...scene.effects.flatMap((e) => tags(e.prompt)),
    ...(shot ? shotTags(shot) : []),
  ];
  return { scene: [...new Set(sceneTags)], characters, negative: NEGATIVE };
}
