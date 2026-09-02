#!/usr/bin/env node
// supabase/*.sql 마이그레이션이 운영 DB에 실제로 적용됐는지 확인하는 SQL을 만들어 출력한다.
//
// 이 저장소는 마이그레이션을 Supabase SQL Editor에서 손으로 실행한다. 실행 기록
// (supabase_migrations.schema_migrations)에는 일부만 남아 있어서 "기록에 없음 = 미적용"이
// 성립하지 않는다. 그래서 파일 이름을 대조하는 대신, 각 마이그레이션이 남긴 흔적(컬럼,
// 제약조건, 정책, 함수, 시드 행)을 카탈로그에서 직접 확인한다.
//
// 사용법:
//   node scripts/check-migrations.mjs      # 확인용 SQL을 출력
// 출력된 SQL을 Supabase SQL Editor에 붙여 넣으면 마이그레이션마다 한 줄씩 나온다.
// applied = false 인 줄이 아직 실행하지 않은 마이그레이션이다.
//
// 새 마이그레이션을 추가하면 아래 PROBES에도 한 줄을 같이 추가한다. 빠뜨리면 이 스크립트가
// 오류로 알려 준다.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase");

// 값이 문자열이면 boolean SQL 식, { manual: "이유" }면 자동 확인이 불가능한 마이그레이션이다.
// 데이터만 고치는 마이그레이션은 흔적이 남지 않아 눈으로 확인할 수밖에 없다.
const PROBES = {
  "20260713_admin_permanent_deletion.sql":
    `exists (select 1 from pg_policies where schemaname='public' and tablename='students' and policyname='students_admin_delete')`,
  "20260713_notice_attachments_push.sql":
    `to_regclass('public.notice_attachments') is not null`,
  "20260714_multi_role_accounts.sql":
    `to_regclass('public.profile_roles') is not null`,
  "20260714_parent_dashboard_realtime.sql":
    `to_regclass('public.parent_dashboard_events') is not null`,
  // 이 마이그레이션의 핵심은 Realtime 발행 목록에 일곱 개 표를 넣는 것이다. 같이 만드는
  // parent_students 유니크 인덱스는 기본키와 겹쳐서 확인용으로 쓸 수 없다.
  "20260714_realtime_parent_student_links.sql":
    `(select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
        and tablename in ('notices','notice_students','notice_attachments','acknowledgements','parent_students','students','profiles')) = 7`,
  "20260714_student_warnings.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='notices' and column_name='source_type')`,
  "20260714_warning_save_rls_fix.sql":
    `exists (select 1 from pg_policies where schemaname='public' and tablename='warning_entries' and policyname='warning_entries_staff_insert')`,
  "20260810_attendance_entries.sql":
    `to_regclass('public.attendance_entries') is not null`,
  "20260810_notice_delete_staff.sql":
    `exists (select 1 from pg_policies where schemaname='public' and tablename='notices' and policyname='notices_staff_delete')`,
  "20260810_signup_invites.sql":
    `to_regclass('public.signup_invites') is not null`,
  "20260811_discipline_praise_points.sql":
    `to_regclass('public.class_periods') is not null`,
  "20260811_notice_custom_type_label.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='notices' and column_name='custom_type_label')`,
  "20260811_notice_type_praise_custom.sql":
    `exists (select 1 from pg_enum where enumtypid='public.notice_type'::regtype and enumlabel='praise')`,
  "20260811_point_kind_column.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='warning_entries' and column_name='kind')`,
  "20260811_signup_invite_children.sql":
    `exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='redeem_signup_invite_children')`,
  "20260811_signup_invites_reusable.sql":
    `to_regclass('public.signup_invite_redemptions') is not null`,
  "20260812_class_periods_seed.sql":
    `exists (select 1 from public.class_periods where name='Homeroom')`,
  "20260812_warning_entries_custom_category.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='warning_entries' and column_name='custom_category_label')`,
  "20260813_academic_terms_and_attendance_suspension.sql":
    `to_regclass('public.academic_terms') is not null and exists (select 1 from pg_enum where enumtypid='public.attendance_status'::regtype and enumlabel='suspension')`,
  "20260814_fix_discipline_point_grant_sign.sql":
    { manual: "지난 훈계 점수 행의 delta 값을 고치는 1회성 보정. 흔적이 남지 않는다." },
  "20260815_grace_conversion_constraint.sql":
    `exists (select 1 from pg_constraint where conrelid='public.warning_entries'::regclass and conname='warning_daily_date_required')`,
  "20260815_grace_conversion_enum.sql":
    `exists (select 1 from pg_enum where enumtypid='public.warning_entry_type'::regtype and enumlabel='grace_conversion')`,
  "20260820_academic_calendar_exceptions.sql":
    `to_regclass('public.academic_calendar_exceptions') is not null`,
  "20260820_discipline_category_rework.sql":
    `exists (select 1 from pg_constraint where conrelid='public.warning_entries'::regclass and conname='warning_entries_category_check')`,
  "20260821_academic_calendar_events.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='academic_calendar_exceptions' and column_name='is_closure')`,
  "20260821_academic_calendar_multi_events.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='academic_calendar_exceptions' and column_name='id')`,
  "20260825_sync_profile_email_on_auth_change.sql":
    `exists (select 1 from pg_trigger where tgname='on_auth_user_email_changed')`,
  "20260826_point_categories.sql":
    `to_regclass('public.point_categories') is not null`,
  "20260826_revoke_trigger_function_execute.sql":
    `not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')`,
  "20260828_homeroom_and_early_dismissal.sql":
    `to_regclass('public.homeroom_assignments') is not null and to_regclass('public.early_dismissal_requests') is not null`,
  "20260829_early_dismissal_no_approval.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='early_dismissal_requests' and column_name='attendance_recorded_at')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='early_dismissal_requests' and column_name='status')`,
  "20260830_principal_designation.sql":
    `exists (select 1 from public.school_officers where role_key='principal')`,
  "20260831_early_dismissal_absence_request_type.sql":
    `(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.early_dismissal_requests'::regclass and conname='early_dismissal_requests_type_check') like '%absence%'`,
  "20260901_notice_target_audience.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='notices' and column_name='target_audience')`,
  "20260902_private_test_fixtures.sql":
    `exists (select 1 from information_schema.columns where table_schema='public' and table_name='students' and column_name='test_owner_id')`,
  "20260903_early_dismissal_tardy_request_type.sql":
    `(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.early_dismissal_requests'::regclass and conname='early_dismissal_requests_type_check') like '%tardy%'`,
};

