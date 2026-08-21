/**
 * Нативный Markdown-синтаксис для популярных макросов Confluence.
 * Сахар над маркерами <!-- MACRO:start/end -->: перед рендером native-
 * конструкции переписываются в маркеры (nativeToMarkers), а экспорт
 * (storage → md) эмитит их обратно с канонической верификацией.
 *
 * Перечень (см. README, раздел «Нативные макросы»):
 *
 *  Панели (admonition в стиле GitHub):
 *    > [!INFO] Заголовок          → info   (заголовок опционален)
 *    > [!NOTE] / [!WARNING] / [!TIP] → note / warning / tip
 *    > текст панели — обычные строки цитаты после тега.
 *
 *  Блоки-директивы (fenced ::: … :::):
 *    ::: properties [id=x] [hidden=true]   → details («Свойства страницы»;
 *      тело — обычная md-таблица)            работает с отчётом detailssummary
 *    ::: expand Заголовок                  → expand (разворачиваемый блок)
 *    ::: panel title=… borderColor=…       → panel
 *
 *  Строчные плейсхолдеры (семейство {{img:}}/{{page:}}):
 *    {{toc}} / {{toc:maxLevel=3}}          → toc (оглавление)
 *    {{children}} / {{children:depth=2}}   → children (дочерние страницы)
 *    {{jira:DR-123}}                       → jira (карточка задачи)
 *    {{jira:jql=project = DR|maximumIssues=20}} → jira (выгрузка по JQL)
 *    {{status:Готово|colour=Green}}        → status (лейбл)
 *    {{anchor:имя}}                        → anchor (якорь)
 *    {{properties-report:cql=label = "x"}} → detailssummary (отчёт по
 *                                            свойствам страниц)
 *
 * Внутри fenced-код-блоков (``` / ~~~) синтаксис не интерпретируется.
 */

import { escapeParamValue } from '../macros/builder.js';

/** Панели: тег admonition → имя макроса. */
export const NATIVE_ADMONITIONS: Record<string, string> = {
  INFO: 'info',
  NOTE: 'note',
  WARNING: 'warning',
  TIP: 'tip',
};

/** Блоки-директивы: имя директивы → имя макроса. */
export const NATIVE_DIRECTIVES: Record<string, string> = {
  properties: 'details',
  expand: 'expand',
  panel: 'panel',
};

/** Строчные плейсхолдеры: имя → имя макроса. */
export const NATIVE_PLACEHOLDERS: Record<string, string> = {
  toc: 'toc',
  children: 'children',
  jira: 'jira',
  status: 'status',
  anchor: 'anchor',
  'properties-report': 'detailssummary',
};

/** Полный перечень макросов с нативной md-разметкой (для документации/UI). */
export function nativeMacroList(): { macro: string; syntax: string }[] {
  return [
    { macro: 'info', syntax: '> [!INFO] Заголовок?' },
    { macro: 'note', syntax: '> [!NOTE] Заголовок?' },
    { macro: 'warning', syntax: '> [!WARNING] Заголовок?' },
    { macro: 'tip', syntax: '> [!TIP] Заголовок?' },
    { macro: 'details', syntax: '::: properties [id=…] [hidden=true] … :::' },
    { macro: 'expand', syntax: '::: expand Заголовок … :::' },
    { macro: 'panel', syntax: '::: panel title=… … :::' },
    { macro: 'toc', syntax: '{{toc}} | {{toc:maxLevel=3}}' },
    { macro: 'children', syntax: '{{children}} | {{children:depth=2}}' },
    { macro: 'jira', syntax: '{{jira:KEY-1}} | {{jira:jql=…|maximumIssues=20}}' },
    { macro: 'status', syntax: '{{status:Текст|colour=Green|subtle=true}}' },
    { macro: 'anchor', syntax: '{{anchor:имя}}' },
    { macro: 'detailssummary', syntax: '{{properties-report:cql=…|firstcolumn=…}}' },
  ];
}

const ADMONITION_FIRST_RE = /^>\s*\[!([A-Za-z]+)\]\s*(.*)$/;
const DIRECTIVE_OPEN_RE = /^:::\s+([a-z-]+)(?:\s+(.*?))?\s*$/;
const DIRECTIVE_CLOSE_RE = /^:::\s*$/;
const PLACEHOLDER_INLINE_RE = /\{\{(toc|children|jira|status|anchor|properties-report)(?::((?:[^{}]|\{[^{])*?))?\}\}/g;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

interface Param { name: string; value: string }

/** Компактная пара маркеров без тела — для строчного контекста. */
function inlineMarker(macroName: string, params: Param[]): string {
  const paramStr = params.length
    ? ':' + params.map((p) => `${escapeParamValue(p.name)}=${escapeParamValue(p.value)}`).join(':')
    : '';
  return `<!-- MACRO:start:${macroName}${paramStr} --><!-- MACRO:end:${macroName} -->`;
}

function blockMarker(macroName: string, params: Param[], body: string): string {
  const paramStr = params.length
    ? ':' + params.map((p) => `${escapeParamValue(p.name)}=${escapeParamValue(p.value)}`).join(':')
    : '';
  return `<!-- MACRO:start:${macroName}${paramStr} -->\n${body}\n<!-- MACRO:end:${macroName} -->`;
}

/** `a|b=c|d=e` → первый сегмент + пары; поведение как у parsePlaceholder. */
function splitAttrs(raw: string): { head: string; attrs: Param[] } {
  const parts = raw.split('|');
  const attrs: Param[] = [];
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) attrs.push({ name: part.trim(), value: '' });
    else attrs.push({ name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() });
  }
  return { head: parts[0].trim(), attrs };
}

