import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { env } from 'node:process';
export default defineConfig({
  base: env.BASE_PATH || '/',
  plugins: [vue()],
  optimizeDeps: { include: ['onnxruntime-web/wasm'] },
  worker: { format: 'es' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
