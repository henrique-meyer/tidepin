import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/** Decode the shipped non-interlaced RGB PNG without adding an image dependency. */
function rgbPixels(png: Buffer) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(2); // RGB, with no alpha channel.
  expect(png[28]).toBe(0);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    expect(type).not.toBe('tRNS'); // Nor a transparent-color key.
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 3;
  expect(raw.length).toBe((stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  const paeth = (left: number, above: number, upperLeft: number) => {
    const prediction = left + above - upperLeft;
    const a = Math.abs(prediction - left), b = Math.abs(prediction - above), c = Math.abs(prediction - upperLeft);
    return a <= b && a <= c ? left : b <= c ? above : upperLeft;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 3 ? pixels[index - 3]! : 0, above = y ? pixels[index - stride]! : 0;
      const upperLeft = y && x >= 3 ? pixels[index - stride - 3]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
      pixels[index] = (raw[y * (stride + 1) + x + 1]! + predictor) & 255;
    }
  }
  return { pixels, width, height };
}

describe('logo-only sharing artwork', () => {
  it('ships a small opaque 1024 square PNG and retires the old text card', async () => {
    const png = await readFile(resolve('assets/social/tidepin-logo.png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024]);
    expect(png.length).toBeLessThan(100_000);
    expect(png[25]).toBe(2);
    const files = await readdir(resolve('assets/social'));
    for (const file of ['tidepin-social.png', 'tidepin-social.svg']) expect(files).not.toContain(file);
  });

  it('retains the original source and centers the logo with dark, circle-safe padding', async () => {
    const originalLogo = await readFile(resolve('assets/brand/logo/tidepin-transparent-logo.png'));
    expect([originalLogo.readUInt32BE(16), originalLogo.readUInt32BE(20)]).toEqual([736, 756]);
    expect(createHash('sha256').update(originalLogo).digest('hex')).toBe('80f0f9c21c5c95fc6eac8f9b3b0bca9b0cb08549166cfb43bae3ff62f8f6103c');
    const { pixels, width, height } = rgbPixels(await readFile(resolve('assets/social/tidepin-logo.png')));
    let minX = width, minY = height, maxX = -1, maxY = -1, outsideCircle = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3;
      if (pixels[index] === 7 && pixels[index + 1] === 21 && pixels[index + 2] === 38) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > width / 2) outsideCircle++;
    }
    expect([minX, minY, maxX, maxY]).toEqual([200, 192, 822, 831]);
    expect(Math.abs((minX + maxX + 1) / 2 - width / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((minY + maxY + 1) / 2 - height / 2)).toBeLessThanOrEqual(0.5);
    expect(outsideCircle).toBe(0);
  });
});
