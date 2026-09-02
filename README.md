# 학교 학부모 소통 포털

학부모별 로그인, 학생별 비공개 알림, 가정통신문, 읽음/확인/답변 기록을 제공하는 Next.js + Supabase 웹앱입니다.

## 핵심 기능

- 관리자: 학생 등록, 학부모/교사 계정 발급, 학부모-학생 연결
- 교사: 학교 전체·학년·개별 학생 대상 알림 발송
- 학부모: 연결된 자녀 관련 알림만 열람
- 경고/생활지도 알림의 읽음 및 확인 완료 기록
- 학부모 답변을 교사 발송 기록에서 확인
- 모바일 반응형 화면
- Supabase Row Level Security로 서버/브라우저 양쪽에서 개인정보 분리

## 1. Supabase 설정

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
3. Authentication > Users에서 첫 관리자 계정을 직접 생성합니다.
4. `supabase/bootstrap-admin.sql`의 이메일을 방금 만든 계정 이메일로 바꾸고 실행합니다.
5. Project Settings에서 Project URL, Publishable key(또는 anon key), service_role key를 확인합니다.

중요: `service_role` 키는 `.env.local`과 Vercel 서버 환경변수에만 저장하세요. 브라우저 코드나 GitHub에 올리면 안 됩니다.

## 2. 로컬 실행

```bash
cp .env.example .env.local
npm install
npm run dev
```

`.env.local`에 실제 키를 입력합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SCHOOL_NAME=우리학교 학부모 포털
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 3. 최초 운영 순서

1. 관리자 로그인
2. `학생 관리`에서 학생 등록
3. `계정 관리`에서 학부모 계정 생성 및 자녀 연결
4. 교사 계정 생성
5. `알림 작성`에서 전체/학년/학생 대상을 선택하여 발송

## 4. Vercel 배포

1. 이 폴더를 GitHub 저장소에 업로드합니다.
2. Vercel에서 저장소를 Import합니다.
3. Vercel Project Settings > Environment Variables에 `.env.local`의 네 변수를 등록합니다.
4. Deploy합니다.
5. Supabase Authentication > URL Configuration의 Site URL을 Vercel 주소로 설정합니다.

## 개인정보 운영 권장사항

- 경고/생활지도 내용은 필요한 사실과 지도 내용만 기록합니다.
- 비밀번호는 교사가 대신 보관하지 말고 임시 비밀번호 전달 후 변경하도록 운영합니다.
- 퇴학·졸업·퇴사 계정은 즉시 비활성화하거나 삭제합니다.
- 실제 운영 전 학부모 개인정보 수집·이용 동의 문구와 학교의 보존 기간 정책을 정합니다.
- 문자·카카오톡·이메일 푸시 알림은 별도 외부 서비스 연동이 필요합니다. 현재 버전은 로그인 후 확인하는 인앱 알림 방식입니다.

## Notice attachments and Web Push setup

Run `supabase/20260713_notice_attachments_push.sql` in the Supabase SQL Editor. It creates the private `notice-attachments` Storage bucket, `notice_attachments`, `push_subscriptions`, indexes, and RLS policies.

VAPID keys are required for Web Push. Generate placeholders locally with:

```bash
npx web-push generate-vapid-keys
```

Add these Vercel environment variables without committing real secrets:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` - public VAPID key exposed to browsers.
- `VAPID_PRIVATE_KEY` - private VAPID key, server-only.
- `VAPID_SUBJECT` - contact URI such as `mailto:school@example.com`.

Existing Supabase variables remain required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`.

## 매일 자동 데이터 백업

핵심 데이터(학생, 학부모 연결, 공지, 훈계·칭찬 점수, 출결 내역 등)가 **매일 한국 시간 새벽 3시**에 JSON 파일 하나로 저장됩니다. 관리자가 `데이터 백업` 탭에서 직접 눌러 받던 파일과 같은 내용이며, 자동 백업은 사람이 아무것도 하지 않아도 남습니다.

저장되는 곳은 두 군데입니다. **Supabase의 비공개 Storage 버킷**에 항상 저장되고, 아래 `구글 드라이브에도 저장하기`를 설정해 두면 **구글 드라이브에도 같은 파일이 한 벌 더** 올라갑니다.

