import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireAdmin } from "@/lib/admin/require-admin";
import { BackupExportError } from "@/lib/backup/export";
import { BackupRunError, runDailyBackup } from "@/lib/backup/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 매일 도는 자동 백업. vercel.json 의 크론이 이 주소를 부르고, 관리자가 화면에서
 * `지금 백업하기`를 눌러도 같은 자리로 들어옵니다.
 *
 * 크론 요청은 Vercel 이 `Authorization: Bearer $CRON_SECRET` 헤더를 붙여 보냅니다.
 * 헤더가 없는 요청은 로그인한 관리자여야 통과합니다. */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) return NextResponse.json({ error: "CRON_SECRET 환경변수가 설정되지 않았습니다." }, { status: 500 });
    if (!matchesBearer(authorization, secret)) return NextResponse.json({ error: "인증에 실패했습니다." }, { status: 401 });
  } else {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
  }

  try {
    const result = await runDailyBackup();
    const rows = `${result.rowCount.toLocaleString("ko-KR")}행`;

    // 드라이브 사본만 실패했으면 Storage 사본은 이미 남았지만, 조용히 성공으로 넘기면
    // 두 곳에 저장되는 줄 알고 지나갑니다. 크론 로그와 화면 양쪽에서 실패로 보이게 합니다.
    if (result.drive.status === "failed") {
      return NextResponse.json(
        { error: `Supabase에는 ${result.date} 백업을 저장했지만 구글 드라이브에 올리지 못했습니다. ${result.drive.error}`, ...result },
        { status: 500 }
      );
    }

    const where = result.drive.status === "saved" ? "Supabase와 구글 드라이브에" : "Supabase에";
    return NextResponse.json({ message: `${result.date} 백업을 ${where} 저장했습니다. (${rows})`, ...result });
  } catch (error) {
    const message = error instanceof BackupRunError || error instanceof BackupExportError ? error.message : "백업에 실패했습니다.";
    console.error("daily backup failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function matchesBearer(authorization: string, secret: string) {
  const provided = Buffer.from(authorization.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
