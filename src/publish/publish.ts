import { mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ConfluenceClient } from '../client/client.js';
import type { ConfluenceConfig } from '../client/config.js';
import { AttachmentService } from '../attachments/attachment.js';
import { bpmnOutputName, convertBpmn, isBpmnFile, type BpmnConversion } from '../bpmn/convert.js';
import { downloadToFile, isHttpUrl, remoteFilename } from './remote.js';
import {
  renameImagePlaceholders,
  renderToStorage,
  type AttachmentUrls,
  type RenderStorageOptions,
} from '../markdown/render.js';
import { validateMarkdown } from '../markdown/validate.js';
import { processMacros } from '../macros/registry.js';
import type { MacroRegistry } from '../macros/registry.js';
import { defaultMacroRegistry } from '../macros/index.js';
import { Markdown } from '../markdown/markdown.js';

export interface TableData {
  name: string;
  markdown: Markdown | string;
}

export interface PublishPageOptions {
  /** Известный ID страницы. Альтернатива — spaceKey + title. */
  pageId?: string;
  /**
   * Space key для поиска/создания страницы по title, когда pageId неизвестен.
   * Если страницы с таким title в space нет и createIfMissing !== false,
   * она будет создана (опционально под parentPageId).
   */
  spaceKey?: string;
  /** Путь к markdown-файлу. Альтернатива — `markdown` со строкой/объектом. */
  markdownPath?: string;
  /** Готовый markdown-контент (вместо markdownPath). */
  markdown?: Markdown | string;
  /**
   * Картинки для страницы: относительный или абсолютный путь на диске либо
   * http(s)-URL (файл скачивается при публикации; для URL с того же
   * Confluence используется токен из конфига). `*.bpmn` конвертируются в PNG.
   */
  images?: string[];
  /** Файлы-аттачи; те же виды источников, что и images. */
  files?: string[];
  tables?: TableData[];
  /**
   * Заголовок страницы. Для существующей страницы — переименование
   * (по умолчанию сохраняется текущий); для поиска/создания по spaceKey —
   * обязательный ключ поиска.
   */
  title?: string;
  /** Родитель для создаваемой страницы (только вместе со spaceKey). */
  parentPageId?: string;
  /** Создавать ли страницу, если по spaceKey+title не нашлась. Default: true. */
  createIfMissing?: boolean;
  /** Лейблы, которые нужно гарантировать на странице. */
  labels?: string[];
  /** Комментарий к версии страницы. */
  versionMessage?: string;
  /** Свой реестр макросов (default: встроенные core + table-filter). */
  registry?: MacroRegistry;
  /**
   * Каталог для PNG, сгенерированных из `*.bpmn` в images[].
   * Default: временный каталог на каждый запуск — дедуп аттачей всё равно
   * идёт по SHA-256 исходного BPMN через sidecar, лишних версий не будет.
   */
  bpmnOutDir?: string;
  /**
   * Каталог для файлов, скачанных по http(s)-URL из images[]/files[].
   * Default: временный каталог на каждый запуск.
   */
  downloadDir?: string;
  /**
   * Ключ content property для хранения content-hash.
   * Default: 'confluence-md-sync-content-hash'.
   */
  hashPropertyKey?: string;
  /** Рендер и валидация без записи в Confluence. */
  dryRun?: boolean;
  /**
   * Опции рендера markdown → storage. Для страниц из exportPage:
   * `{ imageStyle: 'attachment', fileStyle: 'attachment', linkify: false }`.
   */
  render?: RenderStorageOptions;
}

export interface PublishPageResult {
  pageId: string;
  title: string;
  version: number;
  attachments: Array<{ filename: string; id: string; reused: boolean; url: string }>;
  /** false если контент совпал по hash и updatePage не вызывался. */
  updated: boolean;
  /** true если страница была создана в этом запуске. */
  created: boolean;
  /** Итоговый storage-контент (полезно в dryRun). */
  storage: string;
}

