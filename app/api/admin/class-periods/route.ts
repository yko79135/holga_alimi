import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 });

  const { data, error } = await supabase.from("class_periods").select("id,name,active").order("name");
  if (error) return NextResponse.json({ error: "수업 목록을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ classPeriods: data || [] });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return adminJsonError("수업 이름을 입력해 주세요.", 400);

  const admin = createAdminClient();
  const { data, error } = await admin.from("class_periods").insert({ name }).select("id,name,active").single();
  if (error) return adminJsonError(error.code === "23505" ? "이미 존재하는 수업 이름입니다." : "수업을 추가하지 못했습니다.", error.code === "23505" ? 409 : 500);
  return NextResponse.json({ classPeriod: data });
}
