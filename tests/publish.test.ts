import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishPage } from '../src/publish/publish.js';
import type { ConfluenceConfig } from '../src/client/config.js';

// Встроенный фейк Confluence REST: держит одну страницу и одно content
// property в памяти, отвечает по тем же путям, что дёргает ConfluenceClient.
// Так весь конвейер publishPage (getPageStorage + getContentProperty →
// решение → updatePage → setContentProperty) проверяется сквозь реальный fetch.
interface HashProp {
  hash?: string;
  scheme?: number;
  pageVersion?: number;
}
interface FakeState {
  page: { title: string; version: number; storage: string };
  property: { value: HashProp; version: number } | null;
  puts: number; // сколько раз вызвали updatePage (PUT страницы)
}

let server: Server;
let baseUrl: string;
let state: FakeState;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const parse = (): any => (raw ? JSON.parse(raw) : {});
      const send = (code: number, obj: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      };

      // content property: GET (read) и PUT (update) по /property/{key}
      if (/^\/rest\/api\/content\/[^/]+\/property\/[^/?]+$/.test(url)) {
        if (method === 'GET') {
          if (!state.property) return send(404, { message: 'not found' });
          return send(200, {
            value: state.property.value,
            version: { number: state.property.version },
          });
        }
        if (method === 'PUT') {
          const b = parse();
          state.property = { value: b.value, version: b.version?.number ?? 1 };
          return send(200, { key: b.key });
        }
      }
      // content property: POST (create) по /property
      if (/^\/rest\/api\/content\/[^/]+\/property$/.test(url) && method === 'POST') {
        const b = parse();
        state.property = { value: b.value, version: 1 };
        return send(200, { key: b.key });
      }
      // страница: GET с ?expand=body.storage,version
      if (/^\/rest\/api\/content\/[^/?]+\?/.test(url) && method === 'GET') {
        return send(200, {
          title: state.page.title,
          body: { storage: { value: state.page.storage } },
          version: { number: state.page.version },
        });
      }
      // страница: PUT (updatePage) — возвращаем актуальный version.number
      if (/^\/rest\/api\/content\/[^/?]+$/.test(url) && method === 'PUT') {
        const b = parse();
        state.page.title = b.title;
        state.page.version = b.version.number;
        state.page.storage = b.body.storage.value;
        state.puts++;
        return send(200, { id: b.id, version: { number: state.page.version } });
      }
      send(500, { message: `unhandled ${method} ${url}` });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  state = {
    page: { title: 'Doc', version: 1, storage: '<p>seed</p>' },
    property: null,
    puts: 0,
  };
});

const cfg = (): ConfluenceConfig => ({ baseUrl, token: 'secret' });
const MD = '# Doc\n\nHello world.';
const pub = (opts: Record<string, unknown> = {}) =>
  publishPage({ pageId: '123', markdown: MD, ...opts }, cfg());

describe('publishPage drift guard (pageVersion in content property)', () => {
  it('(б) republish with nothing changed → UNCHANGED, no new version', async () => {
    const first = await pub();
    expect(first.updated).toBe(true);
    expect(first.version).toBe(2);
    expect(state.property?.value.scheme).toBe(3);
    expect(state.property?.value.pageVersion).toBe(2);

    const second = await pub();
    expect(second.updated).toBe(false);
    expect(second.version).toBe(2);
    expect(state.puts).toBe(1); // второго PUT страницы не было
  });

  it('(а) manual edit (version bumped, md hash unchanged) → republished as DRIFT', async () => {
    await pub(); // публикатор записал pageVersion=2
    // Страницу правят мимо публикатора: версия выросла, тело зачищено,
    // hash-свойство не тронуто.
    state.page.version = 8;
    state.page.storage = '';

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const res = await pub();
    spy.mockRestore();

    expect(res.updated).toBe(true);
    expect(res.version).toBe(9); // 8 + 1
    expect(state.property?.value.pageVersion).toBe(9);
    expect(logs.join('\n')).toContain('DRIFT (page v8 != published v2)');
  });

  it('(в) legacy property without pageVersion (scheme 2) → publishes once, then UNCHANGED', async () => {
    // Старое свойство: hash есть, но версия неизвестна (нет pageVersion).
    state.property = { value: { hash: 'deadbeef', scheme: 2 }, version: 1 };

    const first = await pub();
    expect(first.updated).toBe(true); // одна принудительная публикация
    expect(state.property?.value.scheme).toBe(3);
    expect(state.property?.value.pageVersion).toBe(2);

    const second = await pub();
    expect(second.updated).toBe(false); // дальше уже стабильно UNCHANGED
    expect(state.puts).toBe(1);
  });

  it('(г) title change at equal content hash → still publishes (no regression)', async () => {
    await pub(); // title 'Doc', pageVersion 2
    const res = await pub({ title: 'Renamed' });
    expect(res.updated).toBe(true);
    expect(res.title).toBe('Renamed');
    expect(state.page.title).toBe('Renamed');
    expect(res.version).toBe(3);
  });

  it('(д) after update the property carries the resulting version → next run UNCHANGED', async () => {
    await pub();
    // Свойство несёт именно ту версию, что получилась после нашей записи.
    expect(state.property?.value.pageVersion).toBe(state.page.version);

    const again = await pub();
    expect(again.updated).toBe(false);
    expect(state.puts).toBe(1);
  });
});

describe('publishPage managed-notice banner', () => {
  const notice = { linkUrl: 'https://studio.example/doc/123', panel: 'warning' as const };

  it('injects the banner into storage but never into the markdown source', async () => {
    const res = await pub({ managedNotice: notice });
    expect(res.storage).toContain('ac:name="warning"');
    expect(res.storage).toContain('href="https://studio.example/doc/123"');
    // Баннер лёг в самое начало (position default = top).
    expect(res.storage.indexOf('structured-macro')).toBeLessThan(res.storage.indexOf('Hello'));
    // В markdown-источнике примечания нет.
    expect(MD).not.toContain('studio.example');
    expect(MD).not.toContain('structured-macro');
  });

  it('is idempotent — same notice + content re-publishes as UNCHANGED', async () => {
    const first = await pub({ managedNotice: notice });
    expect(first.updated).toBe(true);
    const second = await pub({ managedNotice: notice });
    expect(second.updated).toBe(false); // детерминированный баннер → тот же hash
    expect(state.puts).toBe(1);
  });

  it('re-publishes when the notice changes (hash-mismatch)', async () => {
    await pub({ managedNotice: notice });
    const changed = await pub({ managedNotice: { ...notice, linkUrl: 'https://studio.example/doc/999' } });
    expect(changed.updated).toBe(true);
    expect(state.puts).toBe(2);
  });

  it('places the banner at the bottom when position is "bottom"', async () => {
    const res = await pub({ managedNotice: { ...notice, position: 'bottom' } });
    expect(res.storage.indexOf('Hello')).toBeLessThan(res.storage.indexOf('structured-macro'));
  });

  it('fails fast when linkUrl is missing', async () => {
    await expect(pub({ managedNotice: { linkUrl: '' } })).rejects.toThrow(/managedNotice\.linkUrl is required/);
  });
});
