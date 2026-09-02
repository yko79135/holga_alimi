import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { collectBackup, countRows, serializeBackup } from "@/lib/backup/export";
import { BACKUP_BUCKET, BACKUP_PREFIX, backupObjectPath, backupRetentionDays, expiredBackupNames, seoulDate } from "@/lib/backup/storage";

export type BackupRunResult = {
  path: string;
  date: string;
  sizeBytes: number;
  rowCount: number;
  removed: string[];
};

export class BackupRunError extends Error {}

const MISSING_BUCKET_MESSAGE = `백업 버킷(${BACKUP_BUCKET})이 없습니다. Supabase SQL Editor에서 supabase/20260904_daily_data_backup.sql 를 먼저 실행해 주세요.`;

/** 전체 데이터를 JSON 한 덩어리로 만들어 비공개 Storage 버킷에 올리고, 보관 기간이 지난
 * 예전 백업을 지웁니다. 같은 날 두 번 돌면 그날 파일을 덮어씁니다. */
export async function runDailyBackup(now: Date = new Date()): Promise<BackupRunResult> {
  const admin = createAdminClient();
  const payload = await collectBackup(admin);
  const body = serializeBackup(payload);
  const date = seoulDate(now);
  const path = backupObjectPath(date);

  const { error: uploadError } = await admin.storage.from(BACKUP_BUCKET).upload(path, body, {
    contentType: "application/json; charset=utf-8",
    upsert: true,
  });
  if (uploadError) {
    throw new BackupRunError(isMissingBucket(uploadError.message) ? MISSING_BUCKET_MESSAGE : `백업 파일 업로드에 실패했습니다: ${uploadError.message}`);
  }

  return {
    path,
    date,
    sizeBytes: Buffer.byteLength(body, "utf8"),
    rowCount: countRows(payload.tables),
    removed: await pruneOldBackups(admin, now),
  };
}

/** 지우기가 실패해도 백업 자체는 이미 올라갔으므로 실행을 실패로 만들지는 않습니다. */
async function pruneOldBackups(admin: ReturnType<typeof createAdminClient>, now: Date) {
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).list(BACKUP_PREFIX, { limit: 1000 });
  if (error || !data) return [];

  const expired = expiredBackupNames(data.map((file) => file.name), backupRetentionDays(), now);
  if (!expired.length) return [];

  const { error: removeError } = await admin.storage.from(BACKUP_BUCKET).remove(expired.map((name) => `${BACKUP_PREFIX}/${name}`));
  return removeError ? [] : expired;
}

function isMissingBucket(message: string) {
  return /bucket not found/i.test(message);
}
