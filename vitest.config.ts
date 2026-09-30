import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Klasör projeleri kök ayarları devralmaz; her paketin kendi ayarı kendi klasöründedir.
    projects: ['apps/*', 'packages/*', '!{apps,packages}/*.*'],
  },
});
