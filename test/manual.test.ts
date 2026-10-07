import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANUALS, inline, renderMarkdown } from '../src/manual';

describe('in-app manual', () => {
  it('escapes HTML and renders the inline subset', () => {
    expect(inline('<b> **fett** `npm start` [ndi.video](https://ndi.video/)')).toBe(
      '&lt;b&gt; <strong>fett</strong> <code>npm start</code> <a href="https://ndi.video/" target="_blank" rel="noopener">ndi.video</a>');
    expect(inline('[x](javascript:alert(1))')).not.toContain('<a');
  });
  it('renders headings, lists, tables and images', () => {
    const html = renderMarkdown('# T\n\nText\nweiter\n\n- a\n- b\n\n1. x\n2. y\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![Bild](img/x.png)\n', (p) => `/u/${p}`);
    expect(html).toContain('<h2>T</h2>');
    expect(html).toContain('<p>Text weiter</p>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<ol><li>x</li><li>y</li></ol>');
    expect(html).toContain('<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>');
    expect(html).toContain('<img src="/u/img/x.png" alt="Bild">');
  });
  it('both manuals exist, reference only images that are in the repo, and carry the NDI notice', () => {
    for (const md of Object.values(MANUALS)) {
      for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) expect(existsSync(new URL(`../docs/manual/${m[1]}`, import.meta.url))).toBe(true);
      expect(md).toContain('NDI® is a registered trademark of Vizrt NDI AB.');
    }
  });
});
