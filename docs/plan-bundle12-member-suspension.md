# 12번 묶음 계획 · 회원 이용 정지·관리자 메모

작성일: 2026-11-26
판: 3판(검증 PASS, 2026-11-26) — PASS 뒤 남은 minor 6개를 반영함(17절)
- 1판은 네 관점 모두 FAIL 이었고, 2판은 DB·회원 코드·관리자 코드 PASS, 법률 FAIL 이었다. 반영 내용은 15절 표에 있다. 고친 곳은 문단 끝에 `(2판)`·`(3판)` 으로 표시했다.
- 작업 순서표 12번 '회원 정지·메모'(로그인·다운로드 차단, 사유, 해제 / 관리자 메모)를 만든다.
- 결제 경로·권한을 건드리므로 권한·결제 경로·법률·마이그레이션 네 관점으로 검증한다.
- 대표가 정할 것은 0절 **Q1~Q9** 다. 답이 오기 전에는 각 질문의 '기본안'으로 쓴다.

## 0. 대표 결정이 필요한 것(질문)
| # | 질문 | 기본안(이 계획이 따르는 것) | 이유 |
|---|---|---|---|
| Q1 | 정지를 두 단계로 둘까? '이용 제한'(로그인은 되고 구매·충전·다운로드·후기만 막힘)과 '로그인 차단'(로그인 자체를 막음) | **두 단계 둔다.** 보통은 이용 제한, 계정 도용·자동 수집처럼 로그인을 열어 두면 안 되는 때만 로그인 차단 | 약관 9조②·17조는 이의를 고객지원(1:1 문의)으로 받는다. 로그인을 막으면 회원이 화면으로 문의·내역·환불을 못 한다. 반대로 도용 계정은 열어 두면 도용자가 내역·연락처를 본다 |
| Q2 | 이용 제한에서 이미 산 자료의 다운로드도 막을까? | **정지할 때 '다운로드도 막기'를 따로 고른다.** 미리 체크할지는 사유 분류마다 DB 값 `blocksDownloadDefault` 로 정한다. 초안은 자료 공유·계정 도용·자동 수집이 체크, 나머지는 해제다. (3판) | 약관 7조④는 다운로드 차단을 7조(이용 범위) 위반과 묶었다. 자료 무단 공유가 아닌 사유(결제 악용 등)에서는 값을 치른 자료까지 막을 이유가 약하다 |
| Q3 | 권한을 하나(`members.manage`)로 둘까, 둘(`members.memo` 메모, `members.suspend` 정지·해제)로 나눌까? | **둘로 나눈다.** CS 담당에게는 메모만 준다 | 메모는 매일 쓰고 정지는 드물고 무겁다. 운영 개선 계획 154줄의 예고는 8-3 에서 고친다 |
| Q4 | 로그인 차단과 그 해제는 대표만 할까? | **대표만.** 이용 제한은 `members.suspend` 받은 직원도 | 로그인 차단은 회원이 화면으로 이의·환불을 못 하게 되는 조치다 |
| Q5 | 정지 기간을 어떻게 둘까? | **이용 제한은 끝나는 날을 반드시 적는다. 최대 일수는 DB 정책 값(초안 30일)이다. 로그인 차단은 비워 둘 수 있다(본인 확인 때까지). 다만 비워 두면 늘 '기한을 넘는 정지'로 보고 경고와 3절 (가)(나)(다) 선택을 받는다.** 늘리려면 해제한 뒤 다시 정지한다. (2판·3판) | 충전 환불은 결제 뒤 7일·미사용, 자료 환불은 30일, 크레딧은 1년이면 소멸한다. 기한 없는 정지는 '사용 보류'가 '소멸'로 바뀌는 길이 된다(3절 돈 원칙) |
| Q6 | 회원에게 어떻게 알릴까? | 이용 제한은 **화면(한 줄 안내 + 안내 화면, 처음 연 시각 기록)** 으로 한다. 로그인 차단은 **대표가 이메일을 보내고 수단·시각·요약을 기록**한다. 이메일과 로그인 화면 문구에는 기한 안내를 넣는다: 가장 빠른 환불·소멸 기한, 그리고 이메일·전화로 충전·자료 환불과 탈퇴를 신청할 수 있고 접수 시각을 신청 시각으로 본다는 내용(환불정책 3절①·3-2①). (3판) | 9조②의 '사유를 알림'. 로그인 차단 회원은 화면의 안내·환불 경로에 들어올 수 없다. 사이트가 메일을 보내는 기능은 만들지 않는다 |
| Q7 | 정지 중인 회원의 탈퇴를 막을까? | **막지 않는다.** 10번 탈퇴 경로를 그대로 쓴다 | 현행 12조①('언제든지 서비스 화면에서')과 01-11 시행판 12조①(결제 회원 탈퇴 조건 포함)이 정지를 막힘 사유로 적지 않았다. 막으려면 약관을 고쳐야 하는데 12-10~01-11 은 고칠 수 없다(7절) |
| Q8 | 문구를 초안으로 넣고 나중에 고칠까? | **초안으로 넣는다.** 대표가 클라이언트와 정한 뒤 관리자 화면(6-3)에서 고친다 | 메모리 규칙 '문구는 초안, 최종은 클라이언트' |
| Q9 | 01-11 시행판 처리방침(2절 항목·3절 보유)에 '이용 제한 기록'과 '관리자 상담 메모'를 넣을까? (2판) | **대표 결정 대기.** 결정 전에는 (나)로 구현한다(어느 쪽이든 코드는 같다) | 아래 비교 |

**Q9 비교(2판)**
- **(가) 지금 넣는다**
  - 좋은 점: 01-11 에 함께 시행되어 공개되지 않은 항목을 처리하는 기간이 짧다. 탈퇴 뒤 정지 기록을 근거 있게 남길 수도 있다.
  - 비용: 10번 약관 스크립트(`supabase/scripts/20261126_bundle10_policy_text.sql`)의 처리방침 조각을 고쳐야 한다. 그러면 리허설로 확정한 게시 지문 8개(15번 10절 5단계)가 바뀐다. 12-10 게시 전에 리허설을 다시 하고 지문을 다시 확정해야 하며, 15번 일정이 빠듯해진다.
- **(나) 다음 개정 때 넣는다**
  - 좋은 점: 확정한 지문·리허설을 건드리지 않는다.
  - 조건: 공개할 때까지 쓰는 범위를 좁힌다. 지금 처리방침 1절 목적('계정 관리, 부정 이용 방지', '고객 문의 … 처리')과 2절 항목('구매·이용 기록', '고객지원: 문의·답변·처리 상태') 안에서만 쓴다.
    - 메모에는 확인한 사실과 처리 내용만 적고, 새 개인정보는 적지 않는다(`adminMemoGuide`).
    - 탈퇴(익명화)하면 정지 행과 메모를 **지운다**(4-4). 다만 추가만 되는 작업 기록에는 범위·분류 코드·기간·처리자·시각과 자유 글의 글자 수가 남는다. 근거는 처리방침 10절의 '관리자 작업 기록'이고, 분류 코드까지 남겨도 되는지는 L4 로 묻는다. (3판)
    - 다음 개정(01-11 뒤 30일 고지)에서 항목·보유 기간을 넣을지 L3 로 묻는다.

**관리자 비밀번호 후속 과제(작업 순서표 '10~12번 묶음 때 함께')는 이번 범위에 넣지 않는다.**
- 화면 경로는 10번에서 이미 처리했다. `/mypage/profile` 은 관리자 계정이면 '관리자 비밀번호 변경으로 이동'을 보인다(`src/app/(solvook)/mypage/profile/page.tsx` 의 `adminPasswordHref`, 10번 계획 483줄). 옛 화면 `/legacy/mypage/profile` 은 `site_legacy_mypage` 로 닫혀 있다(운영 `site_disabled_features`).
- 남은 틈은 브라우저에서 인증 서버를 직접 불러 짧은 비밀번호를 넣는 길이다. 최소 길이가 프로젝트 전체 값이라 관리자 2단계 인증(운영 개선 계획 5-10) 때 다룬다. 작업 순서표 줄은 8-3 에서 고친다.

## 1. 지금 상태(코드·운영 DB 읽기 전용 확인, 2026-11-26)
- **회원**: 프로필 19, 관리자 5, 탈퇴 0. `auth.users.banned_until` 이 있는 계정은 0이다. 실결제 회원 4명이 있다.
  - 정지·메모 칸이나 표는 없다.
  - `profiles` 에 회원 쓰기 정책이 없다(조회 2개뿐). 트리거는 `profiles_keep_admin_owner` 하나다.
- **로그인과 세션**
  - 이메일 로그인 `src/app/auth/actions.ts:32-44` 는 `error.message`(영어 원문)를 그대로 돌려준다.
  - 카카오 콜백 `src/app/auth/callback/route.ts:46-50` 은 `error_description` 이 있으면 `error_code` 를 버린다.
  - 미들웨어 `src/lib/supabase/middleware.ts` 는 모든 요청에서 `getUser()` 로 확인하고, 확인된 사용자만 `x-auth-user-id` 헤더를 붙인다. 3시간이 지나면 `sb-` 쿠키를 지운다.
  - 응답은 여러 곳에서 다시 만든다(`buildRequestHeaders` 경유). 정적 파일 분기(369-371줄)는 `x-auth-user-id` 만 지운다.
