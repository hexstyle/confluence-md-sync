import MarkdownIt from 'markdown-it';
import { parsePlaceholder } from './render.js';
import { structurizrPreview } from '../macros/plugins/structurizr.js';

export function structurizrReferences(markdown: string): { name: string; json: string; preview: string }[] {
  const refs: { name: string; json: string; preview: string }[] = [];
  for (const token of new MarkdownIt().parse(markdown, {})) for (const child of token.children ?? []) {
    if (child.type !== 'text') continue;
    for (const match of child.content.matchAll(/\{\{structurizr:([^}]+)\}\}/g)) {
      const { name, attrs } = parsePlaceholder(match[1]);
      refs.push({ name, json: name.replace(/\.dsl$/, '.json'), preview: structurizrPreview(name, Object.fromEntries(attrs).view) });
    }
  }
  return refs;
}
