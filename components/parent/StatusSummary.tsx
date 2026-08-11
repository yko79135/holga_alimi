"use client";

import { useEffect, useState } from "react";
import { ATTENDANCE_EXCEPTION_STATUSES, ATTENDANCE_STATUS_LABELS, type AttendanceExceptionStatus } from "@/lib/attendance/types";

type Kind = "attendance" | "discipline" | "praise";

type Row = {
  id: string;
  name: string;
  semesterTotal?: number;
  semesterCounts?: Record<AttendanceExceptionStatus, number>;
};

const now = new Date();
const YEAR = now.getFullYear();
const SEMESTER = now.getMonth() < 7 ? 1 : 2;

const ENDPOINTS: Record<Kind, string> = {
  attendance: `/api/parent/attendance-stats?year=${YEAR}&semester=${SEMESTER}`,
  discipline: `/api/parent/point-stats?year=${YEAR}&semester=${SEMESTER}&kind=discipline`,
  praise: `/api/parent/point-stats?year=${YEAR}&semester=${SEMESTER}&kind=praise`,
};

const UNIT_LABEL: Record<Kind, string> = { attendance: "건", discipline: "점", praise: "점" };

/** Compact glance summary shown above the raw 현황 feed — reuses the same-semester
 * stats endpoints the dedicated 통계 tabs use, just without selectors or monthly expand. */
export default function StatusSummary({ kind }: { kind: Kind }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(ENDPOINTS[kind], { cache: "no-store" });
        const result = await response.json();
        if (!cancelled && response.ok) setRows(result.students || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  if (loading || !rows.length) return null;

  return (
    <div className="account-list">
      {rows.map((row) => (
        <article className="account-card" key={row.id}>
          <div className="account-meta">
            <strong>{row.name}</strong>
            {kind === "attendance"
              ? ATTENDANCE_EXCEPTION_STATUSES.map((status) => (
                  <span className="pill" key={status}>{ATTENDANCE_STATUS_LABELS[status]} {row.semesterCounts?.[status] ?? 0}</span>
                ))
              : null}
            <span className="pill">{kind === "attendance" ? "예외 합계" : kind === "praise" ? "칭찬 합계" : "훈계 합계"} {row.semesterTotal ?? 0}{UNIT_LABEL[kind]}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
