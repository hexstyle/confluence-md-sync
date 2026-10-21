import { describe, expect, it } from 'vitest';
import { compareStorage, renderExportedMarkdown, storageToMarkdown } from '../src/index.js';
import { parsePlaceholder, placeholder } from '../src/markdown/placeholder.js';

describe('native image formatting', () => {
  it('round trips native attributes, captions, effects, links and quoted text inside a table', () => {
    const raw = placeholder('img', 'picture.png', [
      ['width', '400'], ['align', 'center'], ['border', 'true'], ['title', 'Подпись | {контекст}'],
      ['alt', 'A & B < C'], ['hspace', '8'], ['vspace', '12'], ['queryparams', 'effects=drop-shadow'],
      ['style', 'max-width:100%;height:auto'], ['link', 'https://example.com/?a=1&b=2'],
    ]);
    const markdown = `| Изображение |\n| --- |\n| ${raw} |`;
    const storage = renderExportedMarkdown(markdown);
    expect(storage).toContain('ac:title="Подпись | {контекст}"');
    expect(storage).toContain('ac:alt="A &amp; B &lt; C"');
    expect(storage).toContain('ac:queryparams="effects=drop-shadow"');
    expect(storage.match(/<td>/g)).toHaveLength(1);
    const restored = storageToMarkdown(storage).markdown;
    expect(restored).toContain('link=');
    expect(compareStorage(storage, renderExportedMarkdown(restored)).equal).toBe(true);
  });
  it('preserves formatting when importing and republishing a Structurizr view', () => {
    const raw = '{{structurizr:model.dsl|view=containers|width=450|align=right|title=Architecture|alt=Model|border=true}}';
    const storage = renderExportedMarkdown(raw);
    expect(storage).toContain('ac:width="450"');
    expect(storage).toContain('ac:title="Architecture"');
    const restored = storageToMarkdown(storage).markdown;
    expect(restored).toContain('|view=containers'); expect(restored).toContain('|align=right');
    expect(compareStorage(storage, renderExportedMarkdown(restored)).equal).toBe(true);
  });
  it('uses an attachment link for image display=link and leaves code examples intact', () => {
    expect(renderExportedMarkdown('{{img:picture.png|display=link}}')).toContain('<ac:link><ri:attachment ri:filename="picture.png" />');
    expect(renderExportedMarkdown('`{{img:picture.png|width=400}}`')).toContain('<code>{{img:picture.png|width=400}}</code>');
    expect(renderExportedMarkdown('```\n{{img:picture.png}}\n```')).not.toContain('<ac:image');
  });
  it('rejects unsafe image hyperlinks and parses quoted separators without losing values', () => {
    expect(() => renderExportedMarkdown('{{img:picture.png|link=javascript:alert(1)}}')).toThrow('protocol');
    expect(parsePlaceholder('picture.png|alt="one|two {three}"')).toEqual({ name: 'picture.png', attrs: [['alt', 'one|two {three}']] });
  });
});


it('retains Structurizr source and view when its image is displayed as a link; draw.io stays native by default', () => {
  const raw = '{{structurizr:model.dsl|view=containers|display=link}}';
  const storage = renderExportedMarkdown(raw), md = storageToMarkdown(storage).markdown;
  expect(storage).toContain('<ac:link>'); expect(storage).not.toContain('<ac:image');
  expect(md).toContain('{{structurizr:model.dsl|view=containers|display=link}}');
  expect(compareStorage(storage, renderExportedMarkdown(md)).equal).toBe(true);
  const drawio = renderExportedMarkdown('{{drawio:diagram.drawio}}');
  expect(drawio).toContain('ac:name="drawio"'); expect(drawio).not.toContain('<ac:image');
});
