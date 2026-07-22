/**
 * Экспорт страницы Confluence в комплект «markdown + аттачи», пригодный
 * для обратной публикации через publishPage (render-стиль 'attachment').
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfluenceClient } from '../client/client.js';
import type { ConfluenceConfig } from '../client/config.js';
import type { MacroRegistry } from '../macros/registry.js';
import { storageToMarkdown, type StorageToMarkdownResult } from './to-markdown.js';

export interface ExportPageOptions {
  /** Куда писать page.md и attachments/. */
  outDir: string;
  /** Скачивать ли аттачи, на которые ссылается страница. Default: true. */
  downloadAttachments?: boolean;
  registry?: MacroRegistry;
}

export interface ExportPageResult extends StorageToMarkdownResult {
  pageId: string;
  title: string;
  version: number;
  markdownPath: string;
  /** Скачанные файлы: имя аттача → локальный путь. */
  downloaded: Map<string, string>;
}

export async function exportPage(
  pageId: string,
  opts: ExportPageOptions,
  cfg: ConfluenceConfig,
): Promise<ExportPageResult> {
  const client = new ConfluenceClient(cfg);
  const page = await client.getPageStorage(pageId);
  const converted = storageToMarkdown(page.storage, { registry: opts.registry });

  mkdirSync(opts.outDir, { recursive: true });
  const markdownPath = join(opts.outDir, 'page.md');
  writeFileSync(markdownPath, converted.markdown);

  const downloaded = new Map<string, string>();
  if (opts.downloadAttachments !== false && converted.attachmentRefs.length > 0) {
    const dir = join(opts.outDir, 'attachments');
    mkdirSync(dir, { recursive: true });
    for (const name of converted.attachmentRefs) {
      const [att] = await client.listAttachments(pageId, name);
      if (att === undefined) {
        console.warn(`[export] attachment '${name}' referenced by the page but not found`);
        continue;
      }
      const link = att._links?.download ?? `/download/attachments/${pageId}/${encodeURIComponent(name)}`;
      const data = await client.downloadAttachment(link);
      const path = join(dir, name);
      writeFileSync(path, data);
      downloaded.set(name, path);
    }
  }

  return {
    ...converted,
    pageId,
    title: page.title,
    version: page.version,
    markdownPath,
    downloaded,
  };
}
