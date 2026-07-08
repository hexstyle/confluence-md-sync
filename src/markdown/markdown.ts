/**
 * Типизированное представление Markdown контента с валидацией.
 *
 * Вместо обычных строк используется класс Markdown для:
 * - Явности типа в сигнатурах функций
 * - Валидации содержимого (незакрытые макросы, неверные плейсхолдеры)
 * - Удобства преобразований и композиции
 */

export class Markdown {
  private readonly content: string;

  constructor(content: string) {
    this.validate(content);
    this.content = content;
  }

  /**
   * Валидирует markdown контент.
   *
   * Проверяет:
   * - Закрытость всех макросов (MACRO:start/end)
   * - Корректность плейсхолдеров таблиц
   */
  private validate(content: string): void {
    this.validateMacros(content);
    this.validateTablePlaceholders(content);
  }

  private validateMacros(content: string): void {
    const startMarkers = (content.match(/<!-- MACRO:start:/g) || []).length;
    const endMarkers = (content.match(/<!-- MACRO:end:/g) || []).length;

    if (startMarkers !== endMarkers) {
      throw new Error(
        `Markdown validation failed: mismatched macro markers (start: ${startMarkers}, end: ${endMarkers})`,
      );
    }
  }

  private validateTablePlaceholders(content: string): void {
    const placeholders = Array.from(content.matchAll(/\{\{table:([a-z0-9_-]+)\}\}/gi));
    if (placeholders.length === 0) return;

    const seen = new Set<string>();
    for (const [, name] of placeholders) {
      if (seen.has(name.toLowerCase())) {
        throw new Error(
          `Markdown validation failed: duplicate table placeholder '{{table:${name}}}'`,
        );
      }
      seen.add(name.toLowerCase());
    }
  }

  /** Возвращает строковое представление. */
  toString(): string {
    return this.content;
  }

  /** Возвращает длину контента. */
  get length(): number {
    return this.content.length;
  }

  /** Проверяет, содержит ли контент таблицы. */
  hasTables(): boolean {
    return /\{\{table:/.test(this.content);
  }

  /** Извлекает все имена плейсхолдеров таблиц. */
  getTableNames(): string[] {
    const names = new Set<string>();
    for (const [, name] of this.content.matchAll(/\{\{table:([a-z0-9_-]+)\}\}/gi)) {
      names.add(name.toLowerCase());
    }
    return Array.from(names);
  }

  /** Создаёт Markdown из строки. */
  static from(content: string): Markdown {
    return new Markdown(content);
  }

  /** Объединяет несколько Markdown в один. */
  static concat(...parts: (Markdown | string)[]): Markdown {
    const content = parts.map((p) => (p instanceof Markdown ? p.toString() : p)).join('');
    return new Markdown(content);
  }

  /** Пустой Markdown. */
  static empty(): Markdown {
    return new Markdown('');
  }
}
