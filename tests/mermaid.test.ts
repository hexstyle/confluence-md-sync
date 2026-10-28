import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowchart, type DrawingData } from '@react-markdown-kit/mermaid';
import { renderExportedMarkdown, storageToMarkdown } from '../src/index.js';
import { mermaidSources, convertMermaid, saveMermaidSources, readMermaidSources } from '../src/publish/mermaid.js';
import type { ConfluenceClient } from '../src/index.js';
import { mermaidFence } from '../src/markdown/mermaid.js';
import { mermaidCanvasKind, renderMermaidCanvasSvg } from '../src/mermaid.js';

const source = 'flowchart LR\n    A[Начало] --> B[Конец]';
describe('inline Mermaid diagrams', () => {
  it('renders a native Confluence image and restores the fenced source, including layout', () => {
    const kind = flowchart(), parsed = kind.parse(source);
    if ('error' in parsed) throw new Error(parsed.error);
    const model = parsed.model as DrawingData;
    const node = model.shapes.find(shape => shape.type === 'rect')!;
    const moved = kind.write!({ ...model, shapes: model.shapes.map(shape => shape.id === node.id ? { ...shape, x: 80, y: 160 } : shape) }, { retained: parsed.retained });
    expect(moved).toContain('%% rmk-layout v1');
    const md = '# Diagram\n\n' + mermaidFence(moved) + '\n\nAfter.\n';
    const storage = renderExportedMarkdown(md), sources = mermaidSources(md);
    expect(storage).toContain('<ac:image'); expect(storage).toMatch(/ri:filename="mermaid-[a-f0-9]{24}\.png"/);
    expect(storage).not.toContain('<pre>'); expect(storage).not.toContain('ac:name="mermaid"');
    const imported = storageToMarkdown(storage, { mermaidSources: sources });
    expect(imported.markdown).toBe(md); expect(imported.images).toEqual([]); expect(imported.attachmentRefs).toEqual([]);
    expect(renderExportedMarkdown(imported.markdown)).toBe(storage);
    expect(renderMermaidCanvasSvg(moved)).toContain('y="160"');
  });
  it('leaves code examples literal and supports several, nested, and identical diagrams', () => {
    const example = '````markdown\n```mermaid\n' + source + '\n```\n````';
    expect(mermaidSources(example)).toEqual({}); expect(renderExportedMarkdown(example)).not.toContain('<ac:image');
    const md = mermaidFence(source) + '\n\n' + mermaidFence(source) + '\n\n> ' + mermaidFence('sequenceDiagram\nA->>B: Hello').replace(/\n/g, '\n> ');
    expect(Object.keys(mermaidSources(md))).toHaveLength(2);
    expect(renderExportedMarkdown(md).match(/<ac:image/g)).toHaveLength(3);
  });
  it('keeps independent formatting on repeated diagrams and restores Confluence image links', () => {
    const markdown = mermaidFence(source, 'mermaid width=400') + '\n\n' + mermaidFence(source, 'mermaid display=link') + '\n\n' + mermaidFence(source, 'mermaid link="https://example.test/?a=1&b=2" title="Caption"');
    const storage = renderExportedMarkdown(markdown), sources = mermaidSources(markdown);
    expect(storage).toContain('ac:width="400"'); expect(storage).toContain('<ac:link>');
    const imported = storageToMarkdown(storage, { mermaidSources: sources }).markdown;
    expect(imported).toContain('mermaid width="400"'); expect(imported).toContain('mermaid display="link"');
    expect(renderExportedMarkdown(imported)).toBe(storage);
  });
  it('imports existing plain-text Mermaid macros and preserves unsupported parameterized macros', () => {
    const macro = '<ac:structured-macro ac:name="mermaid"><ac:plain-text-body><![CDATA[' + source + ']]></ac:plain-text-body></ac:structured-macro>';
    expect(storageToMarkdown(macro).markdown).toBe(mermaidFence(source) + '\n');
    expect(storageToMarkdown(macro.replace('<ac:plain-text-body>', '<ac:parameter ac:name="custom">keep</ac:parameter><ac:plain-text-body>')).markdown).toContain('custom');
  });
  it('uses the canvas only when the parser preserves every feature and bounds large geometry', async () => {
    expect(mermaidCanvasKind(source)?.name).toBe('flowchart');
    expect(mermaidCanvasKind('sequenceDiagram\nA->>B: Hello')?.name).toBe('sequenceDiagram');
    expect(mermaidCanvasKind('stateDiagram-v2\nA --> B')).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 'mermaid-test-'));
    try {
      const files = await convertMermaid(mermaidSources(mermaidFence(source)), dir);
      expect(readFileSync(files[0]).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('compresses large source maps within the Confluence property limit and verifies recovered names', async () => {
    const large = source + '\n' + Array.from({ length: 1000 }, (_, index) => `    %% Annotation ${index} remains part of the editable source`).join('\n');
    const sources = mermaidSources(mermaidFence(large));
    let property: { value: unknown; version: number } | null = null;
    const client = {
      getContentProperty: async () => property,
      setContentProperty: async (_id: string, _key: string, value: unknown) => { property = { value, version: 1 }; },
    } as unknown as ConfluenceClient;
    await saveMermaidSources(client, '123', sources);
    expect(JSON.stringify(property)).toContain('gzip-base64'); expect(Buffer.byteLength(JSON.stringify(property))).toBeLessThan(30_000);
    const storage = renderExportedMarkdown(mermaidFence(large));
    expect(await readMermaidSources(client, '123', storage)).toEqual(sources);
  });
});
