import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { authHeader, type ConfluenceConfig } from './config.js';

export interface ConfluencePage {
  id: string;
  title: string;
  version: { number: number };
}

export interface ConfluencePageStorage {
  title: string;
  storage: string;
  version: number;
}

export interface ConfluenceAttachment {
  id: string;
  title: string;
  version: { number: number; message?: string };
  extensions?: { fileSize?: number };
  /**
   * `_links.download` — относительный путь скачивания, который Confluence
   * возвращает в ответе и который нужно подставлять в `<img src>` / `<a href>`
   * после аплоада. Абсолютизируется через `client.absoluteUrl(...)`.
   */
  _links?: {
    download?: string;
    webui?: string;
  };
}

interface AttachmentListResponse {
  results: ConfluenceAttachment[];
}

/** Версия аттача из /rest/files/1.0/files/{id}/versions (поля гибкие). */
export interface AttachmentVersionData {
  versionNumber?: number;
  version?: number;
  number?: number;
  fileName?: string;
  fileSize?: number;
  author?: { fullName?: string };
}

export interface ConfluenceLabel {
  prefix: string;
  name: string;
}

export interface CreatePageOptions {
  spaceKey: string;
  title: string;
  parentId?: string;
  /** Initial body in storage format. Defaults to an empty page. */
  storage?: string;
}

export class ConfluenceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly detail: string,
  ) {
    super(message);
    this.name = 'ConfluenceApiError';
  }
}

export class ConfluenceClient {
  private readonly auth: string;
  public readonly baseUrl: string;

  constructor(cfg: ConfluenceConfig) {
    if (!cfg.baseUrl) throw new Error('ConfluenceClient: baseUrl is required');
    if (!cfg.token) throw new Error('ConfluenceClient: token is required');
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.auth = authHeader(cfg);
  }

