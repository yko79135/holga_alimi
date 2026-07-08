import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const { data: requester } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (requester?.role !== "admin") {
      return NextResponse.json({ error: "관리자만 계정을 만들 수 있습니다." }, { status: 403 });
    }

    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const role = String(body.role || "parent");
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.filter((value: unknown) => typeof value === "string") : [];

    if (!email || !fullName || password.length < 8 || !["parent", "teacher", "admin"].includes(role)) {
      return NextResponse.json({ error: "입력값을 확인해주세요. 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      return NextResponse.json({ error: createError?.message || "계정 생성에 실패했습니다." }, { status: 400 });
    }

    const newUserId = created.user.id;
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName, phone, role }).eq("id", newUserId);

    if (profileError) {
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (role === "parent" && studentIds.length) {
      const rows = studentIds.map((studentId: string) => ({ parent_id: newUserId, student_id: studentId }));
      const { error: linkError } = await admin.from("parent_students").insert(rows);
      if (linkError) {
        await admin.auth.admin.deleteUser(newUserId);
        return NextResponse.json({ error: linkError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ id: newUserId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
