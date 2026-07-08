import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  downloadToFile,
  isHttpUrl,
  isSameConfluenceOrigin,
  remoteFilename,
  remoteRequestHeaders,
} from '../src/publish/remote.js';
import { publishPage } from '../src/publish/publish.js';
import type { ConfluenceConfig } from '../src/client/config.js';

const cfgFor = (baseUrl: string): ConfluenceConfig => ({ baseUrl, token: 'secret-pat' });

describe('isHttpUrl', () => {
  it('accepts http/https, rejects paths', () => {
    expect(isHttpUrl('https://confluence.example.com/x.png')).toBe(true);
    expect(isHttpUrl('HTTP://host/x.png')).toBe(true);
    expect(isHttpUrl('docs/x.png')).toBe(false);
    expect(isHttpUrl('/abs/path/x.png')).toBe(false);
    expect(isHttpUrl('file:///x.png')).toBe(false);
  });
});

describe('remoteFilename', () => {
  it('takes basename of the pathname, dropping query and fragment', () => {
    expect(remoteFilename('https://c.example.com/download/attachments/1/p1.bpmn?version=2&x=1')).toBe('p1.bpmn');
    expect(remoteFilename('https://c.example.com/a/b/chart.png#frag')).toBe('chart.png');
  });

  it('decodes percent-encoding (cyrillic names)', () => {
    expect(remoteFilename('https://c.example.com/files/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png')).toBe('схема.png');
  });

  it('throws when the path ends with /', () => {
    expect(() => remoteFilename('https://c.example.com/dir/')).toThrow(/ends with '\/'/);
  });
});

describe('isSameConfluenceOrigin / remoteRequestHeaders', () => {
  const cfg = cfgFor('https://confluence.example.com/wiki');

  it('matches by origin, ignoring the base path', () => {
    expect(isSameConfluenceOrigin('https://confluence.example.com/download/x.png', cfg)).toBe(true);
  });

  it('rejects other hosts, schemes and ports', () => {
    expect(isSameConfluenceOrigin('https://other.example.com/x.png', cfg)).toBe(false);
    expect(isSameConfluenceOrigin('http://confluence.example.com/x.png', cfg)).toBe(false);
    expect(isSameConfluenceOrigin('https://confluence.example.com:8443/x.png', cfg)).toBe(false);
  });

  it('sends Authorization only to the configured Confluence', () => {
    expect(remoteRequestHeaders('https://confluence.example.com/x.png', cfg)).toEqual({
      Authorization: 'Bearer secret-pat',
    });
    expect(remoteRequestHeaders('https://other.example.com/x.png', cfg)).toEqual({});
  });
});

describe('downloadToFile', () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined | null;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastAuth = req.headers.authorization ?? null;
      if (req.url?.startsWith('/missing')) {
        res.writeHead(404).end('nope');
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png' }).end('png-bytes');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('downloads to the destination and authenticates on same origin', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'remote-test-')), 'chart.png');
    await downloadToFile(`${baseUrl}/files/chart.png`, dest, cfgFor(baseUrl));
    expect(readFileSync(dest, 'utf-8')).toBe('png-bytes');
    expect(lastAuth).toBe('Bearer secret-pat');
  });

  it('does not send the token to foreign hosts', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'remote-test-')), 'chart.png');
    await downloadToFile(`${baseUrl}/files/chart.png`, dest, cfgFor('https://confluence.example.com'));
    expect(lastAuth).toBeNull();
  });

  it('throws on non-2xx with status and url', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'remote-test-')), 'x.png');
    await expect(downloadToFile(`${baseUrl}/missing/x.png`, dest, cfgFor(baseUrl))).rejects.toThrow(
      /HTTP 404 .*\/missing\/x\.png/,
    );
  });
});

describe('publishPage source kinds (dry run)', () => {
  const cfg = cfgFor('https://confluence.example.com');
  const png = resolve('tests/fixtures') + '/chart.png'; // path only; dry run does not read it

  it('accepts relative paths, absolute paths and http(s) URLs', async () => {
    const { storage } = await publishPage(
      {
        pageId: '1',
        markdown: '{{img:chart.png}} {{img:flow.bpmn}} {{file:data.csv}}',
        images: [png, 'https://confluence.example.com/download/attachments/9/flow.bpmn?version=3'],
        files: ['https://files.example.com/exports/data.csv'],
        dryRun: true,
      },
      cfg,
    );
    // URL-источники резолвятся в имя из URL; .bpmn получает .png-плейсхолдер
    expect(storage).toContain('dry-run://img/chart.png');
    expect(storage).toContain('dry-run://img/flow.png');
    expect(storage).toContain('dry-run://file/data.csv');
  });

  it('rejects duplicate filenames from different sources', async () => {
    await expect(
      publishPage(
        {
          pageId: '1',
          markdown: '{{img:chart.png}}',
          images: ['build/chart.png', 'https://confluence.example.com/download/attachments/9/chart.png'],
          dryRun: true,
        },
        cfg,
      ),
    ).rejects.toThrow(/duplicate attachment filename 'chart\.png'/);
  });
});
