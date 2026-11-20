# 6번 묶음 계획: 약관·개인정보처리방침 개정과 약관 본문 이력 (4판 — 구현 검증 반영)

작성일: 2026-11-20 · 순서표 `docs/prelaunch-work-order.md` 6번

## 0. 대표 결정(2026-11-20)
- 서비스 범위: **문제마켓(자료 구매·다운로드) 중심**, AI 문제 생성은 "회사가 제공하는 경우"의 부가 서비스 조항으로 남김(나중에 다시 켜도 약관 개정 불필요).
- 권리침해 신고: 별도 문서·문의 카테고리를 만들지 않음. 하단에 표시된 이메일·연락처로 받는다고 약관에 적음.
- **약관 본문 이력을 남김**: 약관을 저장할 때마다 본문 사본을 추가 전용 표에 남기고, 동의 기록에 그때 본문의 지문(해시)을 함께 적음.
- 이전 결정 그대로: 만 14세 미만 가입 불가, 구매 자료 이용 범위(본인 수업용 인쇄·배포 허용 / 파일 공유·재판매·온라인 게시 금지), 보유 기간(탈퇴 시 파기, 결제 이력은 5년).

## 1. 범위
하는 것
- A. 약관 문서 3개(이용약관·개인정보처리방침·취소/환불정책) 문구 개정 — DB 데이터(`system_settings.site_footer_content`). 초안 문서 `docs/bundle6-terms-draft.md` 를 대표가 확인한 뒤 적용.
- B. 약관 본문 이력: 새 표 `policy_document_snapshots`(추가 전용) + `site_footer_content` 저장 때 자동 기록하는 트리거 + `user_consents.policy_sha256` 열 + 기록 함수가 동의 시점 연결 약관 본문의 해시를 적음.
- C. 회원 상세 동의 내역에 "동의 당시 약관 사본 있음/없음" 표시, 관리자 약관 이력 조회(대표·site.manage 읽기 전용 화면 `/admin/footer/policy-history`).

하지 않는 것(다른 묶음)
- 크레딧·자료 환불 기간 변경(7일→30일)과 "1년 이내" 문장 정정 — 8·9번 묶음. 이번 개정에서는 환불 기간 숫자를 **지금 코드 동작 그대로** 적고, 8·9번에서 함께 바꿈.
- 미성년자 결제 화면 고지(충전 결제 화면 한 줄) — 9번 묶음. 이번에는 약관·환불정책 조항만.
- 공지 게시판(13번), 시행일 사전 공지 기능.

## 2. A. 문구 개정 원칙
- 실제 동작과 다른 문장을 쓰지 않음(코드·DB 기준으로 대조). 초안의 문장마다 근거(코드 위치·결정)를 초안 문서 옆 칸에 적어 대조 검증을 쉽게.
- 이용약관: 목적·정의(문제마켓·자료·구매 자료·크레딧·회원 = 만 14세 이상), 회원가입·계정, 서비스(문제마켓 + 부가 AI 조항), 크레딧(선불·1회 충전 상한 100,000원·양도 불가·유효기간과 환불은 환불정책 참조), **구매 자료 이용 범위** 조항, 금지행위, 게시물·이용제한, **미성년자 계약 취소**(법정대리인 동의 없는 미성년자 계약은 본인 또는 법정대리인이 취소할 수 있음, 단 민법상 예외), **서비스 종료**(30일 전 공지, 남은 유료 크레딧 환불), **권리침해 신고**(하단 이메일·연락처로 접수 → 확인 기간 동안 게시 중단 가능), 약관 변경(7일 전, 불리한 변경 30일 전 공지), 책임 제한, 분쟁, **부칙(시행일)**.
- 개인정보처리방침: **시행일**, 처리 목적(문제마켓 중심), 처리 항목(4번 묶음 정리분 유지), 보유 기간(4번 묶음 정리분 유지), **위탁·국외 이전 표**(Supabase Pte. Ltd.(싱가포르) — 회원 인증·DB·파일, 서울 리전 / Vercel Inc. — 호스팅·화면 생성 / Plus Five Five(Resend) — 인증 메일 / Slack Technologies Limited(아일랜드) — 운영 알림 / 페이앱 — 결제 / 카카오 — 로그인 연동(위탁 아님) / AI 제공사 — AI 기능을 켤 때만, 국외 이전 항목·국가·시기·방법·보유기간·거부 방법), 정보주체 권리, 자동 수집(쿠키: 로그인 유지·3시간 만료 표시 쿠키 등 실제 이름), 안전성 조치, 만 14세 미만(4번 정리분), **개인정보 보호책임자 = 하단 정보 값과 같게(현재 "김광현", 이메일은 하단 이메일)**, **권익침해 구제 방법**(개인정보분쟁조정위원회 1833-6972, 개인정보침해신고센터 118, 대검찰청 1301, 경찰청 182), 변경 고지.
- 취소·환불정책: 환불 기간 숫자와 심사 문구 블록은 유지(8·9번), 꺼진 AI 기능 전제 문장(1·3②⑤·4절)을 문제마켓 기준으로 정리, 5절에 '원 결제수단으로 환불할 수 없을 때 본인 계좌' 예외, **미성년자 결제 취소**(민법 141조 효과)·**서비스 종료** 조항.
- 시행일: 적용(DB 반영)하는 날짜로 부칙에 적음. 출시 전이라 사전 공지 기간 없이 바로 시행(실회원 없음).
- 재동의: 출시 전이고 실회원이 없어 '다시 동의 받기'를 하지 않음(시험 계정은 출시 전 삭제). 대신 B 의 이력이 적용 전후 본문을 모두 남김.