- **동의 관문**: `checkConsentGate`(66-69줄)는 화면 GET 이 아니거나 동의 제외 경로(`src/lib/consent-gate.ts:7-30`)이면 **RPC 를 부르기 전에** 돌아간다. 제외 경로는 `/library`·`/mypage/support`·`payments`·`credits`·`withdraw`·`consents`·`/terms`·`/auth`·`/admin`·`/checkout/*/result` 등이다. (2판)
- **10번 탈퇴의 인증 처리**(`20261126100000_member_withdrawal.sql:4879-4882`, 운영 `anonymize_member` md5 `15204dff…`)
  - DEFINER 함수 안에서 `auth.users.banned_until` 을 100년으로 걸고, 같은 거래에서 `auth.sessions`·`auth.refresh_tokens` 를 지운다.
  - 6단계 시작에 `set_config('app.member_withdrawal_bypass', 회원 id, true)` 를 켜고, 6-6 에서 `profiles.withdrawn_at` 을 채운다.
  - `withdrawn_at` 을 바꾸는 DB 함수는 이것 하나다. 가림 문구 키는 `member_withdrawal_policy.texts.redactionMask` 다(대표가 고칠 수 있음).
  - 보관함 추가 함수 `add_withdrawn_member_event` 는 보관함 행이 없으면(익명화 전) `MEMBER_NOT_WITHDRAWN` 으로 거절한다(5196-5198줄). (2판)
- **권한 저장 함수** `replace_admin_permission_grants`(최신 정의 `20261118120000:436`)는 권한 이름을 고정 목록 17개로 검사한다. 모르는 이름은 `ADMIN_PERMISSION_UNKNOWN` 이다. `tests/admin-permission-grants-contract.test.mjs:88-97` 이 최신 정의 파일 이름과 목록을 대조한다. (2판)
- **작업 기록** `admin_audit_log` 는 추가만 된다(`prevent_admin_audit_log_mutation`). `record_admin_audit` 는 `p_reason` 을 그대로 저장한다. 10번은 감사 기록에 자유 글 대신 글자 수만 넣었다(10번 계획 294·307줄). (2판)
- **환불의 대리 접수**(3판)
  - 자료 환불은 고객센터 접수 시각을 신청 시각으로 넣는 경로가 있다(`p_claim_received_at`, `20261124100000_market_material_refund.sql:1335-1349`).
  - 충전 환불 판정 `get_point_charge_refund_eligibility` 는 `now()` 로 보고 대리 접수 인자가 없다(`20261125100000_point_charge_policy.sql:586~`). 기한이 지난 건은 런북 0-3 SQL 절차의 대상이다(RB-6 638줄).
- **회사가 먼저 시작하는 해지·삭제 경로는 없다**(3판). 대표 익명화(`anonymize_member` owner)에는 회원의 열린 탈퇴 요청이 꼭 있어야 한다. 유료 크레딧이 남아 있으면 소멸 안내 발송과 동의 회신도 있어야 한다(`20261126100000:4680-4686`).
- **회원 route·서버 액션 분류**(2판, 이 표가 11-1 전수 시험의 기준이다)
  | 처리 | 경로 |
  |---|---|
  | 막기: 동의 가드 안에서 함께 | 페이앱 주문 POST, 상품 구매 POST, 장바구니 결제 POST. 꺼진 기능(404): `questions/generate`, listboard `run`·`retry`, `save-from-community` POST·PUT |
  | 막기: 따로 부름 | 장바구니 `cart/items` POST·PATCH, 후기 쓰기 `items/[itemId]/reviews` POST, 추천 `reviews/[reviewId]/vote` POST, 다운로드 `items/[itemId]/download` GET(303 이동) |
  | 열기 | `cart` GET·`cart/items` DELETE·`cart/checkouts/[key]` GET, 후기 지우기 `reviews/[reviewId]` DELETE, 충전 환불 `refunds/request`, 자료 환불 `market/refunds`, 문의 `support` POST·PUT·DELETE, 탈퇴 `auth/withdraw`, 로그아웃류(`auth/logout`·`consent-logout`·`cancel-signup`·`sessions`), `profile` PATCH, `notifications` PATCH, 조회 기록 `items/[itemId]/view`, 크레딧 조회 3개, 페이앱 `return`·`status`·통보, 카카오페이 콜백·상태, 서버 액션 `(auth)/consent/actions.ts`·`(solvook)/mypage/consents/actions.ts` |
  | 이미 닫힘 | 410: `market/purchases/batch`, `credits/purchase`·`deduct` / 503: `kakaopay/orders` (3판) |
  | 꺼진 기능(미들웨어 404, 가드 없음) (3판) | exam-papers 전부(print-pdf·random-bank 포함), listboard-jobs 나머지(만들기·조회·save), questions 나머지(POST·`[id]`·review), question-bank 2개, 서버 액션 `api/ocr/actions.ts`·`api/passages/actions.ts`·`api/ai/generate-passages.ts` |
  | 로그인 전·공개(가드 없음) (3판) | 서버 액션 `auth/actions.ts`·`auth/password-reset-actions.ts`, `auth/confirm`·`auth/callback`, 공개 GET(category-menu·sample-pages·pricing-plans·support/categories). `notifications` GET 은 '열기' |
  - '열기'는 이용 제한 회원 기준이다. 로그인 차단 회원은 세션이 지워져 모든 경로에서 비로그인이 된다(4-3).
- 회원 세션으로 부를 수 있는 DB 함수 가운데 돈을 움직이는 것은 없다. 문의 3개·조회·꺼진 문제은행 함수뿐이다. 구매·충전·다운로드 기록은 서버(service_role)가 쓴다. **그래서 이용 제한의 강제는 서버 공용 가드로 충분하다.**
- **약관·처리방침**(운영 `site_footer_content.policyDocuments`)
  - 이용약관 9조①: "경고, 다운로드 제한, 크레딧 사용 보류, 일시 정지, 계약 해지 등"
  - 9조②: 가능한 범위에서 사유를 알리고, 이의를 고객센터로 받아 유지·변경·해제한다.
  - 7조④: 이용 범위 위반에는 다운로드 차단. 4조①·처리방침 11절: 만 14세 미만은 이용 제한 뒤 계정·개인정보 지체 없이 파기
  - 해지: 현행 12조③, **01-11 시행판에서는 12조④** 다(10번 스크립트 339-353줄). (2판)
  - 환불정책: 2절③ 크레딧 1년, 3절① 충전 환불 7일·미사용, 3-2① 자료 환불 30일, 9절 위반 의심 시 환불 보류는 '사실 확인에 필요한 기간에 한하며', '청약철회는 제한하지 않음'
  - 처리방침 3절: 탈퇴하면 지체 없이 파기하고, 예외는 결제 기록이다. 시행판 3절의 보관 목록에도 정지 기록·메모는 없다(10번 스크립트 386-410줄). (2판)
- **결제 화면 틀**: `/checkout` 은 경로 묶음 밖이지만, `src/app/checkout/layout.tsx` 가 `(solvook)` 레이아웃을 그대로 다시 내보낸다(`export { default } from '@/app/(solvook)/layout'`). 같은 틀을 쓴다. (3판: 2판 서술 정정)

## 2. 목표
1. 권한 있는 관리자가 회원 상세에서 정지하고 해제한다. 정지·해제·알림은 같은 거래 안에서 작업 기록으로 남는다. 작업 기록에는 자유 글을 넣지 않는다.
2. **이용 제한 회원**: 충전 주문, 자료 구매, 장바구니 담기, 후기 쓰기·추천이 막힌다. 다운로드는 정지할 때 고른 대로 막힌다(Q2). 1절 '열기' 경로는 그대로 된다.
3. **로그인 차단 회원**: 정지하는 순간 세션이 모두 끊기고, 새 로그인(이메일·카카오)이 거절된다. 로그인 화면에 안내 문구가 뜬다.
4. 막힌 회원은 막힌 것, 아직 되는 것, 이의 방법, 그리고 **환불·소멸 기한**을 화면에서 본다.
5. 진행 중인 결제·환불은 깨지지 않는다.
6. 관리자 메모를 회원 상세에 적고 본다. 회원에게는 보이지 않는다.
7. 회원 화면 문구, 사유 분류, 최대 정지 일수는 DB 에 있고 대표가 관리자 화면에서 고친다.
8. 탈퇴(익명화)하면 그 회원의 메모와 정지 행이 같은 거래에서 지워진다(Q9 (나) 기준). 이 처리가 실패해 탈퇴를 막는 일은 없다.

## 3. 원칙(경우를 판단하는 규칙)
- **보기는 열고, 돈·자료·공개 글로 이어지는 쓰기는 막는다.** 이의·환불·탈퇴·자기 후기 지우기처럼 회원의 권리를 쓰는 길은 이용 제한에서 열어 둔다.
- **강제 위치**
  - 이용 제한: 서버 공용 가드 `checkMemberSuspensionForApi` 한 곳이 강제하고, 읽기에 실패하면 막는다. 화면 안내(미들웨어)는 최선 노력이다.
  - 로그인 차단: DB 거래가 인증 계정을 직접 막는다(10번 선례). 미들웨어·가드는 두 번째 방어다.
