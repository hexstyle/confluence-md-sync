import { flowchart, sequenceDiagram, type DiagramKind } from '@react-markdown-kit/mermaid';
import { toHtml } from 'hast-util-to-html';

/** Same geometry for the interactive canvas, document preview and publication. */
export function mermaidCanvasKind(source: string): DiagramKind | undefined {
  const header = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').split('\n').find(line => line.trim() && !line.trim().startsWith('%%'))?.trim() ?? '';
  const kind = /^(flowchart|graph)\b/.test(header) ? flowchart() as DiagramKind : /^sequenceDiagram\b/.test(header) ? sequenceDiagram() as DiagramKind : undefined;
  if (!kind) return;
  const parsed = kind.parse(source);
  if ('error' in parsed || parsed.lossy.length || parsed.problems.length) return;
  return kind;
}

export function renderMermaidCanvasSvg(source: string): string | undefined {
  const kind = mermaidCanvasKind(source);
  if (!kind) return;
  const parsed = kind.parse(source);
  if ('error' in parsed) return;
  return toHtml(kind.render!(parsed.model, { fallbackTitle: 'Mermaid' }), { space: 'svg', closeSelfClosing: true });
}
