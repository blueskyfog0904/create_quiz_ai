# Supabase 싱가포르 → 서울 이전 계획

- 작성일: 2026-10-29 · 기준 HEAD 0e826cf · 개정 4(무료 방식) 2026-11-04 · 상태: **확정안 — 개정 4 독립 검증 2명 PASS(R6), 개정 3은 전문 검증 3명 PASS(R4). 실행 대기(대표 P 단계부터)**
- 요청: Supabase 프로젝트 지역을 싱가포르(Southeast)에서 서울(Northeast)로 옮긴다. 무료 활성 프로젝트 2개 한도(공무원맛집가이드 프로젝트가 같은 계정의 다른 조직에 있음) 때문에 **공무원맛집가이드를 일시정지해 자리를 비우고, 써머썬 무료 조직에 서울 프로젝트를 무료로 생성**한다(사용자 결정 2026-11-04: 개발 단계라 공무원맛집가이드가 꺼져 있어도 됨, Pro는 나중에 — A-11). 2026-10-29의 "새 Pro 조직" 방식은 폐기.
- 이 문서는 계획이다. 코드·DB는 바꾸지 않았다. 근거는 저장소·운영 DB SELECT 조사와 Supabase 공식 문서·CLI 소스 조사.
- 원칙: 대표는 DB 비밀번호·서비스 키를 AI에게 주지 않는다 → **비밀값이 필요한 명령은 대표가 자기 터미널에서 실행**하고 AI는 스크립트 작성·SELECT 검증·화면 확인을 맡는다. DB 쓰기는 리허설 → 승인 → 적용. 결제 DB는 전문 검증 3명.

## 1. 왜, 언제

- Vercel 함수는 이미 서울(`icn1`)에서 실행된다(운영 응답 헤더 `x-vercel-id: icn1::icn1::…`). DB만 싱가포르라 DB 조회마다 서울↔싱가포르 왕복이 생긴다.
- **지금이 가장 싼 시점**: 페이앱 출시 스위치 전(실결제 0건, `payapp_accepts_new_orders=false`), 카카오페이 미사용 결정, 회원 14명. 출시 후에는 진행 중 결제·웹훅·대사가 얽힌다.
- 순서: **이 이전 → 관리자 계획의 DB 단계(`docs/admin-implementation-workplan.md` 1절) → 페이앱 출시 스위치**. 관리자 계획의 코드 단위는 이전과 병행(13행 동결 규칙). 관리자 계획의 DB 작업과 출시 스위치 마이그레이션(`20261021110000`, 미적용)은 새 서울 DB에 적용한다.
- **변경 동결**: 리허설 시작(H-1 첫 덤프)부터 본 전환 완료까지 옛 프로젝트의 스키마·함수·cron·vault·Auth 설정·버킷 설정 변경 금지(관리자 계획의 **DB 작업**도 대기). 데이터 변경(상품 등록 등)은 허용 — 본 전환에서 다시 옮긴다. DB가 필요 없는 관리자 **코드** 배포는 병행 가능하되 C-0(전환 전 배포 ID 기록)~C-9 동안은 금지(`docs/admin-implementation-workplan.md` 0절).

## 2. 공식 사실 (Supabase 문서·CLI 소스)

| 사실 | 출처 |
|---|---|
| 기존 프로젝트 지역 변경 불가 → 새 프로젝트 + 데이터 이전 + OAuth 재입력 + 앱 URL·키 교체 | KB "Change Project Region" |
| Restore to new project는 같은 지역만, Project Transfer는 지역 이동 불가 | clone-project, project-transfer |
| 공식 경로 = CLI 덤프(roles / schema / data) + psql 복원(`session_replication_role = replica`) + `supabase_migrations` 별도 덤프 | backup-restore |
| schema 덤프는 auth·storage·확장 스키마 제외. data 덤프는 auth·storage·**cron·net 포함**(CLI `dump.go` 제외 목록에서 cron·net 주석 처리), vault·`auth.schema_migrations`·`storage.migrations` 제외 | CLI 레퍼런스, CLI 소스 |
| 덤프 대상 DB는 기본 권한(`pg_default_acl`)을 새 객체에 적용 → 덤프의 grant·revoke가 유지되지 않을 수 있음 | CLI 레퍼런스 |
| Storage 실제 파일은 덤프에 없음 → 공식 Node 스크립트(버킷 생성, download→upload upsert, 차이 비교 없음) | backup-restore |
| Vault 암호화 키는 프로젝트마다 다름 → 옮긴 비밀값 복호화 불가 | vault |
| Auth 설정·API 키·OAuth 설정은 복사되지 않음. 카카오 콜백은 `https://<새 ref>.supabase.co/auth/v1/callback` | clone-project, auth-kakao |
| **2025-11 이후 새 프로젝트에는 legacy `anon`·`service_role` 키가 없음** → `sb_publishable_…`·`sb_secret_…`만(**단, 이 새 프로젝트 `xsvmbrgixgfqijneikjl`에는 legacy JWT 키가 있었고 H-9·C-6은 그 키를 씀 — 14절 H-9**). supabase-js가 `apikey`와 `Authorization`에 같은 값을 보내면 허용, secret 키는 브라우저 User-Agent면 401 | GitHub discussions #29260, API keys 문서 |
| 기본 메일(SMTP 미설정)은 프로젝트 팀원 주소에만, 시간당 소량 | auth-smtp |
| 옛 프로젝트 토큰은 무효 → 사용자 재로그인 | self-hosting 이전 문서 |
| `ALTER DATABASE … SET default_transaction_read_only`는 새 연결에만 적용(soft freeze) | KB read-only mode, PostgreSQL 동작 |
| 덤프 도구: Supabase CLI + **Docker Desktop** + psql(`brew install postgresql@17`) | backup-restore |
| 무료 프로젝트는 Owner·Admin인 모든 조직을 합쳐 **활성 2개**, 일시정지한 프로젝트는 세지 않음 | billing-on-supabase, billing-faq |
| 일시정지한 무료 프로젝트는 **1년 안에** 대시보드 Resume으로 데이터·설정 그대로 복구(옛 문서·검색 색인의 "90일"은 예전 값) | free-project-pausing(2026-11-04 최신 페이지) |
| 무료 프로젝트는 **7일간 DB 활동이 적으면 자동 일시정지**(약 1주 전 경고 메일, 대시보드 방문·API 호출로 막을 수 있음). 유료 조직 프로젝트는 일시정지 불가(일시정지하려면 무료 조직으로 이전) | free-project-pausing |
| 무료 플랜은 **자동 일일 백업 없음**(Pro부터 7일) | backups |
| 무료 디스크는 프로젝트당 **2GB 고정**(WAL 포함), 사용량 95%에서 읽기 전용. DB 크기 500MB는 **조직 합산 청구 한도**(청구 기간 일평균) — 넘으면 조직 전체 Fair Use 제한(402) | database-size(2026-11-04 최신 페이지) |
| 무료 한도: Storage 1GB, Egress 조직당 월 5GB(비캐시)+5GB(캐시). 계속 넘기면 유예 후 **조직 전체** 제한(일시정지·읽기 전용·402) | storage-size, egress, billing-faq |
| 무료 프로젝트 생성은 조직의 다른 Owner·Admin이 자기 무료 한도를 다 쓴 경우에도 막힘 | billing-faq |
| 프로젝트는 조직 간 이전 가능(지역은 그대로, 원본 조직 Owner·대상 조직 멤버·GitHub 연동·Log Drain 없음 조건, 무료 조직으로 옮길 때는 무료 2개 한도 확인). 유료 조직은 프로젝트마다 compute 과금 | project-transfer, billing-faq |

## 3. 현재 상태 (조사 결과)