### 설정 (한 번만)

1. Supabase SQL Editor에서 `supabase/20260904_daily_data_backup.sql`를 실행합니다. 백업 파일이 쌓일 비공개 Storage 버킷 `data-backups`가 만들어집니다.
2. Vercel Project Settings > Environment Variables에 `CRON_SECRET`을 추가합니다. 아무나 백업을 돌리지 못하게 막는 값이며, 예를 들어 `openssl rand -hex 32`로 만든 무작위 문자열을 씁니다.
3. 배포합니다. `vercel.json`의 `crons` 항목이 매일 18:00 UTC(= 한국 시간 새벽 3시)에 `/api/cron/daily-backup`을 부릅니다.

Vercel Hobby 요금제에서 크론은 하루 한 번까지 돌고, 지정한 시각 언저리(같은 시간대 안)에서 실행됩니다. 정각에 딱 맞춰 도는 것은 아닙니다.

### 저장되는 위치와 보관 기간

| 항목 | 값 |
| --- | --- |
| Supabase | 비공개 버킷 `data-backups`, 경로 `daily/holga-backup-2026-09-03.json` |
| 구글 드라이브 | 설정했을 때만. 폴더 `홀가 알림 자동 백업`, 파일 `holga-backup-2026-09-03.json` |
| 파일 이름 | 한국 시간 날짜 기준 |
| 보관 기간 | 기본 30일. 지난 파일은 다음 백업 때 두 곳 모두에서 자동 삭제 |
| 보관 기간 변경 | Vercel 환경변수 `BACKUP_RETENTION_DAYS`에 일수를 넣습니다 |

같은 날 두 번 돌면 그날 파일을 덮어씁니다(드라이브에서도 파일이 늘지 않고 내용만 바뀝니다).

### 구글 드라이브에도 저장하기 (선택)

아래 값을 Vercel 환경변수에 넣으면 매일 백업이 구글 드라이브에도 한 벌 더 올라갑니다. 넣지 않으면 지금처럼 Supabase에만 저장됩니다.

| 환경변수 | 설명 |
| --- | --- |
| `GOOGLE_DRIVE_CLIENT_ID` | OAuth 클라이언트 ID |
| `GOOGLE_DRIVE_CLIENT_SECRET` | OAuth 클라이언트 보안 비밀 |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | 아래에서 한 번 발급받는 리프레시 토큰 |
| `GOOGLE_DRIVE_FOLDER_ID` | (선택) 저장할 폴더 ID. 비워 두면 앱이 `홀가 알림 자동 백업` 폴더를 스스로 만들어 씁니다 |
| `GOOGLE_DRIVE_FOLDER_NAME` | (선택) 앱이 만들 폴더 이름을 바꾸고 싶을 때 |

