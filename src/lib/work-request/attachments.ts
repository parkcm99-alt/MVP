export const TEXT_ATTACHMENT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'] as const;
export const PASSIVE_ATTACHMENT_EXTENSIONS = ['.pdf', '.docx'] as const;
export const ATTACHMENT_ACCEPT = [
  ...TEXT_ATTACHMENT_EXTENSIONS,
  ...PASSIVE_ATTACHMENT_EXTENSIONS,
].join(',');

export const MAX_ATTACHMENT_COUNT = 5;
export const MAX_TEXT_ATTACHMENT_BYTES = 256 * 1024;
export const MAX_ATTACHMENT_CONTEXT_CHARS = 6000;
export const ATTACHMENT_PREVIEW_CHARS = 900;

export interface WorkRequestAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  textExtracted: boolean;
  usedInContext: boolean;
  preview: string | null;
  warning?: string;
}

export function getFileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

export function isTextAttachment(extension: string): boolean {
  return (TEXT_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension);
}

export function isPassiveAttachment(extension: string): boolean {
  return (PASSIVE_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function summarizeAttachmentPreview(text: string): string {
  const compact = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n')
    .trim();

  return compact.length > ATTACHMENT_PREVIEW_CHARS
    ? `${compact.slice(0, ATTACHMENT_PREVIEW_CHARS).trim()}...`
    : compact;
}

export function buildAttachmentContext(attachments: WorkRequestAttachment[]): string {
  const usable = attachments.filter(attachment => attachment.preview?.trim());
  if (attachments.length === 0) return '';

  const fileList = attachments
    .map(attachment => {
      const status = attachment.textExtracted
        ? 'text included'
        : attachment.warning ?? 'filename only';
      return `- ${attachment.name} (${attachment.extension || 'unknown'}, ${formatBytes(attachment.size)}, ${status})`;
    })
    .join('\n');

  const textContext = usable
    .map(attachment => [
      `### ${attachment.name}`,
      attachment.preview ?? '',
    ].join('\n'))
    .join('\n\n');

  return [
    '첨부파일 목록:',
    fileList,
    textContext ? '\n텍스트 추출 내용:' : '',
    textContext,
  ].join('\n').slice(0, MAX_ATTACHMENT_CONTEXT_CHARS).trim();
}
