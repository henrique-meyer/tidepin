import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const server = 'http://localhost:8080';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    assetsDir: 'static',
    rolldownOptions: { input: { main: resolve('src/client/index.html'), location: resolve('src/client/location.html') } },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/health': server, '/api': server, '/assets': server },
  },
  plugins: [{ name: 'location-path', configureServer(vite) { vite.middlewares.use((request, _response, next) => { if (request.url === '/location' || request.url?.startsWith('/location?')) request.url = request.url.replace('/location', '/location.html'); next(); }); } }],
});
