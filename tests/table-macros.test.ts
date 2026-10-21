import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { storageToMarkdown, renderExportedMarkdown, compareStorage, canonicalize, parseStorage, type XNode } from '../src/index.js';

const table = '<table class="wrapped" style="width:90%"><colgroup><col style="width:30%"/></colgroup><tbody><tr><th>Name</th><th>Value</th></tr><tr><td><div><p><span style="color:red">Alice</span></p></div></td><td>10</td></tr></tbody></table>';
const macro = (name: string, body = '', params: Record<string, string> = {}) => `<ac:structured-macro ac:name="${name}">${Object.entries(params).map(([key, value]) => `<ac:parameter ac:name="${key}">${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</ac:parameter>`).join('')}${body ? `<ac:rich-text-body>${body}</ac:rich-text-body>` : ''}</ac:structured-macro>`;

describe('editable table macros', () => {
  it('keeps nested SQL, parameters, table data and source includes as native syntax', () => {
    const include = '<ac:structured-macro ac:name="table-excerpt-include"><ac:parameter ac:name="name">staff</ac:parameter><ac:parameter ac:name="page"><ac:link><ri:page ri:content-title="People" ri:space-key="HR"/></ac:link></ac:parameter><ac:parameter ac:name="type">page</ac:parameter><ac:parameter ac:name="v">2</ac:parameter></ac:structured-macro>';
    const sql = 'SELECT T1."Name", "a|b:{x}"\nFROM T1 LEFT JOIN T2 ON T1.Name=T2.Name';
    const source = macro('table-filter', macro('table-excerpt', macro('table-joiner', table + include, { sql, 'show-source': 'all', empty: '' }), { name: 'plan', hide: 'false' }), { worklog: '365|5|8', rowsPerPage: '20', empty: '' });
    const result = storageToMarkdown(source);
    expect(result.stats.fenced).toBe(0); expect(result.stats.markers).toBe(0);
    for (const name of ['table-filter', 'table-excerpt', 'table-joiner']) expect(result.markdown).toContain('::: ' + name);
    expect(result.markdown).toContain('sql=' + JSON.stringify(sql));
    expect(result.markdown).toContain('| Alice | 10 |');
    expect(result.markdown).toContain('{{table-excerpt-include:');
    expect(result.markdown).toContain('page=People'); expect(result.markdown).toContain('space=HR');
    expect(result.stats.normalized).toBeGreaterThan(0);
    const rendered = renderExportedMarkdown(result.markdown);
    expect(rendered).toContain('ri:space-key="HR"'); expect(rendered).toContain('<ac:parameter ac:name="empty"></ac:parameter>');
    const repeated = storageToMarkdown(rendered);
    expect(compareStorage(rendered, renderExportedMarkdown(repeated.markdown)).equal).toBe(true);
  });

  it('keeps user mentions in editable table cells and preserves their identity', () => {
    const source = macro('table-excerpt', table.replace('10</td>', '<ac:link><ri:user ri:userkey="user-123" /></ac:link></td>'), { name: 'staff' });
    const result = storageToMarkdown(source);
    expect(result.stats.fenced).toBe(0); expect(result.markdown).toContain('{{user:user-123\\|type=userkey}}');
    expect(renderExportedMarkdown(result.markdown)).toContain('<ri:user ri:userkey="user-123"');
  });

  it('supports the same container nested twice and leaves code examples intact', () => {
    const markdown = '::: table-excerpt name="outer"\n::: table-excerpt name="inner"\n| A | B |\n| --- | --- |\n| x | y |\n:::\n:::\n\n```text\n::: table-joiner sql="example"\n::: \n```';
    const storage = renderExportedMarkdown(markdown);
    expect(storage.match(/ac:name="table-excerpt"/g)).toHaveLength(2);
    expect(storage).toContain('::: table-joiner');
    expect(storageToMarkdown(storage).markdown).toContain('name="inner"');
  });

  it('keeps unknown structured parameters faithful instead of discarding them', () => {
    const source = macro('table-filter', table).replace('<ac:rich-text-body>', '<ac:parameter ac:name="custom"><ri:page ri:content-title="Other"/></ac:parameter><ac:rich-text-body>');
    const result = storageToMarkdown(source);
    expect(result.markdown).toContain('ri:content-title="Other"');
    expect(compareStorage(source, renderExportedMarkdown(result.markdown)).equal).toBe(true);
  });

  it('supports numeric parameter names in reports without falling back to storage', () => {
    const source = macro('detailssummary', '', { pageSize: '3000', cql: 'label = "system-card" and space = "RIS"', id: 'Info' });
    const result = storageToMarkdown(source);
    expect(result.markdown).toContain('{{properties-report:');
    expect(compareStorage(source, renderExportedMarkdown(result.markdown)).equal).toBe(true);
  });
});

if (process.env.CONFLUENCE_MACRO_FIXTURES) it('converts real ORP, vacations and specialists without opaque macros or lost parameters', () => {
  const signatures = (nodes: XNode[]) => {
    const result: unknown[] = [];
    const walk = (ns: XNode[]) => { for (const node of ns) if (node.kind === 'el') {
      if (node.name === 'ac:structured-macro') {
        const params = node.children.filter(n => n.kind === 'el' && n.name === 'ac:parameter');
        const name = Object.fromEntries(node.attrs)['ac:name'];
        if (name !== 'info') result.push(canonicalize([{ ...node, children: params }]));
      }
      walk(node.children);
    } }; walk(nodes); return result;
  };
  for (const id of ['409373667', '427871983', '367861052']) {
    const source = readFileSync(`${process.env.CONFLUENCE_MACRO_FIXTURES}/docs-studio-macro-storage-${id}.xml`, 'utf8');
    const result = storageToMarkdown(source);
    expect(result.stats.fenced).toBe(0); expect(result.stats.markers).toBe(0);
    expect(result.markdown).toContain('|'); expect(result.markdown).toContain('::: table-');
    const rendered = renderExportedMarkdown(result.markdown);
    // Canonical parameter comparison ignores formatting and attribute order, including structured page references.
    const sourceParams = signatures(parseStorage(source)), backParams = signatures(parseStorage(rendered));
    expect(backParams).toEqual(sourceParams);
    expect(rendered).toContain('ac:parameter');
    const repeated = storageToMarkdown(rendered);
    expect(compareStorage(rendered, renderExportedMarkdown(repeated.markdown)).equal).toBe(true);
  }
});
