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
    return NextResponse.json({
      message: `${result.date} 백업을 저장했습니다. (${result.rowCount.toLocaleString("ko-KR")}행)`,
      ...result,
    });
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
