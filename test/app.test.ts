import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';

describe('application contract', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
  });

  it('is healthy without a built client or upstream data', async () => {
    const app = await buildApp();
    cleanup.push(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('serves a built client and the original logo on separate static paths', async () => {
    const clientDir = await mkdtemp(join(tmpdir(), 'tidepin-client-'));
    cleanup.push(() => rm(clientDir, { recursive: true, force: true }));
    await writeFile(join(clientDir, 'index.html'), '<h1>Tidepin</h1>');
    const app = await buildApp({ clientDir, assetsDir: resolve('assets') });
    cleanup.push(() => app.close());
    expect((await app.inject('/')).body).toContain('<h1>Tidepin</h1>');
    const logo = await app.inject('/assets/brand/logo/logo.svg');
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toContain('image/svg+xml');
    expect(logo.body).toContain('aria-label="Tidepin"');
    expect((await app.inject('/missing')).statusCode).toBe(404);
  });
});

describe('runtime configuration', () => {
  it('uses port 8080 by default and accepts an explicit port', () => {
    expect(loadConfig({})).toEqual({ port: 8080 });
    expect(loadConfig({ PORT: '9090' })).toEqual({ port: 9090 });
  });

  it.each(['', '0', '-1', '65536', '8080oops', '1.5'])('rejects invalid PORT %j', (PORT) => {
    expect(() => loadConfig({ PORT })).toThrow('PORT must be an integer');
  });
});
