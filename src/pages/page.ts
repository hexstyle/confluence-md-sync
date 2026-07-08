/**
 * Объектная модель для работы со страницами и таблицами Confluence.
 */

import type { ConfluenceClient, ConfluenceLabel, ConfluencePage } from '../client/client.js';
import { findTable, findTableInMacro, renderMarkdownTable } from './tables.js';
import { Attachment, toAttachmentVersion } from '../attachments/attachment.js';
import { Markdown } from '../markdown/markdown.js';

/**
 * Представляет страницу Confluence.
 */
export class Page {
  constructor(
    public readonly id: string,
    public readonly title: string,
    private readonly storage: string,
    private readonly client: ConfluenceClient,
  ) {}

  /** Сырой storage-контент страницы. */
  getStorage(): string {
    return this.storage;
  }

  /**
   * Скачивает аттач страницы по имени файла. Возвращает сырые байты.
   * Текстовая декодировка — через {@link getAttachmentText}.
   */
  async getAttachment(filename: string): Promise<Buffer> {
    const list = await this.client.listAttachments(this.id, filename);
    const att = list.find((a) => a.title === filename);
    if (!att) throw new Error(`Attachment '${filename}' not found on page ${this.id}`);
    const path = att._links?.download;
    if (!path) throw new Error(`Attachment '${filename}' on page ${this.id} has no download link`);
    return this.client.downloadAttachment(path);
  }

  /** Скачивает аттач и декодирует как текст (по умолчанию utf-8). */
  async getAttachmentText(filename: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const buf = await this.getAttachment(filename);
    return buf.toString(encoding);
  }

  /** Список аттачей страницы с историей версий (versions заполнены). */
  async getAttachments(): Promise<Attachment[]> {
    const list = await this.client.listAttachments(this.id);
    return Promise.all(
      list.map(async (a) => {
        const raw = await this.client.getAttachmentVersions(a.id);
        const versions = raw
          .map(toAttachmentVersion)
          .sort((x, y) => y.version - x.version);
        const downloadUrl = a._links?.download
          ? this.client.absoluteUrl(a._links.download)
          : this.client.absoluteUrl(
              `/download/attachments/${this.id}/${encodeURIComponent(a.title)}`,
            );
        return new Attachment(a.id, this.id, a.title, a.version?.number ?? 0, downloadUrl, versions);
      }),
    );
  }

  /**
   * Удаляет у всех аттачей страницы старые версии, оставляя только последнюю
   * (max по номеру). Полезно для регулярно перезаписываемых файлов (CSV),
   * которые иначе копят десятки версий. Возвращает число удалённых версий.
   */
  async removeOldAttachmentVersions(): Promise<number> {
    const attachments = await this.getAttachments();
    let removed = 0;
    for (const att of attachments) {
      if (att.versions.length <= 1) continue;
      const latest = Math.max(...att.versions.map((v) => v.version));
      for (const v of att.versions) {
        if (v.version >= latest) continue;
        try {
          await this.client.removeAttachmentVersion(this.id, att.title, v.version);
          removed++;
        } catch (err) {
          console.warn(
            `[attachments] не удалось удалить ${att.title} v${v.version}: ${(err as Error).message}`,
          );
        }
      }
    }
    return removed;
  }

  /** Лейблы страницы. */
  async getLabels(): Promise<ConfluenceLabel[]> {
    return this.client.getLabels(this.id);
  }

  /** Добавляет лейблы (идемпотентно). */
  async addLabels(labels: string[]): Promise<void> {
    await this.client.addLabels(this.id, labels);
  }

  /** Дочерние страницы. */
  async getChildren(): Promise<ConfluencePage[]> {
    return this.client.getChildPages(this.id);
  }

