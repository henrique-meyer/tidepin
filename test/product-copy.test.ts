import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const disclaimer = /not\s+for\s+navigation/gi;

async function textFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? textFiles(path)
      : ['.html', '.ts', '.css', '.svg', '.webmanifest', '.json'].includes(extname(path)) ? [path] : [];
  }));
  return files.flat();
}

describe('product disclaimer placement', () => {
  it('keeps one notice in each page footer and none in other shipped UI strings or artwork', async () => {
    const pages = new Set(['index.html', 'location.html'].map(file => resolve('src/client', file)));
    const files = (await Promise.all(['src', 'assets'].map(directory => textFiles(resolve(directory))))).flat();
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      if (pages.has(file)) {
        expect(text.match(disclaimer), file).toHaveLength(1);
        const footer = text.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
        expect(footer?.match(disclaimer), file).toHaveLength(1);
        expect(footer, file).toContain('class="footer-source"');
      } else {
        expect(text.match(disclaimer), file).toBeNull();
      }
    }
  });
});
