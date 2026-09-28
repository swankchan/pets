import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // Optional fallback for the local LLM: the page can call /llm/v1/... and the
    // dev server forwards it to llama-server, side-stepping any CORS issue.
    proxy: {
      '/llm': {
        target: process.env.LLAMA_URL || 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/llm/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