  /** Превращает относительный путь из API (`/download/...`) в абсолютный URL. */
  absoluteUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.auth,
      Accept: 'application/json',
      ...extra,
    };
  }

  private async parseError(res: Response, label: string): Promise<never> {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      detail = '<no body>';
    }
    throw new ConfluenceApiError(
      `${label}: ${res.status} ${res.statusText} — ${detail.slice(0, 500)}`,
      res.status,
      res.statusText,
      detail,
    );
  }

  // ── Pages ────────────────────────────────────────────────────────────

  async getPage(pageId: string): Promise<ConfluencePage> {
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}?expand=version`),
      { headers: this.headers() },
    );
    if (!res.ok) await this.parseError(res, `getPage(${pageId})`);
    return (await res.json()) as ConfluencePage;
  }

  async getPageStorage(pageId: string): Promise<ConfluencePageStorage> {
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}?expand=body.storage,version`),
      { headers: this.headers() },
    );
    if (!res.ok) await this.parseError(res, `getPageStorage(${pageId})`);
    const data = (await res.json()) as {
      title?: string;
      body?: { storage?: { value?: string } };
      version?: { number?: number };
    };
    return {
      title: data.title ?? '',
      storage: data.body?.storage?.value ?? '',
      version: data.version?.number ?? 0,
    };
  }

  /** Finds a page by space key and exact title. Returns null if not found. */
  async getPageByTitle(spaceKey: string, title: string): Promise<ConfluencePage | null> {
    const params = new URLSearchParams({ spaceKey, title, expand: 'version' });
    const res = await fetch(this.url(`/rest/api/content?${params}`), {
      headers: this.headers(),
    });
    if (!res.ok) await this.parseError(res, `getPageByTitle(${spaceKey}, ${title})`);
    const data = (await res.json()) as { results?: ConfluencePage[] };
    return data.results?.[0] ?? null;
  }

  async createPage(opts: CreatePageOptions): Promise<ConfluencePage> {
    const body: Record<string, unknown> = {
      type: 'page',
      title: opts.title,
      space: { key: opts.spaceKey },
      body: {
        storage: { value: opts.storage ?? '', representation: 'storage' },
      },
    };
    if (opts.parentId) body.ancestors = [{ id: opts.parentId }];
    const res = await fetch(this.url('/rest/api/content'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.parseError(res, `createPage(${opts.spaceKey}/${opts.title})`);
    return (await res.json()) as ConfluencePage;
  }

  async updatePage(
    pageId: string,
    body: { title: string; version: number; storage: string; versionMessage?: string },
  ): Promise<void> {
    const version: Record<string, unknown> = { number: body.version };
    if (body.versionMessage) version.message = body.versionMessage;
    const res = await fetch(this.url(`/rest/api/content/${pageId}`), {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: pageId,
        type: 'page',
        title: body.title,
        version,
        body: {
          storage: { value: body.storage, representation: 'storage' },
        },
      }),
    });
    if (!res.ok) await this.parseError(res, `updatePage(${pageId})`);
  }

  async deletePage(pageId: string): Promise<void> {
    const res = await fetch(this.url(`/rest/api/content/${pageId}`), {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) await this.parseError(res, `deletePage(${pageId})`);
  }

  /** Direct child pages of a page. */
  async getChildPages(pageId: string, limit = 200): Promise<ConfluencePage[]> {
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}/child/page?limit=${limit}&expand=version`),
      { headers: this.headers() },
    );
    if (!res.ok) await this.parseError(res, `getChildPages(${pageId})`);
    const data = (await res.json()) as { results?: ConfluencePage[] };
    return data.results ?? [];
  }

  /** CQL content search (e.g. `space = DOCS and type = page and title ~ "Report*"`). */
  async search(cql: string, limit = 50): Promise<ConfluencePage[]> {
    const params = new URLSearchParams({ cql, limit: String(limit), expand: 'version' });
    const res = await fetch(this.url(`/rest/api/content/search?${params}`), {
      headers: this.headers(),
    });
    if (!res.ok) await this.parseError(res, `search(${cql})`);
    const data = (await res.json()) as { results?: ConfluencePage[] };
    return data.results ?? [];
  }

  // ── Labels ───────────────────────────────────────────────────────────

  async getLabels(pageId: string): Promise<ConfluenceLabel[]> {
    const res = await fetch(this.url(`/rest/api/content/${pageId}/label`), {
      headers: this.headers(),
    });
    if (!res.ok) await this.parseError(res, `getLabels(${pageId})`);
    const data = (await res.json()) as { results?: ConfluenceLabel[] };
    return data.results ?? [];
  }

  async addLabels(pageId: string, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const res = await fetch(this.url(`/rest/api/content/${pageId}/label`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(labels.map((name) => ({ prefix: 'global', name }))),
    });
    if (!res.ok) await this.parseError(res, `addLabels(${pageId})`);
  }

  async removeLabel(pageId: string, label: string): Promise<void> {
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}/label/${encodeURIComponent(label)}`),
      { method: 'DELETE', headers: this.headers() },
    );
    if (!res.ok) await this.parseError(res, `removeLabel(${pageId}, ${label})`);
  }

  // ── Content properties ───────────────────────────────────────────────

  /**
   * Content Property — произвольные key/value на странице вне body.
   * Используется для content-hash (см. publish.ts): попытка хранить
   * hash в body как HTML-comment не пережила нормализацию storage Confluence.
   * Возвращает null, если property с таким ключом нет.
   */
  async getContentProperty(
    pageId: string,
    key: string,
  ): Promise<{ value: unknown; version: number } | null> {
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}/property/${encodeURIComponent(key)}`),
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    if (!res.ok) await this.parseError(res, `getContentProperty(${pageId}, ${key})`);
    const data = (await res.json()) as { value?: unknown; version?: { number?: number } };
    return { value: data.value, version: data.version?.number ?? 1 };
  }

  /**
   * Создаёт (если version null) или обновляет content property.
   * При update Confluence требует следующий version-номер.
   */
  async setContentProperty(
    pageId: string,
    key: string,
    value: unknown,
    currentVersion: number | null,
  ): Promise<void> {
    const isUpdate = currentVersion !== null;
    const url = isUpdate
      ? this.url(`/rest/api/content/${pageId}/property/${encodeURIComponent(key)}`)
      : this.url(`/rest/api/content/${pageId}/property`);
    const body: Record<string, unknown> = { key, value };
    if (isUpdate) body.version = { number: currentVersion + 1 };
    const res = await fetch(url, {
      method: isUpdate ? 'PUT' : 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.parseError(res, `setContentProperty(${pageId}, ${key})`);
  }

  // ── Attachments ──────────────────────────────────────────────────────

  async listAttachments(pageId: string, filename?: string): Promise<ConfluenceAttachment[]> {
    // expand=version нужен для дедупа по version.message (sha256-тегу).
    // _links возвращается по умолчанию, явный expand не требуется.
    const params = new URLSearchParams({ expand: 'version', limit: '200' });
    if (filename) params.set('filename', filename);
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}/child/attachment?${params}`),
      { headers: this.headers() },
    );
    if (!res.ok) await this.parseError(res, `listAttachments(${pageId})`);
    const data = (await res.json()) as AttachmentListResponse;
    return data.results ?? [];
  }

  async createAttachment(
    pageId: string,
    filePath: string,
    comment?: string,
  ): Promise<ConfluenceAttachment> {
    const filename = basename(filePath);
    const buf = readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buf]), filename);
    form.append('minorEdit', 'true');
    if (comment) form.append('comment', comment);
    const res = await fetch(this.url(`/rest/api/content/${pageId}/child/attachment`), {
      method: 'POST',
      headers: this.headers({ 'X-Atlassian-Token': 'nocheck' }),
      body: form,
    });
    if (!res.ok) await this.parseError(res, `createAttachment(${filename})`);
    const data = (await res.json()) as AttachmentListResponse | ConfluenceAttachment;
    return 'results' in data ? data.results[0] : data;
  }

  /**
   * Скачивает содержимое аттача по download-пути из `_links.download`
   * (или абсолютному URL). Возвращает сырые байты — текстовая
   * декодировка лежит на caller'е.
   */
  async downloadAttachment(downloadPath: string): Promise<Buffer> {
    const res = await fetch(this.absoluteUrl(downloadPath), {
      headers: { Authorization: this.auth },
    });
    if (!res.ok) await this.parseError(res, `downloadAttachment(${downloadPath})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async updateAttachmentData(
    pageId: string,
    attachmentId: string,
    filePath: string,
    comment?: string,
  ): Promise<ConfluenceAttachment> {
    const filename = basename(filePath);
    const buf = readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buf]), filename);
    form.append('minorEdit', 'true');
    if (comment) form.append('comment', comment);
    const res = await fetch(
      this.url(`/rest/api/content/${pageId}/child/attachment/${attachmentId}/data`),
      {
        method: 'POST',
        headers: this.headers({ 'X-Atlassian-Token': 'nocheck' }),
        body: form,
      },
    );
    if (!res.ok) await this.parseError(res, `updateAttachmentData(${filename})`);
    return (await res.json()) as ConfluenceAttachment;
  }

  /**
   * Список версий аттача через Confluence Files API (Data Center only).
   * Структура ответа гибкая — номер версии нормализуется потребителем
   * (поле versionNumber / version / number).
   */
  async getAttachmentVersions(attachmentId: string): Promise<AttachmentVersionData[]> {
    const res = await fetch(
      this.url(`/rest/files/1.0/files/${attachmentId}/versions`),
      { headers: this.headers() },
    );
    if (!res.ok) await this.parseError(res, `getAttachmentVersions(${attachmentId})`);
    const data = (await res.json()) as AttachmentVersionData[] | { versions?: AttachmentVersionData[] };
    return Array.isArray(data) ? data : (data.versions ?? []);
  }

  /**
   * Удаляет конкретную версию аттача (Data Center only). REST-аналога нет,
   * идём через legacy-action; XSRF обходим заголовком X-Atlassian-Token:
   * no-check (тот же приём работает для createAttachment).
   */
  async removeAttachmentVersion(pageId: string, fileName: string, version: number): Promise<void> {
    const params = new URLSearchParams({ pageId, fileName, version: String(version) });
    const res = await fetch(
      this.url(`/json/removeattachmentversion.action?${params}`),
      {
        method: 'POST',
        headers: this.headers({
          'X-Atlassian-Token': 'no-check',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        }),
        body: '',
      },
    );
    if (!res.ok) await this.parseError(res, `removeAttachmentVersion(${fileName} v${version})`);
  }

  /** Удаляет аттач целиком (все версии). */
  async deleteAttachment(attachmentId: string): Promise<void> {
    const res = await fetch(this.url(`/rest/api/content/${attachmentId}`), {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) await this.parseError(res, `deleteAttachment(${attachmentId})`);
  }
}
