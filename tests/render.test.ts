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

  it('produces self-closing void elements (xhtmlOut)', () => {
    expect(renderToStorage('---', { images: new Map(), files: new Map() })).toContain('<hr />');
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
