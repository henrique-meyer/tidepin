import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({
  clientDir: resolve('dist/client'),
  assetsDir: resolve('assets'),
  logger: true,
  config,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