  /**
   * Извлекает таблицу со страницы.
   *
   * @param target порядковый номер таблицы (0 = первая) или имя
   *   table-excerpt-макроса, обёрнутого вокруг таблицы (параметр `name`).
   * @throws если таблица не найдена
   */
  getTable(target: number | string = 0): Table {
    const tableHtml =
      typeof target === 'string'
        ? findTableInMacro(this.storage, target)
        : findTable(this.storage, target);
    if (!tableHtml) {
      const desc =
        typeof target === 'string' ? `macro name="${target}"` : `index ${target}`;
      throw new Error(`Table not found on page ${this.id} (${desc})`);
    }
    return new Table(tableHtml);
  }

  /**
   * Извлекает все таблицы со страницы.
   */
  getTables(): Table[] {
    const tables: Table[] = [];
    let index = 0;
    while (true) {
      try {
        tables.push(this.getTable(index));
        index++;
      } catch {
        break;
      }
    }
    return tables;
  }
}

/**
 * Представляет таблицу Confluence (извлечённую из HTML storage format).
 *
 * Предоставляет методы для преобразования таблицы в разные форматы:
 * - `toCells()` — массив строк и ячеек
 * - `toAny()` — массив объектов с заголовками как ключи
 * - `toType<T>()` — массив типизированных объектов с маппером
 */
export class Table {
  private readonly cells: string[][];
  private readonly headers: string[];

  constructor(tableHtml: string[][]) {
    this.cells = tableHtml;
    this.headers = this.cells[0] || [];
  }

  /**
   * Возвращает сырой массив ячеек таблицы.
   */
  toCells(): string[][] {
    return this.cells;
  }

  /**
   * Возвращает строки таблицы (без заголовков) как массив объектов.
   *
   * Ключи объектов — заголовки колонок.
   * Если есть дублирующиеся заголовки, к имени добавляется порядковый номер.
   *
   * @example
   *   table.toAny() → [
   *     { 'Таб.№': '14800145', 'ФИО': 'Иванов И.И.', ... },
   *     { 'Таб.№': '14800146', 'ФИО': 'Петров П.П.', ... },
   *   ]
   */
  toAny(): Record<string, string>[] {
    const headerMap = this.buildHeaderMap();
    return this.cells.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      row.forEach((cell, i) => {
        const key = headerMap.get(i) || `[${i}]`;
        obj[key] = cell;
      });
      return obj;
    });
  }

  /**
   * Преобразует таблицу в массив типизированных объектов.
   *
   * @param mapper функция, которая заполняет поля результирующего объекта на основе строки таблицы
   * @returns массив объектов типа T, заполненный маппером
   *
   * @example
   *   const employees = table.toType<Employee>((row, emp) => {
   *     emp.tabNumber = row['Таб.№'];
   *     emp.fio = row['ФИО'];
   *   });
   */
  toType<T>(mapper: (row: Record<string, string>, result: T) => void): T[] {
    const rows = this.toAny();
    const results: T[] = [];
    for (const row of rows) {
      const result = {} as T;
      mapper(row, result);
      results.push(result);
    }
    return results;
  }

  /** Возвращает количество строк (включая заголовок). */
  get rowCount(): number {
    return this.cells.length;
  }

  /** Возвращает количество колонок. */
  get columnCount(): number {
    return this.headers.length;
  }

  /** Возвращает заголовки колонок. */
  getHeaders(): string[] {
    return [...this.headers];
  }

  /** Возвращает таблицу в Markdown формате для использования с макросами. */
  toMarkdown(): Markdown {
    const items = this.toAny();
    const columns = this.headers.map((header) => ({
      header,
      cell: (item: Record<string, string>) => item[header] || '',
    }));
    return renderMarkdownTable(items, columns);
  }

  /** Строит карту заголовков с обработкой дубликатов. */
  private buildHeaderMap(): Map<number, string> {
    const map = new Map<number, string>();
    const seen = new Map<string, number>();

    this.headers.forEach((header, i) => {
      const normalized = header.toLowerCase();
      const count = (seen.get(normalized) || 0) + 1;
      seen.set(normalized, count);

      if (count === 1) {
        map.set(i, header);
      } else {
        map.set(i, `${header} (${count})`);
      }
    });

    return map;
  }
}
