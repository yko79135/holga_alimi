-- "준비사항 안내"(preparation) 알림 종류를 추가한다. 수업에 필요한 준비물·과제·암송 등
-- 학생이 미리 챙겨 와야 할 것을 학부모에게 알릴 때 쓴다.
-- supabase/20260904_daily_data_backup.sql 다음에 Supabase SQL Editor에서 실행한다.
--
-- 이 파일은 혼자 실행한다. Postgres는 방금 추가한 enum 값을 같은 트랜잭션 안에서 쓰지 못하므로
-- 이 값을 참조하는 제약조건이나 기본값을 여기에 같이 넣으면 안 된다.

alter type public.notice_type add value if not exists 'preparation';

notify pgrst, 'reload schema';
