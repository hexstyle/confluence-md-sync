import { basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  ConfluenceClient,
  type ConfluenceAttachment,
  type AttachmentVersionData,
} from '../client/client.js';
import { fileSha256, HASH_TAG_PREFIX } from './hash.js';

// Sidecar с SHA-256 исходного файла (например, BPMN), из которого
// сгенерирован публикуемый аттач (PNG). Если рядом с filePath лежит
// `<filePath>.src-sha256`, используем содержимое sidecar как dedup-tag
// вместо SHA самого аттача. Это критично для PNG'шек от Chromium
// (anti-aliasing/fonts нестабильны между CI runs — SHA PNG скачет даже
// при том же исходнике), благодаря sidecar attachment не пересоздаётся
// повторно и Confluence не плодит лишние версии.
export const SRC_SHA_SIDECAR_SUFFIX = '.src-sha256';

function readDedupHash(filePath: string): string {
  const sidecar = filePath + SRC_SHA_SIDECAR_SUFFIX;
  if (existsSync(sidecar)) {
    return readFileSync(sidecar, 'utf-8').trim();
  }
  return fileSha256(filePath);
}

export interface EnsuredAttachment {
  id: string;
  filename: string;
  reused: boolean;
  hash: string;
  /** Абсолютный URL скачивания аттача — подставляется в `<img>` / `<a>`. */
  downloadUrl: string;
}

export interface AttachmentVersion {
  version: number;
  fileSize?: number;
  author?: string;
}

/** Rich-объект аттача страницы Confluence с историей версий. */
export class Attachment {
  constructor(
    public readonly id: string,
    public readonly pageId: string,
    public readonly title: string,
    public readonly version: number,
    public readonly downloadUrl: string,
    public readonly versions: AttachmentVersion[] = [],
  ) {}
}

function versionNumberOf(v: AttachmentVersionData): number {
  return v.versionNumber ?? v.version ?? v.number ?? 0;
}

export function toAttachmentVersion(v: AttachmentVersionData): AttachmentVersion {
  return { version: versionNumberOf(v), fileSize: v.fileSize, author: v.author?.fullName };
}

export class AttachmentService {
  constructor(private client: ConfluenceClient) {}

  /**
   * Загружает аттач (или переиспользует по SHA-256). Дедуп по тегу
   * version.message = sha256:<hash>, чтобы повторные прогоны CI не плодили
   * версии одинакового файла.
   */
  async ensure(pageId: string, filePath: string): Promise<EnsuredAttachment> {
    const filename = basename(filePath);
    // dedup-tag: SHA исходника из sidecar если есть, иначе SHA самого файла.
    // См. readDedupHash наверху и SRC_SHA_SIDECAR_SUFFIX.
    const hash = readDedupHash(filePath);
    const tag = `${HASH_TAG_PREFIX}${hash}`;
    const existing = await this.client.listAttachments(pageId, filename);

    const matched = existing.find((a) => a.version?.message === tag);
    if (matched) {
      return { id: matched.id, filename, reused: true, hash, downloadUrl: this.downloadUrlOf(pageId, matched) };
    }
    const sameName = existing[0];
    if (sameName) {
      const updated = await this.client.updateAttachmentData(pageId, sameName.id, filePath, tag);
      return { id: updated.id ?? sameName.id, filename, reused: false, hash, downloadUrl: this.downloadUrlOf(pageId, updated) };
    }
    const created = await this.client.createAttachment(pageId, filePath, tag);
    return { id: created.id, filename, reused: false, hash, downloadUrl: this.downloadUrlOf(pageId, created) };
  }

  async download(att: Attachment): Promise<Buffer> {
    return this.client.downloadAttachment(att.downloadUrl);
  }

  async delete(att: Attachment): Promise<void> {
    await this.client.deleteAttachment(att.id);
  }

  private downloadUrlOf(pageId: string, attachment: ConfluenceAttachment): string {
    const link = attachment._links?.download;
    if (link) return this.client.absoluteUrl(link);
    return this.client.absoluteUrl(
      `/download/attachments/${pageId}/${encodeURIComponent(attachment.title)}`,
    );
  }
}
