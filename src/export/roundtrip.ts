/**
 * Round-trip-проверка: storage → markdown → storage′ и каноническое
 * сравнение (см. canonical.ts — критерий «без потери разметки»).
 */

import { ConfluenceClient } from '../client/client.js';
import type { ConfluenceConfig } from '../client/config.js';
import { processMacros, type MacroRegistry } from '../macros/registry.js';
import { defaultMacroRegistry } from '../macros/index.js';
import { renderToStorage } from '../markdown/render.js';
import { compareStorage, type StorageDiff } from './canonical.js';
import { storageToMarkdown, type StorageToMarkdownResult } from './to-markdown.js';

export interface RoundTripResult extends StorageToMarkdownResult {
  /** storage, восстановленный из markdown публикационным конвейером. */
  regenerated: string;
  equal: boolean;
  diffs: StorageDiff[];
}

/**
 * Рендерит markdown из exportPage/storageToMarkdown обратно в storage тем
 * же конвейером, что publishPage (attachment-стиль ссылок, без linkify).
 */
export function renderExportedMarkdown(markdown: string, registry?: MacroRegistry): string {
  const storage = renderToStorage(
    markdown,
    { images: new Map(), files: new Map() },
    { imageStyle: 'attachment', fileStyle: 'attachment', linkify: false },
  );
  return processMacros(storage, registry ?? defaultMacroRegistry).toString();
}

/** Полный офлайн round-trip для готового storage-фрагмента. */
export function roundTripStorage(
  storage: string,
  opts: { registry?: MacroRegistry } = {},
): RoundTripResult {
  const converted = storageToMarkdown(storage, opts);
  const regenerated = renderExportedMarkdown(converted.markdown, opts.registry);
  const { equal, diffs } = compareStorage(storage, regenerated);
  return { ...converted, regenerated, equal, diffs };
}

/** Round-trip для живой страницы: тянет storage по id и проверяет офлайн. */
export async function roundTripPage(
  pageId: string,
  cfg: ConfluenceConfig,
  opts: { registry?: MacroRegistry } = {},
): Promise<RoundTripResult & { title: string; version: number }> {
  const client = new ConfluenceClient(cfg);
  const page = await client.getPageStorage(pageId);
  const result = roundTripStorage(page.storage, opts);
  return { ...result, title: page.title, version: page.version };
}
