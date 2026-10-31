import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Several spec files are integration tests sharing one real Redis
    // instance and call flushdb() in beforeEach; running files in parallel
    // lets one file's flush wipe another's in-flight state.
    fileParallelism: false,
  },
});
