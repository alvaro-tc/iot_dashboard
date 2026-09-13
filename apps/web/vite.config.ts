import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../..', // el .env vive en la raíz del monorepo
  server: { port: 5173 },
});
