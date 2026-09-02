-- 매일 자동으로 저장되는 데이터 백업(JSON)이 쌓이는 비공개 버킷입니다.
-- Supabase SQL Editor에서 실행하세요. 기존 데이터에는 손대지 않습니다.
--
-- 이 버킷에는 학생·학부모 개인정보가 통째로 들어 있으므로, 브라우저 세션(authenticated)에는
-- 어떤 정책도 주지 않습니다. 서버의 service_role 경로(app/api/cron/daily-backup,
-- app/api/admin/backups)만 파일을 쓰고 읽을 수 있고, 관리자 화면은 그 서버가 만들어 준
-- 5분짜리 서명 링크로만 내려받습니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('data-backups', 'data-backups', false, 268435456, array['application/json'])
on conflict (id) do update
set public = false,
    file_size_limit = 268435456,
    allowed_mime_types = array['application/json'];

-- 혹시 예전에 만들어 둔 정책이 있으면 지웁니다. (service_role 은 RLS를 지나가지 않습니다.)
drop policy if exists "data_backup_objects_select" on storage.objects;
drop policy if exists "data_backup_objects_insert" on storage.objects;
drop policy if exists "data_backup_objects_delete" on storage.objects;
