import { escapeXmlAttr } from '../macros/xml.js';

/** Native attachment images retain Confluence's image toolbar and formatting. */
export function attachmentImage(name: string, attrs: Array<[string, string]>): string {
  const values = new Map(attrs);
  const attachment = `<ri:attachment ri:filename="${escapeXmlAttr(name)}" />`;
  if (values.get('display') === 'link') return `<ac:link>${attachment}</ac:link>`;
  const attributes = attrs.filter(([key]) => !['display', 'link'].includes(key));
  for (const [key] of attributes) if (!/^[A-Za-z_][\w.-]*$/.test(key)) throw new Error(`Invalid image attribute: ${key}`);
  const image = `<ac:image${attributes.map(([key, value]) => ` ac:${key}="${escapeXmlAttr(value)}"`).join('')}>${attachment}</ac:image>`;
  const link = values.get('link');
  if (!link) return image;
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^(https?|mailto|tel):/i.test(link)) throw new Error('Unsupported image link protocol');
  return `<a href="${escapeXmlAttr(link)}">${image}</a>`;
}
