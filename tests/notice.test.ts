import { describe, expect, it } from 'vitest';
import {
  buildManagedNotice,
  applyManagedNotice,
  DEFAULT_MANAGED_NOTICE_LINK_TEXT,
} from '../src/publish/notice.js';

describe('buildManagedNotice', () => {
  it('renders an info panel with the default text and a link', () => {
    const html = buildManagedNotice({ linkUrl: 'https://studio.example/doc/42' });
    expect(html).toContain('<ac:structured-macro ac:name="info"');
    expect(html).toContain('<ac:rich-text-body><p>');
    expect(html).toContain('<a href="https://studio.example/doc/42">');
    expect(html).toContain(`>${DEFAULT_MANAGED_NOTICE_LINK_TEXT}</a>`);
    // текст источника вместо {link}-плейсхолдера
    expect(html).not.toContain('{link}');
  });

  it('substitutes {link} inline in a custom text', () => {
    const html = buildManagedNotice({
      linkUrl: 'https://studio.example/x',
      linkText: 'постановка',
      text: 'Правьте в {link}. Тут — только чтение.',
    });
    expect(html).toContain('Правьте в <a href="https://studio.example/x">постановка</a>. Тут — только чтение.');
  });

  it('appends the link when the text has no {link} placeholder', () => {
    const html = buildManagedNotice({
      linkUrl: 'https://studio.example/x',
      text: 'Не редактировать здесь.',
    });
    expect(html).toContain('Не редактировать здесь. <a href="https://studio.example/x">');
  });

  it('honours the panel type', () => {
    const html = buildManagedNotice({ linkUrl: 'https://s/x', panel: 'warning' });
    expect(html).toContain('ac:name="warning"');
  });

  it('escapes the URL and link/notice text', () => {
    const html = buildManagedNotice({
      linkUrl: 'https://s/x?a=1&b=2',
      linkText: '<studio>',
      text: 'A & B {link}',
    });
    expect(html).toContain('href="https://s/x?a=1&amp;b=2"');
    expect(html).toContain('&lt;studio&gt;');
    expect(html).toContain('A &amp; B <a');
  });

  it('is deterministic — same options produce byte-identical storage', () => {
    const opts = { linkUrl: 'https://s/x', text: 'hi {link}' } as const;
    expect(buildManagedNotice(opts)).toBe(buildManagedNotice(opts));
    // фиксированный macro-id (иначе content-hash менялся бы каждую публикацию)
    expect(buildManagedNotice(opts)).toContain('ac:macro-id="0f0e0d0c-0b0a-4009-8008-000000000001"');
  });

  it('throws without a linkUrl', () => {
    // @ts-expect-error linkUrl обязателен
    expect(() => buildManagedNotice({})).toThrow(/linkUrl is required/);
  });
});

describe('applyManagedNotice', () => {
  const body = '<p>body</p>';

  it('prepends by default (top)', () => {
    const out = applyManagedNotice(body, { linkUrl: 'https://s/x' });
    expect(out.endsWith(body)).toBe(true);
    expect(out.indexOf('structured-macro')).toBeLessThan(out.indexOf('<p>body</p>'));
  });

  it('appends when position is bottom', () => {
    const out = applyManagedNotice(body, { linkUrl: 'https://s/x', position: 'bottom' });
    expect(out.startsWith(body)).toBe(true);
    expect(out.indexOf('<p>body</p>')).toBeLessThan(out.indexOf('structured-macro'));
  });
});
