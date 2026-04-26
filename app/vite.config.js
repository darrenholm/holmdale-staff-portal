import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/manage/',
  build: {
    outDir: path.resolve(__dirname, '../public/manage'),
    emptyOutDir: true,
  },
});
