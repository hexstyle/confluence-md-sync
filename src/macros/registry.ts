import { Markdown } from '../markdown/markdown.js';
import { unescapeParamValue } from './builder.js';
import { generateMacroId, structuredMacro } from './xml.js';
import type { MacroParam, MacroPlugin, MacroRenderer } from './types.js';

/**
 * Реестр макросов. Пустой при создании — наполняется плагинами через
 * {@link use} или точечной регистрацией через {@link register}.
 *
 * @example
 *   const registry = new MacroRegistry()
 *     .use(coreMacrosPlugin)
 *     .use(tableFilterPlugin)
 *     .register('my-macro', (ctx) => `<ac:structured-macro ...>`);
 */
export class MacroRegistry {
  private renderers = new Map<string, MacroRenderer>();
  private pluginNames: string[] = [];
  private passthroughUnknown = true;

  /** Registers all macros of a plugin. Later registrations win on name clash. */
  use(plugin: MacroPlugin): this {
    for (const def of plugin.macros) {
      this.renderers.set(def.name, def.render);
    }
    this.pluginNames.push(plugin.name);
    return this;
  }

  register(name: string, renderer: MacroRenderer): this {
    this.renderers.set(name, renderer);
    return this;
  }

  has(name: string): boolean {
    return this.renderers.has(name);
  }

  getRenderer(name: string): MacroRenderer | undefined {
    return this.renderers.get(name);
  }

  getAllRenderers(): Map<string, MacroRenderer> {
    return this.renderers;
  }

  /**
   * Управляет обработкой маркеров с именами, которых нет в реестре.
   * По умолчанию ВКЛЮЧЕНО: такой маркер рендерится «как есть» —
   * <ac:structured-macro> с параметрами из маркера и rich-text телом
   * (если тело непустое). Это делает публикуемым любой макрос без явной
   * регистрации (в т.ч. страницы, полученные из exportPage). Выключение
   * возвращает старое поведение: незнакомый маркер остаётся комментарием.
   */
  passthroughUnknownMacros(enable = true): this {
    this.passthroughUnknown = enable;
    return this;
  }

  get allowsUnknownMacros(): boolean {
    return this.passthroughUnknown;
  }

  /** Names of plugins registered via {@link use} (for diagnostics). */
  get plugins(): string[] {
    return [...this.pluginNames];
  }
}

/** Renderer «как есть» для макросов, не зарегистрированных в реестре. */
function passthroughRenderer(name: string): MacroRenderer {
  return (ctx) =>
    structuredMacro(name, ctx.macroId, {
      params: ctx.params,
      ...(ctx.body.trim() !== '' ? { richBody: ctx.body } : {}),
    });
}

const ANY_START_MARKER_RE = /<!-- MACRO:start:([A-Za-z0-9_-]+)/g;

/**
 * Преобразует маркеры макросов в XHTML storage format.
 * Обрабатывает вложенные макросы снизу вверх (от inner к outer).
 */
export function processMacros(storage: Markdown | string, registry: MacroRegistry): Markdown {
  let content = storage instanceof Markdown ? storage.toString() : storage;

  // Повторяем, пока есть макросы (для обработки вложения)
  let modified = true;
  let iterations = 0;
  const maxIterations = 100;

  while (modified && iterations < maxIterations) {
    modified = false;
    iterations++;

    for (const [macroName, renderer] of registry.getAllRenderers()) {
      const result = processMacroType(content, macroName, renderer);
      if (result !== content) {
        content = result;
        modified = true;
        break;
      }
    }

    // Незнакомые имена — passthrough-рендером (если разрешён). После
    // зарегистрированных, чтобы явные рендереры всегда были в приоритете.
    if (!modified && registry.allowsUnknownMacros) {
      for (const name of findMarkerNames(content)) {
        if (registry.has(name)) continue;
        const result = processMacroType(content, name, passthroughRenderer(name));
        if (result !== content) {
          content = result;
          modified = true;
          break;
        }
      }
    }
  }

  return new Markdown(content);
}

function findMarkerNames(storage: string): Set<string> {
  const names = new Set<string>();
  for (const m of storage.matchAll(ANY_START_MARKER_RE)) names.add(m[1]);
  return names;
}

function processMacroType(storage: string, macroName: string, renderer: MacroRenderer): string {
  // `:[^\n]*?` — lazy до конца строки маркера. Раньше тут было `[^-]*`,
  // что ломалось на дефис в имени параметра (например cell-width=) или
  // в значении: маркер целиком не матчился и макрос не рендерился.
  const startMarkerRe = new RegExp(
    `<!-- MACRO:start:${escapeRegex(macroName)}(:[^\\n]*?)? -->`,
    'g',
  );

  let match;

  while ((match = startMarkerRe.exec(storage)) !== null) {
    const paramStr = match[1] ?? '';
    const params = parseParams(paramStr);
    const startIdx = match.index;
    const endMarker = `<!-- MACRO:end:${macroName} -->`;
    const endIdx = storage.indexOf(endMarker, startIdx);

    if (endIdx === -1) {
      console.warn(`[macro] start marker without end for macro '${macroName}' at position ${startIdx}`);
      continue;
    }

    const bodyStart = startIdx + match[0].length;
    const body = storage.substring(bodyStart, endIdx).trim();
    const macroId = generateMacroId();

    const macroXhtml = renderer({ params, body, macroId });

    const before = storage.substring(0, startIdx);
    const after = storage.substring(endIdx + endMarker.length);
    storage = before + macroXhtml + after;

    // Сбрасываем поиск для повторной обработки
    startMarkerRe.lastIndex = 0;
  }

  return storage;
}

function parseParams(paramStr: string): MacroParam[] {
  if (!paramStr.trim()) return [];
  return paramStr
    .split(':')
    .filter((p) => p.trim())
    .map((pair) => {
      const [name, value] = pair.split('=');
      return {
        name: unescapeParamValue(name?.trim() ?? ''),
        value: unescapeParamValue(value?.trim() ?? ''),
      };
    });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
