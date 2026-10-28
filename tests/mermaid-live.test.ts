import { expect, it } from 'vitest';
import { flowchart } from '@react-markdown-kit/mermaid';
import { ConfluenceClient, publishPage, storageToMarkdown, readMermaidSources } from '../src/index.js';
import { mermaidFence } from '../src/markdown/mermaid.js';

const baseUrl = process.env.CONFLUENCE_TEST_BASE_URL, token = process.env.CONFLUENCE_TEST_TOKEN;
const parentId = process.env.CONFLUENCE_TEST_PARENT_ID, spaceKey = process.env.CONFLUENCE_TEST_SPACE_KEY;
it.skipIf(!baseUrl || !token || !parentId || !spaceKey)('publishes three Mermaid kinds and preserves source, layout, page and attachment versions through import', async () => {
  const cfg = { baseUrl: baseUrl!, token: token! }, client = new ConfluenceClient(cfg), kind = flowchart();
  const parsed = kind.parse('flowchart LR\n    A[Start] --> B[End]');
  if ('error' in parsed) throw new Error(parsed.error);
  const model = { ...parsed.model, canvasHeight: 400, shapes: parsed.model.shapes.map(shape => shape.id === 'A' ? { ...shape, x: 150, y: 180 } : shape) };
  const flow = kind.write!(model, { retained: parsed.retained });
  const markdown = [flow, 'sequenceDiagram\nUser->>Service: Request', 'stateDiagram-v2\nPending --> Ready: Complete'].map(source => mermaidFence(source)).join('\n\n') + '\n';
  const page = await client.createPage({ spaceKey: spaceKey!, parentId, title: 'Markdown Mermaid regression ' + Date.now() });
  try {
    const first = await publishPage({ pageId: page.id, markdown }, cfg);
    expect(first.attachments).toHaveLength(3);
    for (let cycle = 0; cycle < 3; cycle++) {
      const stored = await client.getPageStorage(page.id), sources = await readMermaidSources(client, page.id, stored.storage);
      const imported = storageToMarkdown(stored.storage, { mermaidSources: sources });
      expect(imported.markdown.match(/```mermaid/g)).toHaveLength(3); expect(imported.markdown).toContain('%% rmk-layout v1');
      const result = await publishPage({ pageId: page.id, markdown: imported.markdown }, cfg);
      expect(result.updated).toBe(false); expect(result.version).toBe(first.version);
      expect(result.attachments.every(attachment => attachment.reused)).toBe(true);
    }
  } finally { await client.deletePage(page.id); }
}, 120_000);