| 항목 | 값 |
|---|---|
| 서버 | PostgreSQL 17.6, 시간대 UTC, DB 77MB |
| 스키마 | public만(테이블 72, 뷰 1, 함수 97(SECURITY DEFINER 70), 트리거 37, RLS 정책 122, 시퀀스 0, enum 0, 기본키 없는 테이블 0). 커스텀 role 없음. public 객체 소유자 전부 postgres(`supabase_admin` 소유 0) |
| 확장 | pg_cron 1.6.4, pg_net 0.19.5, pg_stat_statements, pgcrypto, plpgsql, supabase_vault 0.3.1, uuid-ossp |
| 권한 | `pg_default_acl`(FOR ROLE postgres, public): 함수 anon·authenticated·service_role EXECUTE, 테이블 anon·authenticated·service_role 전권. 객체별로 회수된 상태: anon 실행 불가 함수 71(SECURITY DEFINER 69), authenticated 실행 불가 56, 모든 API role 불가 2(`payapp_fulfill_order_internal`, `configure_payment_reconciliation_http_cron`), service_role 읽기 전용 결제 테이블 8(`payment_methods`, `payment_provider_transactions`, `payment_admin_actions`, `payment_runtime_config`, `payment_reconciliation_scheduler/runs/alerts/items`). role 설정 anon 3s·authenticated 8s |
| auth | 사용자 14(bcrypt 12·비밀번호 없음 2), identities email 12·kakao 2, 관리자 `@admin.summersun.local` 3, MFA·SSO 0, auth 스키마 버전 `20260831180000`. auth 내부 FK 예: `sessions→users`, `refresh_tokens→sessions`, `mfa_amr_claims→sessions`(15행), `saml_relay_states→flow_state`. 우리 객체는 `auth.users`의 `on_auth_user_created` → `public.handle_new_user` 트리거 1개. `auth.users` 참조 FK 17(public 7, auth 10). `sessions` 15·`refresh_tokens` 102·`flow_state` 50 |
| storage | 버킷 3: `main-ad-images`(public, 10MB, jpeg/png/webp, 10개), `market-files`(private, 50MB, 1,161개 283,558,000B), `market-images`(public, 2MB, webp, 2개). 객체·버킷 owner 전부 NULL, storage RLS 정책 0, public→storage FK 0, 진행 중 멀티파트 0, storage 버전 73. `protect_*_delete` 트리거가 직접 DELETE 차단 |
| DB 데이터 속 절대 URL | **0건**(파일은 `storage_path` 상대 경로, URL은 실행 시 생성) → 데이터 수정 불필요 |
| cron | jobid 1 `payment-reconciliation-health-5m`(`*/5`, `SELECT public.enforce_payment_reconciliation_health();`), jobid 3 `payment-reconciliation-http-5m`(`*/5`, vault origin + `/api/internal/payments/reconcile`, `Bearer` vault secret). 실행 계정 postgres |
| vault | `payment_reconcile_origin`(정확히 `https://www.summersuninst.com`이어야 함), `payment_reconcile_cron_secret`(32자 이상, = Vercel `CRON_SECRET`). `configure_payment_reconciliation_http_cron()`이 두 값을 검사하고 기존 작업을 지운 뒤 다시 등록, 실행 권한 postgres만 |
| health 함수 | scheduler `last_succeeded_at`이 15분보다 오래되면 `PAYMENT_RECONCILIATION_SCHEDULER_STALE` 경보 INSERT(판매 스위치 UPDATE는 `= true` 조건이라 지금은 무변경). 미해소 경보가 있으면 출시 스위치 마이그레이션이 RAISE |
| 트리거 주의 | `payment_admin_actions`에 TRUNCATE 차단 트리거(`prevent_payment_admin_action_truncate`) |
| 연결 | PostgREST(`authenticator`) 6개(가장 오래된 것 2026-08-28부터), `supabase_storage_admin` 1, `pgbouncer` 1. postgres는 `pg_signal_backend` 보유 |
| 마이그레이션 이력 | `schema_migrations` 110행(최신 `20261021100000`). 저장소 파일과 버전 일치 33개 → **파일 재실행으로 재현 불가, 덤프 방식 필수** |
| 코드 | 환경변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`(서버 14곳). JWT 형식 키 전제 코드 없음. 점검 모드 없음. 미들웨어가 요청마다 `getUser()`, 브라우저가 GoTrue에 직접 쓰는 경로(로그인·`updateUser`) 있음. 쿠키 이름 `sb-<ref>-auth-token`(옛 쿠키는 무시되고 무한 리다이렉트 없음) |
| AI 키 | `AI_CREDENTIAL_ENCRYPTION_KEY` 없으면 `SUPABASE_SERVICE_ROLE_KEY`로 암호화(`src/lib/ai/provider-connections.ts:60`), 레거시 문제생성용 2행 |
| 이 Mac | (조사 당시) Supabase CLI·Docker·psql 없음 → **2026-11-04 P-4 완료**: psql·pg_dump 17.11(Homebrew, PATH `/opt/homebrew/opt/postgresql@17/bin`), Supabase CLI 3.0.0, Docker Desktop 29.9.2. Node 22·Homebrew |
| Vercel(2026-11-04 대표 확인) | **Hobby**(무료). Supabase 환경변수는 **대표가 수동 관리**(연동 자동 관리 아님 → C-6에서 덮어쓰기 걱정 없음). WAF Custom Rules는 모든 플랜에서 사용 가능(Vercel 문서) → C-1 입구 차단 수단 유지. Hobby Instant Rollback 제약은 9절 그대로 |
| 플랜·용량(2026-11-04) | 써머썬 조직 무료(프로젝트 1개), 공무원맛집가이드는 **다른** 무료 조직(개발 단계). DB 81MB, Storage 273MB(객체 1,173개), 지난달 Egress 0.75GB(대표 확인) → 무료 한도 안. 공무원맛집가이드와는 조직이 달라 한도·제한을 공유하지 않음. 단 **리허설~A-1 동안은 써머썬 조직에 옛·새 프로젝트 2개**라 합산 DB 약 162MB/500MB, Storage 약 546MB/1GB, 리허설 1회마다 Egress 약 0.28GB(파일 전체 다운로드) 추가 — 여전히 한도 안 |

## 4. 방식

**공식 CLI 덤프·복원(public·auth 데이터) + Storage는 스크립트로만**, 리허설 후 본 전환.

1. **리허설(무중단)**: 운영을 그대로 둔 채 덤프 → 새 서울 프로젝트에 전체 복원 → 파일 복사 → 검증 → 로컬 앱으로 시험(카카오 포함). 문제를 고치며 반복. 본 전환에 쓸 절차(쓰기 중지·재적재·cron)도 새 DB에서 미리 실측.
2. **본 전환(점검)**: 사이트 입구 차단 → 옛 DB 쓰기 중지 → **데이터만** 다시 덤프 → 새 DB 데이터를 한 트랜잭션으로 비우고 다시 적재(스키마는 리허설 것) → 파일 차이만 반영 → 검증 → Vercel 전환 → 확인 → 입구 차단 해제.

- **Storage를 데이터 덤프에서 빼는 이유**: 객체·버킷 owner가 모두 NULL, storage RLS 0, public→storage FK 0, 진행 중 업로드 0이라 메타데이터 행을 옮겨도 얻는 것이 없고, 행만 있고 파일이 없는 상태·삭제 차단 트리거·고아 파일 문제가 생긴다. 스크립트가 버킷을 같은 설정으로 만들고 파일을 올리면 메타데이터 행은 Storage API가 만든다.
- **본 전환에서 스키마를 다시 만들지 않는 이유**: 리허설로 검증한 스키마를 그대로 쓰면 당일 위험이 데이터 재적재 하나로 줄고, project ref가 바뀌지 않아 Auth·카카오·키 설정을 다시 할 필요가 없다. H-10에서 재적재가 안 되면 **P 단계에서** 최종 프로젝트를 새로 만들고(당일에는 불가) 처음부터 다시 리허설한다. 무료 활성 2개 한도(옛 + 실패한 새 프로젝트) 때문에 **실패한 새 프로젝트를 먼저 삭제**한 뒤 P-2부터 다시 하고, 새 ref가 생기므로 P-3·P-5·P-6(카카오 Redirect URI)·P-7(SMTP를 이미 설정했다면)·P-8(MCP 항목)도 다시 한다.

## 5. 준비 (대표, 리허설 전)

| ID | 할 일 | 비고 |
|---|---|---|
| P-1 | **(2026-11-04 완료)** **공무원맛집가이드 프로젝트 일시정지**(그 조직 → 프로젝트 → Settings → General → Pause project) → 일시정지 날짜 기록. 한도는 Owner·Admin인 모든 조직을 합쳐 세므로 다른 조직에 활성 무료 프로젝트가 더 없는지도 확인 | 복구 창 1년(A-10). 결제 없음 |
| P-2 | **(2026-11-04 완료: `summersun`, ref `xsvmbrgixgfqijneikjl`, Seoul, Data API 켬·자동 노출·자동 RLS 끔)** **써머썬 조직(옛 프로젝트와 같은 무료 조직)** 에 프로젝트 생성: 지역 **Northeast Asia (Seoul)**, Postgres 17, **Data API 사용 + public 스키마 노출**, DB 비밀번호 직접 생성·보관. 한도 오류가 나면 P-1 일시정지가 끝났는지, 써머썬 조직에 다른 Owner·Admin 멤버가 있는지, (재생성이라면) 실패한 새 프로젝트를 지웠는지 확인. **리허설 시작 직전에** 만든다(활동 없이 7일이 지나면 자동 일시정지) | AI에게 비밀번호를 주지 않음 |
| P-3 | **(2026-11-04 완료)** Database → Extensions에서 **pg_cron, pg_net** 켜기, vault·pgcrypto·uuid-ossp·pg_stat_statements 확인 | 복원 전 |
| P-4 | Mac 도구 설치: `brew install supabase/tap/supabase`, `brew install postgresql@17`, **Docker Desktop** 설치·실행 | |
| P-5 | **Auth·API 설정 옮기기**: 옛 프로젝트 Authentication·API 설정 화면을 모두 캡처 → 체크리스트로 새 프로젝트에 입력. 항목: Site URL `https://www.summersuninst.com`, Redirect URLs(`https://www.summersuninst.com/**`, `https://summersuninst.com/**`, Vercel preview 주소, `http://localhost:4000/**`), Allow new users to sign up, Email provider, **Confirm email(현재 값 그대로)**, Secure email change, Secure password change, 비밀번호 최소 길이·조건, OTP 만료, Refresh token rotation·reuse interval, 세션 설정, JWT 만료(3600), Captcha, Rate Limits, 이메일 템플릿, Data API 최대 행·노출 스키마. **Leaked password protection**은 Pro 기능이라 무료에서는 켤 수 없음 → A-11 뒤(관리자 계획 0-3) | 새 프로젝트 기본 Site URL은 localhost라 반드시 입력 |
| P-6 | **카카오**: Kakao Developers → 카카오 로그인 Redirect URI에 `https://<새 ref>.supabase.co/auth/v1/callback` **추가**(옛 주소 유지). 새 프로젝트 Kakao provider에 REST API 키·Client Secret·"Allow users without an email" 값을 옛 프로젝트와 같게 | 같은 카카오 앱 → 카카오 사용자 2명 identity 유지 |
| P-7 | **SMTP 판단**: P-5에서 Confirm email이 켜져 있으면 SMTP 없이는 새 프로젝트에서 이메일 가입이 막힘 → 그 경우 Resend·SMTP(관리자 계획 0-8)를 본 전환 전에 함. 꺼져 있으면 전환 후(A-4). **2026-11-04 대표 확인: 켜져 있음 → 리허설 중(H-9 전) 새 프로젝트에 Resend SMTP 설정, H-9에서 대표 시험 주소로 이메일 가입 확인 메일 수신까지 시험**(시험 가입 계정은 C-3 재적재 때 지워짐) | 운영 데이터상 일반 이메일 사용자 9명 중 3명만 확인 메일 기록 → 현재 값 확인 필요 |
| P-8 | **(2026-11-04 `.mcp.json`에 `supabase-seoul` 추가, 재연결 대기)** Supabase MCP에 새 프로젝트용 항목 추가(`https://mcp.supabase.com/mcp?project_ref=<새 ref>&read_only=true`, 같은 조직이라 기존 OAuth 범위 안). 옛 항목은 전환 완료까지 유지 | AI의 검증용 SELECT. 설정 변경은 대표 확인 후 |
| P-9 | Vercel: **플랜(Hobby/Pro)**, Supabase 환경변수 3개가 어느 환경(Production·Preview·Development)에 있는지, Supabase 연동이 자동 관리하는 값인지, `AI_CREDENTIAL_ENCRYPTION_KEY` 유무를 **이름만** 확인. **Vercel Firewall 사용자 규칙**을 플랜에서 쓸 수 있는지 확인. Hobby면 Instant Rollback은 직전 production 배포로만 가능하고, 롤백 뒤에는 새 배포가 운영 도메인에 자동 연결되지 않음(`vercel promote`·Undo Rollback 필요) → Supabase 연동이 값을 관리한다면 C-6 전에 연동을 끊거나 새 프로젝트로 다시 연결할지 결정(그대로 두면 수동 값이 덮어써질 수 있음) | C-1 입구 차단 수단, 9절 되돌리기 |
| P-10 | 사전 공지 채널·문구 결정: 홈 광고 배너 또는 메인 공지로 "○월 ○일 ○시 점검, 점검 후 다시 로그인 필요" | 본 전환 2일 전 |
| P-10a | **리허설 스크립트**: `scripts/supabase-seoul-migration/`(README에 단계별 실행 순서). 비밀값은 실행 시 `read -s`, 옛 DB는 읽기만 | AI 작성·검증 |
| P-11 | **출력용 전환 런북** `docs/supabase-seoul-cutover-runbook.md`(AI 작성): C-0~C-9를 체크박스로, 단계마다 "AI가 SELECT로 확인 → 다음" 표시, 실패 시 9절 해당 줄 | 대표 1명이 실수 없이 따라가도록 |

