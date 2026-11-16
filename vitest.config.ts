import { defineConfig } from 'vitest/config';

// the composition searches take seconds each
export default defineConfig({ test: { testTimeout: 180000 } });
