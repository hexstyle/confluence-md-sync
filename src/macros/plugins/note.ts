import { parseStorage, serializeStorage } from '../../export/xhtml.js';
import type { MacroDefinition, MacroParam } from '../types.js';
import { stableMacroId, structuredMacro } from '../xml.js';

export const noteMacro: MacroDefinition = {
  name: 'note',
  render: ctx => structuredMacro('note', ctx.macroId, { params: ctx.params.filter(p => ['title', 'icon'].includes(p.name)), richBody: ctx.body }),
};
export function renderInlineNote(body: string, attrs: [string, string][]) {
  body = serializeStorage(parseStorage(body));
  const params: MacroParam[] = attrs.map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name));
  if (params.some(p => !['title', 'icon'].includes(p.name))) throw new Error('Inline Note supports title and icon parameters');
  return noteMacro.render({ macroId: stableMacroId(JSON.stringify([body, params])), params, body });
}
