import { basename } from 'node:path';
import { extractPlaceholders } from './render.js';

export class MarkdownValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkdownValidationError';
  }
}

export interface ValidateOptions {
  markdown: string;
  imagePaths: string[];
  filePaths: string[];
  tableNames?: string[];
  sourceLabel?: string;
}

export function validateMarkdown(opts: ValidateOptions): void {
  const { images, files } = extractPlaceholders(opts.markdown);
  const tables = extractTablePlaceholders(opts.markdown);
  const providedImages = new Set(opts.imagePaths.map((p) => basename(p)));
  const providedFiles = new Set(opts.filePaths.map((p) => basename(p)));
  const providedTables = new Set(opts.tableNames ?? []);
  const label = opts.sourceLabel ? `${opts.sourceLabel}: ` : '';

  const errors: string[] = [];

  for (const name of images) {
    if (!providedImages.has(name)) {
      errors.push(`${label}image placeholder {{img:${name}}} has no matching file in images[]`);
    }
  }
  for (const name of files) {
    if (!providedFiles.has(name)) {
      errors.push(`${label}file placeholder {{file:${name}}} has no matching file in files[]`);
    }
  }
  for (const name of tables) {
    if (!providedTables.has(name)) {
      errors.push(`${label}table placeholder {{table:${name}}} has no matching table in tables[]`);
    }
  }

  const referencedImages = new Set(images);
  const referencedFiles = new Set(files);
  const referencedTables = new Set(tables);
  for (const name of providedImages) {
    if (!referencedImages.has(name)) {
      console.warn(`[validate] ${label}image '${name}' provided but not referenced by any {{img:...}} placeholder`);
    }
  }
  for (const name of providedFiles) {
    if (!referencedFiles.has(name)) {
      console.warn(`[validate] ${label}file '${name}' provided but not referenced by any {{file:...}} placeholder`);
    }
  }
  for (const name of providedTables) {
    if (!referencedTables.has(name)) {
      console.warn(`[validate] ${label}table '${name}' provided but not referenced by any {{table:...}} placeholder`);
    }
  }

  if (errors.length > 0) {
    throw new MarkdownValidationError(
      `Markdown validation failed:\n  - ${errors.join('\n  - ')}`,
    );
  }
}

function extractTablePlaceholders(markdown: string): string[] {
  const tables = new Set<string>();
  for (const m of markdown.matchAll(/\{\{table:([a-z0-9_-]+)\}\}/gi)) {
    tables.add(m[1].trim());
  }
  return [...tables];
}