- **돈 원칙(2판)**
  - 정지는 '사용 보류'다. 돈을 없애는 조치가 아니다.
  - 정지 전에 연 결제창으로 결제가 들어오면 크레딧을 정상 지급한다(탈퇴 회원처럼 보류하지 않음).
  - 환불 신청 route 는 열려 있지만, **기한(충전 7일·미사용, 자료 30일·미다운로드) 안의 건만** 된다. 크레딧은 1년이면 소멸한다.
  - 그래서 정지 창과 회원 상세가 그 회원의 가장 빠른 기한을 보여 준다(6-2).
  - **끝나는 날이 그 기한을 넘거나, 끝나는 날이 없는 로그인 차단이면** 정지 창이 늘 경고한다. 그러면 런북 RB-12 규칙대로 다음 가운데 하나를 고른다. (3판)
    - (가) 기한 전에 해제하거나, 로그인 차단을 기한 전에 이용 제한으로 바꾼다(회원이 화면으로 환불을 신청할 수 있게).
    - (나) 계약 해지(현행 12조③·시행판 12조④)와 남은 유료 크레딧 환불(환불정책 8절 계산식)
    - (다) 만료를 정지 기간만큼 늘린다. 이 기능은 없으므로 런북 0-3 의 SQL 절차를 따른다.
  - **회사가 먼저 시작하는 해지·삭제 경로는 아직 없다**(1절). 그래서 (나)는 지금 이렇게만 한다: 회원에게 탈퇴 요청과 환불 신청을 안내하고, 요청이 오면 10번 절차로 처리한다. 요청이 없으면 이용 제한을 기한 경고와 함께 유지하고 L2 로 묻는다. (3판)
  - 로그인 차단 중에 이메일·전화로 받은 환불은 접수 시각을 메모에 적는다. 자료 환불은 접수 시각 경로(`p_claim_received_at`)로 넣는다.
  - 충전 환불은 그 경로가 없으므로 **접수 시각** 기준으로 다음과 같이 처리한다(L2).
    1. 기한 안에 접수된 충전 환불은 회사가 반드시 처리한다.
    2. 회원이 기한 안에 화면으로 다시 신청할 수 있으면 그 길로 처리한다. 이용 제한으로 바꾸는 것은 도용 우려가 없을 때만이다.
    3. 그 밖의 경우(도용이라 로그인을 열 수 없거나, 다시 신청하는 사이에 기한이 지난 경우)는 접수 시각을 메모에 적고 0-3 절차로 처리한다.
    4. 기한 뒤에 접수된 건은 일반 규칙대로 처리한다. (3판 PASS 뒤)
  - 이 규칙이 Q5 의 근거다.
- **대상**
  - 정지할 수 있는 대상: 가입을 마친 회원(관리자·탈퇴 회원·본인 제외). 이미 정지 중이면 새로 정지할 수 없다. 범위나 기간을 바꾸려면 해제한 뒤 다시 정지한다.
  - 메모를 쓸 수 있는 대상: 회원(관리자 제외)이고 탈퇴하지 않은 사람. 탈퇴 회원 기록은 10번 보관함 추가 기록으로만 남긴다. (2판)
- **정지 중 탈퇴**(Q7): 막지 않는다. 결제 회원은 10번대로 요청 → 대표 처리이고, 정지는 처리 때까지 그대로다. 결제가 없는 회원은 완전 삭제되고, 정지·메모도 CASCADE 로 지워진다.
- **만 14세 미만**(`underage` 분류, 2판·3판): 정지는 임시 조치다.
  - 회원·법정대리인에게 탈퇴 요청과 미성년자 결제 취소(환불정책 7절) 신청을 안내한다. 요청이 오면 10번 탈퇴·완전 삭제로 처리한다. 정지 창도 이 분류를 고르면 같은 안내를 보인다.
  - 요청이 오지 않으면 회사가 먼저 지울 경로가 없다. 처리방침 11절의 '지체 없이 파기'와 이 공백은 L6 으로 묻는다.
- **판정**: 활성 = `lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())`

## 4. DB 변경(마이그레이션 `20261214100000_member_suspension.sql`)
날짜는 15번 고지 시작(12-10) 뒤다(10절). 머리에 `lock_timeout`·`statement_timeout` 을 둔다.

### 4-1. 사전 점검(0번 블록, 다르면 멈춤)
- 새 표·함수·키가 없다. `record_admin_audit` 가 있다.
- 본문 md5 가 적어 둔 값과 같다(리허설 때 운영에서 뽑아 상수로 적음)
  - `get_my_missing_required_consents`: 새 관문 함수가 부른다.
  - `anonymize_member`: 4-4 트리거가 그 거래에서 돈다.
  - `replace_admin_permission_grants`: 4-5 에서 다시 정의한다. (2판)
- `profiles` 트리거가 `profiles_keep_admin_owner` 하나다.
- 활성 `admin_permission_grants` 에 `members.memo`·`members.suspend` 행이 없다. (2판)

### 4-2. 표
**`member_suspensions`**(정지 이력, 한 회원에 해제 안 된 행 1건)
- 칸
  - `id`, `user_id`(→ `profiles.id` ON DELETE CASCADE)
  - `scope`(`restricted`|`login_blocked`), `blocks_download`(bool, `login_blocked` 이면 true) (2판)
  - `reason_code`, `reason_label`(분류 이름 사본)
  - `member_reason`(1~500자), `internal_note`(0~2000자)
  - `starts_at`, `ends_at`(`restricted` 이면 필수이고 최대 일수 이하, `> starts_at`) (2판)
  - `created_by`, `lifted_at`, `lifted_by`, `lift_reason`
  - `operation_key`(NOT NULL UNIQUE, 같은 키로 다시 보내면 그 행을 그대로 돌려줌) (3판)
  - `notified_via`(`screen`|`email`|`phone`), `notified_at`, `notice_summary`(0~500자), `first_seen_at`(회원이 안내 화면을 처음 연 시각) (2판)
  - `created_at`
- `auth_ban_state`·재시도 상태는 두지 않는다. 인증 반영이 같은 거래라서다. (2판)
- 행위자 칸은 FK 없는 uuid 다(관리자 계정을 지워도 이력이 남음).
- 부분 UNIQUE `(user_id) WHERE lifted_at IS NULL`. 기간이 지난 행은 정지 함수가 먼저 `lifted_at = ends_at`, `lift_reason = 'expired'` 로 닫는다.

**`member_admin_notes`**: `id`, `user_id`(CASCADE), `body`(1~2000자), `created_by`, `created_at`, `deleted_at`, `deleted_by`. 고치기는 없고, 지우기는 `deleted_at` 만 채운다.

**권한(2판)**
- 두 표 모두 RLS 를 켜고 정책은 두지 않는다.
- anon·authenticated 는 모든 권한을, **service_role 은 INSERT·UPDATE·DELETE 를 회수하고 SELECT 만** 남긴다.
- 쓰는 것은 DEFINER 함수와 4-4 트리거뿐이다. CASCADE 삭제는 참조 표 소유자 권한으로 도므로 `fullDeleteMember` 는 그대로 된다.
- 쓰기 막기 트리거(두 표, 두 번째 방어)
  - INSERT 는 함수 안 거래 설정(`app.member_suspension_write`)이 있을 때만 받는다.
  - UPDATE 는 해제 칸 NULL→값, 알림 칸 NULL→값, `first_seen_at` NULL→값, 메모 `deleted_*` NULL→값만 받는다.
  - DELETE 는 부모 프로필이 이미 없거나(CASCADE), `app.member_withdrawal_bypass` 가 `OLD.user_id` 와 같을 때(4-4)만 받는다.

### 4-3. 함수(SECURITY DEFINER, `search_path` 고정, 적지 않으면 service_role 만 EXECUTE)
- **`member_suspension_actor_allowed(p_actor_id, p_permission)`**(내부): 대표이면 통과다. 직원은 그 권한과 `members.view` 가 `admin_permission_grants` 에 모두 있어야 한다. 의존 규칙은 `admin-permissions.ts` 와 같은 예시 묶음으로 대조한다.
- **`suspend_member(p_actor_id, p_user_id, p_scope, p_blocks_download, p_reason_code, p_member_reason, p_internal_note, p_ends_at, p_operation_key)`**
  - 권한은 `members.suspend` 이고, `login_blocked` 는 대표만이다.
  - 대상 확인, 분류 코드가 정책에 있는지, 기간(4-2 규칙)을 본다.
  - 순서: 입력 검사 → 프로필 `FOR UPDATE` → 같은 `operation_key` 행 확인 → 지난 행 닫기 → 넣기(`grant_admin_credits`·`anonymize_member` 선례처럼 키 확인은 잠금 뒤). (3판 PASS 뒤)
    - 같은 키 행이 있고 `user_id`·`scope` 가 요청과 같으면 그 행을 돌려준다.
    - 다르면 `MEMBER_SUSPEND_INPUT_INVALID` 로 거절한다.
  - **`login_blocked` 이면 같은 거래에서** 10번 6-7 과 똑같이 한다. (2판·3판)
    - `auth.users.banned_until = COALESCE(ends_at, now() + interval '100 years')`
    - `auth.sessions`·`auth.refresh_tokens`·`auth.flow_state`·`auth.one_time_tokens` 에서 그 회원 행을 지운다(재설정 링크·진행 중 카카오 흐름 포함).
  - 작업 기록 `member_suspend`
- **잠금 순서(해제·알림 기록 공통, 3판)**: 먼저 프로필을 `FOR UPDATE` 로 잠근다(익명화와 같은 순서). 잠근 뒤 `withdrawn_at` 을 다시 확인하고, 그다음 정지 행을 잠근다. 정지 행 → 프로필 순서로 잠그면 익명화와 교착이 생길 수 있고, 프로필을 잠그지 않으면 익명화 직후의 100년 차단을 지울 수 있다.
- **`lift_member_suspension(p_actor_id, p_suspension_id, p_lift_reason)`**
  - 권한은 `members.suspend` 이고, `login_blocked` 해제는 대표만이다.
  - `login_blocked` 이면 같은 거래에서 `banned_until = NULL` 로 한다. **위 잠금 뒤 `withdrawn_at IS NULL` 일 때만**이다. 탈퇴 회원이면 `MEMBER_SUSPEND_TARGET_INVALID` 로 거절한다. 작업 기록 `member_suspension_lift`. (2판·3판)
