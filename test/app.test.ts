import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    await writeFile(join(clientDir, 'location.html'), '<h1>Location</h1>');
    const app = await buildApp({ clientDir, assetsDir: resolve('assets') });
    cleanup.push(() => app.close());
    expect((await app.inject('/')).body).toContain('<h1>Tidepin</h1>');
    expect((await app.inject('/location')).body).toContain('<h1>Location</h1>');
    const logo = await app.inject('/assets/brand/logo/logo.svg');
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toContain('image/svg+xml');
    expect(logo.body).toContain('aria-label="Tidepin"');
    expect((await app.inject('/missing')).statusCode).toBe(404);
  });

  it('serves the ICO fallback without a client build, with a long public cache and HEAD support', async () => {
    const app = await buildApp({ assetsDir: resolve('assets') });
    cleanup.push(() => app.close());
    const response = await app.inject('/favicon.ico');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/vnd.microsoft.icon');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000');
    expect(response.rawPayload).toEqual(await readFile('assets/brand/icons/favicon.ico'));
    const head = await app.inject({ method: 'HEAD', url: '/favicon.ico' });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-type']).toBe(response.headers['content-type']);
    expect(head.headers['content-length']).toBe(String(response.rawPayload.length));
    expect(head.body).toBe('');
  });

  it('publishes transparent PNG icons, an opaque touch icon and a local manifest through the asset route', async () => {
    const app = await buildApp({ assetsDir: resolve('assets') });
    cleanup.push(() => app.close());
    for (const [name, size, colorType] of [['favicon-32.png', 32, 6], ['icon-192.png', 192, 6], ['icon-512.png', 512, 6], ['apple-touch-icon.png', 180, 2]] as const) {
      const response = await app.inject(`/assets/brand/icons/${name}`);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(response.rawPayload.readUInt32BE(16)).toBe(size);
      expect(response.rawPayload.readUInt32BE(20)).toBe(size);
      expect(response.rawPayload[25]).toBe(colorType);
    }
    const response = await app.inject('/assets/site.webmanifest');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/manifest+json');
    const manifest = response.json();
    expect(manifest.background_color).toBe('#fbf7ee');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) expect((await app.inject(icon.src)).statusCode).toBe(200);
  });

  it('includes complete 16/32/48 alpha ICO frames with valid DIB offsets and masks', async () => {
    const bytes = await readFile('assets/brand/icons/favicon.ico');
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    expect(bytes.readUInt16LE(4)).toBe(3);
    let previousEnd = 6 + 3 * 16;
    for (const [index, size] of [16, 32, 48].entries()) {
      const entry = 6 + index * 16;
      const length = bytes.readUInt32LE(entry + 8);
      const offset = bytes.readUInt32LE(entry + 12);
      expect(bytes[entry]).toBe(size);
      expect(bytes[entry + 1]).toBe(size);
      expect(bytes.readUInt16LE(entry + 6)).toBe(32);
      expect(offset).toBe(previousEnd);
      expect(bytes.readUInt32LE(offset)).toBe(40);
      expect(bytes.readInt32LE(offset + 4)).toBe(size);
      expect(bytes.readInt32LE(offset + 8)).toBe(size * 2);
      expect(bytes.readUInt16LE(offset + 14)).toBe(32);
      expect(length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
      const alpha = Array.from({ length: size * size }, (_, pixel) => bytes[offset + 40 + pixel * 4 + 3]!);
      expect(alpha.some(value => value === 0)).toBe(true);
      expect(alpha.some(value => value === 255)).toBe(true);
      previousEnd = offset + length;
    }
    expect(previousEnd).toBe(bytes.length);
  });
});

describe('runtime configuration', () => {
  it('uses port 8080 by default and accepts an explicit port', () => {
    expect(loadConfig({})).toEqual({ port: 8080, googleMapsApiKey: '', googleMapsMapId: 'DEMO_MAP_ID', sessionLimitMinutes: 120 });
    expect(loadConfig({ PORT: '9090' }).port).toBe(9090);
  });

  it.each(['', '0', '-1', '65536', '8080oops', '1.5'])('rejects invalid PORT %j', (PORT) => {
    expect(() => loadConfig({ PORT })).toThrow('PORT must be an integer');
  });
  it.each(['', '0', '-1', '121', '1.5', 'NaN'])('rejects invalid session limits %j', (SESSION_LIMIT_MINUTES) => {
    expect(() => loadConfig({ SESSION_LIMIT_MINUTES })).toThrow('SESSION_LIMIT_MINUTES');
  });
  it.each(['1', '120'])('accepts the bounded session endpoint %s', (SESSION_LIMIT_MINUTES) => {
    expect(loadConfig({ SESSION_LIMIT_MINUTES }).sessionLimitMinutes).toBe(Number(SESSION_LIMIT_MINUTES));
  });
});
