/**
 * BPMN → image conversion (out-of-the-box BPMN support).
 *
 * Тяжёлые зависимости (`bpmn-to-image` + puppeteer/Chromium) — опциональный
 * peer dependency: импортируются динамически только когда конвертация
 * реально запрошена. Ядро библиотеки остаётся лёгким.
 *
 *   npm install -D bpmn-to-image
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { SRC_SHA_SIDECAR_SUFFIX } from '../attachments/attachment.js';

export type BpmnImageFormat = 'png' | 'svg' | 'pdf';

export const BPMN_FILE_RE = /\.bpmn$/i;

export function isBpmnFile(path: string): boolean {
  return BPMN_FILE_RE.test(path);
}

/** `p1.bpmn` → `p1.png` (имя выходного файла для формата). */
export function bpmnOutputName(file: string, format: BpmnImageFormat = 'png'): string {
  return `${basename(file, extname(file))}.${format}`;
}

export interface BpmnConversion {
  input: string;
  output: string;
}

let puppeteerPatched = false;

/**
 * bpmn-to-image вызывает puppeteer.launch() без флагов. В CI Chromium
 * запускается из-под root и без --no-sandbox просто не стартует. Патчим
 * глобальный puppeteer.launch один раз — best-effort: если puppeteer
 * не резолвится из нашего контекста, bpmn-to-image разберётся сам.
 */
async function patchPuppeteerForCI(): Promise<void> {
  if (puppeteerPatched) return;
  puppeteerPatched = true;
  try {
    const { default: puppeteer } = await import('puppeteer' as string);
    const origLaunch = puppeteer.launch.bind(puppeteer);
    puppeteer.launch = ((options: Record<string, unknown> = {}) => {
      const existing = (options?.args as string[] | undefined) ?? [];
      const patched = [
        ...existing,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ];
      return origLaunch({ ...options, args: patched });
    }) as typeof puppeteer.launch;
  } catch {
    // puppeteer не установлен отдельно — положимся на bpmn-to-image
  }
}

async function loadConverter(): Promise<typeof import('bpmn-to-image')> {
  try {
    const mod = await import('bpmn-to-image');
    await patchPuppeteerForCI();
    return mod;
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        "BPMN conversion requires the optional peer dependency 'bpmn-to-image'. " +
          'Install it with: npm install -D bpmn-to-image',
      );
    }
    throw err;
  }
}

/**
 * Конвертирует BPMN-файлы в изображения по явному списку input → output.
 *
 * Рядом с каждым результатом пишется sidecar `<output>.src-sha256` с SHA-256
 * исходного BPMN — AttachmentService использует его как dedup-tag вместо SHA
 * результата (PNG от Chromium байт-нестабилен между запусками, BPMN —
 * стабилен). Так Confluence не плодит лишние версии аттача, когда диаграмма
 * не менялась.
 */
export async function convertBpmn(conversions: BpmnConversion[]): Promise<void> {
  if (conversions.length === 0) return;
  const { convertAll } = await loadConverter();

  for (const c of conversions) {
    mkdirSync(dirname(c.output), { recursive: true });
  }
  console.log(`[bpmn] converting ${conversions.length} diagram(s)`);
  await convertAll(conversions.map((c) => ({ input: c.input, outputs: [c.output] })));

  for (const c of conversions) {
    const sha = createHash('sha256').update(readFileSync(c.input)).digest('hex');
    writeFileSync(c.output + SRC_SHA_SIDECAR_SUFFIX, sha);
  }
}

export interface ConvertBpmnFolderOptions {
  /** Папка-источник с `*.bpmn`. */
  srcDir: string;
  /** Папка-приёмник для сгенерированных изображений. Будет создана, если её нет. */
  outDir: string;
  /** Формат выхода. Дефолт — `png`. */
  format?: BpmnImageFormat;
  /** Регулярка для фильтра входов. Дефолт — `/\.bpmn$/i`. */
  pattern?: RegExp;
}

/**
 * Конвертирует все BPMN-файлы из `srcDir` в изображения в `outDir`.
 * Файлы получают то же базовое имя с расширением формата (`p1.bpmn` → `p1.png`).
 *
 * Сгенерированные файлы — артефакты сборки: коммитить их не нужно.
 * В Confluence они улетают как аттачи на этапе публикации.
 */
export async function convertBpmnFolder(
  opts: ConvertBpmnFolderOptions,
): Promise<BpmnConversion[]> {
  const format = opts.format ?? 'png';
  const pattern = opts.pattern ?? BPMN_FILE_RE;
  const files = readdirSync(opts.srcDir).filter((f) => pattern.test(f));

  if (files.length === 0) {
    console.log(`[bpmn] no files matching ${pattern} in ${opts.srcDir}`);
    return [];
  }

  const conversions: BpmnConversion[] = files.map((f) => ({
    input: join(opts.srcDir, f),
    output: join(opts.outDir, bpmnOutputName(f, format)),
  }));
  await convertBpmn(conversions);
  return conversions;
}