// Content property с SHA-256 от рендеренного storage. Хранится отдельно
// от body через /rest/api/content/{id}/property/{key}, поэтому:
//  - не попадает в HTML страницы (пользователь не видит);
//  - переживает любую нормализацию storage Confluence (HTML-comment не
//    переживал — был первый подход, не сработал).
// При повторной публикации того же контента hash совпадёт → updatePage
// не вызываем → версия страницы не растёт, история не пухнет.
export const DEFAULT_HASH_PROPERTY_KEY = 'confluence-md-sync-content-hash';

export function computeContentHash(storage: string): string {
  // Перед хешированием вычищаем query (?version=N&modificationDate=…) из
  // attachment download-URL'ов — защита для storage, писанного схемой 1
  // (см. HASH_SCHEME): там в body лежали URL с пином версии. Начиная со
  // схемы 2 в body подставляются канонические URL без query, и replace —
  // no-op.
  const canonical = storage.replace(
    /(\/download\/attachments\/[^"?\s]+)\?[^"\s]*/g,
    '$1',
  );
  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

// Схема записи download-URL в body. Схема 1 подставляла URL из
// _links.download как есть — с ?version=N&modificationDate=…; при ребампе
// аттача без изменения текста страница оставалась UNCHANGED и продолжала
// отдавать старую, пиненную версию картинки. Схема 2 подставляет
// канонический URL без query — Confluence по нему отдаёт последнюю версию
// аттача, и обновление диаграммы видно без переписывания body. Property со
// схемой ≠ текущей (в т.ч. без поля scheme) считается устаревшей — страница
// один раз переписывается каноническими URL.
const HASH_SCHEME = 2;

/** Канонический download-URL аттача: без query (?version=N&…). */
function canonicalDownloadUrl(url: string): string {
  return url.split('?')[0];
}

async function resolvePage(
  client: ConfluenceClient,
  opts: PublishPageOptions,
): Promise<{ pageId: string; created: boolean }> {
  if (opts.pageId) return { pageId: opts.pageId, created: false };
  if (!opts.spaceKey || !opts.title) {
    throw new Error('publishPage: either pageId or spaceKey + title must be provided');
  }
  const existing = await client.getPageByTitle(opts.spaceKey, opts.title);
  if (existing) return { pageId: existing.id, created: false };
  if (opts.createIfMissing === false) {
    throw new Error(
      `publishPage: page '${opts.title}' not found in space '${opts.spaceKey}' and createIfMissing is false`,
    );
  }
  if (opts.dryRun) {
    console.log(`[publish] dry-run: would create page '${opts.title}' in space '${opts.spaceKey}'`);
    return { pageId: 'dry-run', created: true };
  }
  const page = await client.createPage({
    spaceKey: opts.spaceKey,
    title: opts.title,
    parentId: opts.parentPageId,
  });
  console.log(`[publish] created page ${page.id} "${opts.title}" in space ${opts.spaceKey}`);
  return { pageId: page.id, created: true };
}

export async function publishPage(
  opts: PublishPageOptions,
  cfg: ConfluenceConfig,
): Promise<PublishPageResult> {
  let markdown: string;
  if (opts.markdownPath) {
    markdown = readFileSync(opts.markdownPath, 'utf-8');
  } else if (opts.markdown !== undefined) {
    markdown = opts.markdown instanceof Markdown ? opts.markdown.toString() : opts.markdown;
  } else {
    throw new Error('publishPage: either markdownPath or markdown must be provided');
  }
  let images = opts.images ?? [];
  let files = opts.files ?? [];
  const tables = opts.tables ?? [];
  const registry = opts.registry ?? defaultMacroRegistry;
  const hashKey = opts.hashPropertyKey ?? DEFAULT_HASH_PROPERTY_KEY;

  // 0a. Удалённые источники: http(s)://-элементы в images[]/files[]
  //     заменяются на локальный путь в downloadDir с именем из URL — дальше
  //     конвейер (валидация, BPMN, аплоад) работает с обычными путями.
  //     Скачивание — после валидации (fail fast, до любого сетевого I/O).
  const remoteDownloads: Array<{ url: string; dest: string }> = [];
  if ([...images, ...files].some(isHttpUrl)) {
    const dlDir =
      opts.downloadDir ?? mkdtempSync(join(tmpdir(), 'confluence-md-sync-dl-'));
    const toLocal = (spec: string): string => {
      if (!isHttpUrl(spec)) return spec;
      const dest = join(dlDir, remoteFilename(spec));
      remoteDownloads.push({ url: spec, dest });
      return dest;
    };
    images = images.map(toLocal);
    files = files.map(toLocal);
  }

  // Плейсхолдеры и dedup-карты ключуются по basename — одинаковые имена из
  // разных источников молча перетёрли бы друг друга. С URL-источниками это
  // легко словить случайно, поэтому проверяем явно.
  for (const list of [images, files]) {
    const byName = new Map<string, string>();
    for (const p of list) {
      const prev = byName.get(basename(p));
      if (prev !== undefined && prev !== p) {
        throw new Error(
          `publishPage: duplicate attachment filename '${basename(p)}' from different sources: '${prev}' and '${p}'`,
        );
      }
      byName.set(basename(p), p);
    }
  }

  // 0b. BPMN из коробки: *.bpmn в images[] конвертируются в PNG, а
  //    {{img:p1.bpmn}} в markdown подменяется на {{img:p1.png}} ДО валидации.
  //    Сама конвертация (puppeteer) — после валидации, чтобы падать быстро.
  const bpmnConversions: BpmnConversion[] = [];
  const bpmnInputs = images.filter(isBpmnFile);
  if (bpmnInputs.length > 0) {
    const outDir =
      opts.bpmnOutDir ?? mkdtempSync(join(tmpdir(), 'confluence-md-sync-bpmn-'));
    const renames = new Map<string, string>();
    const outputByInput = new Map<string, string>();
    for (const input of bpmnInputs) {
      const output = join(outDir, bpmnOutputName(input));
      bpmnConversions.push({ input, output });
      outputByInput.set(input, output);
      renames.set(basename(input), basename(output));
    }
    images = images.map((p) => outputByInput.get(p) ?? p);
    markdown = renameImagePlaceholders(markdown, renames);
  }

  validateMarkdown({
    markdown,
    imagePaths: images,
    filePaths: files,
    tableNames: tables.map((t) => t.name),
    sourceLabel: opts.markdownPath,
  });

  // Подставляем таблицы в markdown (уже могут быть обёрнуты в макросы).
  for (const table of tables) {
    const tableMarkdown = table.markdown instanceof Markdown ? table.markdown.toString() : table.markdown;
    markdown = markdown.replace(new RegExp(`\\{\\{table:${escapeRegex(table.name)}\\}\\}`, 'g'), () => tableMarkdown);
  }

  // Скачивание удалённых источников — после валидации, до конвертации
  // (скачанный .bpmn нужен convertBpmn). В dry-run пропускается.
  if (remoteDownloads.length > 0 && !opts.dryRun) {
    for (const { url, dest } of remoteDownloads) {
      await downloadToFile(url, dest, cfg);
      console.log(`[download] ${url} → ${basename(dest)}`);
    }
  }

  // Конвертация диаграмм — до аплоада; в dry-run пропускается (аттачи всё
  // равно не загружаются, URL подставляются фиктивные).
  if (bpmnConversions.length > 0 && !opts.dryRun) {
    await convertBpmn(bpmnConversions);
  }

  const client = new ConfluenceClient(cfg);
  const attachmentSvc = new AttachmentService(client);

  const { pageId, created } = await resolvePage(client, opts);

  // 1. Загрузка аттачей (или переиспользование по SHA-256). Собираем
  //    отдельные карты «имя → URL» для картинок и файлов — рендер потом
  //    подставит эти URL в <img src=…> и <a href=…> вместо плейсхолдеров.
  const urls: AttachmentUrls = { images: new Map(), files: new Map() };
  const attachments: PublishPageResult['attachments'] = [];
  if (opts.dryRun) {
    // В dry-run не трогаем Confluence — подставляем фиктивные URL, чтобы
    // рендер и валидация плейсхолдеров отработали полностью.
    for (const p of images) urls.images.set(basename(p), `dry-run://img/${basename(p)}`);
    for (const p of files) urls.files.set(basename(p), `dry-run://file/${basename(p)}`);
  } else {
    // В body уходит канонический URL без query (см. HASH_SCHEME) — страница
    // всегда отдаёт последнюю версию аттача. Полный URL с версией остаётся
    // в результате для caller'а.
    for (const p of images) {
      const r = await attachmentSvc.ensure(pageId, p);
      urls.images.set(r.filename, canonicalDownloadUrl(r.downloadUrl));
      attachments.push({ filename: r.filename, id: r.id, reused: r.reused, url: r.downloadUrl });
      console.log(
        `[attachment] ${r.filename}: ${r.reused ? 'reused' : 'uploaded'} (id=${r.id})`,
      );
    }
    for (const p of files) {
      const r = await attachmentSvc.ensure(pageId, p);
      urls.files.set(r.filename, canonicalDownloadUrl(r.downloadUrl));
      attachments.push({ filename: r.filename, id: r.id, reused: r.reused, url: r.downloadUrl });
      console.log(
        `[attachment] ${r.filename}: ${r.reused ? 'reused' : 'uploaded'} (id=${r.id})`,
      );
    }
  }

  // 2. Рендер MD → storage format с подстановкой полученных URL-ов.
  let storage = renderToStorage(markdown, urls, opts.render ?? {});

  // 2.5. Преобразование маркеров макросов в XHTML.
  storage = processMacros(storage, registry).toString();

  if (opts.dryRun) {
    console.log(`[publish] dry-run: page ${pageId} rendered OK (${storage.length} bytes of storage)`);
    return {
      pageId,
      title: opts.title ?? '',
      version: 0,
      attachments,
      updated: false,
      created,
      storage,
    };
  }

  // 3. Content-hash check. Hash хранится в content property, не в body.
  const newHash = computeContentHash(storage);
  const [existing, hashProp] = await Promise.all([
    client.getPageStorage(pageId),
    client.getContentProperty(pageId, hashKey),
  ]);
  const title = opts.title ?? existing.title;
  // Property, писанная другой схемой (или до появления scheme), не считается
  // совпадением: body мог быть записан с пином версий аттачей — его нужно
  // один раз переписать каноническими URL.
  const propValue =
    hashProp && typeof hashProp.value === 'object' && hashProp.value !== null
      ? (hashProp.value as { hash?: unknown; scheme?: unknown })
      : null;
  const existingHash =
    propValue && propValue.scheme === HASH_SCHEME
      ? ((propValue.hash as string | undefined) ?? null)
      : null;

  if (existingHash === newHash && title === existing.title) {
    console.log(
      `[publish] ${pageId} "${title}" → UNCHANGED (hash ${newHash.slice(0, 12)}, v${existing.version})`,
    );
    if (opts.labels?.length) await client.addLabels(pageId, opts.labels);
    return { pageId, title, version: existing.version, attachments, updated: false, created, storage };
  }

  // 4. Обновление страницы — только после успешного аплоада всех аттачей.
  const nextVersion = existing.version + 1;
  await client.updatePage(pageId, {
    title,
    version: nextVersion,
    storage,
    versionMessage: opts.versionMessage,
  });

  // 5. Запись/обновление content property с новым hash. Делаем ПОСЛЕ
  //    updatePage чтобы при сбое publish hash не «опередил» реальное содержимое.
  await client.setContentProperty(
    pageId,
    hashKey,
    { hash: newHash, scheme: HASH_SCHEME },
    hashProp ? hashProp.version : null,
  );

  if (opts.labels?.length) await client.addLabels(pageId, opts.labels);

  console.log(
    `[publish] ${pageId} "${title}" → v${nextVersion} (hash ${newHash.slice(0, 12)})`,
  );

  return { pageId, title, version: nextVersion, attachments, updated: true, created, storage };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
