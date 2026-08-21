// Нативный md-синтаксис макросов: панели (admonition), ::: properties/expand,
// строчные {{toc}}/{{jira}}/… — рендер в storage и обратный экспорт (round-trip).
import { describe, expect, it } from 'vitest';
import { renderToStorage } from '../src/markdown/render.js';
import { processMacros } from '../src/macros/registry.js';
import { defaultMacroRegistry, nativeToMarkers, nativeMacroList } from '../src/index.js';
import { storageToMarkdown } from '../src/export/to-markdown.js';
import { compareStorage } from '../src/export/canonical.js';

const urls = { images: new Map<string, string>(), files: new Map<string, string>() };

function toStorage(md: string): string {
  const storage = renderToStorage(md, urls, { linkify: false });
  return processMacros(storage, defaultMacroRegistry).toString();
}

/** md → storage → md: экспорт обязан вернуть исходный нативный синтаксис. */
function roundTrip(md: string): { storage: string; back: string; native: number } {
  const storage = toStorage(md);
  const res = storageToMarkdown(storage);
  return { storage, back: res.markdown, native: res.stats.native };
}

describe('nativeToMarkers', () => {
  it('панель с заголовком и телом', () => {
    const out = nativeToMarkers('> [!INFO] Важно\n> первая строка\n> вторая');
    expect(out).toContain('<!-- MACRO:start:info:title=Важно -->');
    expect(out).toContain('первая строка\nвторая');
    expect(out).toContain('<!-- MACRO:end:info -->');
  });

  it('не трогает fenced-код', () => {
    const src = '```\n> [!NOTE]\n> текст\n{{toc}}\n```';
    expect(nativeToMarkers(src)).toBe(src);
  });

  it('строчный плейсхолдер внутри абзаца', () => {
    const out = nativeToMarkers('Статус: {{status:Готово|colour=Green}} — ок');
    expect(out).toContain('<!-- MACRO:start:status:title=Готово:colour=Green --><!-- MACRO:end:status -->');
  });

  it('jira: ключ и jql-алиас', () => {
    expect(nativeToMarkers('{{jira:DR-123}}')).toContain('MACRO:start:jira:key=DR-123');
    expect(nativeToMarkers('{{jira:jql=project %3D DR|maximumIssues=20}}'))
      .toContain('MACRO:start:jira:jqlQuery=project %253D DR:maximumIssues=20');
  });
});

describe('render → storage', () => {
  it('admonition → структурный макрос', () => {
    const st = toStorage('> [!WARNING] Осторожно\n> Не редактируйте вручную.');
    expect(st).toContain('ac:name="warning"');
    expect(st).toContain('<ac:parameter ac:name="title">Осторожно</ac:parameter>');
    expect(st).toContain('Не редактируйте вручную.');
  });

  it('::: properties → details с таблицей (Свойства страницы)', () => {
    const st = toStorage('::: properties\n| Название | Значение |\n| --- | --- |\n| Код | DS_X |\n:::');
    expect(st).toContain('ac:name="details"');
    expect(st).toContain('<ac:rich-text-body>');
    expect(st).toContain('<td>DS_X</td>');
  });

  it('{{properties-report:…}} → detailssummary', () => {
    const st = toStorage('{{properties-report:cql=label = "ds"|firstcolumn=Код}}');
    expect(st).toContain('ac:name="detailssummary"');
    expect(st).toContain('<ac:parameter ac:name="cql">label = &quot;ds&quot;</ac:parameter>');
  });

  it('{{toc}} и {{children:depth=2}}', () => {
    expect(toStorage('{{toc}}')).toContain('ac:name="toc"');
    const st = toStorage('{{children:depth=2}}');
    expect(st).toContain('ac:name="children"');
    expect(st).toContain('<ac:parameter ac:name="depth">2</ac:parameter>');
  });
});

