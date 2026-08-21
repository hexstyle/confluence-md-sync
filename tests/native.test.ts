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

  it('подчёркивания в ячейках свойств экранируются, но storage стабилен', () => {
    const md = '::: properties\n| К | З |\n| --- | --- |\n| Код | DS_X |\n:::';
    const first = roundTrip(md);
    expect(first.back).toContain('DS\\_X');
    // Повторный цикл literal-стабилен, storage канонически совпадает.
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
