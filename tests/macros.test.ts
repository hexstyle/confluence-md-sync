import { describe, expect, it, vi } from 'vitest';
import {
  MacroRegistry,
  createDefaultRegistry,
  extractPlainText,
  macro,
  macros,
  processMacros,
  structuredMacro,
  type MacroPlugin,
} from '../src/macros/index.js';

const registry = createDefaultRegistry();

describe('MacroBuilder', () => {
  it('builds start/end markers with params', () => {
    const md = macro('expand').param('title', 'Details').body('inner').toMarkdown().toString();
    expect(md).toBe('<!-- MACRO:start:expand:title=Details -->\ninner\n<!-- MACRO:end:expand -->');
  });

  it('escapes = and : in param values', () => {
    const md = macro('x').param('a', 'k=v:z').toMarkdown().toString();
    expect(md).toContain('a=k%3Dv%3Az');
  });
});

describe('processMacros', () => {
  it('renders expand with title', () => {
    const input = '<!-- MACRO:start:expand:title=Детали -->\n<p>body</p>\n<!-- MACRO:end:expand -->';
    const out = processMacros(input, registry).toString();
    expect(out).toContain('ac:name="expand"');
    expect(out).toContain('<ac:parameter ac:name="title">Детали</ac:parameter>');
    expect(out).toContain('<ac:rich-text-body><p>body</p></ac:rich-text-body>');
  });

  it('handles params with dashes in names (cell-width)', () => {
    const md = macros.tableFilter('<p>t</p>', {}).toString();
    const out = processMacros(md, registry).toString();
    expect(out).toContain('ac:name="table-filter"');
    expect(out).toContain('<ac:parameter ac:name="cell-width"></ac:parameter>');
    expect(out).toContain('<ac:parameter ac:name="hidePane">Table header</ac:parameter>');
  });

  it('renders nested macros inner-first', () => {
    const inner = macros.tableExcerpt('<p>table</p>', 'data', true);
    const outer = macros.tableFilter(inner, { totalrow: ',,Sum' });
    const out = processMacros(outer.toString(), registry).toString();
    const filterIdx = out.indexOf('ac:name="table-filter"');
    const excerptIdx = out.indexOf('ac:name="table-excerpt"');
    expect(filterIdx).toBeGreaterThanOrEqual(0);
    expect(excerptIdx).toBeGreaterThan(filterIdx);
    expect(out).not.toContain('MACRO:start');
  });

  it('warns and throws on unclosed macro', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = '<!-- MACRO:start:expand -->\nno end';
    expect(() => processMacros(input, registry)).toThrow(/mismatched macro markers/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('supports custom plugins', () => {
    const plugin: MacroPlugin = {
      name: 'custom',
      macros: [
        {
          name: 'my-macro',
          render: (ctx) => structuredMacro('my-macro', ctx.macroId, { richBody: ctx.body }),
        },
      ],
    };
    const reg = new MacroRegistry().use(plugin);
    const out = processMacros(
      '<!-- MACRO:start:my-macro -->\n<p>x</p>\n<!-- MACRO:end:my-macro -->',
      reg,
    ).toString();
    expect(out).toContain('ac:name="my-macro"');
    expect(reg.plugins).toEqual(['custom']);
  });

  it('renders bodyless status macro', () => {
    const md = macros.status('Green', 'ON TRACK').toString();
    const out = processMacros(md, registry).toString();
    expect(out).toContain('ac:name="status"');
    expect(out).toContain('<ac:parameter ac:name="colour">Green</ac:parameter>');
    expect(out).not.toContain('rich-text-body');
  });

  it('renders code macro body as CDATA', () => {
    const md = macros.codeBlock('if (a < b) { return "x"; }', { language: 'ts' }).toString();
    // Имитация markdown-it: fenced block → <pre><code>
    const rendered = md.replace(
      /```\n([\s\S]*?)\n```/,
      (_m, src: string) =>
        `<pre><code>${src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}\n</code></pre>`,
    );
    const out = processMacros(rendered, registry).toString();
    expect(out).toContain('<ac:plain-text-body><![CDATA[if (a < b) { return "x"; }]]></ac:plain-text-body>');
    expect(out).toContain('<ac:parameter ac:name="language">ts</ac:parameter>');
  });

  it('renders include macro with page link in unnamed param', () => {
    const md = macros.includePage('Target Page', 'DOCS').toString();
    const out = processMacros(md, registry).toString();
    expect(out).toContain('<ac:parameter ac:name=""><ac:link><ri:page ri:content-title="Target Page" ri:space-key="DOCS"/></ac:link></ac:parameter>');
  });
});

describe('structuredMacro', () => {
  it('splits CDATA end sequence in plain body', () => {
    const out = structuredMacro('code', 'id', { plainBody: 'a]]>b' });
    expect(out).toContain('a]]]]><![CDATA[>b');
  });

  it('escapes param values', () => {
    const out = structuredMacro('x', 'id', { params: [{ name: 'title', value: 'a<b&"c"' }] });
    expect(out).toContain('a&lt;b&amp;&quot;c&quot;');
  });
});

describe('extractPlainText', () => {
  it('unwraps pre/code and decodes entities', () => {
    expect(extractPlainText('<pre><code>a &lt; b &amp;&amp; c\n</code></pre>')).toBe('a < b && c');
  });

  it('unwraps paragraph fallback', () => {
    expect(extractPlainText('<p>plain &quot;text&quot;</p>')).toBe('plain "text"');
  });
});
