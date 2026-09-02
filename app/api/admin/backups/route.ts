import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_BUCKET, BACKUP_PREFIX, backupDateFromName, backupRetentionDays } from "@/lib/backup/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_SECONDS = 300;

/** 자동 백업 목록. 파일은 비공개 버킷에 있으므로 잠깐 동안만 열리는 서명 링크를 함께 줍니다. */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).list(BACKUP_PREFIX, { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) {
    const missingBucket = /bucket not found/i.test(error.message);
    return NextResponse.json(
      { error: missingBucket ? `백업 버킷(${BACKUP_BUCKET})이 아직 없습니다. supabase/20260904_daily_data_backup.sql 를 실행해 주세요.` : "백업 목록을 불러오지 못했습니다." },
      { status: missingBucket ? 409 : 500 }
    );
  }

  const files = (data || []).filter((file) => backupDateFromName(file.name) !== null);
  const paths = files.map((file) => `${BACKUP_PREFIX}/${file.name}`);
  const { data: signed } = paths.length
    ? await admin.storage.from(BACKUP_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS, { download: true })
    : { data: [] };
  const urlByPath = new Map((signed || []).map((entry) => [entry.path ?? "", entry.signedUrl]));

  const backups = files.map((file) => ({
    name: file.name,
    date: backupDateFromName(file.name),
    sizeBytes: (file.metadata as { size?: number } | null)?.size ?? null,
    downloadUrl: urlByPath.get(`${BACKUP_PREFIX}/${file.name}`) ?? null,
  }));

  return NextResponse.json({ backups, retentionDays: backupRetentionDays() });
}
