import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TOTAL_INSTRUCTIONAL_DAYS } from "@/lib/attendance/schoolDays";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 });

  const url = new URL(req.url);
  const academicYear = Number(url.searchParams.get("year") || new Date().getFullYear());
  const semester = Number(url.searchParams.get("semester") || 1);

  const { data, error } = await supabase.from("academic_terms").select("total_instructional_days").eq("academic_year", academicYear).eq("semester", semester).maybeSingle();
  if (error) return NextResponse.json({ error: "학기 설정을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ academicYear, semester, totalInstructionalDays: data?.total_instructional_days ?? DEFAULT_TOTAL_INSTRUCTIONAL_DAYS });
}

export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const academicYear = Number(body.academicYear);
  const semester = Number(body.semester);
  const totalInstructionalDays = Number(body.totalInstructionalDays);
  if (!academicYear || ![1, 2].includes(semester) || !Number.isInteger(totalInstructionalDays) || totalInstructionalDays <= 0) {
    return adminJsonError("학년도, 학기, 총 수업일을 확인해 주세요.", 400);
  }

  const admin = createAdminClient();
  const { error } = await admin.from("academic_terms").upsert({ academic_year: academicYear, semester, total_instructional_days: totalInstructionalDays, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "academic_year,semester" });
  if (error) return adminJsonError("학기 설정을 저장하지 못했습니다.", 500);
  return NextResponse.json({ academicYear, semester, totalInstructionalDays });
}
