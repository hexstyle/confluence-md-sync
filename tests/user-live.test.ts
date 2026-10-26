import { expect, it } from 'vitest';
import { authHeader, ConfluenceClient, publishPage, renderExportedMarkdown, resolveUserMentions, storageToMarkdown } from '../src/index.js';

const baseUrl = process.env.CONFLUENCE_TEST_BASE_URL, token = process.env.CONFLUENCE_TEST_TOKEN;
const parentId = process.env.CONFLUENCE_TEST_PARENT_ID, spaceKey = process.env.CONFLUENCE_TEST_SPACE_KEY;
it.skipIf(!baseUrl || !token || !parentId || !spaceKey)('publishes a live self-mention and imports it three times without a new version', async () => {
  const cfg = { baseUrl: baseUrl!, token: token! }, client = new ConfluenceClient(cfg);
  const response = await fetch(`${baseUrl}/rest/api/user/current`, { headers: { Authorization: authHeader(cfg) } });
  expect(response.ok).toBe(true);
  const actor = await response.json() as { username: string; userKey: string };
  expect(actor.username).toBeTruthy(); expect(actor.userKey).toBeTruthy();
  const markdown = `Owner: {{user:${actor.username}}}\n\n| Owner |\n| --- |\n| {{user:${actor.userKey}\\|type=userkey\\|text=System test}} |`;
  const storage = await resolveUserMentions(renderExportedMarkdown(markdown), cfg);
  const preview = await fetch(`${baseUrl}/rest/api/contentbody/convert/view`, {
    method: 'POST', headers: { Authorization: authHeader(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: storage, representation: 'storage' }),
  });
  expect(preview.ok).toBe(true);
  const html = (await preview.json() as { value: string }).value;
  expect(html).toContain('confluence-userlink'); expect(html).not.toContain('{{user:');
  const page = await client.createPage({ spaceKey: spaceKey!, parentId, title: 'Markdown mention regression ' + Date.now() });
  try {
    const first = await publishPage({ pageId: page.id, markdown }, cfg);
    expect((await publishPage({ pageId: page.id, markdown }, cfg)).updated).toBe(false);
    for (let cycle = 0; cycle < 3; cycle++) {
      const imported = storageToMarkdown((await client.getPageStorage(page.id)).storage).markdown;
      expect(imported).toContain('type=userkey');
      const result = await publishPage({ pageId: page.id, markdown: imported }, cfg);
      expect(result.updated).toBe(false); expect(result.version).toBe(first.version);
    }
  } finally { await client.deletePage(page.id); }
}, 120_000);