/** Параметры плейсхолдера → параметры макроса Confluence. */
function placeholderParams(kind: string, raw: string | undefined): Param[] {
  if (raw === undefined || raw.trim() === '') return [];
  const { head, attrs } = splitAttrs(raw);
  const params: Param[] = [];
  const headIsPair = head.includes('=');
  if (headIsPair) {
    const eq = head.indexOf('=');
    attrs.unshift({ name: head.slice(0, eq).trim(), value: head.slice(eq + 1).trim() });
  }
  switch (kind) {
    case 'jira':
      if (!headIsPair && head !== '') params.push({ name: 'key', value: head });
      break;
    case 'status':
      if (!headIsPair && head !== '') params.push({ name: 'title', value: head });
      break;
    case 'anchor':
      if (!headIsPair && head !== '') params.push({ name: 'name', value: head });
      break;
    default:
      // toc/children/properties-report: только k=v-атрибуты.
      if (!headIsPair && head !== '') params.push({ name: head, value: '' });
  }
  for (const a of attrs) {
    // jira: короткое `jql=` — алиас родного jqlQuery.
    if (kind === 'jira' && a.name === 'jql') params.push({ name: 'jqlQuery', value: a.value });
    else params.push(a);
  }
  return params;
}

function replaceInline(line: string): string {
  return line.replace(PLACEHOLDER_INLINE_RE, (_full, kind: string, raw: string | undefined) =>
    inlineMarker(NATIVE_PLACEHOLDERS[kind], placeholderParams(kind, raw)));
}

/** Параметры директивы: токены `k=v` (значение можно в кавычках) + свободный текст → title. */
function directiveParams(name: string, rest: string | undefined): Param[] {
  const params: Param[] = [];
  if (!rest) return params;
  const free: string[] = [];
  const re = /([A-Za-z-]+)=("([^"]*)"|\S+)|(\S+)/g;
  for (const m of rest.matchAll(re)) {
    if (m[1]) params.push({ name: m[1], value: m[3] ?? m[2] });
    else free.push(m[4]);
  }
  if (free.length && name === 'expand') params.unshift({ name: 'title', value: free.join(' ') });
  return params;
}

/**
 * Переписывает нативные конструкции в маркеры макросов. Идемпотентна для
 * текста без нативного синтаксиса; содержимое fenced-код-блоков не трогает.
 */
export function nativeToMarkers(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fm = FENCE_RE.exec(line);
    if (fm) {
      if (fence === null) fence = fm[1][0];
      else if (fm[1][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence !== null) { out.push(line); continue; }

    // ── Панели: > [!TYPE] Заголовок? ─────────────────────────────────────
    const am = ADMONITION_FIRST_RE.exec(line);
    const macroName = am ? NATIVE_ADMONITIONS[am[1].toUpperCase()] : undefined;
    if (am && macroName) {
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && /^>( |$)/.test(lines[j]); j++) {
        body.push(lines[j].replace(/^> ?/, ''));
      }
      const params: Param[] = am[2].trim() ? [{ name: 'title', value: am[2].trim() }] : [];
      out.push(blockMarker(macroName, params, nativeToMarkers(body.join('\n'))));
      i = j - 1;
      continue;
    }

    // ── Директивы: ::: name … / ::: ──────────────────────────────────────
    const dm = DIRECTIVE_OPEN_RE.exec(line);
    const dirMacro = dm ? NATIVE_DIRECTIVES[dm[1]] : undefined;
    if (dm && dirMacro) {
      const body: string[] = [];
      let j = i + 1;
      let innerFence: string | null = null;
      let closed = false;
      for (; j < lines.length; j++) {
        const bl = lines[j];
        const bfm = FENCE_RE.exec(bl);
        if (bfm) {
          if (innerFence === null) innerFence = bfm[1][0];
          else if (bfm[1][0] === innerFence) innerFence = null;
        } else if (innerFence === null && DIRECTIVE_CLOSE_RE.test(bl)) { closed = true; break; }
        body.push(bl);
      }
      if (closed) {
        out.push(blockMarker(dirMacro, directiveParams(dm[1], dm[2]), nativeToMarkers(body.join('\n'))));
        i = j;
        continue;
      }
      // Незакрытая директива — оставляем как текст.
    }

    out.push(replaceInline(line));
  }

  return out.join('\n');
}
