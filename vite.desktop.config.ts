import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

const workspace = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(workspace, 'desktop-web'),
  publicDir: path.join(workspace, 'public'),
  base: '/',
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { '@': workspace } },
  build: {
    outDir: path.join(workspace, 'desktop', 'WulframForge', 'wwwroot'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
