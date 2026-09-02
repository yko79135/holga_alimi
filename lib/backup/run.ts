import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { collectBackup, countRows, serializeBackup } from "@/lib/backup/export";
import { BACKUP_BUCKET, BACKUP_PREFIX, backupFilename, backupObjectPath, backupRetentionDays, expiredBackupNames, seoulDate } from "@/lib/backup/storage";
import { GoogleDriveError, readDriveConfig, saveBackupToDrive } from "@/lib/backup/google-drive";

export type DriveOutcome =
  | { status: "saved"; folderUrl: string; removed: string[] }
  | { status: "skipped" }
  | { status: "failed"; error: string };

export type BackupRunResult = {
  date: string;
  sizeBytes: number;
  rowCount: number;
  storage: { path: string; removed: string[] };
  drive: DriveOutcome;
};

export class BackupRunError extends Error {}

const MISSING_BUCKET_MESSAGE = `백업 버킷(${BACKUP_BUCKET})이 없습니다. Supabase SQL Editor에서 supabase/20260904_daily_data_backup.sql 를 먼저 실행해 주세요.`;

/** 전체 데이터를 JSON 한 덩어리로 만들어 비공개 Storage 버킷에 올리고, 설정되어 있으면
 * 구글 드라이브에도 같은 파일을 한 벌 더 올립니다. 그 다음 두 곳 모두에서 보관 기간이 지난
 * 예전 백업을 지웁니다. 같은 날 두 번 돌면 그날 파일을 덮어씁니다.
 *
 * Storage 업로드가 실패하면 백업이 아예 없는 것이므로 실행 전체를 실패로 봅니다. 드라이브
 * 사본만 실패했을 때는 Storage 사본이 이미 남았으므로 결과에 실패 사유를 담아 돌려주고,
 * 부르는 쪽(크론 응답·관리자 화면)이 이를 눈에 띄게 알립니다. */
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
    date,
    sizeBytes: Buffer.byteLength(body, "utf8"),
    rowCount: countRows(payload.tables),
    storage: { path, removed: await pruneOldBackups(admin, now) },
    drive: await saveToDrive(date, body, now),
  };
}

async function saveToDrive(date: string, body: string, now: Date): Promise<DriveOutcome> {
  try {
    const config = readDriveConfig();
    if (!config) return { status: "skipped" };
    const result = await saveBackupToDrive(config, backupFilename(date), body, now);
    return { status: "saved", folderUrl: result.folderUrl, removed: result.removed };
  } catch (error) {
    const message = error instanceof GoogleDriveError ? error.message : "구글 드라이브에 백업을 올리지 못했습니다.";
    console.error("google drive backup failed", error);
    return { status: "failed", error: message };
  }
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