## 6. 리허설 (무중단, 반복 가능)

**스크립트 규칙**: AI가 스크립트를 쓰고 대표가 자기 터미널에서 실행. 비밀번호·키는 `read -s`로 받아 **`PGPASSWORD`만 export**하고 CLI `--remote=`·psql `--dbname`에는 **비밀번호 없는 URL**을 넣음(**CLI 3.0.0 기준**: `--db-url`은 없어지고 `--remote=<URL>`로 바뀜. URL 모드는 `PGPASSWORD` 환경변수를 그대로 pg_dump에 넘김 — 2026-11-04 가짜 주소 dry-run으로 확인. `--password` 옵션은 명령줄에 비밀번호가 남으므로 쓰지 않음). 명령줄 인자에 비밀번호를 넣지 않음(`ps`·Docker 노출 방지). CLI가 작업 폴더의 `supabase/.env*`를 읽으므로 저장소 밖 작업 폴더에서 실행. 작업 폴더 `~/supabase-migration/<날짜>/`(iCloud 동기화 폴더 밖, `umask 077`, `chmod 700`). 연결은 각 프로젝트 Connect → **Session pooler(5432)**. 공식 Storage 스크립트는 키를 소스에 적지 않고 `read -s`로 받도록 고친 판을 쓴다.

| ID | 단계 | 내용 | 확인 |
|---|---|---|---|
| H-0 | 버전·기본값 기록 | 두 DB의 `auth.schema_migrations`·`storage.migrations` 최대값 비교(옛 `20260831180000` / `73` 조사 당시, 2026-11-04 storage `79` — H-0 시점 값끼리 비교), Postgres 버전, **새 DB의 `pg_default_acl`을 H-3 전에 기록**(새 프로젝트의 자동 노출 설정에 따라 다를 수 있음) | 다르면 COPY 컬럼 대조 후 진행 판단 |
| H-1 | 덤프(옛) | `roles.sql`(`--role-only`), `schema.sql`, **`data.sql`: `--use-copy --data-only --schema public,auth -x auth.sessions -x auth.refresh_tokens -x auth.flow_state -x auth.mfa_amr_claims -x auth.saml_relay_states`**(cron·net·storage·vault 제외, 쓰지 않는 세션·토큰과 그것을 참조하는 테이블 제외 — 하나만 빼면 FK 고아 행이 생김), `history_schema.sql`·`history_data.sql`(`--schema supabase_migrations`). 각 명령은 먼저 `--dry-run`으로 실제 pg_dump 인자를 기록하되 **출력은 `sed -E 's/^(export PGPASSWORD=).*/\1<redacted>/'`를 거친 뒤에만 화면·파일에**(dry-run은 환경변수를 펼친 스크립트를 출력해 비밀번호가 평문으로 찍힘) | `grep '^COPY' data.sql`로 대상 목록 저장·검토: cron·net·vault·storage·`auth.schema_migrations` 없음, 제외한 auth 테이블 없음 |
| H-2 | 덤프 손질 | 공식 Troubleshooting: schema.sql의 `ALTER … OWNER TO "supabase_admin"`, roles.sql의 `GRANT "postgres" TO "cli_login_postgres"` 줄 주석(현재 해당 객체 0이라 바뀌는 줄 0 예상). sed로 하고 바뀐 줄 수 출력 | 바뀐 줄 목록 |
| H-3 | 기본 권한 회수 | 새 DB SQL Editor: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;` 같은 문장을 `FUNCTIONS`, `SEQUENCES`에도. 덤프가 기본값과 다른 권한만 쓰기 때문에, 회수 없이 복원하면 함수 71개에 anon EXECUTE, 결제 테이블 8개에 service_role 쓰기가 새로 생김 | — |
| H-4 | 복원(새) | `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql` → history 2개 → `DROP ROLE IF EXISTS cli_login_postgres;` | 오류 0 |
| H-5 | 기본 권한 원복·auth 트리거 | 새 DB: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`(FUNCTIONS·SEQUENCES도 같은 문장) → `pg_default_acl`이 옛 DB와 같은지 확인(덤프가 끝에 기본 권한 문장을 쓰면 이미 같을 수 있음 — 중복이어도 무해). `auth.users`의 `on_auth_user_created` 트리거를 옛 DB `pg_get_triggerdef` 그대로 생성 | V-5·V-6 |
| H-6 | 스토리지 | 고친 공식 스크립트: 버킷 3개를 같은 설정(public·크기·MIME)으로 만들고 파일 업로드. 이어서 **차이 비교 스크립트**: 비교 목록은 AI가 두 DB `storage.objects`(`bucket_id`, `name`, `metadata->>'size'`, `updated_at`)를 SELECT해 만든다 → 없거나 크기가 다르거나 옛 `updated_at`이 직전 동기화 시각(로컬 시계가 아니라 **옛 DB `now()`로 기록**)보다 늦은 것만 업로드, 새 쪽에만 있는 것은 삭제. **안전장치**: 스크립트가 원본·대상 URL의 ref를 별도 입력값(옛 ref, 새 ref)과 대조하고 다르면 중단, 삭제는 먼저 목록만 출력하는 모드로 확인 후 실행, **옛 ref 대상 삭제는 무조건 거부**. 소요 시간 측정 | V-3 |
| H-7 | cron·vault 시험 | 새 DB `cron.job` = 0 확인. **pg_net·vault 권한 시험**: 32자 이상의 **틀린** secret으로 vault 2개 생성 → `configure_payment_reconciliation_http_cron()` → 다음 실행에서 앱이 403을 돌려주는지 `net._http_response`로 확인 → `cron.unschedule` + vault 2개 삭제(`vault.secrets` delete) | 403 확인, 정리 후 cron 0·vault 0 |
| H-8 | 검증 | 7절 V-1~V-6. 리허설 중에도 옛 DB는 바뀌므로(cron 5분 쓰기, 데이터 변경 허용) **V-4~V-6만 정확히 일치**, V-1·V-2는 덤프 시작 이후 바뀐 테이블(`created_at`/`updated_at`)로 설명되면 통과. 정확한 V-1·V-2 일치는 C-5(옛 DB 동결 뒤)에서만 요구 | 판정 기록 |
| H-9 | 로컬 앱 시험 | ① dev 서버 종료 → `.env.local`을 저장소 밖에 백업 → Supabase 3개 값을 새 프로젝트 값(URL·publishable·secret)으로 교체 → 서버 재시작 → **새 시크릿 창**. ② 테스트 관리자로 로그인 → AI가 새 DB에서 그 계정 `last_sign_in_at`이 바뀌고 **옛 DB는 안 바뀌었는지** SELECT로 확인 → 확인 뒤에만 쓰기 시험. ③ 확인 목록: 이메일 로그인(기존 비밀번호), **카카오 로그인(기존 카카오 회원 2명 중 1명으로, 시험 뒤 `auth.users` 14명 그대로 확인 — identity 재사용 검증. 기존 카카오 회원이 대표 본인이 아니면 대표 카카오 계정으로 가입 경로를 시험 — `auth.users` 15명이 되며 C-3에서 원상복구)**, 상품 목록·이미지(`getPublicUrl`), 다운로드(`createSignedUrl`), 관리자 로그인·관리자 계정 화면(`auth.admin.*`, 테스트 관리자 생성·삭제로 `createUser`/`deleteUser`), 상품 이미지 업로드(secret 키 서버 `upload()`), 샘플 페이지 업로드(`createSignedUploadUrl`+`uploadToSignedUrl`), 크레딧 잔액·RPC. 문의 작성은 슬랙 통지가 가므로 하지 않음. ④ 끝나면 `.env.local` 원복 → URL이 옛 ref인지 값 출력 없이 확인(`grep -c <옛 ref>`) → 재시작. ⑤ **H-6 차이 비교를 다시 실행**해 ③에서 생긴 새 쪽 전용 파일이 삭제되는지(삭제 경로 시험) | 목록 전부 통과 |
| H-10 | 본 전환 실측 | H-9 뒤(세션 행이 있는 상태)에 새 DB에서 본 전환 절차를 그대로 시험: (a) 쓰기 중지: `default_transaction_read_only = true` → C-1 ④⑤ 연결 종료·확인 → 로컬 앱으로 로그인·업로드 **실패**, **secret 키로 PostgREST RPC·POST 쓰기 시험**(성공하면 "DB 설정으로는 API 쓰기가 막히지 않음 → Firewall이 유일한 차단 수단"으로 기록하고 C-1 규칙을 그대로 엄수), **Storage `list`·다운로드는 성공**(C-4가 동결된 옛 DB에서 읽어야 하므로) (b) 해제: `ALTER DATABASE postgres RESET default_transaction_read_only` → 연결 재종료 → 쓰기 성공 (c) 재적재: C-3 SQL(FK 닫힘 검사 포함) → V-1 일치·고아 행 0 (d) **Vercel Firewall 규칙 사전 시험**: 운영 이용자를 막지 않도록 **log 동작으로만** 규칙 일치 여부 확인(대표 IPv4·IPv6, `/api/internal/payments/reconcile` POST). deny 동작 자체는 시험용 경로(없는 경로 하나)로 한정해 확인 (e) 각 단계 소요 시간 | 결과와 시간을 14절에 기록, 단계별 시간 예산·중단 기준 확정 |

