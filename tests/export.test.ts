import { describe, expect, it } from 'vitest';
import { decodeEntities, parseStorage, serializeStorage } from '../src/export/xhtml.js';
import { compareStorage } from '../src/export/canonical.js';
import { storageToMarkdown } from '../src/export/to-markdown.js';
import { roundTripStorage } from '../src/export/roundtrip.js';
import { renderToStorage } from '../src/markdown/render.js';
import { escapeParamValue, unescapeParamValue } from '../src/macros/builder.js';
import { processMacros } from '../src/macros/registry.js';
import { createDefaultRegistry, macros } from '../src/macros/index.js';

describe('storage xhtml parser', () => {
  it('parses and serializes back byte-identically', () => {
    const storage =
      '<p>Текст &amp; <strong>жирный</strong></p>' +
      '<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="abc">' +
      '<ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>' +
      '<ac:plain-text-body><![CDATA[a < b && c]]></ac:plain-text-body>' +
      '<!-- comment --><hr /><img src="http://x/y.png" />';
    expect(serializeStorage(parseStorage(storage))).toBe(storage);
  });

  it('decodes named and numeric entities, keeps unknown', () => {
    expect(decodeEntities('a&nbsp;b &amp; &#1071; &#x42F; &unknownx;')).toBe(
      'a b & Я Я &unknownx;',
    );
  });
});

describe('compareStorage canonical equivalence', () => {
  it('ignores macro-id, schema-version and parameter order', () => {
    const a =
      '<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="one">' +
      '<ac:parameter ac:name="b">2</ac:parameter><ac:parameter ac:name="a">1</ac:parameter></ac:structured-macro>';
    const b =
      '<ac:structured-macro ac:name="toc" ac:schema-version="2" ac:macro-id="two">' +
      '<ac:parameter ac:name="a">1</ac:parameter><ac:parameter ac:name="b">2</ac:parameter></ac:structured-macro>';
    expect(compareStorage(a, b).equal).toBe(true);
  });

  it('treats entity and literal forms as equal', () => {
    expect(compareStorage('<p>a&nbsp;b</p>', '<p>a b</p>').equal).toBe(true);
    expect(compareStorage('<p>&quot;x&quot;</p>', '<p>"x"</p>').equal).toBe(true);
  });

  it('merges adjacent strongs and hoists edge whitespace', () => {
    const a = '<p><strong>a </strong><strong>b</strong></p>';
    const b = '<p><strong>a</strong> <strong>b</strong></p>';
    expect(compareStorage(a, b).equal).toBe(true);
  });

  it('unwraps a paragraph that only wraps a macro', () => {
    const macroXml = '<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="x" />';
    expect(compareStorage(`<p>${macroXml}</p>`, macroXml).equal).toBe(true);
  });

  it('equates <img> with <ac:image><ri:url>', () => {
    const a = '<p><img src="http://x/a.png" class="icon" /></p>';
    const b = '<p><ac:image ac:class="icon"><ri:url ri:value="http://x/a.png" /></ac:image></p>';
    expect(compareStorage(a, b).equal).toBe(true);
  });

  it('reports real differences', () => {
    const r = compareStorage('<p>a</p>', '<p>b</p>');
    expect(r.equal).toBe(false);
    expect(r.diffs[0].message).toMatch(/text differs/);
  });
});