## 3. B. 약관 본문 이력(DB)
### 3-1. 표 `policy_document_snapshots`
- id uuid PK, seq bigint identity, doc_key text, slug text, title text, content text, content_sha256 text(hex 64, CHECK 형식), created_at timestamptz default clock_timestamp(), 인덱스 (doc_key, seq desc), (content_sha256). **UNIQUE 없음** — 같은 본문으로 되돌려 저장(A→B→A)해도 새 행이 남아 '언제 어떤 본문이 시행됐는지' 시간 순서가 정확.
- 추가 전용(UPDATE·DELETE·TRUNCATE 거부 트리거). RLS 켬, 모든 역할 권한 회수 후 service_role SELECT 만. **seq 시퀀스도 `REVOKE ALL ON SEQUENCE … FROM PUBLIC, anon, authenticated, service_role`**(Supabase 기본 권한이 setval 을 허용 — 최근 사본·시간 순서 판정 보호, 4번 선례).
### 3-2. 해시 규칙
- `encode(sha256(convert_to(content, 'UTF8')), 'hex')` — 저장된 원본 문자열 그대로(공백 정리 없이). DB CHECK 가 사본의 해시를 보장하고, 화면은 저장된 해시만 보여 줌(TS 계산 없음).
### 3-3. 자동 기록 트리거
- `system_settings` AFTER INSERT OR UPDATE, `WHEN (NEW.key = 'site_footer_content')` 트리거 → `jsonb_each(NEW.value->'policyDocuments')` 로 문서마다(코드 상수 중복 없음), content 가 문자열이 아니면 건너뜀(저장은 막지 않음), 그 doc_key 의 **가장 최근 사본과 해시가 다를 때만** INSERT. 트리거는 system_settings 행 잠금 안에서 돌아 최근 사본 비교에 경쟁 없음. 저장 경로(관리자 서버 액션 upsert·SQL)와 무관하게 남음.
- 트리거 함수는 SECURITY DEFINER(service_role 은 표 INSERT 권한이 없으므로), search_path 고정, 실행 권한 모두 회수(선례 keep_admin_owner), 실패하면 저장도 실패(이력 없는 저장 금지).
- 마이그레이션에서 지금 본문 3개를 첫 사본으로 넣음(backfill).
### 3-4. `user_consents.policy_sha256 text null`
- ADD COLUMN(null, 기본값 없음 — 메타데이터만 바뀜). CHECK(policy_sha256 IS NULL OR policy_sha256 ~ '^[0-9a-f]{64}$').
- `consent_record_internal` 교체(지금 정의 md5 `5b14ce9ffa188648c781f48e7a8ef2bd` 확인 뒤 CREATE OR REPLACE, **SECURITY DEFINER·SET search_path 다시 명시**): 기록하는 항목에 policy_slug 가 있으면 site_footer_content 원본에서 저장된 `doc->>'slug'` 로 문서를 찾아 본문 해시를 함께 INSERT. 그 해시의 사본이 하나도 없으면(이론상 트리거가 보장) advisory 잠금(`public.policy_document_snapshots`) 안에서 EXISTS 확인 뒤 사본 INSERT. 문서를 찾지 못하면 NULL. 해시 정의는 '동의 제출 시점의 저장 본문'(화면 캐시 60초 차이는 한계 메모).
- 개인정보 항목(연결 약관 없음)은 NULL — 고지 본문 자체가 item_versions 에 있음.
- 4번 묶음의 기존 기록(시험 계정)은 NULL 로 남음.
### 3-5. VERIFY·리허설
- 표 권한(anon·authenticated·PUBLIC 없음, service_role SELECT 만)·시퀀스 relacl 에 anon|authenticated|service_role 없음(4번 6-1 과 같은 정규식)·RLS·추가 전용 트리거 3종·DEFINER/search_path·(3a)·함수 ACL(트리거 함수 `{postgres=X/postgres}`), consent_record_internal 의 prosecdef·proconfig·proacl 재확인, user_consents.policy_sha256 이 있는 행은 모두 사본 표에 해시가 있음, backfill 해시 = 원본 재계산. 머리말에 잠금 설명(user_consents ADD COLUMN·CHECK 는 ACCESS EXCLUSIVE, system_settings CREATE TRIGGER 는 SHARE ROW EXCLUSIVE)과 SET LOCAL timeout.
- backfill 3행, 해시 형식.
- 리허설: 실제 저장 경로 upsert(service_role) → 사본 1행 추가, 같은 본문 다시 저장 → 추가 없음, A→B→A 저장 → 3행, service_role 의 setval 거부, 문서 content 가 빠진 SQL 저장 → 건너뛰고 저장 성공, email_signup·kakao 완료 경로도 해시 기록, 4번 VERIFY(3a 포함) 재통과, 동의 기록(consent_gate) → terms 기록에 해시가 들어가고 사본과 일치, service_role 직접 INSERT 거부, 세션(authenticated) UPDATE 는 RESTRICTIVE 정책으로 0행(4번 묶음 정책 유지).
- 되돌리기: 트리거 DROP → 트리거 함수 DROP → consent_record_internal 을 4번 정의로 복원(6번 정의 md5 가드, **반드시 열 DROP 보다 먼저**) → 열 DROP → 표 DROP. 머리말: 코드 배포 뒤 되돌리지 말 것(사본·해시가 사라짐).

