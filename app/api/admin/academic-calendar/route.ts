import { NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Current saved calendar state for one academic year, so the upload UI can show what's already
 * on file (e.g. after a page refresh) instead of always looking empty. */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const academicYear = Number(new URL(req.url).searchParams.get("year") || new Date().getFullYear());
  if (!academicYear) return adminJsonError("학년도를 확인해 주세요.", 400);

  const admin = createAdminClient();
  const [exceptionsRes, termsRes] = await Promise.all([
    admin.from("academic_calendar_exceptions").select("date,label").eq("academic_year", academicYear).order("date"),
    admin.from("academic_terms").select("semester,start_date,end_date,total_instructional_days").eq("academic_year", academicYear).in("semester", [1, 2]),
  ]);
  if (exceptionsRes.error) return adminJsonError("학사일정을 불러오지 못했습니다.", 500);
  if (termsRes.error) return adminJsonError("학기 정보를 불러오지 못했습니다.", 500);

  return NextResponse.json({
    academicYear,
    exceptions: exceptionsRes.data || [],
    terms: (termsRes.data || []).map((t: any) => ({ semester: t.semester, startDate: t.start_date, endDate: t.end_date, totalInstructionalDays: t.total_instructional_days })),
  });
}

/** Saves the admin-confirmed calendar: replaces every academic_calendar_exceptions row for this
 * academic_year with the submitted list, and upserts each term's start/end dates (leaving
 * total_instructional_days untouched -- it stays available as the fallback for terms nobody has
 * uploaded a calendar for). */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const academicYear = Number(body.academicYear);
  const exceptions = Array.isArray(body.exceptions) ? body.exceptions : [];
  const terms = Array.isArray(body.terms) ? body.terms : [];

  if (!Number.isInteger(academicYear) || academicYear < 2000) return adminJsonError("학년도를 확인해 주세요.", 400);
  for (const e of exceptions) {
    if (!isDateOnly(e?.date) || typeof e?.label !== "string" || !e.label.trim()) return adminJsonError("휴교일 목록을 확인해 주세요.", 400);
  }
  for (const t of terms) {
    if (![1, 2].includes(t?.semester) || !isDateOnly(t?.startDate) || !isDateOnly(t?.endDate) || t.startDate > t.endDate) {
      return adminJsonError("학기 시작일과 종료일을 확인해 주세요.", 400);
    }
  }

  const admin = createAdminClient();

  const deleteRes = await admin.from("academic_calendar_exceptions").delete().eq("academic_year", academicYear);
  if (deleteRes.error) return adminJsonError("기존 학사일정을 정리하지 못했습니다.", 500);

  if (exceptions.length) {
    const rows = exceptions.map((e: { date: string; label: string }) => ({ date: e.date, academic_year: academicYear, label: e.label.trim(), created_by: auth.user.id }));
    const insertRes = await admin.from("academic_calendar_exceptions").insert(rows);
    if (insertRes.error) return adminJsonError("학사일정을 저장하지 못했습니다.", 500);
  }

  for (const t of terms as { semester: 1 | 2; startDate: string; endDate: string }[]) {
    const upsertRes = await admin.from("academic_terms").upsert(
      { academic_year: academicYear, semester: t.semester, start_date: t.startDate, end_date: t.endDate, updated_by: auth.user.id, updated_at: new Date().toISOString() },
      { onConflict: "academic_year,semester" },
    );
    if (upsertRes.error) return adminJsonError("학기 시작·종료일을 저장하지 못했습니다.", 500);
  }

  return NextResponse.json({ success: true, message: `${academicYear}학년도 학사일정을 저장했습니다. (휴교일 ${exceptions.length}건)`, savedExceptions: exceptions.length });
}
