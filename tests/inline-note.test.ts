import { describe, expect, it } from 'vitest';
import { compareStorage, renderExportedMarkdown, storageToMarkdown } from '../src/index.js';
import { extractPlaceholders } from '../src/markdown/render.js';
import { inlineNote, parseInlineNote } from '../src/markdown/note.js';

const note = (body: string, params = '') => `<ac:structured-macro ac:name="note">${params}<ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
describe('inline Note', () => {
  it('places a block Note between paragraphs within the same table cell, preserving surrounding content', () => {
    const raw = '| Artifact | Description |\n| --- | --- |\n| Buffer | Topic<br>Category: state {{note:Required category}} after |';
    const storage = renderExportedMarkdown(raw);
    expect(storage).toMatch(/<td><p>Topic<br\s*\/>Category: state <\/p><ac:structured-macro ac:name="note"/);
    expect(storage).toContain('<ac:rich-text-body><p>Required category</p></ac:rich-text-body>');
    expect(storage).toContain('</ac:structured-macro><p> after</p></td>');
    const restored = storageToMarkdown(storage);
    expect(restored.markdown).toContain('{{note:'); expect(restored.stats.fenced).toBe(0);
    expect(compareStorage(storage, renderExportedMarkdown(restored.markdown)).equal).toBe(true);
  });
  it('preserves breaks, paragraphs, escaped punctuation and nested page, Jira and file macros', () => {
    const text = 'A \\| B \\{literal\\} \\: {{page:Home|space=DOCS}}<br>line\nnext {{jira:ABC-1}} {{file:guide.pdf}}';
    const raw = '| Note |\n| --- |\n| ' + inlineNote(text, [['title', 'Context | {X}'], ['icon', 'false']]) + ' |';
    const storage = renderExportedMarkdown(raw);
    expect(storage).toContain('A | B {literal} :'); expect(storage).toMatch(/<br\s*\/>line<\/p>/);
    expect(storage).toContain('<p>next '); expect(storage).toContain('ri:content-title="Home"');
    expect(storage).toContain('ac:name="jira"'); expect(storage).toContain('ri:filename="guide.pdf"');
    expect(storage.match(/<td>/g)).toHaveLength(1);
    const restored = storageToMarkdown(storage);
    expect(restored.markdown).toContain('{{note:'); expect(restored.markdown).toContain('{{jira:');
    expect(compareStorage(storage, renderExportedMarkdown(restored.markdown)).equal).toBe(true);
  });
  it('imports Notes inside cells without flattening them in faithful or readable mode', () => {
    const storage = `<table><tbody><tr><th>Note</th></tr><tr><td><p>Before</p>${note('<p>One<br/>line</p><p>Two</p>')}<p>After</p></td></tr></tbody></table>`;
    for (const mode of ['faithful', 'readable'] as const) {
      const md = storageToMarkdown(storage, { mode }).markdown;
      expect(md).toContain('{{note:'); expect(md).toContain('One<br'); expect(md).toContain('Two');
      expect(renderExportedMarkdown(md)).toContain('ac:name="note"');
    }
  });
  it('retains complex Note bodies without flattening a nested list in table imports', () => {
    const storage = `<table><tbody><tr><td>${note('<ul><li>Keep list</li></ul>')}</td></tr></tbody></table>`;
    for (const mode of ['faithful', 'readable'] as const) {
      const md = storageToMarkdown(storage, { mode }).markdown;
      expect(md).toContain('confluence-storage'); expect(compareStorage(storage, renderExportedMarkdown(md)).equal).toBe(true);
    }
  });
  it('retains block NOTE syntax and leaves code, escaped braces and literal macros alone', () => {
    expect(renderExportedMarkdown('> [!NOTE] Title\n> Body')).toContain('ac:name="note"');
    expect(storageToMarkdown(note('<p>Body</p>')).markdown).toContain('> [!NOTE]');
    const storage = renderExportedMarkdown('`{{note:Code}}` \\{\\{note:Literal\\}\\}\n\n```\n{{note:Code}}\n```');
    expect(storage).not.toContain('ac:name="note"');
    expect(renderExportedMarkdown('{{note:\\{\\{jira:literal\\}\\}}}')).not.toContain('ac:name="jira"');
    expect(renderExportedMarkdown('{{note:One\nTwo}}')).toContain('<p>One</p>');
    expect(parseInlineNote('One\\nTwo').text).toBe('One\nTwo');
  });
});


it('validates nested attachment references after decoding a quoted Note, ignoring code examples', () => {
  const markdown = inlineNote('File {{file:"a|b.pdf"}} `{{file:example.pdf}}`');
  expect(extractPlaceholders(markdown).files).toEqual(['a|b.pdf']);
});
