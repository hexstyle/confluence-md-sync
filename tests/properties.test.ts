import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareStorage, renderExportedMarkdown, storageToMarkdown } from '../src/index.js';

const header = '<tr><th>Поле</th><th>Значение</th></tr>';
const duplicate = '<tr><td>Поле</td><td>Значение</td></tr>';
const data = '<tr><td>Название</td><td>Dataset</td></tr><tr><td>Код</td><td>DS_DWH_TEST</td></tr>';
const details = (body: string, attrs = '') => `<ac:structured-macro ac:name="details"><ac:parameter ac:name="id">spec</ac:parameter><ac:rich-text-body><table${attrs}>${body}</table></ac:rich-text-body></ac:structured-macro>`;
const cycles = (source: string) => {
  const first = storageToMarkdown(source).markdown;
  let current = first;
  for (let i = 0; i < 3; i++) {
    const storage = renderExportedMarkdown(current);
    expect(storage.match(/<thead>/g)).toHaveLength(1);
    expect(storage).not.toContain(duplicate);
    current = storageToMarkdown(storage).markdown;
    expect(current).toBe(first);
  }
  return first;
};

describe('Page Properties headings', () => {
  for (const attrs of ['', ' class="wrapped" style="width:90%"']) {
    it(`repairs repeated initial headings and remains stable (${attrs || 'plain'})`, () => {
      const source = details(`<thead>${header}</thead><tbody>${duplicate}${duplicate}${data}</tbody>`, attrs);
      const result = storageToMarkdown(source);
      expect(result.stats.normalized).toBeGreaterThan(0);
      const md = cycles(source);
      expect(md.match(/\| Поле \| Значение \|/g)).toHaveLength(1);
      expect(md).toContain('| Код | DS_DWH_TEST |');
      expect(md).toContain('id=spec');
    });
  }
  it('reuses the header of a styled table instead of synthesizing another one', () => {
    const md = cycles(details(`<thead>${header}</thead><tbody>${data}</tbody>`, ' class="wrapped"'));
    expect(md.match(/\| Поле \| Значение \|/g)).toHaveLength(1);
  });
  it('recognizes a Confluence heading in tbody and keeps vertical properties as data', () => {
    expect(cycles(details(`<tbody>${header}${duplicate}${data}</tbody>`, ' class="wrapped"')).match(/\| Поле \| Значение \|/g)).toHaveLength(1);
    const md = cycles(details(`<tbody><tr><th>Название</th><td>Dataset</td></tr>${data}</tbody>`, ' class="wrapped"'));
    expect(md).toContain('| Название | Dataset |');
  });
  it('repairs publication of already contaminated Markdown', () => {
    const md = '::: properties\n| Поле | Значение |\n| --- | --- |\n| Поле | Значение |\n| Поле | Значение |\n| Код | DS_X |\n:::';
    const storage = renderExportedMarkdown(md);
    expect(storage).not.toContain(duplicate);
    expect(storageToMarkdown(storage).markdown.match(/\| Поле \| Значение \|/g)).toHaveLength(1);
  });
  it('keeps matching rows after data and does not repair ordinary tables', () => {
    const body = `<thead>${header}</thead><tbody>${data}${duplicate}</tbody>`;
    expect(renderExportedMarkdown(storageToMarkdown(details(body)).markdown)).toMatch(/<td>Поле<\/td>\s*<td>Значение<\/td>/);
    const table = `<table><thead>${header}</thead><tbody>${duplicate}${data}</tbody></table>`;
    expect(compareStorage(table, renderExportedMarkdown(storageToMarkdown(table).markdown)).equal).toBe(true);
  });
  it('keeps meaningful formatting and imports portable Jira references', () => {
    const source = '<p><span style="color:red">Important</span> &quot;quoted&quot;&nbsp;text</p><blockquote><p>Artifacts</p></blockquote>';
    const md = storageToMarkdown(source).markdown;
    expect(md).toContain('style="color:red"'); expect(md).toContain('"quoted"'); expect(md).toContain('&nbsp;');
    expect(md).toContain('> Artifacts');
    expect(compareStorage(source, renderExportedMarkdown(md)).equal).toBe(true);
    const jira = '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">DR-96</ac:parameter><ac:parameter ac:name="server">Jira</ac:parameter><ac:parameter ac:name="serverId">jira-id</ac:parameter></ac:structured-macro>';
    const result = storageToMarkdown(jira);
    expect(result.markdown.trim()).toBe('{{jira:DR-96}}');
    expect(result.stats.normalized).toBeGreaterThan(0);
    expect(storageToMarkdown(source, { mode: 'readable' }).markdown).not.toMatch(/<span|&quot;|&nbsp;/);
  });
});

if (process.env.CONFLUENCE_DR96_FIXTURES) it('keeps actual DR-96 pages stable across three cycles', () => {
  for (const id of ['474144988', '474145233']) {
    const source = readFileSync(`${process.env.CONFLUENCE_DR96_FIXTURES}/docs-studio-dr96-${id}.xml`, 'utf8');
    let md = storageToMarkdown(renderExportedMarkdown(storageToMarkdown(source).markdown)).markdown;
    for (let i = 0; i < 3; i++) {
      const next = storageToMarkdown(renderExportedMarkdown(md)).markdown;
      expect(next).toBe(md); md = next;
    }
    expect(md.match(/\| Поле \| Значение \|/g)).toHaveLength(1);
  }
});
