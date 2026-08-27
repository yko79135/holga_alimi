import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPointKind, normalizeCategoryHint, normalizeCategoryName, sortPointCategories } from "@/lib/warnings/categories";
import { CATEGORY_COLUMNS, toPointCategory } from "@/lib/warnings/point-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Teachers need the list too (it fills the grant form dropdown); only writes are admin-only. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 });

  const kind = new URL(request.url).searchParams.get("kind");
  let query = supabase.from("point_categories").select(CATEGORY_COLUMNS).order("kind").order("sort_order").order("name");
  if (kind) {
    if (!isPointKind(kind)) return NextResponse.json({ error: "점수 종류를 확인해 주세요." }, { status: 400 });
    query = query.eq("kind", kind);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "카테고리 목록을 불러오지 못했습니다." }, { status: 500 });
  // Praise rows come back in 가나다 order regardless of sort_order -- see comparePointCategories.
  return NextResponse.json({ categories: sortPointCategories((data || []).map(toPointCategory)) });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const kind = body.kind;
  if (!isPointKind(kind)) return adminJsonError("점수 종류를 확인해 주세요.", 400);
  const name = normalizeCategoryName(body.name);
  if (!name) return adminJsonError("카테고리 이름을 40자 이내로 입력해 주세요. \"직접 입력\"은 사용할 수 없습니다.", 400);
  const pointHint = normalizeCategoryHint(body.pointHint);

  const admin = createAdminClient();
  // New categories go to the end of their kind's dropdown.
  const { data: last, error: lastError } = await admin.from("point_categories").select("sort_order").eq("kind", kind).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  if (lastError) return adminJsonError("카테고리를 추가하지 못했습니다.", 500);
  const sortOrder = (last?.sort_order ?? 0) + 10;

  const { data, error } = await admin.from("point_categories").insert({ kind, name, point_hint: pointHint, sort_order: sortOrder }).select(CATEGORY_COLUMNS).single();
  if (error) return adminJsonError(error.code === "23505" ? "이미 등록된 카테고리입니다." : "카테고리를 추가하지 못했습니다.", error.code === "23505" ? 409 : 500);
  return NextResponse.json({ category: toPointCategory(data) });
}