describe('storageToMarkdown', () => {
  it('converts basic blocks to clean markdown', () => {
    const { markdown } = storageToMarkdown(
      '<h2>Заголовок</h2><p>Текст <strong>жирный</strong> и <em>курсив</em>, <code>код</code>.</p>' +
      '<ul><li>один</li><li>два<ul><li>вложенный</li></ul></li></ul><hr />',
    );
    expect(markdown).toContain('## Заголовок');
    expect(markdown).toContain('**жирный**');
    expect(markdown).toContain('*курсив*');
    expect(markdown).toContain('`код`');
    expect(markdown).toContain('- один');
    expect(markdown).toContain('  - вложенный');
    expect(markdown).toContain('---');
  });

  it('converts a simple table to GFM with alignment', () => {
    const { markdown } = storageToMarkdown(
      '<table><thead><tr><th>Имя</th><th style="text-align: right;">Часы</th></tr></thead>' +
      '<tbody><tr><td>Анна</td><td style="text-align: right;">8</td></tr></tbody></table>',
    );
    expect(markdown).toContain('| Имя | Часы |');
    expect(markdown).toContain('| --- | ---: |');
    expect(markdown).toContain('| Анна | 8 |');
  });

  it('keeps a complex table as raw html', () => {
    const src =
      '<table class="wrapped"><tbody><tr><td colspan="2"><ul><li>x</li></ul></td></tr></tbody></table>';
    const { markdown, stats } = storageToMarkdown(src);
    expect(markdown.trim()).toBe(src);
    expect(stats.rawHtml).toBe(1);
  });

  it('turns attachment images into {{img}} placeholders with attrs', () => {
    const { markdown, images } = storageToMarkdown(
      '<p><ac:image ac:thumbnail="true" ac:height="23"><ri:attachment ri:filename="схема.png" /></ac:image></p>',
    );
    expect(markdown).toContain('{{img:схема.png|thumbnail=true|height=23}}');
    expect(images).toEqual(['схема.png']);
  });

  it('lifts placeholders out of raw-html fallbacks', () => {
    const { markdown, images, stats } = storageToMarkdown(
      '<table class="wrapped"><tbody><tr><td><p><ac:image><ri:attachment ri:filename="a.png" /></ac:image></p></td></tr></tbody></table>',
    );
    expect(markdown).toContain('{{img:a.png}}');
    expect(images).toEqual(['a.png']);
    expect(stats.fenced).toBe(0);
  });

  it('turns page links into {{page}} placeholders', () => {
    const { markdown } = storageToMarkdown(
      '<p>см. <ac:link><ri:page ri:content-title="Другая страница" ri:space-key="DOCS" />' +
      '<ac:plain-text-link-body><![CDATA[тут]]></ac:plain-text-link-body></ac:link></p>',
    );
    expect(markdown).toContain('{{page:Другая страница|space=DOCS|text=тут}}');
  });

  it('converts known macros to markers', () => {
    const { markdown, stats } = storageToMarkdown(
      '<ac:structured-macro ac:name="expand" ac:schema-version="1" ac:macro-id="x">' +
      '<ac:parameter ac:name="title">Детали</ac:parameter>' +
      '<ac:rich-text-body><p>внутри <strong>жирный</strong></p></ac:rich-text-body></ac:structured-macro>',
    );
    expect(markdown).toContain('<!-- MACRO:start:expand:title=Детали -->');
    expect(markdown).toContain('внутри **жирный**');
    expect(stats.markers).toBe(1);
  });

  it('converts unknown macros to markers via registry passthrough', () => {
    const { markdown, stats } = storageToMarkdown(
      '<ac:structured-macro ac:name="my-app-macro" ac:schema-version="1" ac:macro-id="x">' +
      '<ac:parameter ac:name="mode">fast</ac:parameter></ac:structured-macro>',
    );
    expect(markdown).toContain('<!-- MACRO:start:my-app-macro:mode=fast -->');
    expect(stats.markers).toBe(1);
    expect(stats.fenced).toBe(0);
  });

  it('fences what cannot be represented faithfully', () => {
    // ac:layout нет ни в markdown, ни в известных макросах
    const src = '<ac:layout><ac:layout-section ac:type="single"><ac:layout-cell><p>x</p></ac:layout-cell></ac:layout-section></ac:layout>';
    const { markdown, stats } = storageToMarkdown(src);
    expect(markdown).toContain('```confluence-storage');
    expect(markdown).toContain(src);
    expect(stats.fenced).toBe(1);
  });
});

