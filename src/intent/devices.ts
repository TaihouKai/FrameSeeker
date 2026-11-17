// Devices: the ways films convey each kind of intent, as preferences over what a camera shows (camera's View). One
// intent may be served by several devices (a gaze by an over-the-shoulder shot or a point-of-view shot); the
// preference is met when any of them is. Deterministic; each device names where it comes from.
//
// Sources: Mascelli, The Five C's of Cinematography (1965): camera angles (low angle for power, high angle for
// weakness), the close-up for reaction, point-of-view and over-the-shoulder shots; Arijon, Grammar of the Film
// Language (1976): the two-shot, the external reverse; Jhala & Young 2005 (low angle for dominance, close shot for
// an angry speaker); Cutting 2015 for shot scales (MS ≈ 2.1, LS ≈ 0.9 of the person's height over the frame's).
import type { ActorView, Preference, ThingView, View } from '../camera/index.ts';
import type { Convey, ConveyKind, ShotIntent } from './types.ts';

/** linear from 0 at a to 1 at b (either direction) */
const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export interface Device { name: string; source: string; score(v: View): number }

function devicesFor(c: Convey): Device[] {
  const actor = (v: View, id: string): ActorView | undefined => v.actors.get(id);
  const thing = (v: View, id: string): ThingView | undefined => v.things.get(id);
  const seen = (t: ThingView | undefined, k = 0.6) => (t ? ramp(t.seen, 0.2, k) : 0);
  /** a person counts as seen when their head is (the shot may be close) */
  const head = (a: ActorView | undefined) => (a?.headSeen ? 1 : 0);
  switch (c.what) {
    case 'face': return [{
      name: 'face to the camera, medium shot or closer', source: 'Mascelli: the close-up for reaction',
      score: (v) => { const a = actor(v, c.who); return a ? head(a) * ramp(a.faceAngle, 75, 30) * ramp(a.scale, 0.9, 2.1) : 0; },
    }];
    case 'sees': {
      const target = (v: View): { inFrame: number; seen: number } => {
        if (c.target === 'gaze') { const g = actor(v, c.who)?.gaze; return g ? { inFrame: +g.inFrame, seen: +g.seen } : { inFrame: 0, seen: 0 }; }
        const t = thing(v, c.target); return t ? { inFrame: t.inFrame, seen: t.seen } : { inFrame: 0, seen: 0 };
      };
      return [
        { name: 'the one who looks and what they look at, in one frame (over the shoulder, two-shot)', source: 'Mascelli: over-the-shoulder; Arijon: external reverse',
          score: (v) => { const a = actor(v, c.who), t = target(v); return a ? head(a) * ramp(t.seen, 0.1, 0.5) : 0; } },
        { name: 'point of view: the camera at their eyes, looking where they look', source: 'Mascelli: the point-of-view shot',
          score: (v) => { const a = actor(v, c.who), t = target(v); return a ? ramp(a.distance, 1.5, 0.6) * ramp(t.seen, 0.1, 0.5) : 0; } },
      ];
    }
    case 'power': return [{
      name: 'low angle: the camera below their eyes, looking up', source: 'Mascelli: camera angles; Jhala & Young 2005',
      score: (v) => { const a = actor(v, c.who); return a ? head(a) * ramp(a.above, 0.1, -0.5) * ramp(v.pitchDeg, -2, 8) : 0; },
    }];
    case 'vulnerable': return [{
      name: 'high angle: the camera above them, looking down', source: 'Mascelli: camera angles',
      score: (v) => { const a = actor(v, c.who); return a ? head(a) * ramp(a.above, 0.3, 1.2) * ramp(v.pitchDeg, -5, -20) : 0; },
    }];
    case 'alone': return [{
      name: 'nobody else in frame, the person small in it', source: 'Mascelli: composition (space around a figure)',
      score: (v) => {
        const a = actor(v, c.who); if (!a) return 0;
        const others = [...v.actors.values()].filter((o) => o.id !== c.who).reduce((m, o) => Math.max(m, o.inFrame), 0);
        return head(a) * ramp(others, 0.4, 0) * ramp(a.scale, 1.6, 0.6);
      },
    }];
    case 'together': return [{
      name: 'all of them in one frame, at sizes alike (two-shot)', source: 'Arijon: the two-shot',
      score: (v) => {
        const as = c.who.map((id) => actor(v, id) ?? thing(v, id));
        if (as.some((a) => !a)) return 0;
        const sizes = as.map((a) => Math.max(1e-3, 'scale' in a! ? (a as ActorView).scale : a!.size));
        const isSeen = (a: ThingView) => ('headSeen' in a ? head(a as ActorView) : seen(a, 0.5));
        return Math.min(...as.map((a) => isSeen(a!))) * ramp(Math.max(...sizes) / Math.min(...sizes), 3, 1.5);
      },
    }];
    case 'scale': return [{
      name: 'what is big in frame, the person a fraction of it', source: 'Mascelli: size relations; FrameSeeker scale shot',
      score: (v) => { const a = actor(v, c.who), t = thing(v, c.against); return a && t ? head(a) * ramp(t.inFrame, 0.3, 0.7) * ramp(t.size / Math.max(1e-3, Math.min(1, a.scale)), 1.5, 4) : 0; },
    }];
  }
}

/** The devices each kind of intent has (for listing). */
export const DEVICES: Record<ConveyKind, string[]> = {
  face: devicesFor({ what: 'face', who: '' }).map((d) => d.name),
  sees: devicesFor({ what: 'sees', who: '', target: '' }).map((d) => d.name),
  power: devicesFor({ what: 'power', who: '' }).map((d) => d.name),
  vulnerable: devicesFor({ what: 'vulnerable', who: '' }).map((d) => d.name),
  alone: devicesFor({ what: 'alone', who: '' }).map((d) => d.name),
  together: devicesFor({ what: 'together', who: [] }).map((d) => d.name),
  scale: devicesFor({ what: 'scale', who: '', against: '' }).map((d) => d.name),
};

/**
 * The intent as preferences for the camera search: one per thing to convey, met by its best device, each weighted
 * as much as the whole composition score (the first, most important, a half more).
 */
export function preferences(intent: ShotIntent): Preference[] {
  return intent.convey.map((c, i) => {
    const ds = devicesFor(c);
    return { name: label(c), weight: i === 0 ? 1.5 : 1, score: (v: View) => Math.max(...ds.map((d) => d.score(v))) };
  });
}

export function label(c: Convey): string {
  switch (c.what) {
    case 'sees': return `${c.who} sees ${c.target}`;
    case 'power': return c.over ? `${c.who} over ${c.over}` : `${c.who} holds power`;
    case 'together': return `${c.who.join(' + ')} together`;
    case 'scale': return `${c.who} against ${c.against}`;
    default: return `${c.what}: ${c.who}`;
  }
}
