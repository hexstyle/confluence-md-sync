// Client
export {
  ConfluenceClient,
  ConfluenceApiError,
  type ConfluencePage,
  type ConfluencePageStorage,
  type ConfluenceAttachment,
  type ConfluenceLabel,
  type AttachmentVersionData,
  type CreatePageOptions,
} from './client/client.js';
export {
  authHeader,
  loadConfigFromEnv,
  type ConfluenceAuthType,
  type ConfluenceConfig,
  type LoadConfigOptions,
} from './client/config.js';

// Markdown
export { Markdown } from './markdown/markdown.js';
export {
  renderToStorage,
  extractPlaceholders,
  renameImagePlaceholders,
  MissingAttachmentUrlError,
  PLACEHOLDER_RE,
  type AttachmentUrls,
  type ExtractedPlaceholders,
} from './markdown/render.js';
export { validateMarkdown, MarkdownValidationError, type ValidateOptions } from './markdown/validate.js';

// Macros (pluggable)
export * from './macros/index.js';

// BPMN (optional peer dep 'bpmn-to-image' is loaded lazily on use)
export {
  convertBpmn,
  convertBpmnFolder,
  isBpmnFile,
  bpmnOutputName,
  BPMN_FILE_RE,
  type BpmnConversion,
  type BpmnImageFormat,
  type ConvertBpmnFolderOptions,
} from './bpmn/convert.js';

// Attachments
export { fileSha256, HASH_TAG_PREFIX } from './attachments/hash.js';
export {
  Attachment,
  AttachmentService,
  toAttachmentVersion,
  SRC_SHA_SIDECAR_SUFFIX,
  type AttachmentVersion,
  type EnsuredAttachment,
} from './attachments/attachment.js';

// Pages & tables
export { Page, Table } from './pages/page.js';
export {
  readTableFromConfluence,
  findTable,
  findTableInMacro,
  parseHtmlTable,
  decodeHtmlCell,
  renderMarkdownTable,
  escapeMdTableCell,
  readAndMapTable,
  type ColumnAlign,
  type TableColumn,
} from './pages/tables.js';

// Publish
export {
  publishPage,
  computeContentHash,
  DEFAULT_HASH_PROPERTY_KEY,
  type PublishPageOptions,
  type PublishPageResult,
  type TableData,
} from './publish/publish.js';
export {
  runPublish,
  type Here,
  type Build,
  type PublishPlan,
  type RunPublishOptions,
} from './publish/runner.js';

// Facade
export { confluence, ConfluenceWrapper } from './wrapper.js';
