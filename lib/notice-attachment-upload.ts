import { createClient } from "@/lib/supabase/client";
import { MAX_PDF_SIZE, NOTICE_BUCKET } from "@/lib/notice-security";

export type UploadedAttachment = { storagePath: string; originalFilename: string; mimeType: string; sizeBytes: number };

/** 고른 PDF를 스토리지에 올리고 서버에 넘길 목록을 만든다. 알림 작성과 알림 수정이 같이 쓴다. */
export async function uploadNoticeAttachments(files: File[]): Promise<UploadedAttachment[]> {
  const uploaded: UploadedAttachment[] = [];
  for (const file of files) {
    if (file.type !== "application/pdf" || !/\.pdf$/i.test(file.name) || file.size <= 0 || file.size > MAX_PDF_SIZE) {
      throw new Error(`${file.name}: PDF(20MB 이하)만 첨부할 수 있습니다.`);
    }
    const prep = await fetch("/api/attachments/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }) });
    const signed = await prep.json();
    if (!prep.ok) throw new Error(signed.error || "첨부 업로드 준비에 실패했습니다.");
    const supabase = createClient();
    const { error } = await supabase.storage.from(NOTICE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file, { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(`${file.name}: 업로드에 실패했습니다.`);
    uploaded.push({ storagePath: signed.path, originalFilename: signed.originalFilename, mimeType: file.type, sizeBytes: file.size });
  }
  return uploaded;
}