describe('round-trip (storage → нативный md)', () => {
  it.each([
    ['панель info с заголовком', '> [!INFO] Важно\n> Страница управляется из git.'],
    ['панель note без заголовка', '> [!NOTE]\n> Просто примечание.'],
    ['панель warning многострочная', '> [!WARNING]\n> Первая.\n>\n> Вторая.'],
    ['свойства страницы', '::: properties\n| Название | Значение |\n| --- | --- |\n| Код | DS-X |\n| Версия | 1 |\n:::'],
    ['свойства с id и hidden', '::: properties id=meta hidden=true\n| К | З |\n| --- | --- |\n| а | б |\n:::'],
    ['expand с заголовком', '::: expand Детали\nСкрытый текст.\n:::'],
    ['toc', '{{toc}}'],
    ['toc с параметром', '{{toc:maxLevel=3}}'],
    ['children', '{{children}}'],
    ['status', '{{status:Готово|colour=Green}}'],
    ['jira по ключу', '{{jira:DR-123}}'],
    ['anchor', '{{anchor:метка}}'],
    ['properties-report', '{{properties-report:firstcolumn=Код}}'],
  ])('%s', (_label, md) => {
    const { back, native } = roundTrip(md);
    expect(back.trim()).toBe(md.trim());
    expect(native).toBeGreaterThan(0);
  });

  it('внутрисловное подчёркивание в ячейках не экранируется, storage стабилен', () => {
    const md = '::: properties\n| К | З |\n| --- | --- |\n| Код | DS_X |\n:::';
    const first = roundTrip(md);
    // Внутрисловное `_` — литерал по CommonMark, обратный слэш не нужен.
    expect(first.back).toContain('DS_X');
    expect(first.back).not.toContain('DS\\_X');
    // Повторный цикл literal-стабилен, storage канонически совпадает.
    const second = roundTrip(first.back);
    expect(second.back.trim()).toBe(first.back.trim());
    expect(compareStorage(toStorage(first.back), toStorage(md)).equal).toBe(true);
  });

  it('граничное подчёркивание в ячейках экранируется (защита от акцента)', () => {
    // `_` у пробелов — не курсив, а литерал; на границе слова его надо
    // экранировать, чтобы при повторном рендере он не открыл акцент.
    const md = '::: properties\n| К | З |\n| --- | --- |\n| Код | a _ b |\n:::';
    const first = roundTrip(md);
    expect(first.back).toContain('a \\_ b');
    const second = roundTrip(first.back);
    expect(second.back.trim()).toBe(first.back.trim());
    expect(compareStorage(toStorage(first.back), toStorage(md)).equal).toBe(true);
  });

  it('второй прогон стабилен (идемпотентность)', () => {
    const md = '> [!INFO] Важно\n> Тело.\n\n{{toc}}';
    const once = roundTrip(md).back;
    expect(roundTrip(once).back.trim()).toBe(once.trim());
  });

  it('макрос вне перечня остаётся маркером', () => {
    const md = '<!-- MACRO:start:portfolio-for-jira-plan:url=https%3A//x -->\n\n<!-- MACRO:end:portfolio-for-jira-plan -->';
    const { back, native } = roundTrip(md);
    expect(back).toContain('MACRO:start:portfolio-for-jira-plan');
    expect(native).toBe(0);
  });
});

describe('nativeMacroList', () => {
  it('перечень непуст и содержит details/jira/note', () => {
    const names = nativeMacroList().map((x) => x.macro);
    expect(names).toContain('details');
    expect(names).toContain('jira');
    expect(names).toContain('note');
  });
});

