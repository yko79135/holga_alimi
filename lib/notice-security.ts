export const NOTICE_BUCKET = "notice-attachments";
export const MAX_PDF_SIZE = 20 * 1024 * 1024;
export const MAX_NOTICE_ATTACHMENTS = 5;
export type AttachmentInput = { originalFilename: string; mimeType: string; sizeBytes: number };
export function sanitizeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() || "attachment.pdf";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "attachment.pdf";
}
export function validatePdf(input: AttachmentInput) {
  const filename = sanitizeFilename(input.originalFilename);
  if (input.mimeType !== "application/pdf") return { ok: false as const, error: "PDF 파일만 첨부할 수 있습니다." };
  if (!/\.pdf$/i.test(filename)) return { ok: false as const, error: "파일 확장자는 .pdf여야 합니다." };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false as const, error: "빈 파일은 첨부할 수 없습니다." };
  if (input.sizeBytes > MAX_PDF_SIZE) return { ok: false as const, error: "PDF는 20MB 이하만 첨부할 수 있습니다." };
  return { ok: true as const, filename };
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
