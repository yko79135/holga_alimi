export const NOTICE_BUCKET = "notice-attachments";
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
export const MAX_NOTICE_ATTACHMENTS = 5;
/** 첨부할 수 있는 파일 종류와 그 확장자. 스토리지 버킷의 allowed_mime_types와
 * notice_attachments의 체크 제약(supabase/20261030_notice_image_attachments.sql)도 같은 목록이다. */
export const ATTACHMENT_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
};
/** 파일 선택 창의 accept 값. 확장자를 함께 적어야 iPhone이 HEIC 사진을 JPEG로 바꿔 넘긴다. */
export const ATTACHMENT_ACCEPT = Object.entries(ATTACHMENT_TYPES).flatMap(([mime, exts]) => [mime, ...exts.map((ext) => `.${ext}`)]).join(",");
export type AttachmentInput = { originalFilename: string; mimeType: string; sizeBytes: number };
export function isImageMime(mimeType: string | null | undefined) {
  return !!mimeType && mimeType.startsWith("image/") && mimeType in ATTACHMENT_TYPES;
}
/** 스토리지 경로에 붙일 확장자. 원래 파일 이름이 아니라 검증된 MIME에서 정한다. */
export function attachmentExtension(mimeType: string) {
  return ATTACHMENT_TYPES[mimeType]?.[0] || "bin";
}
export function sanitizeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() || "attachment";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "attachment";
}
export function validateAttachment(input: AttachmentInput) {
  const filename = sanitizeFilename(input.originalFilename);
  const extensions = ATTACHMENT_TYPES[input.mimeType];
  if (!extensions) return { ok: false as const, error: "PDF 또는 이미지(JPG, PNG, GIF, WEBP) 파일만 첨부할 수 있습니다." };
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (!filename.includes(".") || !extensions.includes(ext)) return { ok: false as const, error: `파일 확장자는 ${extensions.map((e) => `.${e}`).join(" 또는 ")}여야 합니다.` };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false as const, error: "빈 파일은 첨부할 수 없습니다." };
  if (input.sizeBytes > MAX_ATTACHMENT_SIZE) return { ok: false as const, error: "첨부파일은 20MB 이하만 올릴 수 있습니다." };
  return { ok: true as const, filename };
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