세 개(`CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) 중 일부만 넣으면 백업이 실패로 표시됩니다. 반쯤 설정해 두고 저장되는 줄 아는 것이 가장 위험하기 때문에 일부러 조용히 넘어가지 않습니다.

#### 리프레시 토큰 발급 (한 번만)

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 하나 만듭니다.
2. `API 및 서비스 > 라이브러리`에서 **Google Drive API**를 사용 설정합니다.
3. `OAuth 동의 화면`을 만듭니다. 사용자 유형은 `외부`, 앱 이름은 아무거나, 이메일은 본인 것을 넣습니다. **게시 상태를 `프로덕션`으로 바꿔 두세요.** `테스트` 상태로 두면 리프레시 토큰이 7일 만에 만료되어 백업이 멈춥니다.
4. `사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID`에서 유형을 **데스크톱 앱**으로 만들고, 나온 클라이언트 ID와 보안 비밀을 적어 둡니다.
5. 아래 주소의 `클라이언트ID` 자리를 바꿔 브라우저에서 엽니다. 본인 구글 계정으로 로그인하고 허용합니다.

   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=클라이언트ID&redirect_uri=http://localhost&response_type=code&access_type=offline&prompt=consent&scope=https://www.googleapis.com/auth/drive.file
   ```

6. 허용하면 `http://localhost/?code=...` 로 넘어가며 **페이지는 열리지 않습니다(정상)**. 주소창의 `code=` 뒤부터 `&` 앞까지를 복사합니다.
7. 터미널에서 코드를 리프레시 토큰으로 바꿉니다. 응답의 `refresh_token` 값이 `GOOGLE_DRIVE_REFRESH_TOKEN`입니다.

   ```bash
   curl -X POST https://oauth2.googleapis.com/token \
     -d client_id=클라이언트ID \
     -d client_secret=클라이언트보안비밀 \
     -d code=복사한코드 \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost
   ```

8. 세 값을 Vercel 환경변수에 넣고 다시 배포한 뒤, 관리자 화면에서 `지금 백업하기`를 한 번 눌러 드라이브에 파일이 생기는지 확인합니다.

#### 권한 범위에 대해

이 앱은 `drive.file` 권한만 요청합니다. **이 앱이 만든 파일에만** 닿을 수 있는 범위라서, 드라이브의 다른 문서·사진은 읽지도 쓰지도 못합니다. 그래서 저장 폴더도 앱이 직접 만들어 씁니다. 이미 쓰던 폴더를 지정하고 싶다면 `GOOGLE_DRIVE_FOLDER_ID`에 그 폴더 ID(드라이브에서 폴더를 열었을 때 주소 끝부분)를 넣으면 되는데, 앱이 만들지 않은 폴더에는 권한 범위 때문에 올리지 못할 수 있습니다. 그런 오류가 나면 이 값을 비우고 앱이 만든 폴더를 쓰세요.

백업 파일에는 학생·학부모 개인정보가 통째로 들어 있습니다. 이 폴더는 **다른 사람과 공유하지 마세요.**

### 백업 확인·내려받기

관리자로 로그인해 `데이터 백업` 항목을 보면 자동 백업 목록이 날짜·용량과 함께 나옵니다.

- `다운로드`: 5분간만 열리는 서명 링크로 그날 백업을 내려받습니다.
- `지금 백업하기`: 크론을 기다리지 않고 즉시 한 번 저장합니다(오늘 파일을 덮어씀).
- 가장 최근 백업이 이틀 이상 지났으면 목록 위에 빨간 경고가 뜹니다. 자동 백업이 멈춘 것을 이렇게 알아챌 수 있습니다.
- 목록 위에 구글 드라이브 사본이 켜져 있는지 꺼져 있는지도 함께 나옵니다. 켜져 있으면 드라이브 폴더로 가는 링크가 붙습니다.

### 알아 둘 점

- 백업에는 학생·학부모 개인정보가 통째로 들어 있습니다. 버킷은 비공개이고 서버(`service_role`)만 읽고 쓰며, 관리자 화면에도 임시 서명 링크로만 나옵니다. 내려받은 파일은 안전하게 보관하세요.
- 공지에 첨부된 PDF 원본은 백업에 포함되지 않고, 첨부파일 정보(파일명 등)만 들어갑니다.
- 구글 드라이브 사본을 설정하지 않으면 백업이 같은 Supabase 프로젝트 안에만 남습니다. 실수로 지운 기록을 되살리는 데는 충분하지만, 프로젝트 자체를 잃는 상황까지 대비하려면 드라이브 사본을 켜 두는 것이 좋습니다.
- 드라이브 업로드만 실패하면(토큰 만료 등) Supabase 사본은 그대로 남지만, 크론 실행과 관리자 화면 양쪽에서 **실패로 표시**됩니다. 두 곳에 저장되는 줄 알고 지나가지 않도록 일부러 그렇게 했습니다.
- 자동 백업은 더미(테스트) 데이터를 포함한 모든 행을 담습니다. 복원할 때 빠진 행이 없도록 하기 위해서이며, 관리자가 직접 받는 `백업 파일 다운로드`는 지금까지처럼 남의 테스트 행을 뺍니다.

## 훈계·칭찬 점수 카테고리 관리

점수 카테고리 목록은 이제 코드 상수가 아니라 `point_categories` 테이블에 있습니다. Supabase SQL Editor에서 `supabase/20260826_point_categories.sql`를 실행하세요. 기존 카테고리 목록이 초기 데이터로 들어가고, `warning_entries`의 고정 카테고리 CHECK 제약이 테이블을 참조하는 트리거로 교체됩니다.

실행 후 관리자로 로그인하면 `훈계 점수`·`칭찬 점수` 탭 상단에서 수업 관리 옆에 카테고리 관리가 보입니다.

- 추가: 카테고리 이름(40자 이내)과 참고 점수(선택)를 입력하면 해당 탭의 카테고리 목록에 바로 추가됩니다. 참고 점수는 `거짓말 (10/5점)`처럼 안내로만 표시되고 입력 점수를 제한하지 않습니다.
- 비활성화: 목록에서만 감춰지고 과거 기록은 그대로 남습니다. 더 이상 쓰지 않는 카테고리는 삭제 대신 비활성화를 권장합니다.
- 삭제: 아직 한 번도 점수 부여에 쓰이지 않은 카테고리만 삭제할 수 있습니다.

교사 계정에서는 카테고리를 고르기만 하고, 추가·수정은 관리자만 할 수 있습니다.

## 알림 세부 대상 (모든 학부모 / 모든 학부모 및 교사 / 모든 교사)

Supabase SQL Editor에서 `supabase/20260901_notice_target_audience.sql`를 실행하세요. `notices`에 `target_audience` 칸(`parents` / `parents_and_staff` / `staff`)을 추가하고, 교사 전용 공지가 학부모에게 보이지 않도록 `notices` 조회 정책을 다시 만듭니다. 기존 공지는 모두 `parents`(모든 학부모)로 남습니다.

`알림 작성` 탭에서 발송 범위를 `학교 전체`로 고르면 `세부 대상`에서 아래 셋 중 하나를 선택합니다. `특정 학년`·`특정 학생`은 지금처럼 언제나 학부모 대상입니다.

| 세부 대상 | 받는 사람 |
| --- | --- |
| 모든 학부모 | 모든 학부모 계정 (교사·관리자에게는 기존처럼 참고용 알림만 전달) |
| 모든 학부모 및 교사 | 모든 학부모 + 모든 교사·관리자 |
| 모든 교사 | 모든 교사·관리자만. 학부모 화면에는 아예 보이지 않습니다 |

`모든 교사` 공지는 학부모가 열람할 수 없으므로 확인·답변 기록이 생기지 않습니다. `발송 기록` 탭에서는 확인 완료 수 대신 `교사 대상 알림`으로 표시됩니다.

## 나만 보이는 테스트 데이터 (더미 학부모 · 더미 학생)

Supabase SQL Editor에서 `supabase/20260902_private_test_fixtures.sql`를 실행하세요. 이 파일 하나가 세 가지를 합니다.

**배포보다 SQL을 먼저 실행하세요.** 학생·계정 목록 화면이 새 칸(`test_owner_id`)을 바로 읽기 때문에, 마이그레이션 전에 새 코드가 먼저 배포되면 그 목록들이 비어 보입니다.

1. `yko79135@gmail.com` 계정에 `관리자`·`학부모` 권한을 더합니다. 기존 권한은 그대로 두므로, 로그인하면 헤더 오른쪽에 `관리자 화면 / 학부모 화면` 전환 탭이 생깁니다. `admin@holyguidecs.org` 계정은 건드리지 않습니다.
2. `profiles`·`students`에 `test_owner_id` 칸을 추가합니다. 비어 있으면 지금까지와 똑같은 실제 데이터이고, 값이 있으면 **그 계정 한 명에게만 존재하는** 테스트용 행입니다.
3. 더미 학부모(`dummy.parent@holyguide.test`, 표시 이름 `테스트 학부모`)와 더미 학생(`테스트 학생`, G4)을 만들어 서로 연결하고, 같은 학생을 `yko79135@gmail.com` 계정에도 연결합니다. 이 뒤쪽 연결 덕분에 **따로 로그인하지 않고 헤더에서 `학부모 화면`으로 전환하기만 하면** 더미 학생이 보입니다.

### 다른 사람 화면에서 어디까지 감춰지나

`test_owner_id`가 걸린 행은 소유자 외에는 조회 정책 단계에서 걸러집니다. 서버의 `service_role` 경로는 RLS를 지나가지 않으므로 `lib/test-data.ts`의 규칙을 API에서 한 번 더 적용합니다.

| 화면 · 기능 | 다른 교사·관리자에게 |
| --- | --- |
| 계정 관리 목록, 계정 수정·삭제·비밀번호 재설정, 권한 추가·제거 | 더미 학부모가 아예 없음 |
| 학생 관리, 알림 대상 학생 선택, 학부모 연결 검색 | 더미 학생이 아예 없음 |
| 출석 관리·통계, 훈계·칭찬 점수 격자·통계 | 더미 학생 줄이 없음 |
| 발송 기록 | 더미 학생만 대상인 개별 공지는 목록에서 빠짐. 더미 학부모의 확인·답변도 집계에서 빠짐 |
| 학부모 가입 초대(자녀 이름 매칭), 학년 목록 | 더미 학생은 후보에서 제외 |
| 데이터 내보내기(백업 JSON) | 남의 테스트 행과 그 행을 참조하는 기록이 빠짐 |

소유자 본인의 화면에서는 이름 옆에 점선 `테스트` 배지가 붙어 실제 명단과 구분됩니다.

감춰지지 않는 것도 분명히 해 둡니다. `yko79135@gmail.com`은 이제 학부모 권한도 가지므로, **학교 전체 공지의 확인 완료 명단에는 본인 이름이 학부모로 등장할 수 있습니다.** 더미 계정이 아니라 실제 계정이 학부모 화면을 쓴 기록이기 때문입니다.

### 더미 학부모로 직접 로그인해야 한다면

더미 학부모 계정은 쓸 수 없는 비밀번호로 만들어져 있어 그대로는 로그인할 수 없습니다(로그인이 아니라 화면 확인용으로 만든 계정입니다). 굳이 그 계정으로 로그인해 보려면 `계정 관리` 탭에서 `테스트 학부모`의 비밀번호를 재설정한 뒤 쓰면 됩니다.

### 테스트 데이터를 더 만들거나 지우려면

같은 방식으로 `test_owner_id`에 본인 `profiles.id`를 넣으면 어떤 계정·학생이든 개인 전용이 됩니다. 정리할 때는 소유자 계정으로 `학생 관리`·`계정 관리`에서 평소처럼 삭제하면 됩니다.

## PWA icon cache after update

Users who installed the app before this icon update may continue seeing the old cached icon. They should:

1. Remove the existing Home Screen app.
2. Open the redeployed portal in Safari or Chrome.
3. Add or install it again.

Do not assume an already installed icon will always refresh automatically.

## 조퇴 · 지각 · 결석 신청

Supabase SQL Editor에서 `supabase/20260828_homeroom_and_early_dismissal.sql`를 먼저 실행하고, 이어서 `supabase/20260829_early_dismissal_no_approval.sql`, `supabase/20260830_principal_designation.sql`, `supabase/20260831_early_dismissal_absence_request_type.sql`, `supabase/20260903_early_dismissal_tardy_request_type.sql`를 순서대로 실행하세요. 두 번째 파일이 결재 절차를 걷어내고 출석부 기록 칸을 추가하며, 세 번째 파일이 교장 선생님 지정을, 네 번째 파일이 결석 신청을 위한 `request_type` 칸을 추가하고, 다섯 번째 파일이 여기에 지각을 더하면서 시각·당일 복귀 칸의 제약을 세 종류에 맞게 다시 씁니다.

위 파일 중 하나라도 건너뛰면 학부모 화면에서 `조퇴 신청을 저장하지 못했습니다`가 나옵니다. 아래 SQL로 `request_type` 칸이 실제로 있는지 확인할 수 있습니다.

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'early_dismissal_requests' and column_name = 'request_type';
```

칸이 없으면 `supabase/20260831_early_dismissal_absence_request_type.sql`를 실행하세요. 그때까지는 조퇴 신청만 예전 방식으로 접수되고, 지각·결석 신청은 `아직 받을 수 없습니다`로 안내됩니다.

### 동작 방식

1. 학부모가 `조퇴·지각·결석 신청` 탭에서 신청 종류(조퇴 / 지각 / 결석), 자녀, 날짜, 사유, 인솔자를 입력해 신청합니다. 연결된 자녀만 신청할 수 있습니다.
2. 세 종류가 같은 폼, 같은 알림, 같은 출석부 기록 절차를 씁니다. 아래 표의 두 칸만 종류에 따라 달라집니다.
3. 지각은 사유를 반드시 적어야 하는 사유 있는 지각입니다. 사유 칸은 세 종류 모두 필수입니다.
4. 같은 자녀·같은 날짜에는 종류와 상관없이 신청을 하나만 넣을 수 있습니다.
5. 제출 즉시 **모든 교사·관리자**에게 웹 푸시 알림이 전송됩니다. 알림을 누르면 교사 화면의 `조퇴·지각·결석 신청` 탭으로 바로 이동합니다. 알림에는 조퇴면 `일시`, 지각이면 `등교 예정`, 시각이 없으면 `날짜`로 적힙니다.
6. 승인·반려 절차는 없습니다. 모든 선생님이 내용을 열람하고 `확인` 버튼으로 확인 기록을 남길 수 있습니다.
7. 선생님이 `출석부에 조퇴 기록` / `출석부에 지각 기록` / `출석부에 결석 기록`을 누르면 해당 날짜의 출결이 위 표대로 기록됩니다. 잘못 눌렀으면 `기록 취소`로 되돌립니다.
8. 학부모는 출석부에 기록되기 전까지 신청을 취소할 수 있고, 취소되면 선생님들께 알림이 갑니다.

| 신청 종류 | 시각 칸 | 당일 복귀 | 출석부 기록 |
| --- | --- | --- | --- |
| 조퇴 | `조퇴 시각` (선택) | 물어봄 | `early_leave` |
| 지각 | `등교 예정 시각` (선택) | 없음 | `late` |
| 결석 | 없음 (하루 전체) | 없음 | `absent` |

시각은 세 종류가 `dismissal_time` 한 칸을 나눠 씁니다. 조퇴면 나가는 시각, 지각이면 등교 예정 시각이고, 결석에는 저장되지 않습니다.

### 출석부 기록 규칙

기존 출결 기록과 같은 방식(`attendance_change_batches` + `attendance_entries`)으로 저장되므로, 출석 관리 화면과 출석 통계에 그대로 반영되고 이력도 남습니다. 버튼을 누른 선생님이 작성자로 기록됩니다.

- 해당 날짜가 **이미 신청한 종류와 같은 상태로 기록되어 있으면** 아무것도 쓰지 않습니다.
- 해당 날짜에 **다른 출결 상태가 있으면** 그 값을 이전 상태로 남기고 신청한 종류로 바꿉니다.
- `기록 취소`는 기록 직전 상태로 되돌립니다. 다만 그 사이에 출석부를 직접 고쳤다면 건드리지 않고 그대로 둡니다.
- 출석부 기록에 실패하면 화면에 안내가 뜹니다. 출석 관리에서 직접 입력해 주세요.

### 홈룸 배정

관리자 계정의 `계정 관리` 탭에 `홈룸 · 교장 · 교감 선생님 지정` 카드가 있습니다. 조퇴·지각·결석 신청 목록과 알림에 학생의 홈룸 선생님이 함께 표시됩니다. 결재 권한과는 무관하며, 표시용 명단입니다.

마이그레이션이 아래 배정을 넣고, 같은 이름의 교사·관리자 계정이 하나만 있으면 자동으로 연결합니다. 계정을 연결하면 표시 이름이 그 계정의 이름을 따릅니다.

| 학년 | 홈룸 선생님 |
| --- | --- |
| G1 | 임예을 |
| G2 · G3 | 홍성혜 |
| G4 | 고영찬 |
| G5 · G6 | 오민진 |
| G7 | 송재승 |
| G8 ~ G12 | 이은총 |

교장 선생님은 홍인숙 선생님, 교감 선생님은 이은총 선생님입니다. 새 학년 라벨로 학생을 등록하면 그 학년이 목록에 자동으로 나타납니다.
