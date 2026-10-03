import { globSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The project list is derived from folders that hold a package.json; stray files stay out.
    // Folder projects do not inherit the root settings; each package keeps its own config.
    projects: globSync('{apps,packages}/*/package.json').map((path) => dirname(path)),
  },
});
