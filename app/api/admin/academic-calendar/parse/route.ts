import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { requireAdmin } from "@/lib/admin/require-admin";
import { parseAcademicCalendarText } from "@/lib/attendance/calendarParser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Extracts text from an uploaded 학사일정 PDF and parses it into a preview (exceptions +
 * semester date ranges). Read-only -- nothing is saved here; the admin reviews/edits the result
 * client-side and POSTs the confirmed version to /api/admin/academic-calendar to save it. */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "PDF 파일을 선택해 주세요." }, { status: 400 });
  if (file.type !== "application/pdf") return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "파일 크기는 20MB를 넘을 수 없습니다." }, { status: 400 });

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    if (!text.trim()) return NextResponse.json({ error: "PDF에서 텍스트를 추출하지 못했습니다. 스캔된 이미지 PDF는 지원하지 않습니다." }, { status: 400 });

    const parsed = parseAcademicCalendarText(text);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("academic-calendar-parse-failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "PDF를 분석하지 못했습니다. 파일을 확인한 후 다시 시도해 주세요." }, { status: 500 });
  }
}
