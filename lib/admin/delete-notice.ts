import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { NOTICE_BUCKET } from "@/lib/notice-security";

type DeleteNoticeResult = { deleted: true; attachmentCount: number; storageCleanupWarning: boolean };

export async function deleteNoticePermanently(noticeId: string): Promise<DeleteNoticeResult> {
  const admin = createAdminClient();
  const { data: notice, error: noticeError } = await admin.from("notices").select("id").eq("id", noticeId).single();
  if (noticeError || !notice) throw new Error("NOTICE_NOT_FOUND");

  const { data: attachments, error: attachmentError } = await admin
    .from("notice_attachments")
    .select("storage_path")
    .eq("notice_id", noticeId);
  if (attachmentError) throw new Error("ATTACHMENT_LOOKUP_FAILED");

  const paths = (attachments || []).map((row) => row.storage_path).filter((path): path is string => typeof path === "string" && path.length > 0);
  const { error: deleteError } = await admin.from("notices").delete().eq("id", noticeId);
  if (deleteError) throw new Error("NOTICE_DELETE_FAILED");

  let storageCleanupWarning = false;
  if (paths.length) {
    const { error: storageError } = await admin.storage.from(NOTICE_BUCKET).remove(paths);
    if (storageError) {
      storageCleanupWarning = true;
      console.error("Notice storage cleanup failed", { noticeId, attachmentCount: paths.length, message: storageError.message });
    }
  }

  return { deleted: true, attachmentCount: paths.length, storageCleanupWarning };
}
