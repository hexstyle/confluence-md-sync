import { expect, it } from 'vitest';
import { ConfluenceClient, publishPage, storageToMarkdown } from '../src/index.js';

const baseUrl = process.env.CONFLUENCE_TEST_BASE_URL, token = process.env.CONFLUENCE_TEST_TOKEN;
const parentId = process.env.CONFLUENCE_TEST_PARENT_ID, spaceKey = process.env.CONFLUENCE_TEST_SPACE_KEY;
it.skipIf(!baseUrl || !token || !parentId || !spaceKey)('keeps properties stable through three real Confluence publication/import cycles', async () => {
  const cfg = { baseUrl: baseUrl!, token: token! }, client = new ConfluenceClient(cfg);
  const page = await client.createPage({ spaceKey: spaceKey!, parentId, title: 'Markdown properties regression ' + Date.now() });
  try {
    const markdown = '::: properties\n| Поле | Значение |\n| --- | --- |\n| Поле | Значение |\n| Код | DS_IMPORT_TEST |\n:::\n';
    const first = await publishPage({ pageId: page.id, markdown }, cfg);
    let baseline: string | undefined;
    for (let cycle = 0; cycle < 3; cycle++) {
      const source = await client.getPageStorage(page.id), converted = storageToMarkdown(source.storage).markdown;
      expect(converted.match(/\| Поле \| Значение \|/g)).toHaveLength(1);
      if (baseline !== undefined) expect(converted).toBe(baseline);
      baseline = converted;
      const result = await publishPage({ pageId: page.id, markdown: converted }, cfg);
      expect(result.updated).toBe(false); expect(result.version).toBe(first.version);
    }
  } finally { await client.deletePage(page.id); }
}, 120_000);
