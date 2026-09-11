import { NextResponse } from "next/server";
import { requireStaff, staffJsonError } from "@/lib/admin/require-staff";
import { deleteNoticePermanently } from "@/lib/admin/delete-notice";
import { NoticeUpdateError, updateNotice } from "@/lib/admin/update-notice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const noticeId = String(id || "").trim();
  if (!UUID.test(noticeId)) return staffJsonError("공지 ID를 확인해주세요.", 400);

  let payload: any;
  try { payload = await request.json(); } catch { return staffJsonError("요청 내용을 읽지 못했습니다.", 400); }

  try {
    const result = await updateNotice({
      noticeId,
      editorId: auth.user.id,
      title: String(payload?.title || ""),
      body: String(payload?.body || ""),
      customTypeLabel: payload?.customTypeLabel === undefined ? undefined : String(payload.customTypeLabel),
      removeAttachmentIds: Array.isArray(payload?.removeAttachmentIds) ? payload.removeAttachmentIds : [],
      attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
    });
    return NextResponse.json({
      message: result.storageCleanupWarning ? "알림을 수정했습니다. 지운 첨부파일 정리는 서버에서 다시 확인해주세요." : "알림을 수정했습니다.",
      attachmentCount: result.attachmentCount,
      storageCleanupWarning: result.storageCleanupWarning,
    });
  } catch (error) {
    if (error instanceof NoticeUpdateError) return staffJsonError(error.message, error.status);
    console.error("Notice update failed", { noticeId, message: error instanceof Error ? error.message : "unknown" });
    return staffJsonError("알림 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const noticeId = String(id || "").trim();
  if (!UUID.test(noticeId)) return staffJsonError("공지 ID를 확인해주세요.", 400);
  try {
    const result = await deleteNoticePermanently(noticeId);
    return NextResponse.json({ message: result.storageCleanupWarning ? "공지를 영구 삭제했습니다. 일부 첨부파일 정리는 서버에서 다시 확인해주세요." : "공지를 영구 삭제했습니다.", storageCleanupWarning: result.storageCleanupWarning, attachmentCount: result.attachmentCount });
  } catch (error) {
    console.error("Admin notice deletion failed", { noticeId, message: error instanceof Error ? error.message : "unknown" });
    if (error instanceof Error && error.message === "NOTICE_NOT_FOUND") return staffJsonError("공지를 찾을 수 없습니다.", 404);
    return staffJsonError("공지 삭제에 실패했습니다.", 500);
  }
}
