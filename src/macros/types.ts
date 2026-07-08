/**
 * Core types of the pluggable macro system.
 *
 * Макросы в markdown представлены как комментарии:
 *   <!-- MACRO:start:name:param1=value1:param2=value2 -->
 *   markdown content / nested macros
 *   <!-- MACRO:end:name -->
 *
 * После рендера в storage format эти маркеры преобразуются в
 * <ac:structured-macro> с соответствующими параметрами.
 */

export interface MacroParam {
  name: string;
  value: string;
}

export interface RendererContext {
  params: MacroParam[];
  /** Macro body already rendered to XHTML (may contain nested rendered macros). */
  body: string;
  /** Generated UUID for ac:macro-id. */
  macroId: string;
}

/** Renders a macro marker into Confluence storage-format XHTML. */
export type MacroRenderer = (ctx: RendererContext) => string;

export interface MacroDefinition {
  name: string;
  render: MacroRenderer;
}

/**
 * A plugin is a named collection of macro definitions. Register it on a
 * {@link MacroRegistry} via `registry.use(plugin)`.
 */
export interface MacroPlugin {
  name: string;
  macros: MacroDefinition[];
}

/** Convenience: turn `params` array into a name→value map. */
export function paramMap(params: MacroParam[]): Record<string, string> {
  return Object.fromEntries(params.map((p) => [p.name, p.value]));
}
