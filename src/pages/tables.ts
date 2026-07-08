import { ConfluenceClient } from '../client/client.js';
import type { ConfluenceConfig } from '../client/config.js';
import { Markdown } from '../markdown/markdown.js';

/** Читает таблицу со страницы Confluence (storage format) и возвращает `string[][]`. */
export async function readTableFromConfluence(
  pageId: string,
  cfg: ConfluenceConfig,
  tableIndex: number = 0,
): Promise<string[][]> {
  const client = new ConfluenceClient(cfg);
  const { storage } = await client.getPageStorage(pageId);
  const table = findTable(storage, tableIndex);
  if (!table) {
    const tableCount = (storage.match(/<table/g) || []).length;
    throw new Error(
      tableCount === 0
        ? `readTableFromConfluence(${pageId}): no tables found on page`
        : `readTableFromConfluence(${pageId}): table ${tableIndex} not found (page has ${tableCount} table(s))`,
    );
  }
  return table;
}

/**
 * Ищет таблицу в Confluence storage XHTML по индексу (первая таблица = 0).
 * Возвращает `string[][]` с ячейками таблицы или null, если не найдена.
 */
export function findTable(storage: string, index: number = 0): string[][] | null {
  let tableIdx = 0;
  for (const tableMatch of storage.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
    if (tableIdx === index) {
      return parseHtmlTable(tableMatch[1]);
    }
    tableIdx++;
  }
  return null;
}

/**
 * Ищет первую таблицу внутри table-excerpt-макроса с заданным значением
 * параметра `name`. Возвращает ячейки или null, если такого макроса
 * (или таблицы внутри него) нет.
 */
export function findTableInMacro(storage: string, name: string): string[][] | null {
  const macroRe =
    /<ac:structured-macro[^>]*ac:name="table-excerpt"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
  for (const macroMatch of storage.matchAll(macroRe)) {
    const inner = macroMatch[1];
    const nameRe = /<ac:parameter\s+ac:name="name">([\s\S]*?)<\/ac:parameter>/;
    const nameMatch = inner.match(nameRe);
    if (!nameMatch) continue;
    if (decodeHtmlCell(nameMatch[1]) !== name) continue;
    const tableMatch = inner.match(/<table[^>]*>([\s\S]*?)<\/table>/);
    if (!tableMatch) return null;
    return parseHtmlTable(tableMatch[1]);
  }
  return null;
}

/**
 * Парсит Confluence storage XHTML, извлекает её таблицу и возвращает
 * её ячейки как `string[][]` (где каждый элемент уже декодирован из HTML).
 */
export function parseHtmlTable(storage: string): string[][] {
  const rows: string[][] = [];
  for (const tr of storage.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells: string[] = [];
    for (const cell of tr[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/g)) {
      cells.push(decodeHtmlCell(cell[2]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Декодирует ячейку HTML-таблицы: удаляет теги, декодирует сущности,
 * сжимает пробелы, триммирует. Подходит для использования в парсинге
 * storage format из Confluence.
 *
 * Порядок декодирования важен: `&amp;` обрабатывается ПОСЛЕДНИМ, чтобы
 * не разрушить уже декодированные сущности типа `&lt;`.
 */
export function decodeHtmlCell(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Читает таблицу из Confluence и преобразует её в типизированный массив.
 * Первая строка таблицы считается заголовками.
 *
 * @param pageId ID страницы Confluence
 * @param cfg конфиг Confluence
 * @param mapRow функция, которая преобразует (строка: string[], заголовки: string[]) → T
 * @param tableIndex индекс таблицы на странице (0 = первая)
 * @returns типизированный массив строк таблицы (без заголовков)
 * @throws если таблица пустая или содержит только заголовки
 */
export async function readAndMapTable<T>(
  pageId: string,
  cfg: ConfluenceConfig,
  mapRow: (row: string[], headers: string[]) => T,
  tableIndex: number = 0,
): Promise<T[]> {
  const rows = await readTableFromConfluence(pageId, cfg, tableIndex);
  if (rows.length === 0) {
    throw new Error(
      `readAndMapTable(${pageId}): table ${tableIndex} is empty`,
    );
  }
  const headers = rows[0];
  if (headers.length === 0) {
    throw new Error(
      `readAndMapTable(${pageId}): table ${tableIndex} has no columns`,
    );
  }
  if (rows.length === 1) {
    console.warn(
      `[readAndMapTable] ${pageId}: table ${tableIndex} contains only headers, no data rows`,
    );
    return [];
  }
  return rows.slice(1).map((row) => mapRow(row, headers));
}

export type ColumnAlign = 'left' | 'right' | 'center';

export interface TableColumn<T> {
  header: string;
  cell: (item: T) => string;
  /** Выравнивание колонки в опубликованной таблице. По умолчанию — left. */
  align?: ColumnAlign;
}

/**
 * Рендерит типизированный массив в Markdown-таблицу на основе описания
 * колонок. Каждая колонка задаёт заголовок, функцию извлечения значения
 * и опциональное выравнивание. Выравнивание транслируется markdown-it'ом
 * в `style="text-align: right|center|left"` на <th>/<td>, что Confluence
 * сохраняет в storage.
 *
 * @param items массив элементов; если пусто, возвращается сообщение «нет данных»
 * @param columns описание колонок; не может быть пусто
 * @throws если columns пусто
 * @example
 *   interface Row { name: string; hours: number; }
 *   const cols: TableColumn<Row>[] = [
 *     { header: 'Имя',  cell: (r) => r.name },
 *     { header: 'Часы', cell: (r) => r.hours.toFixed(2), align: 'right' },
 *   ];
 *   const md = renderMarkdownTable(rows, cols);
 */
export function renderMarkdownTable<T>(
  items: T[],
  columns: Array<TableColumn<T>>,
): Markdown {
  if (columns.length === 0) {
    throw new Error('renderMarkdownTable: columns cannot be empty');
  }
  if (items.length === 0) return new Markdown('_(нет данных)_');
  const header = columns.map((c) => escapeMdTableCell(c.header));
  const sep = columns.map((c) => alignSeparator(c.align));
  const body = items.map((item) =>
    columns.map((c) => escapeMdTableCell(c.cell(item))),
  );
  const content = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
  return new Markdown(content);
}

function alignSeparator(align: ColumnAlign | undefined): string {
  switch (align) {
    case 'right': return '---:';
    case 'center': return ':---:';
    case 'left': return ':---';
    default: return '---';
  }
}

/**
 * Экранирует спецсимволы для использования в ячейке Markdown-таблицы:
 * заменяет `|` на `\|`, переносы на пробелы.
 */
export function escapeMdTableCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
