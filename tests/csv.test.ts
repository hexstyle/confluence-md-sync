import { describe, expect, it } from 'vitest';
import { decodeText, readCsv } from '../src/csv.js';

describe('decodeText', () => {
  it('strips UTF-8 BOM', () => {
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  it('falls back to windows-1251 for invalid utf-8', () => {
    // 'Привет' in cp1251
    const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeText(cp1251)).toBe('Привет');
  });
});

describe('readCsv', () => {
  it('detects ; separator and parses quotes', () => {
    const rows = readCsv('a;b\n"x;y";"he said ""hi"""\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x;y', 'he said "hi"'],
    ]);
  });

  it('parses comma-separated with CRLF', () => {
    expect(readCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
