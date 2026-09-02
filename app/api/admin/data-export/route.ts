import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { BackupExportError, collectBackup, serializeBackup } from "@/lib/backup/export";
import { backupFilename, seoulDate } from "@/lib/backup/storage";

export const runtime = "nodejs";

/** 관리자가 직접 눌러 받는 백업 파일. 매일 자동으로 저장되는 백업은
 * app/api/cron/daily-backup 이 같은 내용을 Storage 에 올립니다. */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: string;
  try {
    body = serializeBackup(await collectBackup(createAdminClient(), auth.user.id));
  } catch (error) {
    const message = error instanceof BackupExportError ? error.message : "백업 파일을 만들지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFilename(seoulDate())}"`,
    },
  });
}
