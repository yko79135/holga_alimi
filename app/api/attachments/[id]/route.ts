import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NOTICE_BUCKET } from "@/lib/notice-security";
function cd(name:string){return name.replace(/[\r\n"\/\\]/g,"_");}
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params; const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)return NextResponse.json({error:"로그인이 필요합니다."},{status:401}); const {data:att}=await supabase.from("notice_attachments").select("id,notice_id,storage_path,original_filename").eq("id",id).single(); if(!att)return NextResponse.json({error:"첨부파일을 찾을 수 없습니다."},{status:404}); const {data:notice}=await supabase.from("notices").select("id").eq("id",att.notice_id).single(); if(!notice)return NextResponse.json({error:"첨부파일을 찾을 수 없습니다."},{status:404}); const admin=createAdminClient(); // 미리보기는 브라우저가 바로 띄우도록 download 옵션을 넘기지 않는다. 넘기면 이미지·PDF도 내려받기가 된다.
 const download=new URL(req.url).searchParams.get("download")==="1"; const {data,error}=await admin.storage.from(NOTICE_BUCKET).createSignedUrl(att.storage_path,60,download?{download:cd(att.original_filename)}:undefined); if(error||!data)return NextResponse.json({error:"첨부파일 링크 생성에 실패했습니다."},{status:500}); return NextResponse.redirect(data.signedUrl);}
