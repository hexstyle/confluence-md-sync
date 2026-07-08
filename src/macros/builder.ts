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

export function escapeParamValue(s: string): string {
  return s.replace(/[=:]/g, (c) => (c === '=' ? '%3D' : '%3A'));
}

export function unescapeParamValue(s: string): string {
  return s.replace(/%3D/g, '=').replace(/%3A/g, ':');
}