## 7. 검증 (리허설·본 전환 공통)

AI가 두 프로젝트에 같은 SELECT를 실행해 비교한다(값이 아니라 개수·해시). 모든 해시 쿼리는 `SET TimeZone = 'UTC'`.

| ID | 대상 | 방법 |
|---|---|---|
| V-1 | 행 수·고아 행 | data.sql의 COPY 대상 테이블 목록 전부 + `supabase_migrations.schema_migrations`의 `count(*)` 일치. FK 고아 행 0건: public·auth의 모든 FK를 `pg_constraint`에서 생성해 검사(`replica` 적재는 FK를 검사하지 않음) |
| V-2 | 내용 해시 | public 72개 테이블 전부: `md5(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"))`. `auth.users`(id, email, md5(encrypted_password), email_confirmed_at, raw_app_meta_data, raw_user_meta_data), `auth.identities`(provider, provider_id, user_id) 같은 방식 |
| V-3 | 스토리지 | 버킷 설정(public·크기·MIME) 일치, 두 DB `storage.objects`의 (`bucket_id`, `name`, 크기) 집합을 SELECT로 비교해 일치, 무작위 5개 다운로드 크기 일치 |
| V-4 | 객체 정의 | 테이블 72·뷰 1·함수 97·트리거 37(+auth 1)·정책 122 개수, 함수별 `md5(pg_get_functiondef)`·소유자·`prosecdef`·`proconfig`, 정책별 정의 md5, 트리거 `tgenabled`, 테이블별 RLS 상태(`source_configs` 꺼짐 포함) 일치 |
| V-5 | 권한 | 함수·테이블별 `aclexplode(proacl/relacl)`를 정렬해 비교(PUBLIC 포함). 특히 REVOKE 2개 함수, service_role 읽기 전용 테이블 8개 |
| V-6 | 설정 | `pg_default_acl` 일치, 확장 버전(다르면 `net.http_post`·`cron.schedule` 시그니처 확인), role `statement_timeout`, DB 시간대 UTC |

## 8. 본 전환 (점검, 대표와 함께)

- 시간: 이용자가 가장 적은 평일 밤. 시작은 cron 실행 직후(매 5분의 :01~:04, 대사 lease 4분).
- 단계별 시간 예산·중단 기준은 H-10 실측으로 정한다(14절).
- **입구 차단(C-1)을 C-8 확인까지 유지**한다 → C-9 전에는 언제든 깨끗하게 되돌릴 수 있고, C-9 뒤에는 새 DB에서 고쳐 나간다.

| ID | 단계 | 내용 |
|---|---|---|
| C-0 | 전날 | V-4~V-6 정확히 일치, V-1·V-2는 H-8 기준(리허설 뒤 스키마 변경 없음 확인), H-10 재실행(데이터 덤프 + 재적재 + V-1, 런북 C-0), 사전 공지 게시 확인, Vercel에 넣을 새 URL·**legacy JWT anon·service_role 키**(14절 H-9와 같은 종류) 준비, 전환 전 production 배포 ID 기록, 대표 IP(IPv4·IPv6 — 사이트에 AAAA 없음 확인 2026-11-09, IPv4만) 확인(C-1 직전에 한 번 더 — 유동 IP), **H-10(d) Firewall 사전 시험 완료 확인(보류분, 14절)** |
| C-1 | 입구 차단·쓰기 중지 | **C-1부터 C-6 새 배포 연결 확인까지 대표도 운영 사이트를 쓰지 않는다**(허용 IP라 쓰기가 들어갈 수 있음, 확인용 접속은 런북이 시킬 때만). ① Vercel Firewall 사용자 규칙: 대표 IP와 `/api/internal/payments/reconcile`(POST)만 허용, 나머지는 deny(challenge 아님). ② 옛 DB cron 2개 비활성(`cron.alter_job(job_id := (select jobid from cron.job where jobname = '…'), active := false)`) → `select jobname, active from cron.job`으로 둘 다 false 확인(jobname 오타 시 NULL 처리 방지). ③ 옛 DB `ALTER DATABASE postgres SET default_transaction_read_only = true`. ④ `pg_terminate_backend`로 `authenticator`, `supabase_auth_admin`, `supabase_storage_admin`, `pgbouncer` 연결과 **`postgres` role의 다른 client backend(자기 pid 제외, 예: `mgmt-api`)** 종료. ⑤ superuser가 아닌 모든 client backend(자기 pid 제외)의 `backend_start`가 ③ 이후인지 확인 |
| C-2 | 최종 덤프·스냅샷 | 옛 DB V-1·V-2·V-2b(cron 기록 테이블 포함)·Storage 개수·미해소 경보 목록 스냅샷 저장 → data.sql만 다시(H-1과 같은 옵션). history는 다시 덤프하지 않음(스키마 동결) |
| C-3 | 재적재 | 새 DB, 한 세션·한 트랜잭션: `psql --single-transaction -v ON_ERROR_STOP=1 -c 'SET session_replication_role = replica' -c 'TRUNCATE <목록>' -f data.sql`. **목록 = data.sql COPY 대상 전부 + H-1에서 뺀 auth 테이블(`sessions`, `refresh_tokens`, `flow_state`, `mfa_amr_claims`, `saml_relay_states`)**, CASCADE 없음. 스크립트가 실행 전에 **새 DB의** `pg_constraint`로 목록이 FK 기준으로 닫혀 있는지(목록 안 테이블을 참조하는 테이블이 모두 목록에 있는지) 확인하고 아니면 중단(새 DB에만 있는 auth 테이블이 걸리면 그 테이블을 목록에 추가 — H-0에서 버전이 같으면 해당 없음)(TRUNCATE의 FK 검사는 `replica`로 꺼지지 않음). `replica`를 먼저 걸어 `payment_admin_actions` TRUNCATE 차단 트리거(`tgenabled='O'`)를 끈다. 리허설 때 생긴 테스트 세션·토큰도 함께 지워진다. 적재 실패 시 비우기도 롤백. 끝나면 `cron.job` = 0, history 110행·최신 `20261021100000`, 고아 행 0 확인 |
| C-4 | 파일 | H-6 차이 비교 스크립트(바뀐 것만 업로드, 새 쪽에만 있는 것 삭제) |
| C-5 | 검증 | V-1~V-5 |
| C-6 | 앱 전환 | Vercel 환경변수 3개 값을 새 값으로(이름은 그대로: `NEXT_PUBLIC_SUPABASE_URL` ← 새 URL, `NEXT_PUBLIC_SUPABASE_ANON_KEY` ← **legacy anon JWT**, `SUPABASE_SERVICE_ROLE_KEY` ← **legacy service_role JWT** — 14절 H-9에서 시험한 종류), P-9에서 확인한 환경(**Production만**, 14절 P-9) → **빌드 캐시 없이 재배포 1회**(`NEXT_PUBLIC_*`는 빌드 시 고정, Hobby면 production 배포를 1회로 제한해 직전 배포 롤백을 유지) → 운영 도메인이 가리키는 배포 ID가 새 배포인지 확인 → **Vercel Data Cache 비우기**(배포를 넘어 남아 옛 Supabase 주소를 내보냄, 14절 런북 검증) |
| C-7 | 대사 cron | 새 DB: 대표가 SQL Editor에서 `select vault.create_secret('https://www.summersuninst.com', 'payment_reconcile_origin');`, `select vault.create_secret('<Vercel CRON_SECRET 값>', 'payment_reconcile_cron_secret');` → `select public.configure_payment_reconciliation_http_cron();` → 다음 실행에서 `net._http_response` 200, `payment_reconciliation_scheduler.last_succeeded_at` 갱신 확인 → **그다음** `select cron.schedule('payment-reconciliation-health-5m', '*/5 * * * *', 'SELECT public.enforce_payment_reconciliation_health();');` → `cron.job` 2개, 미해소 경보가 **C-2 목록과 같음(새 경보 0)** 확인(기존 `PAYAPP_FEEDBACK_ORDER_NOT_FOUND` 1건은 예상값, 점검 중 해소하지 않음). secret을 입력한 SQL Editor 스니펫은 실행 뒤 삭제. `create_secret`이 오류 나면: 잘못 만든 vault 항목 삭제 → 같은 값을 다시 정확히 입력 → 새 DB Postgres 로그에 값이 남았을 수 있다는 사실만 기록(`log_min_error_statement=error`). **점검 중에는 secret을 바꾸지 않는다**(재배포가 Hobby의 직전 배포 롤백을 깨고, 옛 vault와 값이 달라져 되돌리기 때 옛 대사가 403). 교체는 C-9 뒤 A-9. `configure_payment_reconciliation_http_cron()`이 `ORIGIN_INVALID`·`CRON_SECRET_INVALID`로 실패해도 같은 처리(항목 삭제 → 정확한 값 재입력, 이 오류 문장에는 값이 없어 로그 기록 불필요) |
| C-8 | 확인 | 대표 IP로 운영 사이트: 이메일 로그인·카카오 로그인·상품·이미지·다운로드·관리자·관리자 계정 화면·크레딧 잔액. 새 DB health 1회 이상 실행 후 미해소 경보 = C-2 목록(새 경보 0). **옛 DB V-1·V-2·V-2b·Storage 개수·미해소 경보가 C-2 스냅샷과 같음**(쓰기 유입 없음). **하나라도 다르면 실패** → 9절 C-6~C-8 줄로 되돌리고 C-1부터 재시도 |
| C-9 | 차단 해제 | Firewall 규칙 해제 → 점검 공지 내리고 "다시 로그인해 주세요" 안내. **이 시점부터 되돌리기 대신 새 DB에서 고침** |

