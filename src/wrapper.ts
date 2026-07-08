import type { ConfluenceConfig } from './client/config.js';
import { ConfluenceClient } from './client/client.js';
import { AttachmentService } from './attachments/attachment.js';
import { Page } from './pages/page.js';
import { publishPage, type PublishPageOptions, type PublishPageResult } from './publish/publish.js';

/**
 * Высокоуровневый фасад: один объект на конфиг, отдаёт клиент, сервис
 * аттачей, объектную модель страниц и публикацию.
 */
export class ConfluenceWrapper {
  readonly client: ConfluenceClient;
  readonly attachments: AttachmentService;

  constructor(private readonly cfg: ConfluenceConfig) {
    this.client = new ConfluenceClient(cfg);
    this.attachments = new AttachmentService(this.client);
  }

  async readPage(pageId: string): Promise<Page> {
    const { title, storage } = await this.client.getPageStorage(pageId);
    return new Page(pageId, title, storage, this.client);
  }

  /** Находит страницу по space + title и возвращает объектную модель. */
  async findPage(spaceKey: string, title: string): Promise<Page | null> {
    const found = await this.client.getPageByTitle(spaceKey, title);
    if (!found) return null;
    return this.readPage(found.id);
  }

  /** Публикует markdown на страницу (см. {@link publishPage}). */
  async publish(opts: PublishPageOptions): Promise<PublishPageResult> {
    return publishPage(opts, this.cfg);
  }
}

export function confluence(cfg: ConfluenceConfig): ConfluenceWrapper {
  return new ConfluenceWrapper(cfg);
}
