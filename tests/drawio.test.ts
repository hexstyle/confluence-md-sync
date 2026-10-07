import { describe, it, expect } from 'vitest';
import { drawioReferences, renderExportedMarkdown, storageToMarkdown, validateMarkdown, compareStorage, publishPage } from '../src/index.js';

describe('draw.io', () => {
  const macro = '<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">Схема CICD C4</ac:parameter><ac:parameter ac:name="revision">11</ac:parameter><ac:parameter ac:name="border">true</ac:parameter><ac:parameter ac:name="" /></ac:structured-macro>';
  it('imports extensionless XML and PNG and preserves viewer parameters', () => {
    const result = storageToMarkdown(macro);
    expect(result.files).toEqual(['Схема CICD C4']);
    expect(result.images).toEqual(['Схема CICD C4.png']);
    expect(result.markdown).toContain('{{drawio:Схема CICD C4|revision=11|border=true|=}}');
    expect(compareStorage(macro, renderExportedMarkdown(result.markdown)).equal).toBe(true);
  });
  it('publishes an image which imports back as an editable diagram', () => {
    const md = '{{drawio:flow.drawio|format=image}}';
    const storage = renderExportedMarkdown(md);
    expect(storage).toContain('<ac:image');
    expect(storage).toContain('ri:filename="flow.drawio.png"');
    const result = storageToMarkdown(storage);
    expect(result.markdown.trim()).toBe(md);
    expect(result.files).toEqual(['flow.drawio']);
  });
  it('validates both attachments and ignores fenced and inline code examples', () => {
    const md = '{{drawio:flow.drawio}}\n\n`{{drawio:example}}`\n\n```\n{{drawio:example2}}\n```';
    expect(drawioReferences(md)).toHaveLength(1);
    expect(() => validateMarkdown({ markdown: md, filePaths: ['flow.drawio'], imagePaths: [] })).toThrow('flow.drawio.png');
    expect(() => validateMarkdown({ markdown: md, filePaths: [], imagePaths: ['flow.drawio.png'] })).toThrow('flow.drawio');
    expect(() => validateMarkdown({ markdown: md, filePaths: ['flow.drawio'], imagePaths: ['flow.drawio.png'] })).not.toThrow();
  });
  it('rejects invalid format and unsafe attachment names', () => {
    expect(() => drawioReferences('{{drawio:../flow.drawio}}')).toThrow('filename');
    expect(() => drawioReferences('{{drawio:flow.drawio|format=unknown}}')).toThrow('format');
  });
  it('recognizes extensionless image-mode diagrams after Confluence removes image attributes', () => {
    const storage = '<ac:image><ri:attachment ri:filename="Схема CICD.png" /></ac:image>';
    const result = storageToMarkdown(storage, { drawioNames: ['Схема CICD'] });
    expect(result.markdown.trim()).toBe('{{drawio:Схема CICD|format=image}}');
    expect(result.files).toEqual(['Схема CICD']);
  });
  it('imports an included diagram as a local editable object with its source page', () => {
    const result = storageToMarkdown(macro.replace('ac:name="drawio"', 'ac:name="inc-drawio"').replace('</ac:structured-macro>', '<ac:parameter ac:name="pageId">42</ac:parameter></ac:structured-macro>'));
    expect(drawioReferences(result.markdown)[0].pageId).toBe('42');
    expect(result.stats.normalized).toBe(1);
    expect(result.files).toEqual(['Схема CICD C4']);
  });
  it('publishes imported diagrams against current target attachments, not old revision pins', async () => {
    const result = await publishPage({ pageId: '1', markdown: storageToMarkdown(macro).markdown, files: ['Схема CICD C4'], images: ['Схема CICD C4.png'], dryRun: true }, { baseUrl: 'https://unused.example', token: 'test' });
    expect(result.storage).toContain('ac:name="drawio"');
    expect(result.storage).not.toContain('ac:name="revision"');
    expect(result.storage).toContain('Схема CICD C4');
  });
});
