import { macro } from '../builder.js';
import { paramMap, type MacroPlugin } from '../types.js';
import { escapeXmlAttr } from '../xml.js';

export interface UserOptions { type?: 'username' | 'userkey' | 'account-id'; text?: string }

export function renderUserLink(identity: string, options: Record<string, string> = {}): string {
  if (!identity.trim()) throw new Error('Confluence user identity is required');
  const type = options.type || 'username';
  if (!['username', 'userkey', 'account-id'].includes(type)) throw new Error('Unknown Confluence user identity type');
  const body = options.text === undefined ? '' : `<ac:plain-text-link-body><![CDATA[${options.text.replace(/]]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-link-body>`;
  return `<ac:link><ri:user ri:${type}="${escapeXmlAttr(identity)}" />${body}</ac:link>`;
}

export const userPlugin: MacroPlugin = {
  name: 'user',
  macros: [{ name: 'user', render: ctx => {
    const { identity = '', ...options } = paramMap(ctx.params);
    return renderUserLink(identity, options);
  } }],
};

export const user = (identity: string, options: UserOptions = {}) =>
  macro('user').param('identity', identity).param('type', options.type || 'username')
    .withParams({ text: options.text }).toMarkdown();
