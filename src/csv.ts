import { writeFileSync } from 'node:fs';

/**
 * Авто-декод текстового файла: UTF-8/UTF-16 BOM → соответствующая UTF;
 * без BOM пробуем strict UTF-8 (fatal: true), если падает на невалидной
 * последовательности — fallback на Windows-1251 (типичная кодировка
 * для русских CSV из Excel/1С).
 */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

/**
 * Парсит CSV (RFC 4180): кавычки, экранирование `""`, CRLF/LF. Разделитель
 * определяется по первой строке — если `;` больше `,`, то `;`, иначе `,`.
 */
export function readCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuotes = false; continue; }
      field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === sep) { cur.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

/**
 * Пишет CSV с `;`-разделителем (русский Excel), CRLF, кавычками вокруг полей
 * с `;` / `"` / переносом и экранированием `"` → `""`. BOM в начале — чтобы
 * Excel сразу распознал UTF-8 кириллицу.
 */
export function writeCsv(path: string, rows: string[][]): void {
  const esc = (s: string) => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const text = '﻿' + rows.map((r) => r.map((c) => esc(c ?? '')).join(';')).join('\r\n') + '\r\n';
  writeFileSync(path, text, 'utf-8');
}
