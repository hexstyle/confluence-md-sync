import { describe, expect, it, vi } from 'vitest';
import { compareStorage, macros, nativeMacroList, nativeToMarkers, processMacros, defaultMacroRegistry, renderExportedMarkdown, resolveUserMentions, storageToMarkdown } from '../src/index.js';
import { placeholder } from '../src/markdown/placeholder.js';

describe('Confluence user mentions', () => {
  it.each(['username', 'userkey', 'account-id'] as const)('renders and imports %s with an explicit identity type', type => {
    const source = placeholder('user', 'jdoe', [['type', type], ['text', 'Иван']]);
    const storage = renderExportedMarkdown(source);
    expect(storage).toContain(`<ac:link><ri:user ri:${type}="jdoe" />`);
    expect(storage).toContain('<ac:plain-text-link-body><![CDATA[Иван]]></ac:plain-text-link-body>');
    expect(storage).not.toContain('ac:structured-macro');
    const imported = storageToMarkdown(storage).markdown;
    expect(imported.trim()).toBe(source);
    expect(compareStorage(storage, renderExportedMarkdown(imported)).equal).toBe(true);
  });

  it('defaults to username and produces the same storage through native markers and builders', () => {
    const expected = renderExportedMarkdown('{{user:jdoe|type=username}}');
    expect(renderExportedMarkdown('{{user:jdoe}}')).toBe(expected);
    expect(processMacros(nativeToMarkers('{{user:jdoe}}'), defaultMacroRegistry).toString()).toBe(expected.trim().replace(/^<p>|<\/p>$/g, ''));
    expect(renderExportedMarkdown(macros.user('jdoe').toString()).trim()).toBe(expected.trim().replace(/^<p>|<\/p>$/g, ''));
    expect(macros.user('acc', { text: 'Иван', type: 'account-id' }).toString()).toBe(macros.user('acc', { type: 'account-id', text: 'Иван' }).toString());
    expect(nativeMacroList().find(item => item.macro === 'user')?.syntax).toContain('type=username');
  });

  it('escapes XML identities and quoted labels including split CDATA and table delimiters', () => {
    const identity = 'a"&<b', text = 'Иван | {текст}: "]]><test>"\nследующий';
    const source = placeholder('user', identity, [['text', text], ['type', 'account-id']]);
    const storage = renderExportedMarkdown(source);
    expect(storage).toContain('ri:account-id="a&quot;&amp;&lt;b"');
    expect(storage).toContain(']]]]><![CDATA[>');
    const imported = storageToMarkdown(storage);
    expect(imported.stats.fenced).toBe(0);
    expect(compareStorage(storage, renderExportedMarkdown(imported.markdown)).equal).toBe(true);
    const table = renderExportedMarkdown('| Owner |\n| --- |\n| ' + source.replace(/\|/g, '\\|') + ' |');
    expect(table.match(/<td>/g)).toHaveLength(1);
    expect(compareStorage(table, renderExportedMarkdown(storageToMarkdown(table).markdown)).equal).toBe(true);
  });

  it('preserves unknown attributes and complex link bodies through faithful fallback', () => {
    for (const link of [
      '<ac:link><ri:user ri:userkey="key" ri:custom="keep" /></ac:link>',
      '<ac:link ac:card-appearance="inline"><ri:user ri:userkey="key" /></ac:link>',
      '<ac:link><ri:user ri:userkey="key" /><ac:link-body><strong>Иван</strong></ac:link-body></ac:link>',
      '<ac:link><ri:user ri:userkey="key" /><ac:plain-text-link-body custom="keep"><![CDATA[Иван]]></ac:plain-text-link-body></ac:link>',
    ]) {
      const source = '<p>' + link + '</p>', imported = storageToMarkdown(source);
      expect(imported.markdown).toContain('confluence-storage');
      expect(compareStorage(source, renderExportedMarkdown(imported.markdown)).equal).toBe(true);
    }
  });

  it('keeps code examples literal and rejects an empty identity or unknown type', () => {
    expect(renderExportedMarkdown('`{{user:jdoe}}`\n\n```\n{{user:jdoe}}\n```')).not.toContain('<ri:user');
    expect(() => renderExportedMarkdown('{{user:jdoe|type=invalid}}')).toThrow('identity type');
    expect(() => renderExportedMarkdown('{{user:}}')).toThrow('identity is required');
  });
});

describe('target-side user resolution', () => {
  const cfg = { baseUrl: 'https://target.test', token: 'test-only' };
  it('looks up each login once per publication and retains labels and unknown attributes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ userKey: 'key<&' }));
    try {
      const source = '<p><ac:link><ri:user ri:username="a&amp;b" ri:custom="keep" /></ac:link><ac:link><ri:user ri:username="a&amp;b" /><ac:plain-text-link-body><![CDATA[Иван]]></ac:plain-text-link-body></ac:link></p>';
      const result = await resolveUserMentions(source, cfg);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('https://target.test/rest/api/user?username=a%26b');
      expect(result.match(/ri:userkey="key&lt;&amp;"/g)).toHaveLength(2);
      expect(result).toContain('ri:custom="keep"'); expect(result).toContain('<![CDATA[Иван]]>');
    } finally { fetch.mockRestore(); }
  });
  it('leaves keys, account IDs and code examples unchanged without a lookup', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const storage = renderExportedMarkdown('{{user:key|type=userkey}} {{user:acc|type=account-id}} `{{user:example}}`');
      expect(await resolveUserMentions(storage, cfg)).toBe(storage); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('fails on lookup errors and supports a returned Cloud account ID', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const storage = renderExportedMarkdown('{{user:jdoe}}');
      fetch.mockResolvedValue(Response.json({ accountId: 'cloud-account' }));
      expect(await resolveUserMentions(storage, cfg)).toContain('ri:account-id="cloud-account"');
      fetch.mockResolvedValue(new Response('private upstream diagnostics', { status: 403 }));
      await expect(resolveUserMentions(storage, cfg)).rejects.toThrow('Confluence user lookup failed (HTTP 403)');
      fetch.mockResolvedValue(Response.json({}));
      await expect(resolveUserMentions(storage, cfg)).rejects.toThrow('no user key or account ID');
    } finally { fetch.mockRestore(); }
  });
});
