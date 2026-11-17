// The text half of a generation request, built deterministically from the scene JSON (what is there, written by the
// extract step from the story) and the shot (how it is seen, measured by the camera module). The structure maps carry
// the composition; the prompt only names things. SFW always: `nsfw` is always negative.
import type { Scene } from '../scene/index.ts';
import type { Shot } from '../camera/index.ts';

export interface CharacterPrompt { id: string; tags: string[] }
export interface Prompt {
  /** the whole picture: head count, setting, time, structures, and how it is shot */
  scene: string[];
  /** one entry per person, focus first (multi-character backends such as NovelAI V4 take these separately) */
  characters: CharacterPrompt[];
  /** one entry per effect (beam, explosion, damage): drawn where its region is, not anywhere in the picture */
  effects: CharacterPrompt[];
  negative: string[];
}

export const NEGATIVE = ['nsfw', 'lowres', 'bad anatomy', 'extra limbs', 'text', 'watermark'];

/** How the shot looks, in image-board vocabulary, from the camera's measurements. */
export function shotTags(shot: Shot): string[] {
  const t: string[] = [];
  const pitch = shot.info.pitch_deg ?? 0, size = shot.info.subject_size ?? 1;
  if (pitch < -25) t.push('from above'); else if (pitch > 12) t.push('from below');
  // subject_size: person height / frame height (Cutting's scales)
  if (size < 0.6) t.push('wide shot', 'scenery'); else if (size < 1.1) t.push('full body'); else if (size < 1.7) t.push('cowboy shot');
  else if (size < 3) t.push('upper body'); else t.push('portrait');
  // how each person is seen (front, profile, back) is their own: viewTags, in their tags
  if (Math.abs(shot.cam.roll) > 0.1) t.push('dutch angle');
  return t;
}

/**
 * The picture's head count in image-board form ("2girls", "1girl, 1boy", "6+boys"), from each person's own "1girl" /
 * "1boy" / "1other" tag; none when someone's is unknown (a wrong count is worse than none).
 */
export function countTags(people: string[][]): string[] {
  const kinds = people.map((t) => t.find((x) => /^1(girl|boy|other)$/.test(x))?.slice(1));
  if (!kinds.length || kinds.some((k) => !k)) return [];
  const n = (k: string) => kinds.filter((x) => x === k).length;
  return (['girl', 'boy', 'other'] as const).filter((k) => n(k)).map((k) => n(k) === 1 ? `1${k}` : n(k) >= 6 ? `6+${k}s` : `${n(k)}${k}s`);
}

/** How one person is seen, from the angle between where they face and the camera. */
export function viewTags(faceAngle: number | undefined): string[] {
  if (faceAngle === undefined) return [];
  // the gray box looks the same from the front and the back (depth cannot tell), so the front is said too
  return faceAngle > 120 ? ['from behind', 'facing away'] : faceAngle > 60 ? ['profile'] : faceAngle < 45 ? ['facing viewer'] : [];
}

/** people: the shot's planned people (camera maps), for how each person is seen */
export function promptOf(scene: Scene, shot?: Shot, people?: { id: string; faceAngle: number }[]): Prompt {
  const tags = (xs: (string | undefined)[] | undefined) => (xs ?? []).map((x) => x?.trim()).filter((x): x is string => !!x);
  const focusFirst = [...scene.actors].sort((a, b) => Number(b.id === scene.moment.focus) - Number(a.id === scene.moment.focus));
  const characters = focusFirst.map((a) => {
    const angle = people?.find((r) => r.id === a.id)?.faceAngle;
    // a face that cannot be seen has no expression to draw (the tag makes the model turn the head)
    const back = angle !== undefined && angle > 120;
    return {
      id: a.id,
      // image-board models lean to drawing girls; "male focus" is the board's tag for a male subject, and in a
      // person's own region it says this one is the man (with "1boy" alone the boy came out a girl 3 times in 4)
      tags: tags([a.prompt.tag, a.prompt.series, ...a.prompt.look, ...(a.prompt.look.includes('1boy') ? ['male focus'] : []), ...a.prompt.outfit, ...(back ? [] : a.prompt.expression), ...viewTags(angle)]),
    };
  });
  const sceneTags = [
    ...countTags(characters.map((c) => c.tags)),
    ...tags([scene.place.description, scene.time.of_day, scene.time.weather]),
    ...scene.structures.flatMap((s) => tags(s.prompt)),
    ...(shot ? shotTags(shot) : []),
  ];
  // effects by themselves: in the whole-picture prompt "melting" melted whatever the model chose and the beam was lost
  const effects = scene.effects.map((e) => ({ id: e.id, tags: tags(e.prompt) })).filter((e) => e.tags.length);
  return { scene: [...new Set(sceneTags)], characters, effects, negative: NEGATIVE };
}
