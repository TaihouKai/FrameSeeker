// The project's tunable settings (frameseeker.config.json at the working directory, optional): weights that are
// first choices rather than measurements, kept out of the code so they can be tuned as testing shows.
import { existsSync, readFileSync } from 'node:fs';
import type { IntentWeights } from '../intent/index.ts';

export interface Config { intent?: Partial<IntentWeights> }

export function loadConfig(file = 'frameseeker.config.json'): Config {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Config : {};
}
