import { globSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Proje listesi package.json taşıyan klasörlerden çıkarılır; başıboş dosyalar listeye girmez.
    // Klasör projeleri kök ayarları devralmaz; her paketin kendi ayarı kendi klasöründedir.
    projects: globSync('{apps,packages}/*/package.json').map((yol) => dirname(yol)),
  },
});