- **`record_member_suspension_notice(p_actor_id, p_suspension_id, p_via, p_sent_at, p_summary)`**: 권한은 그 정지를 할 수 있는 권한과 같다(로그인 차단은 대표). 위 잠금 순서를 따른다. 비어 있을 때만 채우고, 작업 기록 `member_suspension_notice_record` 를 남긴다. (2판)
- **`mark_member_suspension_seen(p_user_id)`**: 안내 화면 서버가 부른다. 활성 행의 `first_seen_at` 이 비어 있을 때만 채우고, 작업 기록은 남기지 않는다. 화면 알림의 증빙이다. (2판)
- **`add_member_admin_note(p_actor_id, p_user_id, p_body)`**
  - 권한은 `members.memo` 다.
  - 대상 확인: 있음, 관리자 아님, `withdrawn_at IS NULL`. 아니면 `MEMBER_NOTE_TARGET_INVALID` 다. 프로필은 `FOR SHARE` 로 잠가 익명화와 겹치지 않게 한다. (2판)
- **`delete_member_admin_note(p_actor_id, p_note_id)`**: 작성자 본인이나 대표만 지운다.
- **`member_active_suspension(p_user_id)`** → jsonb 또는 NULL(서버 가드·안내 화면용, STABLE)
- **`member_refund_deadlines(p_user_id)`** → `{ paidBalance, earliestCreditExpiry, chargeRefundUntil, materialRefundUntil }`(읽기만, 6-2 표시용) (2판)
  - 기한 계산은 기존 환불 판정 함수의 값을 그대로 쓴다. 규칙을 새로 쓰지 않는다.
  - 구현 때 쓸 수 있는 함수를 확인하고, 없으면 '규칙을 옮기지 않고 이 표시는 뺀다'를 검증에 올린다.
- **`get_my_member_gate()`** → `{ missingRequired, restriction: null | { scope, blocksDownload, endsAt } }`
  - **authenticated EXECUTE**, `auth.uid()` 기준이다. 동의 부분은 `get_my_missing_required_consents()` 를 그대로 부른다.
- **`save_member_suspension_policy(p_actor_id, p_expected_revision, p_value)`**
  - 대표만 저장하고, revision 이 다르면 거절한다(15번 저장 함수와 같은 틀).
  - 확인하는 것: 분류 코드 형식, 각 분류의 `blocksDownloadDefault` 가 boolean 으로 있음(3판 PASS 뒤), 문구 길이, `maxRestrictedDays`(1~365), 쓰는 중인 코드를 지우지 않음 작업 기록 `member_suspension_policy_update`
- **작업 기록 내용 규칙(2판)**
  - `member_suspend`·`member_suspension_lift`·`member_suspension_notice_record`·`member_note_*` 의 `p_reason` 은 NULL 이다.
  - details 에는 `suspension_id`(또는 `note_id`)·`scope`·`blocks_download`·`reason_code`·`ends_at`·`notified_via` 와 자유 글마다 **글자 수만** 넣는다. sha256 같은 지문은 넣지 않는다. 짧은 글은 지문으로 원문을 맞혀 볼 수 있기 때문이다(10번과 같은 관례). (3판)
  - 회원 사유·내부 메모·해제 사유·알림 요약·메모 본문은 넣지 않는다. 표를 지우거나 익명화해도 범위·분류·기간·처리자·시각은 작업 기록에 남는다(Q9·L4 의 전제).

### 4-4. 탈퇴와 맞물림: `profiles` AFTER UPDATE OF `withdrawn_at` 트리거(2판)
- `withdrawn_at` 이 NULL→값 으로 바뀔 때만 돈다(`anonymize_member` 6-6 안, `app.member_withdrawal_bypass` 가 켜진 거래).
- 하는 일: 그 회원의 `member_admin_notes` 와 `member_suspensions` 를 모두 DELETE 한다(Q9 (나)). 남는 것은 작업 기록의 범위·분류·기간·처리자·시각·글자 수다(자유 글·지문 없음). (3판) 활성 로그인 차단의 `banned_until` 은 바로 뒤 6-7 이 100년으로 덮는다.
- **이 트리거는 예외를 내지 않는다.**
  - DELETE 만 하므로 길이 CHECK·가림 문구 문제가 생기지 않는다.
  - 쓰기 막기 트리거는 bypass 설정이 `OLD.user_id` 와 같을 때 이 DELETE 를 받는다.
  - 혹시 모를 오류를 삼키지는 않는다. 대신 리허설에서 실제 `anonymize_member` self·owner 두 경로로 확인한다(S8).
- Q9 가 (가)로 정해지면 이 절은 'DELETE 대신 범위·분류·시각만 남기고 자유 글을 지움'으로 바뀐다. 그때는 가림 값 `COALESCE(NULLIF(btrim(redactionMask), ''), '[가림 처리됨]')` 과 `lift_reason` 도 가림 대상에 넣는다.
- 런북에서 '메모를 보관함으로 옮기기' 단계는 두지 않는다. 익명화 전에는 보관함 함수가 거절하고, 처리방침 근거도 없다.

### 4-5. 권한 저장 함수와 설정 행
- **`replace_admin_permission_grants` 를 다시 정의**한다. 권한 목록 배열에 `members.memo`·`members.suspend` 를 더하는 것 말고는 그대로다. 4-1 md5 확인 뒤 CREATE OR REPLACE 한다(20261118120000 과 같은 방식). (2판)
- **설정 행 `member_suspension_policy`**: 9절 초안, `maxRestrictedDays: 30`, `revision: 1`, `ON CONFLICT (key) DO NOTHING`
- RESTRICTIVE 정책 `system_settings_member_suspension_policy_no_client_write`. 표 잠금 문장이라 새벽 창에서 하고, VERIFY 는 이름 붙인 별도 DO 블록에 둔다.

### 4-6. VERIFY 와 되돌리기
- **VERIFY**
  - 표·RLS(정책 0)·부분 UNIQUE·트리거 3개(쓰기 막기 2, 탈퇴 1)
  - **service_role 에 두 표의 쓰기 권한이 없음**(2판)
  - EXECUTE 대상(`get_my_member_gate` 만 authenticated)
  - 권한 함수 목록에 두 키, 설정 행, RESTRICTIVE 정책(별도 블록)
- **되돌리기** `supabase/rollback/20261214100000_member_suspension_down.sql`(2판)
  - 머리 확인
    - 활성 정지 0건
    - `scope = 'login_blocked'` 이면서 `banned_until` 이 남은 탈퇴 안 한 회원 0건
    - `members.memo`·`members.suspend` 권한 행 0건(있으면 대표가 먼저 회수)
    - `replace_admin_permission_grants` 의 지금 md5(prosrc, 4-1 과 같은 방식)가 리허설에서 뽑은 12번 적용 뒤 상수와 같음. 다르면 뒤 묶음이 다시 정의한 것이므로 멈춘다(덮어쓰지 않게). (3판)
    - 13번 묶음이 적용돼 있으면 13번을 먼저 되돌린다(10절). (3판)
  - 지난 정지 이력·메모가 있으면 대표가 내보내기를 확인한 뒤에만 지운다(`c_suspensions_export_confirmed`·`c_notes_export_confirmed`). 뼈대는 작업 기록에 남는다(4-3).
  - 순서: 트리거 → 함수 → `replace_admin_permission_grants` 를 20261118120000 정의로 되돌림 → 정책 → 설정 행 → 표
  - 코드를 먼저 되돌린 뒤에만 실행한다.

## 5. 회원 쪽 코드
### 5-1. 공용 가드 `src/lib/member-suspension-server.ts`(server-only)
- `checkMemberSuspensionForApi(userId, action)` → `null | { status: 403|503, code: 'MEMBER_SUSPENDED'|'SUSPENSION_CHECK_FAILED', message }`
  - `action` 은 `'write'|'download'` 이다. download 는 `blocksDownload` 일 때만 막는다.
  - 실패하면 503 으로 막는다. 문구는 정책 `texts.apiBlocked` 이고, 읽지 못하면 코드의 짧은 대체 문구를 쓴다.
- 부르는 곳은 1절 표의 '막기' 두 줄이다. 동의 가드 8곳은 `checkMemberConsentForApi` 안에서 함께 부른다(응답은 `consentBlockResponse` 모양).
- **다운로드**는 GET 이동이라 막히면 `/mypage/restriction` 으로 303 이동한다. 확인 실패도 `/mypage/restriction?check=failed` 로 303 이동한다('잠시 후 다시 시도' 문구, 날 JSON 없음). (2판)
  - 관리자 진단 `market-download-diagnosis.ts` 와 이름표에 `MEMBER_SUSPENDED` 를 더하고, `tests/market-download-diagnosis.test.mjs` 를 함께 고친다.
- 부르는 자리: 인증 확인 직후, 첫 DB 쓰기·외부 호출 전

### 5-2. 미들웨어(2판: 정지 판정을 동의 제외 목록에서 떼어 냄)
- 화면 GET 에서 `get_my_member_gate` 를 한 번 부르고, 그 결과를 두 판정에 쓴다.
  - **정지 판정**: 최소 제외 `isMemberGateExcludedPath`(순수 함수: `/login`·`/auth/callback`·`/api`·`/admin`·`/_next`·정적 파일)만 빼고 모든 화면에서 한다.
    - `login_blocked`: `sb-` 쿠키·세션 시작 쿠키를 지우고 `/login?error=account_blocked` 로 보낸다(세션 삭제 뒤 남은 토큰에 대한 두 번째 방어).
    - `restricted`: 요청 헤더 `x-member-restriction` 을 붙인다.
  - **동의 이동**: 같은 결과의 `missingRequired` 를 쓴다. 지금의 동의 제외 경로에서는 이동시키지 않는다(동작 그대로). 동의 제외에 `/mypage/restriction` 을 더한다.
- 헤더 처리
  - `buildRequestHeaders` 가 `restriction` 인자를 받는다. 모든 응답 재생성이 값을 넘긴다.
  - 밖에서 온 같은 헤더는 늘 지운다. 정적 파일 분기에서도 지운다.
