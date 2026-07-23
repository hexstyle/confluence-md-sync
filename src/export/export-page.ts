/**
 * Экспорт страницы Confluence в комплект «markdown + аттачи», пригодный
 * для обратной публикации через publishPage (render-стиль 'attachment').
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfluenceClient } from '../client/client.js';
import type { ConfluenceConfig } from '../client/config.js';
import type { MacroRegistry } from '../macros/registry.js';
import { storageToMarkdown, type StorageToMarkdownResult } from './to-markdown.js';

export interface ExportPageOptions {
  /**
   * Точный путь до итогового md-файла. Альтернатива `outDir`. Аттачи (если
   * включены) кладутся в `attachments/` рядом с этим файлом.
   */
  outFile?: string;
  /**
   * Каталог для `page.md` и `attachments/`. Используется, если не задан
   * `outFile`. Если не задан ни тот, ни другой — `./<pageId>`.
   */
  outDir?: string;
  /** Скачивать ли аттачи, на которые ссылается страница. Default: true. */
  downloadAttachments?: boolean;
  /**
   * 'faithful' (default) — round-trippable, с сырым HTML в fallback;
   * 'readable' — чистый Markdown ценой оформления (round-trip не гарантирован).
   */
  mode?: 'faithful' | 'readable';
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
  const converted = storageToMarkdown(page.storage, { registry: opts.registry, mode: opts.mode });

  const markdownPath = opts.outFile ?? join(opts.outDir ?? `./${pageId}`, 'page.md');
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, converted.markdown);

  const downloaded = new Map<string, string>();
  if (opts.downloadAttachments !== false && converted.attachmentRefs.length > 0) {
    const dir = join(dirname(markdownPath), 'attachments');
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
