/**
 * Канонизация storage-деревьев и сравнение «без потери разметки».
 *
 * Побайтовое равенство storage → md → storage недостижимо и не нужно:
 * Confluence сам нормализует storage при каждом сохранении, ac:macro-id
 * генерируется заново, markdown-it меняет форму сущностей. Критерий
 * эквивалентности: XML-деревья равны после канонизации —
 *  - ac:macro-id / ac:schema-version отброшены;
 *  - сущности декодированы, пробельные последовательности схлопнуты;
 *  - пробельные text-узлы между блочными элементами удалены;
 *  - краевые пробелы вынесены из инлайн-форматирования
 *    (<strong>a </strong>b ≡ <strong>a</strong> b);
 *  - параметры макросов отсортированы по имени;
 *  - <img src=…> ≡ <ac:image><ri:url ri:value=…/></ac:image>;
 *  - атрибуты отсортированы по имени.
 */

import { decodeEntities, parseStorage, type XElement, type XNode } from './xhtml.js';

/** Канонический узел: element | text (после нормализации). */
export type CNode =
  | { kind: 'el'; name: string; attrs: Record<string, string>; children: CNode[] }
  | { kind: 'text'; text: string };

// Элементы, внутри которых пробелы значимы и не схлопываются.
const PRESERVE_WS = new Set(['pre', 'ac:plain-text-body', 'ac:plain-text-link-body']);

// Инлайн-форматирование: краевые пробелы выносим наружу, пустые узлы убираем.
const INLINE_FORMATTING = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'span', 'sub', 'sup']);

// Блочные элементы: пробельный текст рядом с ними — форматирование исходника.
const BLOCK_LEVEL = new Set([
  'p', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ac:structured-macro', 'ac:rich-text-body', 'ac:parameter', 'ac:plain-text-body',
  'ac:layout', 'ac:layout-section', 'ac:layout-cell', 'ac:task-list', 'ac:task',
]);

const DROP_ATTRS = new Set(['ac:macro-id', 'ac:schema-version']);

function isWsOnly(s: string): boolean {
  return /^[ \t\r\n]*$/.test(s);
}

function collapseWs(s: string): string {
  return s.replace(/[ \t\r\n]+/g, ' ');
}

export function canonicalize(nodes: XNode[]): CNode[] {
  return normalizeChildren(nodes, /* preserveWs */ false, /* inlineContainer */ false);
}

function normalizeChildren(nodes: XNode[], preserveWs: boolean, inlineContainer: boolean): CNode[] {
  // 1. Узлы → канонические (рекурсивно), комментарии отбрасываются.
  let out: CNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'comment') continue;
    if (n.kind === 'cdata') {
      out.push({ kind: 'text', text: n.text });
      continue;
    }
    if (n.kind === 'text') {
      out.push({ kind: 'text', text: decodeEntities(n.raw) });
      continue;
    }
    out.push(canonicalizeElement(n));
  }

  if (!preserveWs) {
    // 2. Пробельный text-узел между блочными границами (блочный элемент
    //    или край контейнера) — форматирование исходника, удаляем.
    //    Между инлайн-элементами (спанами) пробел значим — остаётся.
    out = out.filter((node, idx) => {
      if (node.kind !== 'text' || !isWsOnly(node.text)) return true;
      const prev = out[idx - 1];
      const next = out[idx + 1];
      const prevBoundary = prev === undefined || (prev.kind === 'el' && BLOCK_LEVEL.has(prev.name));
      const nextBoundary = next === undefined || (next.kind === 'el' && BLOCK_LEVEL.has(next.name));
      return !(prevBoundary && nextBoundary);
    });
    for (const node of out) {
      if (node.kind === 'text') node.text = collapseWs(node.text);
    }

    // 3. Краевые пробелы инлайн-форматирования — наружу; пустые узлы —
    //    прочь; смежные одноимённые (без атрибутов) — в один:
    //    <strong>a</strong><strong>b</strong> ≡ <strong>ab</strong>.
    out = mergeAdjacentFormatting(hoistEdgeWhitespace(out));

    // 4. Соседние text-узлы сливаем, схлопываем повторно. Края обрезаем
    //    только в блочном контексте: краевой пробел ВНУТРИ инлайн-элемента
    //    значим — его выносит наружу hoistEdgeWhitespace на уровне родителя.
    out = mergeTexts(out);
    if (inlineContainer) return out;
    if (out.length > 0) {
      const first = out[0];
      if (first.kind === 'text') {
        first.text = first.text.replace(/^ +/, '');
        if (first.text === '') out.shift();
      }
    }
    if (out.length > 0) {
      const last = out[out.length - 1];
      if (last.kind === 'text') {
        last.text = last.text.replace(/ +$/, '');
        if (last.text === '') out.pop();
      }
    }
  }
  return out;
}