- 관리자 ID 계정은 판정하지 않는다. 실패하면 통과시킨다(강제는 4-3·5-1).
- **확인 항목**: 세션을 지운 뒤 남은 액세스 토큰으로 `getUser()` 가 실패하는지 운영 시험(10절 6단계)에서 본다.
  - **예상 결과(3판)**: 운영 인증 서버(v2.197.0, `supabase/.temp/gotrue-version`)는 JWT 의 session_id 에 맞는 세션 행이 없으면 `/user` 를 `session_not_found` 로 거절한다. supabase-js 는 이때 `sb-` 쿠키를 지운다.
    - 그래서 기존 탭은 다음 요청에서 **문구 없이 비로그인**이 된다. 보호 화면은 `/login?next=…` 로 간다.
    - 안내 문구는 다시 로그인할 때(`user_banned` → `account_blocked`) 뜬다. 미들웨어의 login_blocked 분기는 `getUser()` 가 통과한 경우의 두 번째 방어다.
  - 예상과 달리 `getUser()` 가 통과하면(토큰 만료까지), 미들웨어가 `/api` 요청에도 로그인 차단 판정을 해 401 을 주게 구현에 더하고 다시 검증한다.
  - 회원 세션으로 부를 수 있는 DB 함수(문의 3개 등)는 남은 토큰으로 최대 1시간 불릴 수 있다. 10번과 같은 수준으로 받아들인다.

### 5-3. 회원 화면
- **한 줄 안내**: `src/app/(solvook)/layout.tsx` **한 곳만** 고친다. 헤더를 보고 위쪽에 `texts.bannerRestricted` + '자세히 보기'를 그린다. `/checkout` 은 그 레이아웃을 다시 내보내므로 자동으로 적용된다. (3판)
- **안내 화면 `/mypage/restriction`**(로그인 필요, 서버가 `member_active_suspension`·`member_refund_deadlines` 로 읽음)
  - 보이는 것: 제목, 시작·끝나는 날, 막힌 것(다운로드 여부 반영), 아직 되는 것, 사유 분류·회원에게 알린 사유, 이의 방법, 환불 기한 안내(`texts.noticeDeadlines`)
  - 처음 열 때 `mark_member_suspension_seen` 을 부른다. 실패해도 화면은 그린다.
  - 정지가 아니면 `noticeNone` 을 보인다. 마이페이지 메뉴에는 정지 중일 때만 링크를 둔다.
- **로그인 화면(2판)**
  - `src/app/auth/actions.ts`: `error.code === 'user_banned'` 이면 `{ code: 'account_blocked' }` 를 돌려준다.
  - `src/app/auth/callback/route.ts`: `errorCode === 'user_banned'` 이면 `error=account_blocked` 로 보낸다.
  - 로그인 화면은 `account_blocked` 를 `texts.loginBlocked` 로 보인다. 영어 원문을 비교하거나 보이지 않는다.
- **막힌 동작**: 구매 확인창·장바구니·충전·후기 쓰기가 `MEMBER_SUSPENDED` 를 받으면 문구와 '자세히 보기'를 보인다. 공용 처리는 `src/lib/consent-client.ts` 옆에 둔다.

## 6. 관리자 쪽
### 6-1. 권한(`src/lib/admin-permissions.ts`, DB 4-5 와 짝)
- `members.memo`: 회원 관리자 메모 쓰기·지우기(requires `members.view`)
- `members.suspend`: 회원 이용 제한·해제(requires `members.view`). 로그인 차단과 그 해제는 대표만이다.
- 메모 보기는 `members.view` 다. 미리 묶음(`admin_permission_presets`)에 넣을지는 대표가 정한다(데이터).

### 6-2. 회원 상세 '이용 정지' 구역과 '관리자 메모' 구역(권한은 화면·서버 액션·DB 세 곳이 같음, 2판)
| 동작 | 권한 |
|---|---|
| 구역 보기, 정지 이력, 메모 보기 | `members.view` |
| 이용 제한·해제, 그 알림 기록 | `members.suspend` |
| 로그인 차단·해제, 그 알림 기록 | 대표 |
| 정지 창의 대기 주문·환불 요청 건수 | `orders.view` 도 있을 때만(없으면 '결제 정보는 주문 조회 권한이 있어야 보입니다') |
| 환불·소멸 기한 날짜와 기한 경고 | `members.suspend`(정지 판단에 필요, 금액 없음) (3판) |
| 유료 크레딧 잔액 | `credits.view` 도 있을 때만(기존 회원 상세 규칙과 같음) (3판) |
| 메모 추가 / 지우기 | `members.memo` / 작성자·대표 |
| 문의 상세 회원 요약의 '정지 중' 배지 | `members.view` |
- **정지 창**
  - 칸: 범위(로그인 차단은 대표에게만), 분류, 다운로드도 막기(분류의 `blocksDownloadDefault` 로 미리 체크, 바꿀 수 있음), 회원에게 알릴 사유, 내부 메모, 끝나는 날(이용 제한은 필수, 최대 일수) (3판)
  - 확인 문구: '막히는 것 / 계속 되는 것'을 보인다. 끝나는 날이 가장 빠른 기한을 넘거나 끝나는 날 없는 로그인 차단이면 3절 (가)(나)(다) 경고를 보인다. 로그인 차단이면 이메일에 넣을 기한 안내 초안(`ownerMailDeadlines`)도 보인다. `underage` 면 3절 안내를 보인다. (3판)
- **활성 정지의 계속 경고**: 활성 정지가 남은 기한을 넘기면(끝나는 날 없는 로그인 차단 포함) 정지 구역 위에 가장 빠른 기한 날짜와 `adminDeadlineWarning` 을 계속 띄운다. 정지 창에서만 보이는 것이 아니다. (3판 PASS 뒤)
- **알림 기록 창**: 수단·보낸 시각·요약을 받는다. 로그인 차단 뒤 알림 기록이 없으면 구역 위에 경고를 띄운다. 이용 제한은 `first_seen_at` 을 보인다.
- **메모 구역**: 최신 순, 위에 `texts.adminMemoGuide` 를 보인다. 탈퇴 회원에게는 [메모 추가]를 숨기고 '탈퇴 회원 기록은 보관함 추가 기록으로'를 보인다.
- **10번 탈퇴 패널과 이어지기(3판)**
  - 활성 정지가 있거나 메모가 있으면 10번 패널 위에 '익명화하면 정지 기록 N건·메모 N건이 지워집니다(필요하면 먼저 내보내기)'를 띄운다. 건수는 앱에서 따로 센다(10번 함수는 고치지 않음).
  - 탈퇴 회원의 정지 구역에는 '탈퇴로 지워짐 · 범위·분류·기간은 작업 기록'을 보인다.
  - 회원 상세 프로필 조회(`admin-member-detail-server.ts:245`)에 `withdrawn_at` 을 더한다. 직원 화면에서도 [메모 추가]·[정지]를 숨기는 판정에 쓴다.
- 회원 목록(`/admin/users`)에 '정지' 배지와 '정지 중만 보기'를 둔다.

### 6-3. 문구 편집 화면(대표 전용)
- 위치: `/admin/users` 위쪽 접는 카드 '이용 정지 안내 문구·사유 분류'. 서버 액션은 `assertAdminActionPermission('owner')` 로 막는다.
- 칸: 9절 문구 키 전부, 사유 분류(코드·이름·관련 조항·다운로드 막기 기본값 체크, 추가·순서·숨김, 쓰는 중인 코드는 숨김만), 최대 정지 일수 (3판 PASS 뒤)
- [미리보기]는 표시만 한다. 저장은 `save_member_suspension_policy` 로 하고, revision 충돌을 알린다. 저장 뒤 `revalidateTag(KEY, { expire: 0 })` 를 부른다.

### 6-4. 작업 기록 종류(`src/lib/admin-audit-log.ts`)
- `member_suspend` 회원 이용 정지
- `member_suspension_lift` 회원 이용 정지 해제
- `member_suspension_notice_record` 정지 알림 발송 기록
- `member_note_add` 회원 관리자 메모 추가
- `member_note_delete` 회원 관리자 메모 삭제
- `member_suspension_policy_update` 이용 정지 안내 문구 수정
- 인증 반영 경보·다시 시도는 없다(같은 거래, 2판).

## 7. 약관·처리방침과의 순서 문제
- **이번 묶음은 약관·처리방침·가입 동의 문구를 바꾸지 않는다.** 정지는 이용약관 9조·7조④·17조, 환불정책 9절로 한다.
- 처리방침 항목 추가는 Q9 다.
  - (가)는 12-10 게시 전에 10번 스크립트를 고치고 리허설을 다시 해야 한다.
  - (나)는 01-11 뒤 다음 개정(30일 고지) 때다.
  - 2026-12-10 무렵~2027-01-11 에는 15번 잠금 트리거가 세 문서와 동의 terms·privacy 를 막는다. 10번 시행 스크립트는 처리방침 md5 를 대조하므로, 그 사이에 따로 고치는 길은 없다.
- 정지 중 탈퇴를 막는 안(Q7 의 다른 답)도 12조① 을 고쳐야 하므로 같은 순서 문제가 생긴다.