## 4. C. 화면
- 회원 상세 '약관 동의' 줄: 연결 약관이 있는 항목은 "약관 사본 보관"(해시 앞 8자리) 또는 "사본 없음(4번 묶음 이전 기록)".
- (구현에서 단순화) TS 쪽에서 해시를 계산하지 않고 DB 에 저장된 해시만 보여 줌 — 계약 테스트의 'TS 해시 = SQL' 항목은 뺌.
- `/admin/footer/policy-history`(site.manage 읽기): 문서별 사본 목록(저장 시각·해시 앞 8자리·본문 보기). 해시로 찾기(`?hash=`). 쓰기 없음. 사이드바에는 넣지 않고 사이트 기본 정보 화면의 약관 카드에서 링크.
- 하단 정보 화면 "약관 및 정책" 카드 설명에 "저장할 때마다 본문 이력이 남습니다" 한 줄.

## 5. 검증·테스트
- 계약 테스트: 마이그레이션 권한·트리거·열·함수 교체 md5 가드, 관리자 이력 화면 가드(site.manage)·쓰기 없음, 회원 상세 표시.
- 초안 대조 검증(서브에이전트): 초안 문장 ↔ 코드·DB 실제 동작(쿠키 이름, 위탁 업체, 크레딧 상한, 환불 기간 현재값, 보호책임자 값) 대조, 법정 기재사항 누락 점검(개인정보보호법 30조·시행령 31조, 전자상거래법 약관 기재).
- DB 리허설(BEGIN…ROLLBACK) → 대표 승인 → 적용 → 문구 적용(관리자 저장 또는 승인된 SQL) → 로컬 확인 → push.

## 6. 배포 순서
1. 초안 확인(대표) → 2. DB(이력 표·트리거·열·함수) 적용(승인) → 3. 코드 배포(이력 화면·회원 상세) → 4. 문구 적용 전 확인: **하단 정보 상담/주문 이메일을 대표가 채움**, **Slack 워크스페이스 메시지 보존 기간을 대표가 정함**(처리방침 6절), 초안 본문에 치환 표시·메모(`{`·`[대표 확인]`·`계획`)가 0개(처리방침 12절·약관 제10조 연락처와 같은 값), 관리자 계정을 뺀 user_consents 회원이 모두 시험 계정인지 읽기 검사 → 5. 문구 적용(트리거가 이력을 남김, 승인). **'다시 동의 받기'는 누르지 않음**(출시 전 첫 개정, 실회원 없음).
- 후속 메모: 변호사 확인 목록에 'Slack 운영 알림이 국외 이전 제3호(계약 이행 위탁)에 해당하는지, 아니면 알림에서 개인정보를 빼야 하는지' 추가, CS 런북에 '만 14세 체크만으로 미성년자 취소를 거절하지 않음', 하단 이메일이 도메인 메일(Zoho 등)이면 위탁·국외 이전 표에 추가, 옛 싱가포르 DB 사본 출시 전 삭제, 남은 유료 크레딧 환불(탈퇴·이용 제한 해지 때) 결정을 8·9번에, 결제 회원 익명화(10번)는 출시 조건(처리방침 '탈퇴 시 파기'가 결제 회원에게 사실이 되려면), 이용약관 끝 '환불가능기간 1년'과 환불정책 7일 모순은 9번에서 출시 전 해결, 미성년자 취소권 결제 화면 고지(9번), CAPTCHA(5번)·Sentry(24번) 도입 때 위탁·국외 이전 표 갱신, 이전 처리방침 공개 열람 검토.
   - 2 를 먼저 하는 이유: 문구를 바꾸기 전에 이력 장치가 있어야 개정 전후 본문이 모두 남음.
