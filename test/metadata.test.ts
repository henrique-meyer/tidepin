import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';
import { fillBaseUrl, normalizePublicBaseUrl, SOCIAL_DESCRIPTION, SOCIAL_IMAGE_URL } from '../src/server/metadata.js';

describe('public sharing origin', () => {
  it.each([
    ['https://your-domain.example', 'https://your-domain.example'],
    [' https://your-domain.example/// ', 'https://your-domain.example'],
    ['https://YOUR-DOMAIN.example:443/', 'https://your-domain.example'],
    ['http://localhost:8080/', 'http://localhost:8080'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePublicBaseUrl(input)).toBe(expected);
  });

  it.each([
    '', 'not a URL', '//your-domain.example', 'https:your-domain.example', 'https:///your-domain.example', 'http://your-domain.example',
    'http://localhost.your-domain.example', 'http://192.168.1.1',
    'https://username:password@your-domain.example', 'https://your-domain.example/path',
    'https://your-domain.example/?token=secret', 'https://your-domain.example/#fragment',
    'https://your-domain.example?', 'https://your-domain.example#',
    'https://your-domain.example/" onload="alert(1)', 'https://your-domain.example\\other',
    'https://your-domain.example\nother', 'javascript:alert(1)', 'file:///tmp/card',
  ])('rejects unsafe or ambiguous origins without echoing the input', (input) => {
    try { normalizePublicBaseUrl(input); throw new Error('Expected rejection'); }
    catch (error) {
      expect((error as Error).message).toBe('PUBLIC_BASE_URL must be an HTTPS origin, or an HTTP loopback origin for local development, without credentials, a path, query or fragment.');
    }
  });

  it('uses the configured port locally and the explicit origin at runtime', () => {
    expect(loadConfig({ PORT: '9090' }).publicBaseUrl).toBe('http://localhost:9090');
    expect(loadConfig({ PUBLIC_BASE_URL: 'https://your-domain.example/' }).publicBaseUrl).toBe('https://your-domain.example');
    expect(() => loadConfig({ PUBLIC_BASE_URL: 'http://your-domain.example' })).toThrow('PUBLIC_BASE_URL');
  });

  it('fills every trusted HTML token with absolute URLs and leaves unrelated content alone', () => {
    const html = `<link rel="canonical" href="__PUBLIC_BASE_URL__/" /><meta property="og:image" content="__PUBLIC_BASE_URL__${SOCIAL_IMAGE_URL}" /><p>Keep me &amp; my text</p>`;
    const filled = fillBaseUrl(html, 'https://your-domain.example/');
    expect(filled).toBe('<link rel="canonical" href="https://your-domain.example/" /><meta property="og:image" content="https://your-domain.example/assets/social/tidepin-logo.png?v=logo-square-1" /><p>Keep me &amp; my text</p>');
    expect(filled).not.toContain('__PUBLIC_BASE_URL__');
    expect(SOCIAL_DESCRIPTION).toContain('NOAA CO-OPS');
    expect(SOCIAL_DESCRIPTION).not.toMatch(/not for navigation/i);
  });
});