## 8. 함께 고칠 문서(구현 커밋)
### 8-1. 런북 새 절 'RB-12 회원 이용 정지·해제'(0-1 구성: 언제 / 무엇을 본다 / 무엇을 한다 / 누가 / 고객 안내 문구)
- 언제: 8조 금지행위를 확인했거나 의심될 때. 도용 신고는 로그인 차단, 그 밖은 이용 제한이 먼저다. `underage` 는 3절대로 바로 넘긴다.
- 무엇을 본다
  - 진행 중 결제·환불 요청, 근거(다운로드 기록·문의·결제)
  - 6-2 의 환불·소멸 기한. 정지가 기한을 넘기게 되거나 끝나는 날 없는 로그인 차단이면 3절 (가)(나)(다)에서 고르고 메모에 적는다.
  - 회사가 먼저 시작하는 해지·삭제 경로는 없다. (나)와 `underage` 는 회원·법정대리인의 요청을 받아 10번 절차로 처리한다(3절). (3판)
  - 로그인 차단 중 이메일·전화로 받은 환불·탈퇴 요청은 접수 시각을 메모에 적고 3절 규칙대로 처리한다. 충전 환불은 대리 접수 경로가 없으므로 3절의 접수 시각 4단계를 따른다. (3판)
  - 활성 로그인 차단은 가장 빠른 기한 전에 다시 확인한다. (3판 PASS 뒤)
  - (나)·`underage` 로 요청을 기다리는 이용 제한은 끝나는 날 전에 다시 확인한다. 요청이 여전히 없으면 만료 뒤 바로 같은 사유로 새로 정지하고 메모에 남긴다(이용 제한은 최대 일수 뒤 저절로 풀리기 때문). `underage` 의 최대 일수를 따로 둘지는 L6 답에 맡긴다. (3판 PASS 뒤)
- 무엇을 한다
  - 정지한 뒤 알림을 기록한다(로그인 차단은 이메일 + 요약).
  - 이의는 1:1 문의로 받는다. 그 문의 번호와 검토 결과를 메모에 적고, 결과를 회원에게 답한다(9조②). 해제할 때 해제 사유를 적는다.
  - 범위·기간을 바꿀 때는 해제한 뒤 다시 정지한다.
- 조항 번호는 '해지: 현행 12조③ / 2027-01-11부터 12조④'로 함께 적는다.
- 탈퇴 요청이 오면 10번 절차대로 한다. 익명화하면 정지·메모가 지워진다(남길 것은 작업 기록 뼈대뿐).
- 고객 안내 문구(12절): '이용 제한 알림', '로그인 차단 알림', '이의 검토 결과'
- RB-11 10-11 열람 요청: 관리자 메모·정지 기록도 열람 대상인지 확인한다(L5).

### 8-2. 운영 개선 계획 `docs/admin-operations-improvement-plan.md` 154줄을 '`members.memo`·`members.suspend`(12번 묶음)'로 고친다. (2판)

- 13번 계획 `docs/plan-bundle13-cs-tools.md` 16절은 이미 '12번은 `anonymize_member` 를 고치지 않고 트리거만 더함, 12번 먼저, 13번 파일 시각은 그 뒤'로 맞게 적혀 있어 고칠 것이 없다(3판, 2판 DB minor 의 '292줄' 지적은 옛 서술 기준).

### 8-3. 작업 순서표: 12번 행·진행 기록에 계획 링크를 달고, 후속 과제 '관리자 비밀번호' 줄을 0절 끝 내용으로 고친다.

## 9. 문구 초안(DB `member_suspension_policy.texts`, 최종은 대표가 6-3 에서)
- `bannerRestricted`: 이 계정은 이용이 제한되어 충전·구매 등 일부 기능을 쓸 수 없습니다.
- `noticeTitle`: 계정 이용 제한 안내
- `noticeIntro`: 이용약관 제9조에 따라 이 계정의 이용을 제한했습니다. 제한 내용과 사유는 아래와 같습니다.
- `noticeBlockedList`: 크레딧 충전, 자료 구매·장바구니 담기, 구매 후기 작성·추천
- `noticeBlockedDownload`: 자료 다운로드
- `noticeAvailableList`: 1:1 문의, 결제·크레딧·구매 내역 보기, 충전·자료 환불 신청(정해진 기간 안의 건), 내 후기 삭제, 선택 동의 관리, 회원 탈퇴
- `noticeDeadlines`: 충전 환불은 결제 다음 날부터 7일 안에 크레딧을 쓰지 않은 건, 자료 환불은 구매 뒤 30일 안에 받지 않은 자료만 신청할 수 있습니다. 기한이 걱정되시면 1:1 문의로 알려 주세요.
- `noticeObjection`: 제한 내용에 이의가 있으시면 1:1 문의나 화면 하단의 고객센터 연락처로 알려 주세요. 회사는 내용을 검토해 제한을 유지·변경·해제하고 결과를 알려 드립니다.
- `noticeUntilLifted`: 해제할 때까지
- `noticeNone`: 지금 이 계정에는 이용 제한이 없습니다.
- `noticeCheckFailed`: 이용 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.
- `apiBlocked`: 이용이 제한된 계정이라 이 기능을 쓸 수 없습니다. 자세한 내용은 '계정 이용 제한 안내'에서 확인해 주세요.
- `loginBlocked`: 이 계정은 이용약관 제9조에 따라 로그인이 제한되었습니다. 이의, 충전·자료 환불, 탈퇴는 화면 하단의 고객센터 이메일·전화로 신청하실 수 있으며, 접수한 시각을 신청 시각으로 봅니다. 충전 환불(결제 다음 날부터 7일 안, 쓰지 않은 건)과 자료 환불(구매 뒤 30일 안, 받지 않은 자료)은 기간이 정해져 있으니 서둘러 연락해 주세요. (3판)
- `ownerMailDeadlines`(대표 이메일에 붙이는 틀): 고객님 계정의 가장 빠른 기한은 {기한 종류} {날짜}입니다. 이 메일에 답장하거나 고객센터로 전화하시면 접수한 시각을 신청 시각으로 보고 충전·자료 환불과 탈퇴를 처리해 드립니다. (3판)
- `adminMemoGuide`: 확인한 사실과 처리 내용만 적어 주세요. 새로 알게 된 개인정보(주민등록번호·계좌번호 등)는 적지 마세요. 회원이 열람을 요청하면 보여 줄 수 있습니다. 탈퇴하면 메모는 지워지고, 작업 기록에는 글자 수만 남습니다. (3판)
- `adminSuspendConfirm`: 정지해도 진행 중인 결제 통보와 환불은 그대로 처리됩니다. 회원에게 알릴 사유는 회원 화면에 그대로 보입니다.
- `adminDeadlineWarning`: 정지 기간이 이 회원의 환불·소멸 기한을 넘습니다. 기한 전 해제, 계약 해지와 환불, 만료 연장 가운데 하나를 정해 메모에 적어 주세요(런북 RB-12).
- `adminUnderageGuide`: 만 14세 미만 가입은 정지를 임시 조치로만 쓰고, 미성년자 결제 취소 안내와 탈퇴 처리로 바로 넘겨 주세요.
- **사유 분류 초안**(`reasonCategories`, 코드·`blocksDownloadDefault` 모두 데이터, 3판)
  - `account_misuse`: 계정 도용·양도·공유(제4조②), 다운로드 막기 기본 체크
  - `material_sharing`: 구매 자료 무단 공유·게시(제7조), 다운로드 막기 기본 체크
  - `scraping`: 자동 수집(제8조), 다운로드 막기 기본 체크
  - `payment_abuse`: 결제·환불·크레딧 악용(제8조, 환불정책 9절), 기본 해제
  - `operation_interference`: 서비스 운영 방해(제8조), 기본 해제
  - `underage`: 만 14세 미만 가입 확인(제4조①), 기본 해제
  - `other`: 그 밖의 약관·법령 위반(제9조), 기본 해제

## 10. 배포 순서
**원칙**
- 실회원이 있고 localhost 도 운영 DB 를 쓴다. 표 잠금 문장은 새벽 짧은 창에서 하고, localhost 에서는 정지·메모·저장을 누르지 않는다.
- **DB 를 먼저 적용한다.** 새 가드는 함수가 없으면 막도록 짜여 있어서, 코드가 먼저 나가면 모든 구매가 막힌다. 옛 코드는 새 표·함수를 읽지 않는다. 다만 다시 정의한 권한 저장 함수는 옛 화면에서도 그대로 동작한다(목록만 늘어남).
- 15번 일정(12-05~12-10)과 겹치지 않게 DB 적용은 12-10 고지 시작 뒤로 잡는다. Q9 가 (가)면 10번 스크립트 수정·리허설을 15번 게시 전에 먼저 끝낸다.
- **13번 묶음과의 순서(3판)**
  - 12번을 먼저 적용한다. 13번 파일 시각(`20261215…`)은 12번(`20261214100000`) 뒤다. 13번 계획 16절과 같다.
  - 13번 리허설(익명화 경우 포함)은 12번이 적용된 상태에서 돌린다.
  - 되돌릴 때는 13번부터 되돌린다.
  - 일정이 바뀌어도 파일 시각은 적용 순서를 지켜 다시 정한다.
- 고지 기간(~01-11)에 12번 배포를 되돌릴 때는 15번이 들어 있는 배포로만 되돌린다(15번 10절).

**순서**
1. 계획 검증 PASS(4관점) → 구현 → 계약 시험(11-1) → 독립 검증 PASS
2. 리허설(11-2, 운영 DB, BEGIN…ROLLBACK, 새벽): 적용 + S1~S13 → 되돌리기 → 다시 적용. 남은 것 0건
3. **(대표 승인) 새벽 DB 창 10분 안**: 마이그레이션만 적용하고, 읽기 조회로 확인한다.
4. 로컬 확인(쓰기 없음): 개발 전용 미리보기(`MEMBER_RESTRICTION_PREVIEW=1`, 조건 셋은 15번 10-1 과 같음). 나(Claude in Chrome) → 대표
5. push·배포(대표 결정). 배포 직후 정지 없는 회원 경로에 가드 503·오류 경보가 없는지 본다.
6. **운영 시험(대표 승인, 결제 기록 없는 시험 계정 1개)**
   - 이용 제한(다운로드 막기 켬·끔) → 막힘·열림 확인 → 해제
   - 로그인 차단 → 기대값을 나눠 본다. 기존 탭은 다음 요청에서 문구 없이 비로그인(5-2 예상 결과), 새 이메일·카카오 로그인은 `account_blocked` 문구 → 해제 → 다시 로그인 (3판)
   - 작업 기록 줄, `banned_until` NULL 을 확인한다.
