"use client";

import { useCallback, useEffect, useState } from "react";
import { seoulDate } from "@/lib/backup/storage";

type Backup = { name: string; date: string | null; sizeBytes: number | null; downloadUrl: string | null };

/** 서명 링크는 5분이면 만료되므로, 목록을 오래 열어 둔 뒤 눌렀을 때를 대비해 이 시간이 지나면
 * 목록을 다시 받아옵니다. */
const REFRESH_AFTER_MS = 4 * 60 * 1000;

function formatSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function daysSince(date: string | null) {
  if (!date) return null;
  const then = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date(`${seoulDate()}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return null;
  return Math.round((today - then) / 86400000);
}

export default function BackupHistory() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/backups", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "백업 목록을 불러오지 못했습니다.");
      setBackups(result.backups || []);
      setRetentionDays(result.retentionDays || 30);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "백업 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { void load(); }, REFRESH_AFTER_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function runNow() {
    setRunning(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/cron/daily-backup", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "백업에 실패했습니다.");
      setMessage(result.message || "백업을 저장했습니다.");
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "백업에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  const latestAge = daysSince(backups[0]?.date ?? null);
  const stale = latestAge !== null && latestAge >= 2;

  return (
    <div className="backup-history">
      <div className="account-actions">
        <button type="button" className="secondary" onClick={runNow} disabled={running}>{running ? "백업하는 중..." : "지금 백업하기"}</button>
      </div>
      {message && <p role="status" className="success-message">{message}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {loading ? (
        <p className="muted">자동 백업 목록을 불러오는 중...</p>
      ) : backups.length === 0 ? (
        <div className="empty-state">아직 저장된 자동 백업이 없습니다. 첫 백업은 오늘 밤(한국 시간 새벽 3시)에 저장됩니다.</div>
      ) : (
        <>
          {stale && <p className="form-error">가장 최근 자동 백업이 {latestAge}일 전({backups[0].date})입니다. 자동 백업이 도는지 확인해 주세요.</p>}
          <p className="muted">최근 {backups.length}개 · {retentionDays}일이 지난 백업은 자동으로 지워집니다. 다운로드 링크는 5분간만 열립니다.</p>
          <ul className="backup-list">
            {backups.map((backup) => (
              <li key={backup.name}>
                <span>{backup.date}</span>
                <span className="muted">{formatSize(backup.sizeBytes)}</span>
                {backup.downloadUrl && <a className="secondary" href={backup.downloadUrl}>다운로드</a>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
