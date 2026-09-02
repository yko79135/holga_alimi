/** 자동 백업 JSON이 쌓이는 비공개 Storage 버킷. service_role 로만 접근합니다.
 * (supabase/20260904_daily_data_backup.sql) */
export const BACKUP_BUCKET = "data-backups";
export const BACKUP_PREFIX = "daily";

const DEFAULT_RETENTION_DAYS = 30;

/** 이 일수보다 오래된 자동 백업은 다음 실행 때 지워집니다. */
export function backupRetentionDays() {
  const configured = Number(process.env.BACKUP_RETENTION_DAYS);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_RETENTION_DAYS;
  return Math.floor(configured);
}

/** 파일 이름은 학교가 쓰는 한국 시간 날짜로 붙입니다. 새벽 3시(KST)에 도는 크론이
 * UTC 기준으로는 전날이라 이름이 하루 밀려 보이는 것을 막습니다. */
export function seoulDate(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function backupFilename(date: string) {
  return `holga-backup-${date}.json`;
}

export function backupObjectPath(date: string) {
  return `${BACKUP_PREFIX}/${backupFilename(date)}`;
}

/** 파일 이름에 박아 둔 날짜를 그대로 읽습니다. Storage의 created_at 은 덮어쓰기 때
 * 바뀔 수 있어서, 보관 기간 판단은 이 날짜로 합니다. */
export function backupDateFromName(name: string) {
  const match = /^holga-backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
  return match ? match[1] : null;
}

/** `retentionDays` 보다 오래된 백업 이름만 골라 냅니다. 날짜를 못 읽는 파일은 건드리지 않습니다. */
export function expiredBackupNames(names: string[], retentionDays: number, now: Date = new Date()) {
  const cutoff = new Date(`${seoulDate(now)}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (retentionDays - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return names.filter((name) => {
    const date = backupDateFromName(name);
    return date !== null && date < cutoffDate;
  });
}