7. 문구 확정: 대표가 클라이언트와 정한 뒤 6-3 에서 한다.

**되돌리기**
- 코드만 되돌리기: 이용 제한 강제가 사라진다. 로그인 차단은 DB(`banned_until`)에 남는다. 먼저 해제하거나, 런북대로 확인한다.
- DB 되돌리기: 4-6. 코드를 먼저 되돌린 뒤에만 한다.

## 11. 시험
### 11-1. 계약 시험 `tests/bundle12-member-suspension-contract.test.mjs`(node --test)
- **전수**: `src/app/**/route.ts` 전부와 `'use server'` 파일 전부를 훑어, 각 메서드·파일이 1절 표의 한 줄에 있어야 통과한다. (3판) '막기'는 가드를 인증 직후·첫 쓰기 전에 부르고, '열기'는 부르지 않는다.
- 결제 통보·지급·환불·대조 코드와 DB 결제 함수가 정지를 보지 않는다.
- 다운로드
  - 막힘 → 303 `/mypage/restriction`, 확인 실패 → 303 `?check=failed`
  - `blocksDownload = false` 면 통과
  - 진단 함수에 `MEMBER_SUSPENDED` 가 있다.
- 미들웨어(2판)
  - `isMemberGateExcludedPath` 예시
  - `/library`·`/mypage/support`·`/checkout/payapp/result` 에서도 restricted 는 헤더가 붙는다. login_blocked 는 `getUser()` 가 통과한 경우(두 번째 방어)에 `/login?error=account_blocked` 로 간다. (3판)
  - 동의 이동은 그 경로에서 일어나지 않는다.
  - 헤더를 늘 지우고(정적 분기 포함), 모든 응답 재생성이 restriction 을 넘긴다. 관리자 ID 는 판정하지 않고, 실패하면 통과한다.
- 로그인 오류: `user_banned` 코드(이메일 액션·카카오 콜백) → `account_blocked`. 영어 원문을 비교하지 않는다.
- 권한: 새 두 키·`requires`, DB 의존 규칙과 같은 예시 묶음(대표·직원 조합 6가지), 6-2 표의 권한이 guard-coverage 표와 같다.
- 마이그레이션
  - RLS 켬·정책 0, service_role 쓰기 회수, 부분 UNIQUE, DEFINER·`search_path`, EXECUTE 대상
  - `login_blocked` 경로의 `banned_until` 과 auth 네 표 삭제, 해제의 `withdrawn_at IS NULL` 조건
  - 잠금 순서: 해제·알림 기록 함수는 프로필 `FOR UPDATE` 가 정지 행 잠금보다 앞에 있다. `suspend_member` 는 `operation_key` 확인이 프로필 잠금 뒤에 있다. `operation_key` UNIQUE (3판)
  - 작업 기록 `p_reason` NULL, details 에 자유 글·지문 키 없음(키 목록 고정) (3판)
  - `reasonCategories` 의 `blocksDownloadDefault` 를 정지 창이 읽고, 코드에 분류별 기본값이 없다 (3판)
  - 탈퇴 트리거(NULL→값, DELETE 만, RAISE 없음), 쓰기 막기의 bypass·CASCADE 조건
  - 권한 함수 목록이 `ADMIN_PERMISSION_KEYS` 와 같음, RESTRICTIVE, `lock_timeout`, `DROP TRIGGER` 없음, 되돌리기 머리 확인 5개(활성 정지, login_blocked 의 `banned_until`, 권한 행, `replace_admin_permission_grants` md5(prosrc) = 12번 적용 뒤 상수, 13번 마이그레이션 version 없음) (3판 PASS 뒤)
- 문구: 회원 화면 문구는 정책 키로 읽는다. 코드 대체 문구는 `apiBlocked`·`loginBlocked`·`noticeCheckFailed` 셋뿐이다.
- 함께 고칠 시험: `admin-audit-log-contract`(종류 6개), `admin-guard-coverage-contract`, `admin-permissions.test.mjs`(키 목록), `admin-permission-grants-contract`(최신 정의 파일 이름 → 새 마이그레이션, 목록 대조), `market-download-diagnosis`, `admin-member-detail-contract`

### 11-2. 리허설(운영 DB, postgres, 새벽, BEGIN…ROLLBACK, 결과는 임시 표 + 마지막 SELECT)
가짜 회원·관리자·권한 행은 거래 안에서만 만든다.
- S1: 이용 제한 → 활성 값, 작업 기록 1건(reason NULL, details 에 자유 글 없음). 끝나는 날 없음·최대 일수 초과는 거절
- S2: 중복 정지 거절, 같은 `operation_key` 는 첫 행을 그대로 돌려줌(오류 아님) (3판)
- S3: 관리자·탈퇴 회원·본인·가입 미완료는 거절
- S4: 대표가 직원에게 `members.suspend`+`members.view` 를 `replace_admin_permission_grants` 로 저장 → 성공. 직원 정지 성공, 직원 `login_blocked` 거절, `members.view` 없는 직원 거절, 알림 기록 권한
- S5: 로그인 차단 → `banned_until` 값, 그 회원 `auth.sessions`·`refresh_tokens`·`flow_state`·`one_time_tokens` 0행 → 해제 → `banned_until` NULL (3판)
- S6: 기간이 지나면 비활성, 새 정지는 지난 행을 `expired` 로 닫음
- S7: 메모 추가·지우기 권한, 지운 메모가 남음, 관리자 대상 거절
- S8: 정지·메모가 있는 가짜 회원으로 **실제 `anonymize_member`** 를 self·owner 각 1회 부른다 → 성공, 정지·메모 0행, `banned_until` 100년. 그 뒤 메모 추가·로그인 차단 해제는 거절(해제가 탈퇴 차단을 풀지 않음)
- S9: `get_my_member_gate` 를 `request.jwt.claims` 로 흉내 → 동의 부족·정지가 함께 나오고, 다른 회원 것은 안 보임
- S10: 정책 저장 revision 충돌, 쓰는 중인 코드 지우기 거절, `blocksDownloadDefault` 가 빠지거나 boolean 이 아니면 거절, 대표 세션 직접 UPDATE 는 RESTRICTIVE 로 막힘
- S11: service_role 로 두 표에 직접 INSERT·UPDATE·DELETE → 권한 오류
- S12: 완전 삭제처럼 프로필을 지우면 CASCADE 로 정지·메모가 지워짐(쓰기 막기 통과)
- S13: 되돌리기 머리 확인(활성 정지 있으면 멈춤) → 되돌리기 → 남은 객체 0 → 다시 적용

### 11-3. 화면 시험(Claude in Chrome, 내가 먼저 → 대표, 미리보기로만)
- 한 줄 안내(회원 틀, `/checkout` 에서 한 번만 보임), 안내 화면(다운로드 막힘 여부, 끝나는 날, 기한 안내, 확인 실패), 로그인 문구 (3판)
- 관리자 두 구역(권한별 버튼·잔액 숨김, 기한 경고, 끝나는 날 없는 로그인 차단 경고, underage 안내), 10번 패널 위 '지워집니다' 안내, 문구 편집 카드 미리보기 (3판)
- 모바일 폭과 키보드 초점

## 12. 검증 관점
| 관점 | 볼 것 |
|---|---|
| 권한 | 화면·서버 액션·DB 세 곳이 같은지, 권한 저장 함수 목록, 로그인 차단 대표 전용, 6-2 표, 전수 시험 |
| 결제 경로 | 결제 통보·지급·환불·대조를 막지 않는지, 정지 전 결제창, 환불 기한 표시가 기존 판정과 같은지, 가드 503 이 정지 없는 회원에게 생기지 않는지 |
| 법률 | 9조②(알림 증빙·이의 처리), 사용 보류가 소멸이 되지 않는 규칙(Q5·3절), 다운로드 분리(Q2), 탈퇴 뒤 삭제와 처리방침(Q9), underage 파기 |
| 마이그레이션 | 탈퇴 트리거가 `anonymize_member` 를 깨지 않는지(S8), `auth.*` 직접 갱신, 권한 함수 재정의 md5, 잠금 창, 되돌리기 조건 |

## 13. 변호사 확인 질문(대표 할 일 변호사 목록에 '(12번)'으로 더함)
- L1: 9조②의 사유 알림을 화면 안내(처음 연 시각 기록)·대표 이메일(요약 기록)로 하면 충분한가? 조치 전에 미리 알려야 하는 경우가 있나?
- L2: 다운로드를 막을 수 있는 기간은? 정지가 환불·소멸 기한을 넘길 때의 3절 (가)(나)(다)는 적절한가? 해지(현행 12조③·시행판 12조④) 때 남은 유료 크레딧을 8절 계산식으로 환불하면 되나? 지금은 회사가 먼저 시작하는 해지 경로가 없어 회원 요청을 기다리는데 괜찮은가? 로그인 차단 중 이메일로 받은 충전 환불은 대리 접수 경로가 없어 기한이 지나면 별도 SQL 절차로 처리하는데, 이 공백이 문제가 되나? (3판)
- L3(Q9 와 함께, **12-10 게시 전에** 답을 받고 싶음): 정지 기록·관리자 메모를 처리방침 2절 항목·3절 보유 기간에 적어야 하나? 다음 개정까지 1·2절 범위로 좁혀 쓰는 것((나))이 허용되나?
- L4: 탈퇴하면 정지 행·메모는 지우고, 추가만 되는 작업 기록에는 범위·분류 코드·기간·처리자·시각·글자 수가 남는다(근거: 처리방침 10절 관리자 작업 기록). 이것이 맞나? 분류 코드(예: underage·material_sharing)까지 남겨도 되나? 분쟁 대비로 더 남겨야 한다면 처리방침에 무엇을 적어야 하나? (3판)
- L5: 회원이 열람을 요청하면 관리자 메모를 보여 줘야 하나(개인정보 보호법 35조와 제한 사유)?
- L6: 만 14세 미만 가입이 확인됐는데 회원·법정대리인의 요청이 오지 않으면, 회사가 먼저 지울 경로가 없다. 정지를 유지하며 요청을 기다리는 것이 처리방침 11절 '지체 없이 파기'와 맞나? 회사가 먼저 시작하는 삭제 경로를 출시 전에 만들어야 하나? (3판)

