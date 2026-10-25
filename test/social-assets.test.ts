import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('social sharing artwork', () => {
  it('ships a 1200 by 630 PNG below the sharing size budget', async () => {
    const png = await readFile(resolve('assets/social/tidepin-social.png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(300_000);
  });

  it('keeps the editable source self-contained with the exact existing logo', async () => {
    const source = await readFile(resolve('assets/social/tidepin-social.svg'), 'utf8');
    const originalLogo = await readFile(resolve('assets/brand/logo/tidepin-transparent-logo.png'));
    const embeddedLogo = source.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
    expect(embeddedLogo).not.toBeNull();
    expect(Buffer.from(embeddedLogo![1]!, 'base64')).toEqual(originalLogo);
    expect(source).toContain('Tide predictions, at a glance.');
    expect(source).not.toMatch(/not for navigation/i);
    expect(source).not.toMatch(/(?:href|src)="https?:/);
  });
});
