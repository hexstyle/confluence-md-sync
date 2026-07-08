import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const HASH_TAG_PREFIX = 'sha256:';

export function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