## 9. 되돌리기 (C-9 전까지)

| 실패 시점 | 되돌리기 |
|---|---|
| C-1~C-5 (앱은 아직 옛 DB) | 옛 DB `ALTER DATABASE postgres RESET default_transaction_read_only` → 연결 다시 종료(점검 중 새로 맺은 연결은 읽기 전용이므로) → **쓰기 시험: 대표 로그인 후 AI가 옛 DB `last_sign_in_at` 변경을 SELECT로 확인** → 옛 http cron 재활성 → 성공 확인 → 옛 health cron 재활성 → 미해소 경보 확인(생겼으면 메모와 함께 해소) → Firewall 해제 |
| C-6~C-8 (앱이 새 DB) | ① **새 DB cron 먼저 삭제(`cron.unschedule`, 런북 R-2 안전 검사)** ② Vercel **Instant Rollback**으로 C-0에 기록한 전환 전 배포 + 환경변수도 옛 값으로 원복(다음 배포가 새 DB를 보지 않게) + Data Cache 비우기 ③ 위 표 첫 줄과 같이 옛 DB 복구 ④ Firewall 해제. 차단 중이라 새 DB에 들어간 사용자 쓰기는 없음(대표 시험 쓰기만) |
| 재시도 | ① 옛 DB를 다시 열었거나(RESET) Firewall을 해제했다면 **C-1부터 새 덤프로**(예전 덤프로 다시 적재하면 되돌린 사이의 쓰기를 잃음). ② 옛 DB가 계속 동결된 채 C-3~C-5에서 실패했다면 C-3부터. 공통: 새 DB cron 정리(`cron.unschedule`), vault 2개 삭제(이름 중복 방지). Instant Rollback을 했다면 재시도 C-6 뒤 **`vercel promote` 또는 Undo Rollback으로 새 배포를 운영 도메인에 연결하고 배포 ID 확인**, Vercel 화면에서 롤백 후보가 C-0 배포인지 눈으로 확인한 뒤 C-7. 재시도 뒤 다시 실패해 직전 배포가 C-0 배포가 아니면 Instant Rollback 대신 **환경변수 원복 + 재배포**로 되돌림 |

- **C-9 뒤 금지**: 전환 전 배포로 Instant Rollback·Promote 금지(조용히 옛 DB를 씀). Preview 배포도 새 환경변수로 다시 빌드된 것만 사용.

## 10. 전환 후

