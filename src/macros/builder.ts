import { Markdown } from '../markdown/markdown.js';

/**
 * Построитель макроса для использования в markdown.
 *
 * @example
 *   const md = macro('table-excerpt')
 *     .param('name', 'jira_fact')
 *     .param('hide', 'true')
 *     .body(tableMarkdown)
 *     .toMarkdown();
 */
export class MacroBuilder {
  private macroParams: Array<{ name: string; value: string }> = [];
  private bodyContent = '';

  constructor(private macroName: string) {}

  param(name: string, value: string): this {
    this.macroParams.push({ name, value });
    return this;
  }

  withParams(obj: Record<string, string | undefined>): this {
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) this.param(k, v);
    }
    return this;
  }

  body(content: Markdown | string): this {
    this.bodyContent = content instanceof Markdown ? content.toString() : content;
    return this;
  }

  toMarkdown(): Markdown {
    const paramStr = this.macroParams.length > 0
      ? ':' + this.macroParams.map((p) => `${escapeParamValue(p.name)}=${escapeParamValue(p.value)}`).join(':')
      : '';
    const content =
      `<!-- MACRO:start:${this.macroName}${paramStr} -->\n` +
      this.bodyContent +
      `\n<!-- MACRO:end:${this.macroName} -->`;
    return new Markdown(content);
  }
}

/**
 * Создаёт построитель макроса.
 *
 * @example
 *   macro('table-excerpt').param('name', 'data').body(md).toMarkdown()
 */
export function macro(name: string): MacroBuilder {
  return new MacroBuilder(name);
}

/**
 * Экранирование значения параметра для однострочного маркера-комментария.
 * Кодируются: `%` (первым — иначе двойное декодирование), `=`/`:`
 * (разделители маркера), `<`/`>` (чтобы значение с `-->` не оборвало
 * комментарий) и переводы строк (маркер обязан остаться одной строкой —
 * нужно для многострочных параметров вроде SQL у table-joiner).
 */
export function escapeParamValue(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/=/g, '%3D')
    .replace(/:/g, '%3A')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

export function unescapeParamValue(s: string): string {
  return s
    .replace(/%0A/g, '\n')
    .replace(/%0D/g, '\r')
    .replace(/%3E/g, '>')
    .replace(/%3C/g, '<')
    .replace(/%3A/g, ':')
    .replace(/%3D/g, '=')
    .replace(/%25/g, '%');
}
