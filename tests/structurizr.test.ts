import { it, expect } from 'vitest';
import { renderExportedMarkdown, storageToMarkdown, validateMarkdown } from '../src/index.js';
import { structurizrPreview } from '../src/macros/plugins/structurizr.js';

it('publishes a Structurizr view as a portable image and imports it as an editable object', () => {
  const md = '{{structurizr:architecture.dsl|view=containers}}';
  const preview = structurizrPreview('architecture.dsl', 'containers');
  const storage = renderExportedMarkdown(md);
  expect(storage).toContain(`ri:filename="${preview}"`);
  const result = storageToMarkdown(storage);
  expect(result.markdown.trim()).toBe(md);
  expect(result.files).toEqual(['architecture.dsl', 'architecture.json']);
  expect(result.images).toEqual([preview]);
  expect(() => validateMarkdown({ markdown: md, filePaths: ['architecture.dsl'], imagePaths: [preview] })).toThrow('architecture.json');
  expect(() => validateMarkdown({ markdown: md, filePaths: ['architecture.dsl', 'architecture.json'], imagePaths: [preview] })).not.toThrow();
});
it('does not interpret code examples, and rejects missing views and unsafe filenames', () => {
  expect(() => validateMarkdown({ markdown: '`{{structurizr:x.dsl|view=a}}`', filePaths: [], imagePaths: [] })).not.toThrow();
  expect(() => structurizrPreview('../x.dsl', 'a')).toThrow();
  expect(() => structurizrPreview('x.dsl', '')).toThrow();
});
