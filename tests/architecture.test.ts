import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// The modules and what each may use. A module is used only through its index.ts (shared: any of its files, a
// library of independent pieces). Each module can then be reworked on its own behind its index.ts.
//   shared   — vectors, geometry, images, the skeleton format
//   scene    — phases 1–3: text → scene JSON → 3D world
//   camera   — phases 4–5: camera search and scoring, structure maps
//   generate — phase 6: structure maps → picture
//   eval     — the scorer against reference shots from films
//   (root)   — pipeline.ts wires scene → camera → generate;  cli — the commands
const MAY_USE: Record<string, string[]> = {
  shared: [],
  scene: ['shared'],
  camera: ['shared', 'scene'],
  generate: ['shared', 'scene', 'camera'],
  eval: ['shared', 'scene', 'camera'],
  root: ['shared', 'scene', 'camera', 'generate'],
  cli: ['shared', 'scene', 'camera', 'generate', 'eval', 'root'],
};

const SRC = resolve('src');
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
const moduleOf = (file: string) => { const parts = relative(SRC, file).split(/[\\/]/); return parts.length === 1 ? 'root' : parts[0]; };

/** every relative import (and re-export) of a file, resolved */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/g)].map((m) => resolve(dirname(file), m[1]));
}

describe('architecture: modules meet only at their index.ts', () => {
  const all = files(SRC);

  it('AR1 every module is known', () => {
    expect([...new Set(all.map(moduleOf))].filter((m) => !MAY_USE[m])).toEqual([]);
  });

  it('AR2 a module uses only the modules below it, and only through their index.ts', () => {
    const bad: string[] = [];
    for (const f of all) {
      const from = moduleOf(f);
      for (const target of importsOf(f)) {
        const to = moduleOf(target);
        if (to === from) continue;
        const where = `${relative(SRC, f)} → ${relative(SRC, target)}`;
        if (!MAY_USE[from].includes(to)) bad.push(`${where} (${from} may not use ${to})`);
        else if (to !== 'shared' && to !== 'root' && relative(SRC, target).split(/[\\/]/).slice(1).join('/') !== 'index.ts') bad.push(`${where} (not through ${to}/index.ts)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('AR3 the shared library depends on nothing else', () => {
    for (const f of all.filter((f) => moduleOf(f) === 'shared')) for (const t of importsOf(f)) expect(moduleOf(t)).toBe('shared');
  });
});