| ID | 할 일 | 시점 |
|---|---|---|
| A-1 | 옛 프로젝트: 읽기 전용·cron 비활성 상태로 **2주 보관** → 일시정지(무료 한도에서 빠짐) → 삭제는 대표 결정. 로컬 덤프 폴더는 **2주 보관을 마친 뒤의** 옛 프로젝트 일시정지·삭제 때 함께 삭제(덤프에 bcrypt 해시·AI 키 암호문 포함, 보관 중 자동 일시정지 때는 지우지 않음). 보관 중 활동이 없어 **약 7일 뒤 자동 일시정지될 수 있으며 무방**(1년 안 Resume 가능. A-10 뒤에 다시 열어야 하면 공무원맛집가이드를 먼저 일시정지) | 2주 |
| A-2 | 개발 도구·문서의 옛 ref 갱신: `.env.local`, `.mcp.json`, `.codex/config.toml`, `supabase link`(`supabase/.temp/project-ref`·`pooler-url`), `AGENTS.md:81`, `project_architecture.md:97,437`(`gen types --project-id`), `docs/auth/kakao-login-settings-checklist.txt` 콜백 주소, `docs/payapp-db-migration-checklist.md`의 ref와 cron `jobid in (1,3)` → **jobname 기준**으로(새 DB에서 jobid가 달라짐) | 즉시 |
| A-3 | 카카오 Redirect URI에서 옛 주소 삭제 | 1주 뒤 |
| A-4 | **Resend + 새 프로젝트 SMTP 설정**(관리자 계획 0-8), P-7에서 이미 했으면 생략 | 즉시 |
| A-5 | 24시간 관찰: cron 288회 성공, 새 경보 0(기존 `PAYAPP_FEEDBACK_ORDER_NOT_FOUND` 1건 제외 — 출시 스위치 전 해소, A-7), Vercel 런타임 오류, 새 프로젝트 API 4xx/5xx·권한 오류(42501) | 24시간 |
| A-6 | 마이그레이션 이력은 옛 110행 그대로(MCP `list_migrations`로 확인) → 이후 마이그레이션은 지금처럼 SQL Editor + history INSERT. 저장소 파일과의 불일치(33/110)는 별도 결정 | 별도 |
| A-7 | 관리자 계획의 DB 단계 시작(`docs/admin-implementation-workplan.md` 1절), 출시 스위치 마이그레이션은 새 DB에 적용(사전 점검 쿼리 그대로 통과 예상: 미해소 경보 0, 런타임 설정 동일) | 이후 |
| A-8 | AI 키(레거시): service role 키가 바뀌어 기존 암호문 복호화 불가. 문제생성 미사용이라 그대로 둠(Q4). 다시 쓰면 키 재입력 | 기록만 |
| A-9 | (C-7에서 vault 오류가 났던 경우만) `CRON_SECRET` 교체: cron 실행 직후(:01~:04) 시작, 10분 안에 끝냄. 새 값 생성 → Vercel `CRON_SECRET` 변경·재배포 → **새 배포 Ready 확인** → 바로 `select vault.update_secret((select id from vault.secrets where name = 'payment_reconcile_cron_secret'), '<새 값>');` → 다음 대사 200·미해소 경보 0 확인. 배포가 실패하면 Vercel 값을 되돌리고 vault는 건드리지 않음(갱신했다면 `update_secret`으로 예전 값 복원) | C-9 뒤 |
| A-10 | **공무원맛집가이드 재개**: 옛 써머썬을 일시정지 또는 삭제한 **뒤**, 또는 A-11(Pro) 뒤에 Resume(그 전에 하면 활성 3개라 막힘). P-1 날짜로부터 1년 안 | A-1 뒤 |
| A-11 | **Pro 전환**(대표 결정, Q7): 써머썬 조직을 Pro로 업그레이드. 유료 조직 프로젝트는 일시정지할 수 없고 프로젝트마다 compute가 과금되므로 **먼저 옛 써머썬 프로젝트를 삭제하거나 무료 조직으로 이전**(이전 대상 조직의 멤버여야 하고, 그 조직이 무료면 활성 2개 한도 확인). **A-1 2주 보관 중에 Pro로 바꾸면 옛 프로젝트는 삭제하지 말고 무료 조직(공무원맛집가이드 조직 또는 새 무료 조직)으로 이전**해 보관을 이어감. 전환 뒤 Leaked password protection 켜기(P-5) | 페이앱 출시 전 권장 |

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 쓰기 유실(덤프 뒤 옛 DB 쓰기) | C-1 입구 차단 + 읽기 전용 + 연결 종료 + `backend_start` 확인, C-8 옛 DB 스냅샷 비교 |
| 권한 확대(anon EXECUTE·결제 테이블 쓰기) | H-3 기본 권한 회수, H-5 원복, V-5·V-6 |
| 새 키 체계 | 이름은 그대로 값만 교체, H-9에서 secret 키 경로 전부 시험 |
| 카카오 로그인 실패 | P-6 사전 입력, H-9 localhost 카카오 시험, C-8 재확인 |
| 이메일 가입 막힘 | P-7 Confirm email 값에 따라 SMTP를 전환 전에 |
| 전원 로그아웃 | 피할 수 없음 → P-10 사전 공지, C-9 재로그인 안내 |
| 파일 누락 | H-6 차이 비교, V-3 |
| cron 이중 실행·403·경보 | C-1 옛 cron 비활성, H-7 사전 시험, C-7 순서(대사 성공 뒤 health) |
| 재적재 실패 | H-10 실측, C-3 한 트랜잭션(실패 시 비우기도 롤백) |
| Vercel 배포 롤백 함정 | 9절 Instant Rollback + 환경변수 원복, C-9 뒤 옛 배포 금지 |
| 로컬 시험이 운영 DB에 씀 | H-9 ① 재시작·시크릿 창 ② `last_sign_in_at` 확인 뒤 쓰기 |
| 비밀값 노출 | `read -s` → 환경변수, 작업 폴더 권한·위치, SQL Editor 스니펫 삭제, 덤프 삭제 시점 |
| 새 프로젝트 자동 일시정지(무료, 7일 활동 적음 — 전환 전에는 cron 0) | 직전 7일 동안 활동이 적으면 일시정지 → P-2는 리허설 직전에, 리허설~본 전환 사이에 활동 없는 기간이 7일을 넘지 않게. 경고 메일이 오면 대시보드 방문. 일시정지됐으면 Resume 후 H-0(auth·storage 버전, Postgres 버전), P-3 확장, `cron.job` 0·vault 0(전환 전), V-4~V-6 다시 확인하고 진행 |
| 새 프로젝트 디스크 가득(무료 2GB 고정, 대량 적재·재적재로 WAL 증가 → 95%에서 읽기 전용) | H-4·H-10(c)·C-3 뒤 대시보드 Database → Settings 디스크 사용량 확인. 80%를 넘으면 다음 단계 전에 멈추고 판단 |
| 자동 백업 없음(무료) | 리허설·본 전환은 자체 덤프로 진행. 전환 뒤 Pro(A-11) 전까지 DB 작업 직전마다 H-1과 같은 덤프를 대표가 떠 둠(`docs/admin-implementation-workplan.md` 0절). 이 덤프로 되돌릴 수 있는 것은 public·auth 스키마·데이터까지(storage 파일·vault·cron은 없음). 작업 폴더 규칙은 6절과 같고, 덤프는 다음 덤프가 생기면 이전 것을 삭제, A-11 뒤 모두 삭제(bcrypt 해시 포함) |
| 무료 한도 초과(조직 합산) | 3절 플랜·용량 행: 리허설~A-1 동안 합산 DB 약 162MB/500MB·Storage 약 546MB/1GB, Egress 0.75GB/5GB + 리허설당 약 0.28GB. 넘기면 조직 전체(새 DB 포함)가 제한됨. 일시정지·삭제하면 새 사용량은 쌓이지 않지만 그 청구 기간에 이미 쌓인 사용량은 기간이 끝날 때까지 남음 → A-1 뒤 조직 Usage 화면으로 확인. 상품 파일이 늘면 Storage부터 확인, 넘기 전에 A-11 |

## 12. 결정 질문

| Q | 질문 | 권장 |
|---|---|---|
| Q1 | 덤프 도구 | 공식 경로(Supabase CLI + Docker Desktop + psql 17) |
| Q2 | 본 전환 시간 | 평일 밤, 대표가 함께 있는 시간 |
| Q3 | `payment_reconciliation_runs` 20,196행 | 그대로 옮김 |
| Q4 | AI 키(레거시) | 그대로 둠(A-8) |
| Q5 | 옛 프로젝트 보관 기간 | 2주 후 일시정지(무료라 활동이 없으면 약 7일 뒤 자동 일시정지될 수 있음 — 무방) |
| Q6 | 입구 차단 수단 | Vercel Firewall 사용자 규칙. 플랜에서 불가하면 대안(점검 화면 코드 추가 후 환경변수로 켜기 — 리허설 전에 구현·시험) |
| Q7 | Pro 전환 시점(A-11) | 대표 결정 "나중에"(2026-11-04). 권장: 페이앱 출시 전(자동 백업·자동 일시정지 없음) |

## 13. 검증 기록

