import { defineConfig } from 'vite';

const server = 'http://localhost:8080';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    assetsDir: 'static',
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/health': server, '/api': server, '/assets': server },
  },
});
