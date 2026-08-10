import { NextResponse } from "next/server";
import { requireStaff, staffJsonError } from "@/lib/admin/require-staff";
import { deleteNoticePermanently } from "@/lib/admin/delete-notice";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BULK_DELETE = 50;

export async function DELETE(request: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return staffJsonError("삭제할 공지를 선택해주세요.", 400);
  }
  const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : [];
  const ids = Array.from(new Set(rawIds.filter((value): value is string => typeof value === "string")));
  if (!ids.length) return staffJsonError("삭제할 공지를 선택해주세요.", 400);
  if (ids.some((id) => !UUID_RE.test(id))) return staffJsonError("공지 ID를 확인해주세요.", 400);
  if (ids.length > MAX_BULK_DELETE) return staffJsonError(`한 번에 최대 ${MAX_BULK_DELETE}개까지 삭제할 수 있습니다.`, 400);

  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  let storageCleanupWarning = false;

  for (const id of ids) {
    try {
      const result = await deleteNoticePermanently(id);
      deleted.push(id);
      if (result.storageCleanupWarning) storageCleanupWarning = true;
    } catch (error) {
      console.error("Bulk notice deletion failed", { id, message: error instanceof Error ? error.message : "unknown" });
      failed.push({ id, error: error instanceof Error && error.message === "NOTICE_NOT_FOUND" ? "공지를 찾을 수 없습니다." : "삭제에 실패했습니다." });
    }
  }

  return NextResponse.json({
    message: failed.length ? `${deleted.length}개를 삭제했습니다. ${failed.length}개는 삭제하지 못했습니다.` : `${deleted.length}개 공지를 영구 삭제했습니다.`,
    deleted,
    failed,
    storageCleanupWarning,
  });
}
