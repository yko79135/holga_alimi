import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_NOTICE_ATTACHMENTS, NOTICE_BUCKET, validatePdf } from "@/lib/notice-security";

export type NoticeAttachmentInput = { storagePath: string; originalFilename: string; mimeType: string; sizeBytes: number };

export type UpdateNoticeInput = {
  noticeId: string;
  editorId: string;
  title: string;
  body: string;
  customTypeLabel?: string;
  /** 지울 기존 첨부의 id. */
  removeAttachmentIds?: string[];
  /** 스토리지에 이미 올라간 새 첨부. */
  attachments?: NoticeAttachmentInput[];
};

export class NoticeUpdateError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** 스토리지에 실제로 파일이 있는지 본다. 업로드 URL만 받고 올리지 않은 경로를 걸러 낸다. */
async function assertUploaded(admin: ReturnType<typeof createAdminClient>, storagePath: string, filename: string) {
  const [folder, object] = storagePath.split("/");
  const { data, error } = await admin.storage.from(NOTICE_BUCKET).list(folder, { search: object });
  if (error || !data?.length) throw new NoticeUpdateError(`${filename} 업로드 확인에 실패했습니다.`);
}

export async function updateNotice(input: UpdateNoticeInput) {
  const admin = createAdminClient();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new NoticeUpdateError("제목과 내용을 입력해주세요.");

  const { data: notice, error: noticeError } = await admin
    .from("notices")
    .select("id,type,source_type")
    .eq("id", input.noticeId)
    .maybeSingle();
  if (noticeError) throw new NoticeUpdateError("알림을 불러오지 못했습니다.", 500);
  if (!notice) throw new NoticeUpdateError("공지를 찾을 수 없습니다.", 404);
  // 점수·출석 알림은 점수 기록에서 문구를 다시 만들어 덮어쓴다. 여기서 고쳐 두어도 다음 정정
  // 때 사라지므로 애초에 막고 올바른 화면으로 보낸다.
  if (notice.source_type) throw new NoticeUpdateError("점수·출석에서 자동으로 만들어진 알림입니다. 점수 기록을 고치면 알림 내용도 함께 바뀝니다.");

  const { data: existing, error: existingError } = await admin
    .from("notice_attachments")
    .select("id,storage_path,original_filename")
    .eq("notice_id", input.noticeId);
  if (existingError) throw new NoticeUpdateError("첨부파일을 불러오지 못했습니다.", 500);

  const existingRows = existing || [];
  const removeIds = Array.from(new Set((input.removeAttachmentIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const unknown = removeIds.find((id) => !existingRows.some((row) => row.id === id));
  if (unknown) throw new NoticeUpdateError("이 공지의 첨부파일이 아닙니다.");

  const incoming = input.attachments || [];
  const keptCount = existingRows.length - removeIds.length;
  if (keptCount + incoming.length > MAX_NOTICE_ATTACHMENTS) throw new NoticeUpdateError(`PDF는 최대 ${MAX_NOTICE_ATTACHMENTS}개까지 첨부할 수 있습니다.`);

  const newRows = [];
  for (const file of incoming) {
    const valid = validatePdf({ originalFilename: file.originalFilename, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes) });
    if (!valid.ok) throw new NoticeUpdateError(valid.error);
    const storagePath = String(file.storagePath || "");
    // 업로드 URL은 자기 폴더에만 내준다. 남의 경로를 붙여 넣어 남의 파일을 공지에 다는 것을 막는다.
    if (!storagePath.startsWith(`${input.editorId}/`)) throw new NoticeUpdateError("첨부 경로가 올바르지 않습니다.");
    await assertUploaded(admin, storagePath, valid.filename);
    newRows.push({ notice_id: input.noticeId, storage_path: storagePath, original_filename: valid.filename, mime_type: file.mimeType, size_bytes: Number(file.sizeBytes), uploaded_by: input.editorId });
  }

  if (newRows.length) {
    const { error } = await admin.from("notice_attachments").insert(newRows);
    if (error) {
      await admin.storage.from(NOTICE_BUCKET).remove(newRows.map((row) => row.storage_path));
      throw new NoticeUpdateError("첨부파일 저장에 실패했습니다.", 500);
    }
  }

  const patch: Record<string, unknown> = { title, body, edited_at: new Date().toISOString(), edited_by: input.editorId };
  if (notice.type === "custom") {
    const label = String(input.customTypeLabel || "").trim();
    if (!label) throw new NoticeUpdateError("알림 종류를 직접 입력해주세요.");
    patch.custom_type_label = label;
  }
  const { error: updateError } = await admin.from("notices").update(patch).eq("id", input.noticeId);
  if (updateError) {
    if (newRows.length) {
      await admin.from("notice_attachments").delete().in("storage_path", newRows.map((row) => row.storage_path));
      await admin.storage.from(NOTICE_BUCKET).remove(newRows.map((row) => row.storage_path));
    }
    throw new NoticeUpdateError("알림 수정에 실패했습니다.", 500);
  }

  // 지우기는 본문 수정이 확정된 뒤에 한다. 앞서 하다가 중간에 실패하면 되살릴 수 없다.
  let storageCleanupWarning = false;
  if (removeIds.length) {
    const removedPaths = existingRows.filter((row) => removeIds.includes(row.id)).map((row) => row.storage_path).filter(Boolean);
    const { error } = await admin.from("notice_attachments").delete().in("id", removeIds);
    if (error) {
      storageCleanupWarning = true;
      console.error("Notice attachment removal failed", { noticeId: input.noticeId, message: error.message });
    } else if (removedPaths.length) {
      const { error: storageError } = await admin.storage.from(NOTICE_BUCKET).remove(removedPaths);
      if (storageError) {
        storageCleanupWarning = true;
        console.error("Notice attachment storage cleanup failed", { noticeId: input.noticeId, message: storageError.message });
      }
    }
  }

  return { attachmentCount: keptCount + newRows.length, storageCleanupWarning };
}
