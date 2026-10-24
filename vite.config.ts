import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const server = 'http://localhost:8080';
const licenseBanner = `/*! Project code: PolyForm Noncommercial License 1.0.0
https://polyformproject.org/licenses/noncommercial/1.0.0
Required Notice: Copyright (c) 2026 Henrique Meyer / Nitrosoft Technology Inc
Third-party components retain their own license terms.
*/`;

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    assetsDir: 'static',
    rolldownOptions: {
      input: { main: resolve('src/client/index.html'), location: resolve('src/client/location.html') },
      output: { banner: licenseBanner },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/health': server, '/api': server, '/assets': server },
  },
  plugins: [{ name: 'location-path', configureServer(vite) { vite.middlewares.use((request, _response, next) => { if (request.url === '/location' || request.url?.startsWith('/location?')) request.url = request.url.replace('/location', '/location.html'); next(); }); } }],
});
