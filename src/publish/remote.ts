/**
 * Удалённые источники для images[]/files[]: элемент со схемой http(s)://
 * скачивается во временный каталог перед публикацией и дальше проходит
 * обычный конвейер (BPMN-конвертация, dedup по SHA-256, аплоад).
 *
 * Если URL указывает на тот же Confluence, что и cfg.baseUrl (совпадает
 * origin — протокол + хост + порт), запрос уходит с Authorization из
 * текущего конфига (PAT/API token). На чужие хосты токен НЕ отправляется;
 * undici к тому же сам вырезает Authorization при cross-origin redirect.
 */

import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { authHeader, type ConfluenceConfig } from '../client/config.js';

/** true для http:// и https:// (остальное трактуется как путь на диске). */
export function isHttpUrl(spec: string): boolean {
  return /^https?:\/\//i.test(spec);
}

/**
 * Имя файла из URL: basename от pathname (query/fragment отбрасываются),
 * percent-encoding декодируется. `.../p1.bpmn?version=2` → `p1.bpmn` —
 * это же имя используется в `{{img:...}}`/`{{file:...}}` плейсхолдерах.
 */
export function remoteFilename(spec: string): string {
  const pathname = new URL(spec).pathname;
  // node:path.basename('/dir/') === 'dir' — трейлинг-слэш надо ловить явно.
  const name = pathname.endsWith('/') ? '' : decodeURIComponent(basename(pathname));
  if (!name) {
    throw new Error(
      `Cannot derive a filename from URL '${spec}' — the path ends with '/'`,
    );
  }
  return name;
}

/** Совпадает ли origin URL-а с origin Confluence из конфига. */
export function isSameConfluenceOrigin(url: string, cfg: ConfluenceConfig): boolean {
  try {
    return new URL(url).origin === new URL(cfg.baseUrl).origin;
  } catch {
    return false;
  }
}

/** Заголовки запроса: Authorization — только для своего Confluence. */
export function remoteRequestHeaders(
  url: string,
  cfg: ConfluenceConfig,
): Record<string, string> {
  return isSameConfluenceOrigin(url, cfg) ? { Authorization: authHeader(cfg) } : {};
}

/** Скачивает URL в destPath. Не-2xx → ошибка с кодом и URL. */
export async function downloadToFile(
  url: string,
  destPath: string,
  cfg: ConfluenceConfig,
): Promise<void> {
  const res = await fetch(url, { headers: remoteRequestHeaders(url, cfg) });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}
