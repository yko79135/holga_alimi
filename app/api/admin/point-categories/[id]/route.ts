import { NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCategoryHint, normalizeCategoryName } from "@/lib/warnings/categories";
import { CATEGORY_COLUMNS, toPointCategory } from "@/lib/warnings/point-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_PATTERN.test(String(id || "").trim())) return adminJsonError("카테고리 ID를 확인해 주세요.", 400);

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const update: Record<string, unknown> = {};
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return adminJsonError("잘못된 요청입니다.", 400);
    update.active = body.active;
  }
  if (body.name !== undefined) {
    const name = normalizeCategoryName(body.name);
    if (!name) return adminJsonError("카테고리 이름을 40자 이내로 입력해 주세요. \"직접 입력\"은 사용할 수 없습니다.", 400);
    update.name = name;
  }
  // pointHint is deliberately nullable: sending "" clears the hint.
  if (body.pointHint !== undefined) update.point_hint = normalizeCategoryHint(body.pointHint);
  if (!Object.keys(update).length) return adminJsonError("변경할 내용이 없습니다.", 400);

  const admin = createAdminClient();
  const { data, error } = await admin.from("point_categories").update(update).eq("id", id).select(CATEGORY_COLUMNS).maybeSingle();
  if (error) return adminJsonError(error.code === "23505" ? "이미 등록된 카테고리입니다." : "카테고리를 수정하지 못했습니다.", error.code === "23505" ? 409 : 500);
  if (!data) return adminJsonError("카테고리를 찾을 수 없습니다.", 404);
  return NextResponse.json({ category: toPointCategory(data) });
}

/** Categories already used by a point record can't be deleted -- past records keep their category
 * text and the stats screens group by it, so removing the row would rewrite history's meaning.
 * Deactivate those instead: they disappear from the grant dropdown but stay readable. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_PATTERN.test(String(id || "").trim())) return adminJsonError("카테고리 ID를 확인해 주세요.", 400);

  const admin = createAdminClient();
  const { data: category, error: loadError } = await admin.from("point_categories").select("id,kind,name").eq("id", id).maybeSingle();
  if (loadError) return adminJsonError("카테고리를 삭제하지 못했습니다.", 500);
  if (!category) return adminJsonError("카테고리를 찾을 수 없습니다.", 404);

  const { count, error: usageError } = await admin
    .from("warning_entries")
    .select("id", { count: "exact", head: true })
    .eq("category", category.name)
    .eq("kind", category.kind);
  if (usageError) return adminJsonError("카테고리를 삭제하지 못했습니다.", 500);
  if (count) return adminJsonError(`이미 ${count}건의 점수 기록에 사용된 카테고리라 삭제할 수 없습니다. 비활성화해 주세요.`, 409);

  const { error } = await admin.from("point_categories").delete().eq("id", id);
  if (error) return adminJsonError("카테고리를 삭제하지 못했습니다.", 500);
  return NextResponse.json({ success: true });
}