function canonicalizeElement(el: XElement): CNode {
  // <img src=…> и <ac:image><ri:url ri:value=…/></ac:image> — одно и то же
  // изображение по внешнему URL; канонизируем к форме ac:image.
  if (el.name === 'img') {
    const attrs: Record<string, string> = {};
    let url = '';
    for (const [k, v] of el.attrs) {
      const value = decodeEntities(v);
      if (k === 'src') url = value;
      else if (k === 'alt' && value === '') continue;
      else if (k === 'alt') attrs['ac:alt'] = value;
      else attrs[`ac:${k}`] = value;
    }
    return {
      kind: 'el',
      name: 'ac:image',
      attrs,
      children: [{ kind: 'el', name: 'ri:url', attrs: { 'ri:value': url }, children: [] }],
    };
  }

  const attrs: Record<string, string> = {};
  for (const [k, v] of el.attrs) {
    if (DROP_ATTRS.has(k)) continue;
    const value = decodeEntities(v);
    if (el.name === 'ac:image' && k === 'ac:alt' && value === '') continue;
    attrs[k] = value;
  }

  const preserve = PRESERVE_WS.has(el.name);
  let children = normalizeChildren(el.children, preserve, INLINE_FORMATTING.has(el.name));

  // <p><ac:structured-macro/></p> ≡ <ac:structured-macro/> — обёртка
  // блочного макроса в абзац не влияет на рендер Confluence.
  if (
    el.name === 'p' && el.attrs.length === 0 && children.length === 1 &&
    children[0].kind === 'el' && children[0].name === 'ac:structured-macro'
  ) {
    return children[0];
  }

  // Параметры макроса не зависят от порядка — сортируем по ac:name.
  if (el.name === 'ac:structured-macro') {
    children = [...children].sort((a, b) => {
      const an = a.kind === 'el' && a.name === 'ac:parameter' ? (a.attrs['ac:name'] ?? '') : '￿';
      const bn = b.kind === 'el' && b.name === 'ac:parameter' ? (b.attrs['ac:name'] ?? '') : '￿';
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
  }

  return { kind: 'el', name: el.name, attrs, children };
}

/** `<strong>a </strong>b` → `<strong>a</strong> b` (рекурсивно, для сравнения). */
function hoistEdgeWhitespace(nodes: CNode[]): CNode[] {
  const out: CNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'el' || !INLINE_FORMATTING.has(node.name)) {
      out.push(node);
      continue;
    }
    let leading = '';
    let trailing = '';
    const kids = node.children;
    if (kids.length > 0 && kids[0].kind === 'text') {
      const m = kids[0].text.match(/^ +/);
      if (m) {
        leading = ' ';
        kids[0].text = kids[0].text.slice(m[0].length);
      }
    }
    if (kids.length > 0) {
      const last = kids[kids.length - 1];
      if (last.kind === 'text') {
        const m = last.text.match(/ +$/);
        if (m) {
          trailing = ' ';
          last.text = last.text.slice(0, -m[0].length);
        }
      }
    }
    node.children = mergeTexts(kids.filter((k) => !(k.kind === 'text' && k.text === '')));
    if (leading) out.push({ kind: 'text', text: leading });
    if (node.children.length > 0) out.push(node);
    if (trailing) out.push({ kind: 'text', text: trailing });
  }
  return out;
}

function mergeAdjacentFormatting(nodes: CNode[]): CNode[] {
  const out: CNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (
      n.kind === 'el' && INLINE_FORMATTING.has(n.name) && Object.keys(n.attrs).length === 0 &&
      prev !== undefined && prev.kind === 'el' && prev.name === n.name && Object.keys(prev.attrs).length === 0
    ) {
      prev.children = mergeTexts([...prev.children, ...n.children]);
    } else {
      out.push(n);
    }
  }
  return out;
}

function mergeTexts(nodes: CNode[]): CNode[] {
  const out: CNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.kind === 'text' && prev !== undefined && prev.kind === 'text') {
      prev.text = collapseWs(prev.text + node.text);
    } else {
      out.push(node);
    }
  }
  return out;
}

// ── Сравнение ───────────────────────────────────────────────────────────

export interface StorageDiff {
  path: string;
  message: string;
}

export interface CompareResult {
  equal: boolean;
  diffs: StorageDiff[];
}

/** Сравнивает два storage-фрагмента с точностью до канонизации. */
export function compareStorage(a: string, b: string, maxDiffs = 20): CompareResult {
  const ca = canonicalize(parseStorage(a));
  const cb = canonicalize(parseStorage(b));
  const diffs: StorageDiff[] = [];
  diffNodes(ca, cb, 'root', diffs, maxDiffs);
  return { equal: diffs.length === 0, diffs };
}

function excerpt(n: CNode | undefined): string {
  if (n === undefined) return '(none)';
  if (n.kind === 'text') return `text ${JSON.stringify(n.text.slice(0, 80))}`;
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v.slice(0, 40)}"`).join('');
  return `<${n.name}${attrs.slice(0, 120)}>`;
}

function diffNodes(a: CNode[], b: CNode[], path: string, diffs: StorageDiff[], max: number): void {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len && diffs.length < max; i++) {
    const na = a[i];
    const nb = b[i];
    const p = `${path}[${i}]`;
    if (na === undefined || nb === undefined) {
      diffs.push({ path: p, message: `node mismatch: ${excerpt(na)} vs ${excerpt(nb)}` });
      continue;
    }
    if (na.kind !== nb.kind) {
      diffs.push({ path: p, message: `kind mismatch: ${excerpt(na)} vs ${excerpt(nb)}` });
      continue;
    }
    if (na.kind === 'text' && nb.kind === 'text') {
      if (na.text !== nb.text) {
        diffs.push({ path: p, message: `text differs: ${JSON.stringify(na.text.slice(0, 120))} vs ${JSON.stringify(nb.text.slice(0, 120))}` });
      }
      continue;
    }
    if (na.kind === 'el' && nb.kind === 'el') {
      const childPath = `${p}<${na.name}>`;
      if (na.name !== nb.name) {
        diffs.push({ path: p, message: `element differs: <${na.name}> vs <${nb.name}>` });
        continue;
      }
      const keys = new Set([...Object.keys(na.attrs), ...Object.keys(nb.attrs)]);
      for (const k of keys) {
        if (na.attrs[k] !== nb.attrs[k]) {
          diffs.push({
            path: childPath,
            message: `attr ${k}: ${JSON.stringify(na.attrs[k] ?? null)} vs ${JSON.stringify(nb.attrs[k] ?? null)}`,
          });
        }
      }
      diffNodes(na.children, nb.children, childPath, diffs, max);
    }
  }
}