describe('render pipeline additions', () => {
  const noUrls = { images: new Map<string, string>(), files: new Map<string, string>() };

  it('unescapes confluence-storage fences into live markup', () => {
    const md = '```confluence-storage\n<ac:structured-macro ac:name="x"><ac:parameter ac:name="q">a &amp; "b"</ac:parameter></ac:structured-macro>\n```\n';
    const storage = renderToStorage(md, noUrls);
    expect(storage).toContain('<ac:structured-macro ac:name="x">');
    expect(storage).toContain('a &amp; "b"');
    expect(storage).not.toContain('<pre>');
  });

  it('renders attachment-style images and files without urls', () => {
    const storage = renderToStorage(
      '{{img:a.png|thumbnail=true}} {{file:отчёт.xlsx}}',
      noUrls,
      { imageStyle: 'attachment', fileStyle: 'attachment' },
    );
    expect(storage).toContain('<ac:image ac:thumbnail="true"><ri:attachment ri:filename="a.png" /></ac:image>');
    expect(storage).toContain('<ac:link><ri:attachment ri:filename="отчёт.xlsx" /></ac:link>');
  });

  it('renders {{page}} placeholders as ac:link', () => {
    const storage = renderToStorage('{{page:Моя страница|space=DOCS|text=сюда}}', noUrls);
    expect(storage).toContain('<ri:page ri:content-title="Моя страница" ri:space-key="DOCS" />');
    expect(storage).toContain('<![CDATA[сюда]]>');
  });

  it('linkify can be turned off', () => {
    const md = 'см. https://example.com/page';
    expect(renderToStorage(md, noUrls)).toContain('<a href');
    expect(renderToStorage(md, noUrls, { linkify: false })).not.toContain('<a href');
  });
});

describe('macro system additions', () => {
  it('escapes multiline and special chars in marker params', () => {
    const sql = "SELECT *\nFROM T1 WHERE a = 'b:c' -- 100%";
    expect(unescapeParamValue(escapeParamValue(sql))).toBe(sql);
    expect(escapeParamValue(sql)).not.toContain('\n');
  });

  it('tableJoiner builder produces a single-line marker with sql', () => {
    const md = macros.tableJoiner('body', 'SELECT 1\nFROM T1').toString();
    const [markerLine] = md.split('\n');
    expect(markerLine).toContain('sql=SELECT 1%0AFROM T1');
  });

  it('processMacros renders unknown markers via passthrough', () => {
    const registry = createDefaultRegistry();
    const out = processMacros(
      '<!-- MACRO:start:custom-thing:k=v -->\n<p>body</p>\n<!-- MACRO:end:custom-thing -->',
      registry,
    ).toString();
    expect(out).toContain('ac:name="custom-thing"');
    expect(out).toContain('<ac:parameter ac:name="k">v</ac:parameter>');
    expect(out).toContain('<ac:rich-text-body><p>body</p></ac:rich-text-body>');
  });

  it('passthrough can be disabled', () => {
    const registry = createDefaultRegistry().passthroughUnknownMacros(false);
    const out = processMacros(
      '<!-- MACRO:start:custom-thing -->\n<!-- MACRO:end:custom-thing -->',
      registry,
    ).toString();
    expect(out).toContain('<!-- MACRO:start:custom-thing -->');
  });
});

