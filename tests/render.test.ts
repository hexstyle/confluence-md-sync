import { describe, expect, it } from 'vitest';
import {
  MissingAttachmentUrlError,
  extractPlaceholders,
  renderToStorage,
} from '../src/markdown/render.js';
import { Markdown } from '../src/markdown/markdown.js';
import { validateMarkdown, MarkdownValidationError } from '../src/markdown/validate.js';

describe('extractPlaceholders', () => {
  it('splits images and files, dedupes', () => {
    const r = extractPlaceholders('{{img:a.png}} {{file:b.csv}} {{img:a.png}}');
    expect(r).toEqual({ images: ['a.png'], files: ['b.csv'], pages: [] });
  });
});

describe('renderToStorage', () => {
  const urls = {
    images: new Map([['a.png', 'https://c/x/a.png?version=2']]),
    files: new Map([['b.csv', 'https://c/x/b.csv']]),
  };

  it('renders markdown and substitutes placeholders', () => {
    const html = renderToStorage('# T\n\n{{img:a.png}} and {{file:b.csv}}', urls);
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<img src="https://c/x/a.png?version=2" alt="a.png" />');
    expect(html).toContain('<a href="https://c/x/b.csv">b.csv</a>');
  });

  it('linkResolver: relative md links → page-links, externals untouched', () => {
    const map: Record<string, { title: string; space?: string }> = {
      '../design/foo.md': { title: 'Коннекторы' },
      'bar.md': { title: 'Bar', space: 'DOCS' },
    };
    const html = renderToStorage(
      '[c](../design/foo.md) [ext](https://x.com) [b](bar.md) [anchor](#s)',
      urls,
      { linkResolver: (h) => map[h] ?? null },
    );
    expect(html).toContain('<ac:link><ri:page ri:content-title="Коннекторы" /><ac:plain-text-link-body><![CDATA[c]]></ac:plain-text-link-body></ac:link>');
    expect(html).toContain('ri:content-title="Bar" ri:space-key="DOCS"');
    expect(html).toContain('<a href="https://x.com">ext</a>');
    expect(html).toContain('<a href="#s">anchor</a>');
  });

  it('produces self-closing void elements (xhtmlOut)', () => {
    expect(renderToStorage('---', { images: new Map(), files: new Map() })).toContain('<hr />');
  });

  it('preserves linked images and rich labels while resolving repository assets', () => {
    const html = renderToStorage(
      '[![Landscape](docs/landscape.svg)](docs/overview.md#context)\n\n[**Download** diagram](docs/source.drawio "Source") [Registry](docs/systems.json)',
      urls,
      {
        linkResolver: href => href.startsWith('docs/overview.md') ? { title: 'Overview' } : null,
        resourceResolver: href => href.endsWith('.json')
          ? { url: 'https://gitlab.example/repo/-/blob/main/docs/systems.json' }
          : { attachment: href.split('/').at(-1)! },
      },
    );
    expect(html).toContain('<ac:link ac:anchor="context"><ri:page ri:content-title="Overview" /><ac:link-body><ac:image ac:alt="Landscape"><ri:attachment ri:filename="landscape.svg" /></ac:image></ac:link-body></ac:link>');
    expect(html).toContain('<ri:attachment ri:filename="source.drawio" /><ac:link-body><strong>Download</strong> diagram</ac:link-body>');
    expect(html).toContain('href="https://gitlab.example/repo/-/blob/main/docs/systems.json"');
  });

  it('does not resolve external images, anchors or code examples', () => {
    const seen: string[] = [];
    const html = renderToStorage('![External](https://example.org/image.png) [Anchor](#x) `![Code](local.png)`', urls, {
      resourceResolver: href => { seen.push(href); return null; },
    });
    expect(seen).toEqual([]);
    expect(html).toContain('src="https://example.org/image.png"');
    expect(html).toContain('<code>![Code](local.png)</code>');
  });

  it('throws for unknown placeholder', () => {
    expect(() => renderToStorage('{{img:zzz.png}}', urls)).toThrow(MissingAttachmentUrlError);
  });
});

describe('Markdown', () => {
  it('rejects mismatched macro markers', () => {
    expect(() => new Markdown('<!-- MACRO:start:x -->')).toThrow(/mismatched/);
  });

  it('rejects duplicate table placeholders', () => {
    expect(() => new Markdown('{{table:a}} {{table:a}}')).toThrow(/duplicate/);
  });

  it('concat and table name extraction work', () => {
    const md = Markdown.concat('x {{table:t1}} ', new Markdown('y'));
    expect(md.hasTables()).toBe(true);
    expect(md.getTableNames()).toEqual(['t1']);
  });
});

describe('validateMarkdown', () => {
  it('fails when a placeholder has no provided file', () => {
    expect(() =>
      validateMarkdown({ markdown: '{{img:a.png}}', imagePaths: [], filePaths: [] }),
    ).toThrow(MarkdownValidationError);
  });

  it('passes when placeholders are covered', () => {
    expect(() =>
      validateMarkdown({
        markdown: '{{img:a.png}} {{file:b.csv}} {{table:t}}',
        imagePaths: ['/x/a.png'],
        filePaths: ['/y/b.csv'],
        tableNames: ['t'],
      }),
    ).not.toThrow();
  });
});