// schema.sql과 bootstrap-admin.sql은 최초 설치용이라 대조 대상이 아니다.
const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{8}_.+\.sql$/.test(name))
  .sort();

const missing = files.filter((name) => !(name in PROBES));
if (missing.length) {
  console.error("확인 방법이 등록되지 않은 마이그레이션이 있습니다. scripts/check-migrations.mjs의 PROBES에 추가해 주세요:");
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

const stale = Object.keys(PROBES).filter((name) => !files.includes(name));
if (stale.length) {
  console.error("PROBES에 있으나 supabase/에 없는 파일입니다. 지워 주세요:");
  for (const name of stale) console.error(`  - ${name}`);
  process.exit(1);
}

const selects = files.map((name) => {
  const probe = PROBES[name];
  const applied = typeof probe === "string" ? `(${probe.trim()})` : "null::boolean";
  const note = typeof probe === "string" ? "''" : `'${probe.manual.replace(/'/g, "''")}'`;
  return `  select '${name}' as migration, ${applied} as applied, ${note} as note`;
});

console.log(`-- supabase/*.sql 적용 여부 확인 (scripts/check-migrations.mjs 가 생성)
-- Supabase SQL Editor에 붙여 넣고 실행하세요. applied = false 인 줄이 아직 실행하지 않은
-- 마이그레이션입니다. applied = null 은 흔적이 남지 않아 눈으로 확인해야 하는 것입니다.
select * from (
${selects.join("\n  union all\n")}
) as t
order by applied nulls last, migration;`);