describe('storageToMarkdown readable mode', () => {
  const readable = { mode: 'readable' as const };

  it('never emits raw HTML blocks; complex tables become GFM', () => {
    const src =
      '<table class="wrapped" style="width: 800px;"><colgroup><col /><col /></colgroup>' +
      '<thead><tr><th colspan="2">Детали</th></tr></thead>' +
      '<tbody>' +
      '<tr><td><div class="content-wrapper"><p><strong>Проц</strong></p>' +
      '<ul><li>раз</li><li>два</li></ul></div></td>' +
      '<td><p><br /></p></td></tr>' +
      '</tbody></table>';
    const { markdown, stats } = storageToMarkdown(src, readable);
    expect(markdown).not.toMatch(/<table|<div|<colgroup|```confluence-storage/);
    // colspan=2: содержимое в первой клетке диапазона, остальные пустые
    expect(markdown).toContain('| Детали |  |');
    expect(markdown).toContain('| --- | --- |');
    // блочная ячейка сплющена: bullets + <br>, содержимое на месте
    expect(markdown).toContain('**Проц**<br>• раз<br>• два');
    // пустая ячейка (<p><br/></p>) действительно пустая
    expect(markdown).toMatch(/\|\s*\|/);
    expect(stats.lossy).toBeGreaterThan(0);
  });

  it('unwraps styled spans and drops colour, keeping text and emphasis', () => {
    const { markdown } = storageToMarkdown(
      '<p>до <span style="color: rgb(255,0,0);">крас <strong>ный</strong></span> после</p>',
      readable,
    );
    expect(markdown).not.toContain('<span');
    expect(markdown).toContain('до крас **ный** после');
  });

  it('decodes safe entities but keeps &lt;/&gt;/&amp;', () => {
    const { markdown } = storageToMarkdown(
      '<p>&quot;цитата&quot; &mdash; тире, a &lt; b &amp; c</p>',
      readable,
    );
    expect(markdown).toContain('"цитата" — тире');
    expect(markdown).toContain('&lt; b &amp; c');
  });

  it('escapes placeholder pipes exactly once inside table cells', () => {
    const src =
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>' +
      '<ac:image ac:height="23"><ri:attachment ri:filename="p.png" /></ac:image>' +
      '</td></tr></tbody></table>';
    const { markdown } = storageToMarkdown(src, readable);
    expect(markdown).toContain('{{img:p.png\\|height=23}}');
    expect(markdown).not.toContain('\\\\|');
  });

  it('keeps macro content when a macro cannot become a marker', () => {
    // ac:layout is neither a known macro nor Markdown → faithful would fence
    const src =
      '<ac:layout><ac:layout-section ac:type="two_equal">' +
      '<ac:layout-cell><p>левая</p></ac:layout-cell>' +
      '<ac:layout-cell><p>правая</p></ac:layout-cell>' +
      '</ac:layout-section></ac:layout>';
    const { markdown, stats } = storageToMarkdown(src, readable);
    expect(markdown).not.toContain('```confluence-storage');
    expect(markdown).toContain('левая');
    expect(markdown).toContain('правая');
    expect(stats.fenced).toBe(0);
  });

  it('<br> becomes a real newline in paragraphs, stays <br> in table cells', () => {
    const src =
      '<p>строка один<br/>строка два</p>' +
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>' +
      '<p>ячейка A<br/>ячейка B</p></td></tr></tbody></table>';
    const { markdown } = storageToMarkdown(src, readable);
    expect(markdown).toContain('строка один\nстрока два'); // абзац: перенос
    expect(markdown).toContain('| ячейка A<br>ячейка B |'); // ячейка: <br>
    // в самом абзаце тегов <br> не остаётся
    const paraLine = markdown.split('\n\n')[0];
    expect(paraLine).not.toContain('<br');
  });

  it("attachments:'local' — images as <img> to local files, files as md links", () => {
    const local = { attachments: 'local' as const };
    const img = storageToMarkdown(
      '<p><ac:image ac:height="23"><ri:attachment ri:filename="d.png" /></ac:image></p>',
      local,
    );
    expect(img.markdown).toContain('<img src="attachments/d.png" height="23" alt="d.png" />');
    expect(img.images).toEqual(['d.png']);

    const file = storageToMarkdown(
      '<p>см. <ac:link><ri:attachment ri:filename="отчёт.xlsx" />' +
      '<ac:plain-text-link-body><![CDATA[отчёт]]></ac:plain-text-link-body></ac:link></p>',
      local,
    );
    expect(file.markdown).toContain('[отчёт](attachments/отчёт.xlsx)');
    expect(file.files).toEqual(['отчёт.xlsx']);
  });

  it("attachments:'local' — external ri:url image becomes <img> with the URL", () => {
    const { markdown } = storageToMarkdown(
      '<p><ac:image><ri:url ri:value="https://x/y.png" /></ac:image></p>',
      { attachments: 'local' },
    );
    expect(markdown).toContain('<img src="https://x/y.png" alt="" />');
  });

  it("tables:'records' — each row becomes a **Header:** value record", () => {
    const src =
      '<table><thead><tr><th>Проект</th><th>Роль</th><th>Проц</th></tr></thead>' +
      '<tbody>' +
      '<tr><td>CP</td><td>TechLead</td><td>100</td></tr>' +
      '<tr><td>MITS</td><td>Dev</td><td></td></tr>' + // пустая ячейка пропускается
      '</tbody></table>';
    const { markdown, stats } = storageToMarkdown(src, { tables: 'records' });
    expect(markdown).toContain('**Проект:** CP\n**Роль:** TechLead\n**Проц:** 100');
    expect(markdown).toContain('\n\n---\n\n');
    expect(markdown).toContain('**Проект:** MITS\n**Роль:** Dev'); // без пустого **Проц:**
    expect(markdown).not.toContain('**Проц:** \n');
    expect(markdown).not.toMatch(/<table|\| ---/);
    expect(stats.lossy).toBeGreaterThan(0);
  });

  it("tables:'records' expands colspan/rowspan via the shared grid", () => {
    const src =
      '<table><tbody>' +
      '<tr><th>A</th><th>B</th></tr>' +
      '<tr><td rowspan="2">x</td><td>1</td></tr>' +
      '<tr><td>2</td></tr>' +
      '</tbody></table>';
    const { markdown } = storageToMarkdown(src, { tables: 'records' });
    expect(markdown).toContain('**A:** x\n**B:** 1');
    expect(markdown).toContain('**B:** 2'); // вторая строка: A пустая (rowspan-филлер) → пропущена
  });

  it('faithful mode is unchanged (still emits raw html / fences)', () => {
    const src = '<table class="wrapped"><tbody><tr><td colspan="2">x</td></tr></tbody></table>';
    expect(storageToMarkdown(src).markdown.trim()).toBe(src); // raw html preserved
    expect(storageToMarkdown(src, readable).markdown).not.toContain('<table');
  });
});

describe('roundTripStorage', () => {
  it('round-trips a composite page without canonical loss', () => {
    const storage =
      '<h1>Отчёт</h1>' +
      '<p>Вводный текст с <strong>акцентом</strong>, <span style="color: rgb(255,0,0);">красным</span> и nbsp.</p>' +
      '<ul><li>пункт один</li><li>пункт два</li></ul>' +
      '<table><thead><tr><th>Ключ</th><th>Значение</th></tr></thead>' +
      '<tbody><tr><td>размер</td><td>42</td></tr></tbody></table>' +
      '<table class="wrapped"><colgroup><col /></colgroup><tbody><tr><td rowspan="2"><p>сложная</p></td></tr><tr></tr></tbody></table>' +
      '<p><ac:image ac:height="250"><ri:attachment ri:filename="chart.png" /></ac:image></p>' +
      '<p>Ссылка: <ac:link><ri:page ri:content-title="Список проектов" /></ac:link></p>' +
      '<ac:structured-macro ac:name="expand" ac:schema-version="1" ac:macro-id="e1">' +
      '<ac:parameter ac:name="title">Раскрыть</ac:parameter>' +
      '<ac:rich-text-body><p>скрытое</p></ac:rich-text-body></ac:structured-macro>' +
      '<ac:structured-macro ac:name="unknown-app-macro" ac:schema-version="1" ac:macro-id="u1">' +
      '<ac:parameter ac:name="sql">SELECT 1</ac:parameter></ac:structured-macro>';
    const r = roundTripStorage(storage);
    expect(r.diffs).toEqual([]);
    expect(r.equal).toBe(true);
    expect(r.images).toEqual(['chart.png']);
    expect(r.stats.fenced).toBe(0);
  });

  it('round-trips a code macro through a fenced body', () => {
    const storage =
      '<ac:structured-macro ac:name="code" ac:schema-version="1" ac:macro-id="c1">' +
      '<ac:parameter ac:name="language">sql</ac:parameter>' +
      '<ac:plain-text-body><![CDATA[SELECT *\nFROM t]]></ac:plain-text-body></ac:structured-macro>';
    const r = roundTripStorage(storage);
    expect(r.diffs).toEqual([]);
    expect(r.markdown).toContain('```\nSELECT *\nFROM t\n```');
  });
});
