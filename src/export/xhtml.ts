/**
 * Мини-парсер и сериализатор storage-формата Confluence.
 *
 * Storage — well-formed XML-фрагмент (XHTML + пространства имён ac:/ri:),
 * но с HTML-сущностями (&nbsp; и т.п.), которые «настоящий» XML-парсер не
 * переварит. Поэтому свой парсер: сущности в тексте и атрибутах НЕ
 * декодируются (хранятся как в исходнике — это даёт побайтовую
 * сериализацию обратно), а декодирование по требованию делает
 * {@link decodeEntities}.
 */

export interface XElement {
  kind: 'el';
  name: string;
  /** Пары [имя, raw-значение] в исходном порядке; значения не декодированы. */
  attrs: Array<[string, string]>;
  children: XNode[];
  selfClosing: boolean;
}

export interface XText {
  kind: 'text';
  /** Текст как в исходнике, сущности не декодированы. */
  raw: string;
}

export interface XCdata {
  kind: 'cdata';
  text: string;
}

export interface XComment {
  kind: 'comment';
  text: string;
}

export type XNode = XElement | XText | XCdata | XComment;

export class StorageParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`${message} (at offset ${position})`);
    this.name = 'StorageParseError';
  }
}

// XHTML-«пустые» элементы: на случай невалидного <br> без самозакрытия.
const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'col', 'input', 'meta', 'link']);

const NAME_RE = /[A-Za-z_][A-Za-z0-9._:-]*/y;

/** Парсит storage-фрагмент в список узлов. Бросает StorageParseError. */
export function parseStorage(input: string): XNode[] {
  const root: XNode[] = [];
  const stack: Array<{ el: XElement; children: XNode[] }> = [];
  let current = root;
  let i = 0;

  const pushText = (from: number, to: number): void => {
    if (to > from) current.push({ kind: 'text', raw: input.slice(from, to) });
  };

  let textStart = 0;
  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) break;
    pushText(textStart, lt);

    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9);
      if (end === -1) throw new StorageParseError('unterminated CDATA', lt);
      current.push({ kind: 'cdata', text: input.slice(lt + 9, end) });
      i = textStart = end + 3;
      continue;
    }
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      if (end === -1) throw new StorageParseError('unterminated comment', lt);
      current.push({ kind: 'comment', text: input.slice(lt + 4, end) });
      i = textStart = end + 3;
      continue;
    }
    if (input.startsWith('</', lt)) {
      NAME_RE.lastIndex = lt + 2;
      const m = NAME_RE.exec(input);
      if (!m) throw new StorageParseError('malformed closing tag', lt);
      const gt = input.indexOf('>', lt);
      if (gt === -1) throw new StorageParseError('unterminated closing tag', lt);
      const frame = stack.pop();
      if (!frame || frame.el.name !== m[0]) {
        throw new StorageParseError(
          `unexpected </${m[0]}>${frame ? `, open element is <${frame.el.name}>` : ''}`,
          lt,
        );
      }
      current = stack.length > 0 ? stack[stack.length - 1].children : root;
      i = textStart = gt + 1;
      continue;
    }

    // Открывающий тег
    NAME_RE.lastIndex = lt + 1;
    const nameMatch = NAME_RE.exec(input);
    if (!nameMatch) {
      // Не тег (например, одинокий '<' — в валидном storage не бывает).
      throw new StorageParseError('malformed tag', lt);
    }
    const el: XElement = {
      kind: 'el',
      name: nameMatch[0],
      attrs: [],
      children: [],
      selfClosing: false,
    };
    i = NAME_RE.lastIndex;
    // Атрибуты
    for (;;) {
      while (/[\s]/.test(input[i] ?? '')) i++;
      const ch = input[i];
      if (ch === '>' ) { i++; break; }
      if (ch === '/') {
        if (input[i + 1] !== '>') throw new StorageParseError('malformed self-closing tag', i);
        el.selfClosing = true;
        i += 2;
        break;
      }
      NAME_RE.lastIndex = i;
      const attrName = NAME_RE.exec(input);
      if (!attrName) throw new StorageParseError(`malformed attribute in <${el.name}>`, i);
      i = NAME_RE.lastIndex;
      while (/\s/.test(input[i] ?? '')) i++;
      if (input[i] !== '=') {
        // Булев атрибут без значения — в storage не встречается, но переживём.
        el.attrs.push([attrName[0], '']);
        continue;
      }
      i++;
      while (/\s/.test(input[i] ?? '')) i++;
      const quote = input[i];
      if (quote !== '"' && quote !== "'") {
        throw new StorageParseError(`unquoted attribute value in <${el.name}>`, i);
      }
      const endQuote = input.indexOf(quote, i + 1);
      if (endQuote === -1) throw new StorageParseError('unterminated attribute value', i);
      el.attrs.push([attrName[0], input.slice(i + 1, endQuote)]);
      i = endQuote + 1;
    }

    current.push(el);
    if (!el.selfClosing && !VOID_ELEMENTS.has(el.name.toLowerCase())) {
      stack.push({ el, children: el.children });
      current = el.children;
    } else if (!el.selfClosing) {
      el.selfClosing = true; // нормализуем невалидный <br> к <br/>
    }
    textStart = i;
  }
  pushText(textStart, input.length);
  if (stack.length > 0) {
    throw new StorageParseError(`unclosed element <${stack[stack.length - 1].el.name}>`, input.length);
  }
  return root;
}

