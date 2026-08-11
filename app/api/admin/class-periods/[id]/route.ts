import { NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.active !== "boolean") return adminJsonError("잘못된 요청입니다.", 400);

  const admin = createAdminClient();
  const { data, error } = await admin.from("class_periods").update({ active: body.active }).eq("id", id).select("id,name,active").single();
  if (error || !data) return adminJsonError("수업 상태를 변경하지 못했습니다.", 500);
  return NextResponse.json({ classPeriod: data });
}
