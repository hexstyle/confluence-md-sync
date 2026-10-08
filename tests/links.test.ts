import { describe, expect, it } from 'vitest';
import { renderToStorage } from '../src/markdown/render.js';
import { storageToMarkdown } from '../src/export/to-markdown.js';
import { storageLinks, rewriteStorageLinks } from '../src/export/links.js';

describe('repository link round trip', () => {
  const git = 'https://git.test/group/repo/-/blob/main/docs/a.md?plain=1#section';
  const page = 'https://c.test/pages/viewpage.action?pageId=42#section';
  it('resolves explicit URLs, keeps rich labels and restores the exact original URL', () => {
    const storage = renderToStorage(`[**Source** page](${git}) [External](https://other.test/a.md) \`${git}\``, { images: new Map(), files: new Map() }, {
      linkResolver: href => href === git ? { url: page } : null,
    });
    expect(storage).toContain(`<a href="${page}"><strong>Source</strong> page</a>`);
    expect(storage).toContain('<a href="https://other.test/a.md">External</a>');
    expect(storage).toContain(`<code>${git}</code>`);
    const restored = storageToMarkdown(storage, { linkResolver: link => link.href === page ? git : null });
    expect(restored.markdown).toContain(`[**Source** page](${git})`);
    expect(restored.stats.normalized).toBe(1);
  });
  it('maps native links and anchors after all sibling paths are known, without touching macro parameters or code', () => {
    const link = '<ac:link ac:anchor="c4"><ri:page ri:content-title="Sibling" ri:space-key="EDP" /><ac:link-body><strong>See</strong> sibling</ac:link-body></ac:link>';
    const storage = `<p>${link}</p><ac:structured-macro ac:name="include"><ac:parameter ac:name="">${link}</ac:parameter></ac:structured-macro><pre>${link}</pre>`;
    expect(storageLinks(storage)).toEqual([{ title: 'Sibling', space: 'EDP', anchor: 'c4', pageId: undefined }]);
    const rewritten = rewriteStorageLinks(storage, () => '../sibling-copy1.md#c4');
    expect(rewritten).toContain('<p><a href="../sibling-copy1.md#c4"><strong>See</strong> sibling</a></p>');
    expect(rewritten).toContain(`<pre>${link}</pre>`);
    expect(rewritten).toContain(`<ac:parameter ac:name="">${link}</ac:parameter>`);
  });
  it('leaves the input byte-identical when no targets match', () => {
    const storage = '<p><a href="https://other.test">Outside</a></p>';
    expect(rewriteStorageLinks(storage, () => null)).toBe(storage);
  });
});