describe('details: сложная таблица нормализуется в md-таблицу', () => {
  it('th-строки, colgroup и стили → ::: properties с GFM-таблицей', () => {
    const storage =
      '<ac:structured-macro ac:name="details" ac:schema-version="1" ac:macro-id="m1">' +
      '<ac:rich-text-body>' +
      '<table class="relative-table" style="width: 60%;"><colgroup><col style="width:20%;" /><col /></colgroup><tbody>' +
      '<tr><th scope="row">Название</th><td><span style="color: rgb(0,0,0);">Dataset X</span></td></tr>' +
      '<tr><th>Код</th><td><p>DS-X</p></td></tr>' +
      '<tr><th>Версия</th><td>1</td></tr>' +
      '</tbody></table></ac:rich-text-body></ac:structured-macro>';
    const res = storageToMarkdown(storage);
    expect(res.stats.normalized).toBe(1);
    expect(res.markdown).toContain('::: properties');
    expect(res.markdown).toContain('| Поле | Значение |');
    expect(res.markdown).toContain('| Название | Dataset X |');
    expect(res.markdown).toContain('| Код | DS-X |');
    expect(res.markdown).not.toContain('confluence-storage');
    // Обратный рендер даёт настоящий details, повторный экспорт уже строгий (без потерь).
    const st2 = toStorage(res.markdown);
    expect(st2).toContain('ac:name="details"');
    const res2 = storageToMarkdown(st2);
    expect(res2.stats.normalized).toBe(0);
    expect(res2.markdown.trim()).toBe(res.markdown.trim());
  });

  it('нумерационная колонка Confluence отбрасывается', () => {
    const storage =
      '<ac:structured-macro ac:name="details" ac:macro-id="m2"><ac:rich-text-body>' +
      '<table><tbody>' +
      '<tr><td class="numberingColumn"><br /></td><th>Код</th><td>DS-Y</td></tr>' +
      '<tr><td class="numberingColumn"><br /></td><th>Версия</th><td>2</td></tr>' +
      '</tbody></table></ac:rich-text-body></ac:structured-macro>';
    const res = storageToMarkdown(storage);
    expect(res.stats.normalized).toBe(1);
    expect(res.markdown).toContain('| Код | DS-Y |');
  });
});

describe('readable-режим сохраняет нативные макросы', () => {
  it('details → ::: properties, панель → admonition (не readableMacro)', () => {
    const st = toStorage('> [!NOTE] Важно\n> Текст.\n\n::: properties\n| К | З |\n| --- | --- |\n| Код | X |\n:::');
    const res = storageToMarkdown(st, { mode: 'readable' });
    expect(res.markdown).toContain('> [!NOTE] Важно');
    expect(res.markdown).toContain('::: properties');
    expect(res.markdown).toContain('| Код | X |');
    expect(res.markdown).not.toContain('_[macro:');
  });
});

describe('managedNotice не попадает в экспорт', () => {
  it('макрос с фиксированным NOTICE_MACRO_ID выбрасывается в обоих режимах', () => {
    const banner = '<ac:structured-macro ac:name="info" ac:schema-version="1" ac:macro-id="0f0e0d0c-0b0a-4009-8008-000000000001"><ac:rich-text-body><p>Страница управляется из git. <a href="https://x">Редактировать</a>.</p></ac:rich-text-body></ac:structured-macro>';
    const storage = banner + '<h1>Заголовок</h1><p>Текст.</p>';
    for (const mode of ['faithful', 'readable'] as const) {
      const r = storageToMarkdown(storage, { mode });
      expect(r.markdown).not.toContain('Редактировать');
      expect(r.markdown).toContain('# Заголовок');
    }
  });
});

describe('details: ссылки в ячейках свойств не теряются', () => {
  it('ac:link → ri:page без текста тела остаётся {{page:…}} при нормализации', () => {
    const storage =
      '<ac:structured-macro ac:name="details" ac:macro-id="m3"><ac:rich-text-body>' +
      '<table class="wrapped"><tbody>' +
      '<tr><th>Код системы</th><td><ac:link><ri:page ri:content-title="Паспорт SYS_X" /></ac:link></td></tr>' +
      '</tbody></table></ac:rich-text-body></ac:structured-macro>';
    const res = storageToMarkdown(storage, { mode: 'readable' });
    expect(res.markdown).toContain('{{page:Паспорт SYS_X}}');
    expect(res.markdown).not.toMatch(/\| Код системы \|\s*\|/);
  });
});