| 회차 | 대상 | 검증 | 결과 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 1 덤프·복원 무결성 | **FAIL** | M-1 기본 권한 회수 범위(함수 71·결제 테이블 8 권한 확대) → H-3·H-5·V-5·V-6. M-2 data.sql 범위 불명확 → H-1 `--schema public,auth`·dry-run·COPY 목록. M-3 읽기 전용이 기존 연결에 미적용 → C-1 연결 종료·확인. M-4 재적재 미정의 → C-3 한 트랜잭션·COPY 목록 기반 TRUNCATE·history 재적재 제외 |
| R1 | 초안 | 2 Auth·Storage·연동 | **FAIL** | 1 새 프로젝트 legacy 키 없음 → 2절·C-6·H-9. 2 쓰기 중지(1과 같음). 3 Auth 설정이 늦고 부족, 카카오 사전 시험 없음 → P-5·P-6·P-7·H-9. 4 Storage 재적재 막힘·"바뀐 것만" 사실 아님 → Storage를 덤프에서 제외, 차이 비교 스크립트. 5 Vercel 롤백 함정 → 9절 |
| R1 | 초안 | 3 전환·되돌리기·결제 | **FAIL** | 1 쓰기 중지 → C-1 Firewall·연결 종료, C-8 옛 DB 스냅샷 비교. 2 cron 순서로 경보 발생·출시 스위치 차단 → C-7 순서, H-7 사전 시험. 3 되돌리기 실행 불가 → 9절 재작성(C-9 전 차단 유지). 4 TRUNCATE 차단 트리거 → C-3 `replica` 먼저. 5 로컬 시험 운영 DB 쓰기 위험 → H-9 절차 |
| R2 | 개정 1 | 1 덤프·복원 무결성 | **FAIL** | M-1~M-3 해소(권한 순서·결과 PASS 확인). N-1 auth 테이블 일부 제외로 TRUNCATE FK 실패·`mfa_amr_claims` 고아 15행 → H-1 `-x mfa_amr_claims, saml_relay_states`, C-3 목록에 제외 테이블 포함·FK 닫힘 검사, V-1 고아 행 0. 권고 반영: H-8·C-0 판정 기준, H-10 PostgREST 쓰기 시험, C-1 ⑤ 범위, H-5 SQL 명시·H-0 기본값 기록, COPY 목록에 `auth.schema_migrations` 확인 |
| R2 | 개정 1 | 2 Auth·Storage·연동 | **FAIL** | R1 1~5 반영 확인. 1 TRUNCATE FK(위와 같음) 2 dry-run이 PGPASSWORD 평문 출력 → H-1 sed 가림 3 Vercel Instant Rollback 제약 → P-9 플랜 확인, C-6 1회 배포·배포 ID, 재시도 promote 4 Storage 삭제 방향 실수·삭제 경로 미시험·동결 중 읽기 → H-6 안전장치, H-9 ⑤ 재실행, H-10(a) Storage 읽기 성공. 권고 반영: H-9 서버 upload·createUser/deleteUser·기존 카카오 회원 시험, `updated_at` 기준 재업로드, V-3 SQL 비교, 빌드 캐시 없이 배포, vault 오류 시 secret 교체 |
| R2 | 개정 1 | 3 전환·되돌리기·결제 | **FAIL** | R1 5건 대부분 해소, C-7 SQL·순서·`replica` TRUNCATE 트리거 회피 확인. 1 TRUNCATE FK(위와 같음) 2 재시도 데이터 유실 경로·롤백 후 도메인 연결 → 9절 재시도 ①② 3 C-8 불일치·H-10 미차단 처리 없음 → C-8 실패 판정, H-10(a) 기록, C-1 대표 사용 금지. 권고 반영: Firewall POST·deny, `cron.alter_job` 확인, 쓰기 시험 구체화, P-11 출력용 런북 |
| R3 | 개정 2 | 1 덤프·복원 무결성 | **PASS** | TRUNCATE 목록 FK 닫힘 전수 확인(위반 0). 권고 반영: C-1 ④ postgres 다른 backend 종료, C-3 FK 검사는 새 DB 기준·새 auth 테이블 대응, V-1 고아 행 전 FK |
| R3 | 개정 2 | 2 Auth·Storage·연동 | **FAIL** | R2 4건 해소. 새 지적: C-7 secret 교체·재배포가 Hobby 롤백·옛 vault와 충돌 → 점검 중 교체 금지, A-9로. 권고 반영: `PGPASSWORD`만·비밀번호 없는 URL, promote 뒤 롤백 후보 확인, P-9 연동 처리, H-9 카카오 대안, H-6 기준 시각 옛 DB `now()` |
| R3 | 개정 2 | 3 전환·되돌리기·결제 | **FAIL** | R2 3건 해소. 새 지적: 위와 같음(C-7 ↔ 9절). 권고 반영: C-1 ④ postgres backend, H-10(d) Firewall 사전 시험, 재시도 후 재실패 시 환경변수 원복 + 재배포 |
| R4 | 개정 3 | 2 Auth·Storage·연동 | **PASS** | R3 필수 해소, 새 모순 없음. 권고 반영: H-10(d) log 동작만, 대표 IP 재확인, A-9 시간·순서·복원 |
| R4 | 개정 3 | 3 전환·되돌리기·결제 | **PASS** | R3 필수·권고 반영 확인. 권고 반영: A-9 순서·`update_secret` SQL, H-10(d) log 모드, C-7 configure 오류 처리 |
| 확정 | 개정 3 + R4 권고 | 작성자 | 반영 | 검증 1은 R3 PASS, 2·3은 R4 PASS. R4 권고는 실행 시 유의 사항으로 문구만 반영(설계 변경 없음) |
| R5 | 개정 4(무료 방식) | A 무료 플랜 사실 | **FAIL** | 복구 창은 1년(90일 아님), 500MB는 조직 합산 청구 한도이고 읽기 전용은 디스크 2GB의 95% → 2절·3절·11절 수정. 권고 반영: 조직 합산 수치, 디스크 확인, 다른 Owner·Admin, 경고 메일, 이전 조건 |
| R5 | 개정 4 | B 자리 계산·순서 | **FAIL** | 재생성 시 활성 3개로 막힘 → 4절 실패 프로젝트 먼저 삭제·P 재실행, P-2 원인. 권고 반영: P-2 리허설 직전, Resume 뒤 재확인 항목, A-1·A-10·A-11·Q5, P-1 다른 조직, 관리자 작업계획 0절 덤프 행 |
| R6 | 개정 4-1 | A·B | **PASS** | A 권고(이미 쌓인 사용량 문구, 7일 표현, A-10 이전 경로 제외)·B 권고(P-7 재실행, 덤프 삭제 시점, 덤프 복구 범위) 반영 |
| S1 | 리허설 스크립트 82080b8 | 1 덤프·복원 / 2 Storage·보안 / 3 쓰기 중지·되돌리기 | **FAIL** | 1: 해시 블록 시간대 고정 없음. 2: H-7 정리 SQL을 옛 DB에서 단독 실행하면 운영 cron·vault 삭제 → DO 검사. 3: 옛·새 설정이 짝째로 뒤바뀌면 옛 DB TRUNCATE 가능 → pooler 지역·저장소 연결 ref 대조·새 DB cron 0 검사, freeze 기준 시각을 ALTER 뒤로 |
| S2 | df8b45a | 1·2·3 | 1·2 **FAIL**, 3 **PASS** | 1·2: dry-run 비밀번호 잔존 검사가 grep 인자로 비밀번호 노출 → bash 내장 비교(881e555) |
| S3 | 2d38928 | 1·2 | **PASS** | 3은 S2 PASS. 스크립트 확정 |
| P-11 | 런북 초안 eb783cb | 데이터 이전·Auth·Storage·Vercel·결제·cron 3명 | **FAIL ×3** | 키 종류 계획 불일치, C-0 재적재 누락, 경보 0 기준 불가(기존 PAYAPP 경보 1건), R-3 vault 삭제 대상·안전장치 없음, 새 DB MCP read_only라 net.http 시험 불가, Vercel Data Cache가 배포를 넘어 옛 Storage 주소 유지 → 896e720 |
| P-11 | 896e720 | 같은 3명 | 데이터 FAIL·Vercel FAIL·결제 **PASS** | 공지 시간·사용 금지 구간 계획서 미동기화, 퍼지 메뉴 경로 → 106555d |
| P-11 | 106555d(+7f003f4·c16d86e 권고) | 같은 3명 | **PASS ×3** | 권고 반영: secret 로그 기록, update_secret 대상 없음 검사, C-7 가드를 `not active` 방식으로, R-2 가드는 R-1 전에만 |

## 14. 실측 기록 (H-10)

