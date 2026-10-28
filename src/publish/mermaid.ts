/// <reference lib="dom" />
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import MarkdownIt from 'markdown-it';
import { mermaidFilename } from '../macros/plugins/mermaid.js';
import { renderMermaidCanvasSvg } from '../mermaid.js';
import type { MermaidSource } from '../markdown/mermaid.js';
import { MERMAID_PROPERTY_KEY } from '../markdown/mermaid.js';
import type { ConfluenceClient } from '../client/client.js';

export async function readMermaidSources(client: ConfluenceClient, pageId: string, storage: string): Promise<Record<string, MermaidSource>> {
  if (!/ri:filename="mermaid-[a-f0-9]{24}\.png"/.test(storage)) return {};
  const property = await client.getContentProperty(pageId, MERMAID_PROPERTY_KEY);
  const raw = property?.value as { sources?: Record<string, MermaidSource>; encoding?: string; data?: string } | undefined;
  const value = raw?.encoding === 'gzip-base64' && typeof raw.data === 'string' ? JSON.parse(gunzipSync(Buffer.from(raw.data, 'base64'), { maxOutputLength: 2_000_000 }).toString()) as typeof raw : raw;
  const sources: Record<string, MermaidSource> = {};
  for (const [name, ref] of Object.entries(value?.sources ?? {})) {
    if (ref && typeof ref.source === 'string' && ref.source.length <= 100_000 && name === mermaidFilename(ref.source)) sources[name] = { source: ref.source, info: typeof ref.info === 'string' ? ref.info : 'mermaid' };
  }
  return sources;
}

export async function saveMermaidSources(client: ConfluenceClient, pageId: string, sources: Record<string, MermaidSource>): Promise<void> {
  if (!Object.keys(sources).length) return;
  const previous = await client.getContentProperty(pageId, MERMAID_PROPERTY_KEY), value = mermaidProperty(sources);
  if (JSON.stringify(previous?.value) !== JSON.stringify(value)) await client.setContentProperty(pageId, MERMAID_PROPERTY_KEY, value, previous?.version ?? null);
}

function mermaidProperty(sources: Record<string, MermaidSource>) {
  const value = { version: 1, sources }, json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 2_000_000) throw new Error('Mermaid sources are too large. Split diagrams across pages.');
  if (Buffer.byteLength(json) < 28_000) return value;
  const packed = { version: 1, encoding: 'gzip-base64', data: gzipSync(json).toString('base64') };
  if (Buffer.byteLength(JSON.stringify(packed)) > 30_000) throw new Error('Mermaid sources exceed the Confluence property limit. Split diagrams across pages.');
  return packed;
}

export function mermaidSources(markdown: string): Record<string, MermaidSource> {
  const sources: Record<string, MermaidSource> = {};
  const walk = (tokens: ReturnType<MarkdownIt['parse']>) => { for (const token of tokens) {
    if (token.type === 'fence' && /^mermaid(?:\s|$)/i.test(token.info.trim())) {
      const source = token.content.replace(/\n$/, '');
      if (!source.trim() || source.length > 100_000) throw new Error('Mermaid source must contain between 1 and 100000 characters');
      sources[mermaidFilename(source)] = { source, info: token.info.trim() };
    }
    if (token.children) walk(token.children);
  } };
  walk(new MarkdownIt({ html: true }).parse(markdown, {}));
  if (Object.keys(sources).length > 100) throw new Error('A page can contain at most 100 Mermaid diagrams');
  mermaidProperty(sources);
  return sources;
}

/** Network-free rendering; optional browser dependencies are loaded only for Mermaid. */
export async function convertMermaid(sources: Record<string, MermaidSource>, outDir: string): Promise<string[]> {
  const outputs: string[] = [];
  let browser: import('puppeteer').Browser | undefined;
  try {
    for (const [filename, { source }] of Object.entries(sources)) {
      const output = join(outDir, filename), svg = renderMermaidCanvasSvg(source);
      if (svg) {
        const bounds = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
        if (!bounds || bounds.length !== 4 || bounds.some(n => !Number.isFinite(n)) || bounds[2] * bounds[3] > 40_000_000 || Math.max(bounds[2], bounds[3]) > 16000) throw new Error('Mermaid diagram is too large');
        const { Resvg } = await import('@resvg/resvg-js' as string) as typeof import('@resvg/resvg-js');
        writeFileSync(output, new Resvg(svg, { background: 'white', font: { defaultFontFamily: 'sans-serif' } }).render().asPng());
      } else {
        if (!browser) {
          const { default: puppeteer } = await import('puppeteer' as string) as typeof import('puppeteer');
          browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
        }
        const page = await browser.newPage();
        try {
          await page.setRequestInterception(true);
          page.on('request', request => { void request.abort(); });
          await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
          await page.setContent('<html><body style="margin:0;background:white"><main id="diagram"></main></body></html>');
          const require = createRequire(import.meta.url);
          await page.addScriptTag({ content: readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8') });
          await page.evaluate(async code => {
            const engine = (globalThis as unknown as { mermaid: { initialize: (cfg: unknown) => void; render: (id: string, text: string) => Promise<{ svg: string }> } }).mermaid;
            engine.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', maxTextSize: 100_000, flowchart: { htmlLabels: false } });
            const result = await engine.render('mermaid-export', code);
            document.getElementById('diagram')!.innerHTML = result.svg;
            const svg = document.querySelector('svg')!;
            const box = svg.viewBox.baseVal;
            if (!box.width || !box.height || box.width * box.height > 40_000_000 || Math.max(box.width, box.height) > 16000) throw new Error('Mermaid diagram is too large');
            svg.style.maxWidth = 'none'; svg.setAttribute('width', String(box.width)); svg.setAttribute('height', String(box.height));
          }, source);
          await (await page.$('svg'))!.screenshot({ path: output, type: 'png' });
        } finally { await page.close(); }
      }
      outputs.push(output);
    }
  } finally { await browser?.close(); }
  return outputs;
}
