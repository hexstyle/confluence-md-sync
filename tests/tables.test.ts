import { describe, expect, it } from 'vitest';
import {
  decodeHtmlCell,
  escapeMdTableCell,
  findTable,
  findTableInMacro,
  parseHtmlTable,
  renderMarkdownTable,
} from '../src/pages/tables.js';
import { Table } from '../src/pages/page.js';

const STORAGE = `
<p>intro</p>
<table><tbody>
<tr><th>Имя</th><th>Часы</th></tr>
<tr><td>Иванов &amp; Ко</td><td>8.5</td></tr>
</tbody></table>
<ac:structured-macro ac:name="table-excerpt" ac:schema-version="1" ac:macro-id="x">
<ac:parameter ac:name="name">named_data</ac:parameter>
<ac:rich-text-body>
<table><tbody>
<tr><th>K</th><th>V</th></tr>
<tr><td>a</td><td>1</td></tr>
</tbody></table>
</ac:rich-text-body>
</ac:structured-macro>
`;

describe('findTable / parseHtmlTable', () => {
  it('finds table by index and decodes cells', () => {
    const t = findTable(STORAGE, 0);
    expect(t).toEqual([
      ['Имя', 'Часы'],
      ['Иванов & Ко', '8.5'],
    ]);
  });

  it('returns null for out-of-range index', () => {
    expect(findTable(STORAGE, 5)).toBeNull();
  });

  it('finds table inside a named table-excerpt macro', () => {
    const t = findTableInMacro(STORAGE, 'named_data');
    expect(t).toEqual([
      ['K', 'V'],
      ['a', '1'],
    ]);
  });

  it('returns null for unknown macro name', () => {
    expect(findTableInMacro(STORAGE, 'nope')).toBeNull();
  });

  it('parseHtmlTable handles th and td', () => {
    const rows = parseHtmlTable('<tr><th>h</th></tr><tr><td>d<br/>x</td></tr>');
    expect(rows).toEqual([['h'], ['d x']]);
  });
});

describe('decodeHtmlCell', () => {
  it('decodes entities in correct order', () => {
    expect(decodeHtmlCell('&amp;lt;')).toBe('&lt;');
    expect(decodeHtmlCell('<b>a&nbsp;&gt;&quot;b&quot;</b>')).toBe('a >"b"');
  });
});

describe('renderMarkdownTable', () => {
  interface Row { name: string; hours: number }
  const cols = [
    { header: 'Имя', cell: (r: Row) => r.name },
    { header: 'Часы', cell: (r: Row) => r.hours.toFixed(2), align: 'right' as const },
  ];

  it('renders header, alignment separator and rows', () => {
    const md = renderMarkdownTable<Row>([{ name: 'a|b', hours: 1 }], cols).toString();
    expect(md).toBe('| Имя | Часы |\n| --- | ---: |\n| a\\|b | 1.00 |');
  });

  it('returns placeholder for empty data', () => {
    expect(renderMarkdownTable<Row>([], cols).toString()).toBe('_(нет данных)_');
  });

  it('throws on empty columns', () => {
    expect(() => renderMarkdownTable([{}], [])).toThrow();
  });
});

describe('Table', () => {
  const table = new Table([
    ['A', 'B', 'a'],
    ['1', '2', '3'],
  ]);

  it('maps rows to objects with dedup of duplicate headers', () => {
    expect(table.toAny()).toEqual([{ A: '1', B: '2', 'a (2)': '3' }]);
  });

  it('maps to typed objects', () => {
    const rows = table.toType<{ a: string }>((row, r) => {
      r.a = row.A;
    });
    expect(rows).toEqual([{ a: '1' }]);
  });

  it('exposes counts and headers', () => {
    expect(table.rowCount).toBe(2);
    expect(table.columnCount).toBe(3);
    expect(table.getHeaders()).toEqual(['A', 'B', 'a']);
  });

  it('round-trips to markdown', () => {
    expect(table.toMarkdown().toString()).toContain('| A | B | a |');
  });
});

describe('escapeMdTableCell', () => {
  it('escapes pipes and newlines', () => {
    expect(escapeMdTableCell('a|b\nc')).toBe('a\\|b c');
  });
});
