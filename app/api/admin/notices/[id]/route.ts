import { NextResponse } from "next/server";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { deleteNoticePermanently } from "@/lib/admin/delete-notice";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const noticeId = String(id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(noticeId)) return adminJsonError("공지 ID를 확인해주세요.", 400);
  try {
    const result = await deleteNoticePermanently(noticeId);
    return NextResponse.json({ message: result.storageCleanupWarning ? "공지를 영구 삭제했습니다. 일부 첨부파일 정리는 서버에서 다시 확인해주세요." : "공지를 영구 삭제했습니다.", storageCleanupWarning: result.storageCleanupWarning, attachmentCount: result.attachmentCount });
  } catch (error) {
    console.error("Admin notice deletion failed", { noticeId, message: error instanceof Error ? error.message : "unknown" });
    if (error instanceof Error && error.message === "NOTICE_NOT_FOUND") return adminJsonError("공지를 찾을 수 없습니다.", 404);
    return adminJsonError("공지 삭제에 실패했습니다.", 500);
  }
}