| 항목 | 값 |
|---|---|
| H-0(2026-11-04) | 새 `xsvmbrgixgfqijneikjl`: PG 17.11(옛 17.6), auth `20260831180000`·storage `79` 같음, auth 테이블 27개 같음, event trigger 6개 같음(자동 RLS·자동 노출 없음), pg_cron 1.6.4 같음, **pg_net 0.20.4(옛 0.19.5) — `net.http_post`·`cron.schedule/alter_job/unschedule` 시그니처 같음**, public 객체·auth.users·cron·vault·버킷 0, 시간대 UTC. 새 `pg_default_acl`(postgres, public): S `postgres=rwU`, f `postgres=X`, r `postgres=arwdDxtm, anon/authenticated/service_role=Dxtm` → H-3 회수·H-5 부여 뒤 옛 값과 같아져야 함. role 설정 차이(authenticator `supautils, safeupdate`, `supabase_realtime_admin` 항목)는 플랫폼 값 — roles.sql이 예약 role의 statement_timeout 외 설정은 주석 처리하므로 덮어쓰지 않음(V-6에서 이 두 차이는 예상값) |
| H-1~H-5·H-8(2026-11-04 1차 리허설) | 덤프 `dumps/20261104T090054Z`(옛 DB 시작 09:00:55 UTC): roles 297B·schema 556KB·data 20.2MB, COPY 93개(public 72 + auth 21), H-2 0줄, auth 트리거 1개. data-only 순환 FK 경고 6건(questions, credit_sources↔payment_orders 등)은 replica 적재라 무해. **복원 25초**, 디스크 17%(DB 48MB·WAL 128MB). **V-1** 일치(차이: `payment_reconciliation_runs` 옛 22104/새 22101 = 덤프 시각 이전 22101과 정확히 같음, 제외 auth 4개). **V-1b** FK 160개 고아 0. **V-2** public 70개 + auth.users·identities 해시 일치(다른 2개 `payment_reconciliation_runs`·`scheduler`는 덤프 뒤 cron 쓰기). **V-4** 함수 97·정책 122·트리거 38·RLS 해시 모두 일치(`source_configs` RLS 꺼짐 유지). **V-5** ACL 2193행 해시 일치, anon 실행 26·authenticated 41, 결제 테이블 service_role 쓰기 0. **V-6** `pg_default_acl`(postgres, public) 옛 값과 같음, role 시간 제한 같음, `cli_login_*` 없음, 시간대 UTC, cron 0. V-3(Storage)은 H-6 뒤 |
| H-6·V-3(2026-11-09) | `storage-sync.sh` 첫 동기화: 버킷 3개 생성, 옛 1173개 → **업로드 1173개, 실패 0, 415초**, 새 쪽 전용 0개. 옛 DB 기준 시각 2026-11-09 01:02:17 UTC(`storage-sync/LAST_SYNC`). **V-3** 버킷 설정 해시 일치(3개), 버킷별 (이름, 크기) 해시 일치(main-ad-images 10·market-files 1161·market-images 2), 전체 (이름, MIME, cacheControl) 해시 일치, storage 정책은 양쪽 0개. 공개 파일 5개를 옛·새 공개 주소에서 받아 SHA-256 일치(크기·Content-Type 같음). 비공개 `market-files` 다운로드는 H-9 `createSignedUrl`에서 확인 |
| H-7(2026-11-09) | 새 프로젝트 SQL Editor에서 `sql/h7-cron-vault-test.sql` 1·2단계: 틀린 secret(무작위 48자)으로 vault 2개 + `configure_payment_reconciliation_http_cron()` → `payment-reconciliation-http-5m` `*/5` 등록. 01:20:00 UTC 실행 `succeeded`, `net._http_response` **403 `{"error":"Forbidden"}`**, 시간 초과·오류 없음. 대사 route는 secret 불일치 시 DB 접근 없이 403 → 옛 DB 경보 증가 0(미해결 1개는 기존 페이앱 건). 4·5단계 정리 뒤 cron 0·vault 0 확인(AI MCP 재확인) |
| P-5(2026-11-09) | 대표가 옛·새 Authentication·Data API 화면을 보고 옮김. AI 확인: 두 프로젝트 `GET /auth/v1/settings`(publishable 키) 응답이 **완전히 같음**(가입 허용, `mailer_autoconfirm` false = Confirm email 켜짐, 공급자 email·kakao만 켜짐, 익명·전화 꺼짐). 카카오 `/auth/v1/authorize` 리다이렉트의 client_id·scope(account_email profile_image profile_nickname) 같음, redirect_uri는 새 ref 콜백. Site URL·Redirect URLs·세션·Rate Limits·템플릿은 공개 API로 확인 불가 → H-9 실제 흐름으로 확인 |
| P-6(2026-11-09) | 대표: Kakao Developers Redirect URI에 `https://xsvmbrgixgfqijneikjl.supabase.co/auth/v1/callback` 추가(옛 주소 유지), 새 Kakao provider Client Secret·이메일 없는 사용자 허용 값 옛과 같게. 실제 로그인은 H-9 |
| P-7 사전 확인(2026-11-09) | AI가 Resend MCP로 확인: 도메인 `summersuninst.com` **verified**(2026-10-28 등록, 지역 ap-northeast-1, DKIM `resend._domainkey`·SPF `send` MX·TXT·`rsend` CNAME 모두 verified), API 키 1개(`summersuninst_firstcreate`). 남은 일: 새 프로젝트 SMTP 입력 |
| P-7(2026-11-09) | 대표: 새 프로젝트 Custom SMTP(Resend `smtp.resend.com:465`, 사용자 `resend`) 입력·저장, Rate Limits 확인. 실제 발송은 H-9에서 확인. **H-9 주의(코드 확인)**: `src/app/auth/actions.ts` `signUp`에 `emailRedirectTo`가 없어 확인 메일 링크는 새 프로젝트 `/auth/v1/verify`에서 확인 처리 뒤 **Site URL(운영 사이트 = 아직 옛 DB)**로 돌아감 → 운영 화면 오류는 무시하고 AI가 새 DB `email_confirmed_at`으로 판정, 로그인은 localhost:4000에서. 앱에 비밀번호 찾기 메일(`resetPasswordForEmail`) 경로는 없음 |
| H-9(2026-11-09) | `.env.local` Supabase 3개만 새 값으로 바뀐 상태로 시험. **실제로는 대표가 먼저 새 프로젝트 legacy JWT 키(anon·service_role, `eyJ…`)로 직접 바꿔 두어 AI의 교체 스크립트는 적용되지 않았고, 백업도 바뀐 뒤 상태로 떠짐** → 시험은 legacy JWT 키 기준(본 전환 C-6 Vercel 값도 같은 종류로 맞출 것). 원복은 2026-10-19 `.env.local 복사본`(Supabase 3개 외 값 동일, anon 키 = 옛 프로젝트 현재 공개 anon 키 확인)으로 함, 새 값 파일은 `env.local.seoul-h9`로 이름 변경. supabase-js 2.83.0. ② 대표 관리자 이메일 로그인(옮긴 비밀번호) → 새 DB `last_sign_in_at` 01:53:15·세션 1, **옛 DB 변화 0**. ③ 1차: 메인 배너·마켓 썸네일·상품 상세 샘플 미리보기(비공개 버킷 서명 URL)·관리자 사용자/크레딧/결제 화면 정상, 테스트 관리자 생성·삭제 성공(`auth.admin` + secret 키). **시험 상품·업로드(서버 upload·`createSignedUploadUrl`)는 대표 결정으로 생략** — secret 키 Storage 업로드는 H-6 1173개로 확인됨, 서명 업로드 경로는 미확인. 2차: `+h9` 이메일 가입 → Resend 발송 기록 `delivered`(02:00:30, 제목 "Confirm your email address" = 기본 템플릿), 링크로 `email_confirmed_at` 02:00:45, localhost 로그인 02:01:05. Resend 발송 기록이 이것 1건뿐 → 옛 프로젝트는 Resend SMTP를 쓰지 않았음. **기존 카카오 회원(대표 본인 카카오)** 로그인 02:01:29: 기존 사용자에 세션 생성, kakao identity 그대로(2개), 회원 수 15(=14+이메일 시험 1) → identity 재사용 확인. 옛 DB는 시험 내내 auth 변화 0. ⑤ 삭제 경로 시험은 새 쪽 전용 파일이 없어 H-10 C-4 리허설에서 목록 0 확인으로 대신 |
| 덤프 시간 | C-2 데이터 전용: 2026-11-09 `dumps/20261109T073533Z` **73초**(비밀번호 입력 포함, `time` 실측), data.sql 20.5MB, COPY 93개, 순환 FK 경고 6건 동일(무해). 전체 덤프(H-1)는 별도 |
| 재적재 시간 | C-3 2026-11-09 `reload-data.sh`(덤프 `20261109T073533Z`): 비울 테이블 98개, FK 닫힘 검사 통과, **재적재 10초**(비밀번호·확인 입력 포함 30초). 검증: V-1 행 수 일치(차이 `payment_reconciliation_runs` 새 23524 = 옛 덤프 시작 전 23524, 제외 auth 테이블은 새 쪽 0), V-1b FK 160개 고아 0, V-2 public 70개(cron 기록 2개 제외)·auth.users·identities 해시 옛과 일치, H-9·H-10 시험 데이터(가입 계정·세션·리뷰 태그 변경) 모두 원상복구, cron 0·이력 110 |
| 파일 차이 반영 시간 | 첫 전체 복사 1173개 415초(2026-11-09). 본 전환 C-4는 바뀐 것만이라 더 짧음. **C-4 2회차(2026-11-09) 실측: 옛 1173·새 1173 → 업로드 0·새 쪽 전용 0, 업로드 0초, 전체 2분 15초(비밀번호·키 4개 입력이 대부분)** → V-3 (이름·크기) 해시 옛·새 일치. 본 전환에서는 키 입력을 미리 준비해 둘 것 |
| 쓰기 중지 실측(API 쓰기·로그인·업로드 실패 여부) | 2026-11-09 새 DB `freeze.sh new on`(기준 07:40:32 UTC, 연결 9개 종료, 저장 설정 확인). 로컬 앱(새 DB legacy 키): 배너·썸네일·샘플 미리보기(Storage 읽기) **성공**, 관리자 생성·재로그인(GoTrue 쓰기) **실패**. **secret 키 PostgREST PATCH(`market_review_tags` sort_order 같은 값) → HTTP 204, 트리거로 `updated_at` 07:42:24 갱신 = 읽기 전용 기본값이 PostgREST 쓰기를 막지 못함** → 본 전환에서 API 쓰기 차단은 **Vercel Firewall(C-1 ①)만이 유일한 수단**, C-8 옛 DB 스냅샷 비교 필수. `freeze.sh new off` 뒤 재로그인 성공(07:52:48, 저장 설정 해제 확인). Storage 업로드 차단 여부는 미시험(업로드 시험 생략) |
| Firewall 사전 시험(H-10(d)) | **2026-11-09 대표 결정으로 보류 — 본 전환 전(늦어도 C-0) 필수.** 확인된 사실: 운영 프로젝트 `create-quiz-ai`는 Firewall 설정이 한 번도 없음(`get_firewall_config` 404). Vercel API(PUT 전체 설정·PATCH `rules.insert`·`firewallEnabled`)는 모두 "Seawall Config not found" 404 → **첫 설정은 대시보드에서 규칙 1개를 만들어 Publish해야 생기고, 그 뒤부터 API로 수정 가능**. 로컬 Vercel CLI 없음. 시험안: 대시보드로 `fwtest-0`(경로 `/__fw-test` 시작 → Log) 생성 → AI가 PUT으로 시험 규칙 3개(①`/__fw-test/reconcile`+POST bypass ②`/__fw-test` 시작+대표 IP bypass ③`/__fw-test` 시작 deny)로 교체 → 대표 PC GET 통과, **대표 휴대폰 모바일 데이터 GET 403**, 옛 DB `net.http_post` reconcile 통과·`net.http_get` reconcile 403(옛 DB 쓰기 = `net` 큐뿐, 대표 승인) 확인 → 규칙 삭제 → `get_firewall_config`가 빈 규칙(404 아님) 확인. **새 DB MCP는 read_only라 `net.http_*` 불가**(런북 검증 지적) |
| P-9(2026-11-09, AI가 이름·메타데이터만 확인) | Vercel 환경변수 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 **Production에만** 있고 `configurationId` 없음(**Supabase 연동이 관리하지 않음** → C-6에서 직접 교체, 연동 끊기 불필요). `CRON_SECRET`은 sensitive(대시보드에서 값 안 보임) → C-7 값은 옛 DB `vault.decrypted_secrets`에서 대표가 확인. 현재 production 배포 `dpl_3dY34E4KR6nX3dr41K3zeTCEpyHT`(커밋 `24d5f7e`), 저장소 main에는 그 뒤 미배포 코드 커밋 있음 → C-6은 push가 아니라 **현재 배포 Redeploy(캐시 없이)**, 점검 중 push 금지. 옛 DB cron 이름 `payment-reconciliation-http-5m`·`payment-reconciliation-health-5m` 확인. 플랜(Hobby/Pro)은 API로 확인 못 함 |
| 단계별 시간 예산·중단 기준 | 런북 `docs/supabase-seoul-cutover-runbook.md` 0절. 예산 C-1 10·C-2 10·C-3 10·C-4 10·C-5 15·C-6 15·C-7 15·C-8 15·C-9 5분 = 105분 + (실패 시) R-2·R-1 25분 = 130분 → **공지 2시간 30분**. 중단: 같은 단계 2회 실패, **C-5까지 60분 초과**, C-5 원인 불명 불일치, C-8 옛 DB 스냅샷 차이·**새 경보**·화면 오류 → 9절 되돌리기 |
