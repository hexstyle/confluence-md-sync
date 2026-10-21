import { describe, expect, it, vi } from 'vitest';
import { renderExportedMarkdown, resolveJiraMacros, storageToMarkdown } from '../src/index.js';
const cfg = { baseUrl: 'https://target.test', token: 'test-only' };

describe('portable Jira macros', () => {
  it('strips only environment parameters, including Jira nested in a table Note', () => {
    const source = '<table><thead><tr><th>Task</th></tr></thead><tbody><tr><td><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">DR-96</ac:parameter><ac:parameter ac:name="server">Old</ac:parameter><ac:parameter ac:name="serverId">old-id</ac:parameter><ac:parameter ac:name="columns">key,summary</ac:parameter></ac:structured-macro></td></tr></tbody></table>';
    const md = storageToMarkdown(source).markdown;
    expect(md).not.toMatch(/serverId|server=/); expect(md).toContain('columns=key,summary');
    expect(md).toContain('DR-96'); expect(storageToMarkdown(renderExportedMarkdown(md)).markdown).toBe(md);
  });
  it('resolves the selected target server once for every Jira macro and keeps code literal', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([{ id: 'other', name: 'Other' }, { id: 'primary', name: 'Target', selected: true }]));
    try {
      const md = '{{jira:DR-96}}\n\n{{note:Task {{jira:DR-97}}}}\n\n```text\n{{jira:EXAMPLE-1}}\n```';
      const storage = await resolveJiraMacros(renderExportedMarkdown(md), cfg);
      expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('https://target.test/rest/jiraanywhere/1.0/servers');
      expect(storage.match(/ac:name="serverId">primary/g)).toHaveLength(2);
      expect(storageToMarkdown(storage).markdown).not.toMatch(/serverId|server=/);
      expect(storage).toContain('{{jira:EXAMPLE-1}}');
    } finally { fetch.mockRestore(); }
  });
  it('does not query Jira configuration for unrelated pages', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try { expect(await resolveJiraMacros('<p>Plain</p>', cfg)).toBe('<p>Plain</p>'); expect(fetch).not.toHaveBeenCalled(); }
    finally { fetch.mockRestore(); }
  });
  it('never chooses an arbitrary server or silently ignores missing access', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      for (const servers of [[], [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]]) {
        fetch.mockResolvedValue(Response.json(servers));
        await expect(resolveJiraMacros(renderExportedMarkdown('{{jira:DR-96}}'), cfg)).rejects.toThrow('default Jira connection');
      }
      fetch.mockResolvedValue(new Response('', { status: 403 }));
      await expect(resolveJiraMacros(renderExportedMarkdown('{{jira:DR-96}}'), cfg)).rejects.toThrow('getJiraServers: 403');
    } finally { fetch.mockRestore(); }
  });
});