## 14. 범위 밖
- 회사가 먼저 시작하는 계약 해지·삭제 경로(L2·L6 답 뒤), 충전 환불 대리 접수 경로, 만료 연장 기능(런북 SQL 절차로) (3판)
- 정지 알림 이메일 자동 발송, 알림함 알림(16번 때 검토)
- 같은 사람 재가입 막기, 메모 고치기·첨부
- 관리자 비밀번호 직접 호출 틈(0절)

## 15. 1판 검증 반영
| 관점·등급 | 지적 | 고친 곳 |
|---|---|---|
| 법률 major | 무기한 정지·다운로드 차단이 환불·소멸 기한을 넘겨 돈을 잃게 함, '환불 신청 된다'가 사실과 다름 | 3절 돈 원칙, Q2(다운로드 따로)·Q5(이용 제한 기간 필수·최대 일수), 4-3 `member_refund_deadlines`, 6-2 경고, 9절 `noticeDeadlines`·`adminDeadlineWarning`, 8-1 |
| 법률 major | 작업 기록에 자유 글이 영구히 남음, `lift_reason` 가림 빠짐 | 4-3 작업 기록 내용 규칙, 4-4(DELETE 로 바꿔 가림 문제 자체를 없앰, (가)면 `lift_reason` 포함), 11-1·S1 |
| 법률 major | 탈퇴 뒤 정지 행을 남길 근거 없음, 메모를 보관함으로 옮기는 단계는 실행 불가 | 4-4 익명화 때 정지·메모 DELETE, 런북 옮기기 단계 삭제, Q9·L4 |
| 법률 major | 01-11 시행판에 항목을 넣는 선택지를 다루지 않음 | Q9 (가)/(나) 비교(지문 8개·리허설 다시 vs 범위 좁힘·삭제), 7절, L3 앞당김. 10번 스크립트는 고치지 않음 |
| 법률 minor | 후기 지우기를 막음 | 1절 표 '열기'로 옮김, 9절 `noticeAvailableList` |
| 법률 minor | 알림·이의 처리 증빙 약함 | 4-2 `first_seen_at`·`notice_summary`, 4-3 `mark_member_suspension_seen`, 8-1 이의 문의 번호를 메모에 |
| 법률 minor | 시행판 12조 번호 바뀜 | 1절·3절·8-1·L2 에 '현행 12조③ / 시행판 12조④', Q7 근거 |
| 법률 minor | underage 를 일반 정지로만 둠 | 3절, 6-2 정지 창, 9절 `adminUnderageGuide`, 8-1 |
| DB major | 탈퇴 트리거가 예외를 내면 익명화 전체가 실패, 가림 문구·CHECK·가르는 방법 미정, S8 이 실제 함수를 안 부름 | 4-4 'DELETE 만·예외 없음', 쓰기 막기의 bypass 조건(4-2), S8 실제 `anonymize_member` self·owner |
| DB major | 인증 서버 해제가 탈퇴 100년 차단을 풀 수 있음, 상태 전이 미정 | 4-3 같은 거래에서 `banned_until`·세션 삭제, 해제는 `withdrawn_at IS NULL` 때만, `auth_ban_state`·재시도·경보 삭제, S5·S8 |
| DB major | 동의 제외 경로에서 정지 판정이 안 됨 | 5-2 정지 판정 분리(`isMemberGateExcludedPath`), 4-3 세션 삭제, 5-2 확인 항목 |
| DB minor | service_role 쓰기 권한이 남음 | 4-2 쓰기 회수, VERIFY·S11 |
| DB minor | 되돌리기 조건 모호 | 4-6 머리 확인 3개·내보내기 상수 2개, 작업 기록 details 에 id·범위 |
| 회원 코드 major | 제외 경로에서 로그아웃·안내 안 됨 | 5-2, 11-1 미들웨어 예시 |
| 회원 코드 major | 로그인 차단이 기존 세션을 안 끊어 열린 API(탈퇴·환불·문의·프로필)를 쓸 수 있음 | 4-3 같은 거래 세션 삭제, 1절 표 주석, 10절 6단계 확인 |
| 회원 코드 minor | `user_banned` 가 로그인 화면까지 오는 길 없음 | 5-3 두 파일 수정, 11-1 |
| 회원 코드 minor | '돈 API 5곳'은 틀림(8곳), 전수 목록 빠짐 | 1절 route·메서드·서버 액션 표, 11-1 전수 |
| 회원 코드 minor | `/checkout` 틀, 헤더 전달·정적 분기, 다운로드 확인 실패 | 5-2 헤더 처리, 5-1 `?check=failed`. `/checkout` 틀은 3판에서 정정(16절) |
| 관리자 코드 major | 권한 저장 함수가 새 키를 거절 | 4-5 재정의, 4-1 md5, 4-6 되돌림, 11-1 시험 2개, S4 |
| 관리자 코드 major | 작업 기록 자유 글 | 위 법률 major 와 같음(4-3 규칙) |
| 관리자 코드 major | 탈퇴 뒤 메모가 남음, 대상 확인 없음 | 4-3 `add_member_admin_note` 대상 확인·`FOR SHARE`, 3절, 6-2, S8 |
| 관리자 코드 minor | 몇몇 동작의 권한 미정 | 6-2 권한 표(알림 기록·대기 건수 `orders.view`·배지), 다시 시도는 없앰 |
| 관리자 코드 minor | 운영 개선 계획 키 이름 | 8-2 |
- 반박한 지적은 없다. 모든 지적을 코드·운영 DB(`replace_admin_permission_grants` 목록, `anonymize_member` 6-7, `redactionMask`, 보관함 거절 조건)로 확인했다.
- 다만 회원 코드 minor 의 '`/checkout` 틀 밖'은 2판 검증에서 틀린 것으로 밝혀졌다(3판에서 정정).

## 16. 2판 검증 반영(3판)
| 관점·등급 | 지적 | 고친 곳 |
|---|---|---|
| 법률 major | 끝나는 날 없는 로그인 차단에 돈 원칙이 빠짐, 차단 회원은 기한 안내·환불 경로에 못 들어옴 | Q5·Q6, 3절(늘 경고, 접수 시각 처리), 6-2 정지 창, 9절 `loginBlocked`·`ownerMailDeadlines`, 8-1, L2(충전 환불 대리 접수 없음) |
| 법률 minor | 회사가 먼저 시작하는 해지·삭제 경로가 없음 | 1절, 3절 (나)·underage, 8-1, L2·L6, 14절 |
| 법률 minor | 다운로드 막기 기본값이 근거와 반대 | Q2, 6-2, 9절 `blocksDownloadDefault`(데이터), 11-1 |
| 법률 minor | 작업 기록의 sha256·남는 뼈대를 사실대로 적지 않음 | 4-3 글자 수만, Q9 (나)·4-4·L4 서술 정정, `adminMemoGuide` |
| DB minor | 12·13 적용 순서, 권한 함수 되돌리기 전 md5 | 10절 13번 순서, 4-6 머리 확인 2줄. 13번 계획 '292줄' 서술은 이미 16절에서 맞게 고쳐져 있어 고칠 것이 없음(8-2) |
| DB minor | 해제 함수 잠금 순서 | 4-3 공통 잠금 순서, 11-1 |
| DB minor | `operation_key` 칸·UNIQUE 없음 | 4-2, 4-3, S2 |
| DB minor | `auth.flow_state`·`one_time_tokens` 삭제 빠짐 | 4-3, S5, 11-1 |
| 회원 코드 minor | `/checkout` 틀 사실 오류 | 1절 정정, 5-3 한 곳만, 11-3 한 번만 보임 |
| 회원 코드 minor | 전수 표에 꺼진 기능·공개·로그인 전 경로 빠짐, kakaopay 503 | 1절 표 두 줄·고침, 11-1 범위 |
| 회원 코드 minor | 세션 삭제 뒤 동작 예상(문구 없이 비로그인) | 5-2 예상 결과, 11-1 두 번째 방어, 10절 6단계 기대값 |
| 관리자 코드 minor | 작업 기록 sha256 | 위 법률 minor 와 같음 |
| 관리자 코드 minor | 기한·잔액 권한 불일치 | 6-2 표((나)안: 날짜·경고만, 잔액은 `credits.view`) |
| 관리자 코드 minor | 10번 탈퇴 패널과 연결, 프로필 `withdrawn_at` | 6-2 '10번 탈퇴 패널과 이어지기', 11-3 |

## 17. 3판 검증(PASS) 뒤 minor 반영
| 관점 | 지적 | 고친 곳 |
|---|---|---|
| 법률·DB·코드 minor 6개 | 충전 환불을 접수 시각 기준으로, (나)·underage 만료 전 재확인·재정지, 활성 정지 구역의 계속 기한 경고, `operation_key` 확인을 잠금 뒤로 + 다른 대상 거절, `blocksDownloadDefault` 저장 검사·편집 칸·S10, 되돌리기 머리 확인 5개·md5(prosrc) | 3절 충전 환불 4단계, 8-1 RB-12 두 줄, 6-2 '활성 정지의 계속 경고', 4-3 `suspend_member` 순서, 4-3 저장 함수·6-3·S10, 4-6·11-1 |
