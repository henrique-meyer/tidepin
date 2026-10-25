import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { SOCIAL_DESCRIPTION, SOCIAL_IMAGE_ALT, SOCIAL_IMAGE_PATH } from '../src/server/metadata.js';

describe('server-rendered sharing metadata', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
  });

  it('serves complete sharing tags on every document alias without JavaScript, cookies or a trusted Host', async () => {
    const clientDir = await mkdtemp(join(tmpdir(), 'tidepin-metadata-'));
    cleanup.push(() => rm(clientDir, { recursive: true, force: true }));
    for (const file of ['index.html', 'location.html']) {
      await writeFile(join(clientDir, file), await readFile(resolve('src/client', file)));
    }
    const origin = 'https://your-domain.example';
    const app = await buildApp({ clientDir, config: loadConfig({ PUBLIC_BASE_URL: origin }) });
    cleanup.push(() => app.close());
    for (const url of ['/', '/index.html', '/location', '/location.html']) {
      const canonical = `${origin}${url.startsWith('/location') ? '/location' : '/'}`;
      for (const userAgent of ['facebookexternalhit/1.1', 'Twitterbot/1.0']) {
        const response = await app.inject({ url, headers: { 'user-agent': userAgent, host: 'untrusted.example', 'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'http' } });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.headers['cache-control']).toBe('no-cache');
        const html = response.body;
        expect(html).not.toContain('__PUBLIC_BASE_URL__');
        expect(html).not.toContain('untrusted.example');
        expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
        expect(html).toContain(`<meta property="og:url" content="${canonical}"`);
        expect(html).toContain('<meta property="og:type" content="website"');
        expect(html).toContain('<meta property="og:site_name" content="Tidepin"');
        for (const key of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) {
          expect(html).toMatch(new RegExp(`<meta (?:property|name)="${key}" content="[^"]+"`));
        }
        expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
        expect(html).toContain(`<meta property="og:image" content="${origin}${SOCIAL_IMAGE_PATH}"`);
        expect(html).toContain(`<meta name="twitter:image" content="${origin}${SOCIAL_IMAGE_PATH}"`);
        expect(html).toContain('<meta property="og:image:type" content="image/png"');
        expect(html).toContain('<meta property="og:image:width" content="1200"');
        expect(html).toContain('<meta property="og:image:height" content="630"');
        expect(html).toContain(`<meta property="og:image:alt" content="${SOCIAL_IMAGE_ALT}"`);
        expect(html.match(/not for navigation/gi)).toHaveLength(1);
        expect(html.split('</head>')[0]).not.toMatch(/not for navigation/i);
        expect(html).toContain('rel="icon" href="/favicon.ico"');
        expect(html).toContain('class="footer-credit"');
        expect(html).toContain('href="https://www.hmeyer.com"');
        if (url === '/') expect(html).toContain(`<meta name="description" content="${SOCIAL_DESCRIPTION}"`);
      }
      const head = await app.inject({ method: 'HEAD', url });
      expect(head.statusCode).toBe(200);
      expect(head.headers['content-type']).toContain('text/html');
      expect(head.body).toBe('');
    }
  });

  it('blocks generic HTML file aliases while preserving filled encoded routes and built scripts/styles', async () => {
    const clientDir = await mkdtemp(join(tmpdir(), 'tidepin-route-alias-'));
    cleanup.push(() => rm(clientDir, { recursive: true, force: true }));
    await writeFile(join(clientDir, 'index.html'), '<link rel="canonical" href="__PUBLIC_BASE_URL__/" />');
    await writeFile(join(clientDir, 'location.html'), '<link rel="canonical" href="__PUBLIC_BASE_URL__/location" />');
    await mkdir(join(clientDir, 'static'));
    await writeFile(join(clientDir, 'static/app.js'), 'export const ready = true;');
    await writeFile(join(clientDir, 'static/app.css'), 'body { color: navy; }');
    const app = await buildApp({ clientDir, config: loadConfig({ PUBLIC_BASE_URL: 'https://your-domain.example' }) });
    cleanup.push(() => app.close());
    for (const url of ['/index.html/', '/location.html/', '/index.html%2f', '/location.html%2F', '/%69ndex.html/', '/loc%61tion.html/', '/index%2ehtml/', '/location%2ehtml/', '/index.html/.', '/location.html/%2e', '//index.html', '/index.html/?share=1']) {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await app.inject({ method, url });
        expect([400, 403, 404], url).toContain(response.statusCode);
        expect(response.body, url).not.toContain('__PUBLIC_BASE_URL__');
      }
    }
    for (const url of ['/%69ndex.html', '/index%2ehtml', '/loc%61tion.html', '/location%2ehtml', '/index.html?share=1', '/location.html?share=1']) {
      const response = await app.inject(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).not.toContain('__PUBLIC_BASE_URL__');
      expect(response.body, url).toContain('href="https://your-domain.example/');
    }
    for (const [url, content, mime] of [['/static/app.js', 'export const ready = true;', 'javascript'], ['/static/app.css', 'body { color: navy; }', 'text/css']]) {
      const response = await app.inject(url!);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(content);
      expect(response.headers['content-type']).toContain(mime!);
    }
  });

  it('publishes the card without a client session, with correct PNG bytes, caching, HEAD and revalidation', async () => {
    const app = await buildApp({ assetsDir: resolve('assets'), config: loadConfig({ SESSION_LIMIT_MINUTES: '1' }) });
    cleanup.push(() => app.close());
    const expected = await readFile(resolve('assets/social/tidepin-social.png'));
    const response = await app.inject({ url: SOCIAL_IMAGE_PATH, headers: { 'user-agent': 'Twitterbot/1.0' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.rawPayload).toEqual(expected);
    expect(response.headers['set-cookie']).toBeUndefined();
    const head = await app.inject({ method: 'HEAD', url: SOCIAL_IMAGE_PATH });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe(String(expected.length));
    expect(head.body).toBe('');
    const cached = await app.inject({ url: SOCIAL_IMAGE_PATH, headers: { 'if-none-match': response.headers.etag as string } });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
  });
});