/** Сериализует узлы обратно в storage. Для нетронутого дерева — побайтово. */
export function serializeStorage(nodes: XNode[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out += n.raw;
        break;
      case 'cdata':
        out += `<![CDATA[${n.text}]]>`;
        break;
      case 'comment':
        out += `<!--${n.text}-->`;
        break;
      case 'el': {
        const attrs = n.attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
        if (n.selfClosing) {
          out += `<${n.name}${attrs} />`;
        } else {
          out += `<${n.name}${attrs}>${serializeStorage(n.children)}</${n.name}>`;
        }
        break;
      }
    }
  }
  return out;
}

// Частые именованные сущности Confluence-страниц; остальное — числовые.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', shy: '­',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', times: '×', middot: '·',
  deg: '°', plusmn: '±', copy: '©', reg: '®', trade: '™',
  bull: '•', rarr: '→', larr: '←', darr: '↓', uarr: '↑',
  sect: '§', para: '¶', euro: '€',
};

/** Декодирует HTML/XML-сущности (именованные из словаря + числовые). */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (full, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(parseInt(body.slice(1), 10));
    }
    return NAMED_ENTITIES[body] ?? full;
  });
}

/** Значение атрибута элемента (декодированное) или undefined. */
export function getAttr(el: XElement, name: string): string | undefined {
  const found = el.attrs.find(([k]) => k === name);
  return found === undefined ? undefined : decodeEntities(found[1]);
}

/** Текстовое содержимое поддерева (сущности декодированы, теги отброшены). */
export function textContent(nodes: XNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += decodeEntities(n.raw);
    else if (n.kind === 'cdata') out += n.text;
    else if (n.kind === 'el') out += textContent(n.children);
  }
  return out;
}

/** true, если в поддереве есть элементы с namespace-префиксом (ac:, ri:, …). */
export function hasNamespacedElements(nodes: XNode[]): boolean {
  for (const n of nodes) {
    if (n.kind === 'el') {
      if (n.name.includes(':')) return true;
      if (hasNamespacedElements(n.children)) return true;
    }
  }
  return false;
}

/** Только элементы среди узлов. */
export function elements(nodes: XNode[]): XElement[] {
  return nodes.filter((n): n is XElement => n.kind === 'el');
}

/** Экранирует текст для XML (используется при генерации новых узлов). */
export function escapeXmlText(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}
