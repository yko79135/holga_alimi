import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NOTICE_BUCKET, validatePdf } from "@/lib/notice-security";

async function staff() { const s=await createClient(); const {data:{user}}=await s.auth.getUser(); if(!user) return {e:NextResponse.json({error:"로그인이 필요합니다."},{status:401})}; const {data:p}=await s.from("profiles").select("role").eq("id",user.id).single(); if(!["admin","teacher"].includes(p?.role)) return {e:NextResponse.json({error:"교사 또는 관리자 권한이 필요합니다."},{status:403})}; return {user}; }
export async function POST(req: Request) { const a=await staff(); if("e" in a) return a.e; const b=await req.json(); const v=validatePdf({originalFilename:b.filename,mimeType:b.mimeType,sizeBytes:Number(b.sizeBytes)}); if(!v.ok) return NextResponse.json({error:v.error},{status:400}); const path=`${a.user.id}/${crypto.randomUUID()}.pdf`; const admin=createAdminClient(); const {data,error}=await admin.storage.from(NOTICE_BUCKET).createSignedUploadUrl(path); if(error||!data) return NextResponse.json({error:"업로드 URL 생성에 실패했습니다."},{status:500}); return NextResponse.json({path, token:data.token, signedUrl:data.signedUrl, originalFilename:v.filename}); }
