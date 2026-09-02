# 홀리가이드 학부모 포털

Next.js(App Router) + Supabase. 배포는 Vercel이 `main` 푸시를 받아 자동으로 한다.

## 배포 전 필수 확인: 미적용 마이그레이션

**DB 스키마에 기대는 코드를 배포하기 전에, 그 마이그레이션이 운영 DB에 실행됐는지 반드시 먼저
확인한다.** 이 저장소는 마이그레이션을 `supabase/*.sql` 파일로 두고 Supabase SQL Editor에서
손으로 실행하기 때문에, 코드만 배포되고 DB가 뒤처지는 일이 실제로 일어난다. 그렇게 되면
사용자에게는 "저장하지 못했습니다" 같은 500 오류로만 보인다. (2026-09-02: 지각 신청 기능이
`20260903_early_dismissal_tardy_request_type.sql` 미적용으로 학부모 화면에서 실패했다.)

확인 방법:

```bash
node scripts/check-migrations.mjs   # 확인용 SQL을 출력한다
```

출력된 SQL을 운영 DB에서 실행한다(Supabase SQL Editor, 또는 Supabase MCP의 `execute_sql`).
결과에서:

- `applied = false` — 아직 실행하지 않은 마이그레이션이다. 배포 전에 해당 `.sql` 파일을 실행한다.
- `applied = null` — 데이터만 고치는 1회성 보정이라 흔적이 남지 않는다. 눈으로 판단한다.

이 확인은 파일 이름을 대조하는 것이 아니라 각 마이그레이션이 남긴 흔적(컬럼·제약조건·정책·
함수·시드 행)을 DB 카탈로그에서 직접 본다. `supabase_migrations.schema_migrations`에는 일부만
기록돼 있어서 그 표만 믿으면 안 된다.

언제 확인하는가:

- `supabase/`에 파일을 추가하거나 DB 스키마에 기대는 기능을 만들 때 — 병합·배포 **전에**
- 사용자가 "저장하지 못했습니다" 류의 오류를 알려 올 때 — 코드를 읽기 전에 먼저

새 마이그레이션을 추가하면 `scripts/check-migrations.mjs`의 `PROBES`에도 확인식을 한 줄
추가한다. 빠뜨리면 스크립트가 오류로 알려 준다.

## 마이그레이션 작성 규칙

- 파일 이름은 `supabase/YYYYMMDD_설명.sql`. 앞선 마이그레이션 다음에 실행한다는 전제를 파일
  맨 위 주석에 적는다.
- 다시 실행해도 안전하게 쓴다 (`if not exists`, `drop constraint if exists` 뒤에 `add`).
- 스키마를 바꿨으면 끝에 `notify pgrst, 'reload schema';`를 넣는다.
- `supabase/schema.sql`은 최초 설치용이고 마이그레이션 대상이 아니다.

## 확인 명령

```bash
npx tsc --noEmit   # npm run lint 과 같다. 타입 검사만 한다.
npx next build     # 빌드 확인
```

테스트 러너는 없다. UI를 바꿨으면 실제로 렌더링해 확인한다 — Chromium이 설치돼 있고
Playwright가 `/opt/pw-browsers/chromium`을 쓰도록 설정돼 있다. 모바일 화면은 360px과 390px
너비에서 가로 스크롤이 생기지 않는지 본다(`document.documentElement.scrollWidth`).

## 화면 폭 규칙

- 통계 표(점수·출석)는 700px 이하에서 학생별 카드로 바뀐다 (`stat-cards-*`, `app/globals.css`).
- 새 표를 넣을 때도 같은 방식을 따른다. 휴대폰에서 가로로 밀리는 표는 사실상 안 보이는 표다.
