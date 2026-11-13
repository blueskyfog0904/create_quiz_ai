# 관리자 페이지 운영 개선 계획서 (2026-11)

- 작성일: 2026-11-13 · 기준 HEAD 91cac00(main) · 상태: **확정안 — 독립 검증 2명 PASS(R2), 사용자 확인 질문(9절) 답변 대기**
- 목표: 관리자 페이지만으로 **문제마켓**을 실제 운영할 수 있게 한다(대표 1명 + CS 1명).
- 이 문서는 계획이다. 코드·DB는 바꾸지 않았다(예외: 사용자 지시로 한 일 2건, 11절).
- 조사: 코드 3영역(결제·크레딧 / 문의·알림 / 마켓 운영·권한) + 실서버 DB SELECT + 브라우저로 실제 관리자 화면 사용(2026-11-13). 근거는 `file:line` 또는 "DB 확인".

## 0. 기존 문서와의 관계

| 문서 | 관계 |
|---|---|
| `docs/admin-operations-readiness-plan.md`(10-28, "준비 계획") | 분석·결정의 바탕. 10-1절 결정은 2절에서 바뀐 것 외에는 그대로 |
| `docs/admin-implementation-workplan.md`(10-29, "작업계획서") | 단위별 구현 명세(W 번호). 0-2절에 적은 변경 외에는 그 명세를 쓴다 |
| 이 문서 | 두 문서와 어긋나면 **이 문서가 우선**. 두 문서에 있던 단위의 처리는 0-3절 표에 모두 적는다(적히지 않은 채 사라지는 단위가 없게) |

### 0-1. 진행 상태 (2026-11-13 코드·DB 확인)

| 항목 | 상태 | 근거 |
|---|---|---|
| W1-9a 카카오페이 문구, W1-9b 약관(DB-13) | 완료 | e00dbf4, 마이그레이션 20261110116000 |
| 서울 이전 | 완료(2026-11-10) | DB 쓰기 단위의 선행 조건 해소 |
| 페이앱 출시 스위치 | **켜짐**(2026-11-11 05:45:27 UTC) | `payment_runtime_config`: master=true, payapp=true, merchant 설정됨. 준비 계획 Q8의 선행 조건(런북·중지 SQL·경보 통지·1단계)보다 먼저 켜졌다 → 0단계가 급하다 |
| 관리자 지급 RPC | **이미 있음** | `grant_admin_credits(p_user_id, p_amount, p_source_category, p_payment_method, p_operation_key)`(20261110110000, 대상 프로필 잠금·멱등·충돌 규칙 포함), 코드도 호출(`src/lib/credits.ts:422-461`, `api/admin/users/credits/route.ts:14, 52-58`) |
| 그 밖의 W0·W1·W2·W3·W4 | 미구현 | 표식(`deleteOrHideMarketItem`, `kst-period`, `/admin/orders`, `public-subjects`, `admin_audit_log`, `forgot-password`, `admin_role` 등) 0건. 영어 공개 상품 1개·영어 광고 3개 활성(W1-7b 미완) |
| W0-8 고객 메일(SMTP) | 미확인 | `auth.users` 복구 메일 발송 0건(DB 확인). 9절 Q-A |

### 0-2. 작업계획서 명세에서 바뀐 것 (구현 전 반드시 반영)

기준 HEAD가 25bad66 → 91cac00으로 바뀌었다. **모든 줄 번호·건수는 구현 직전에 다시 확인**하고, 아래는 설계 수준에서 달라진 것이다.

| 단위 | 바뀐 점 |
|---|---|
| 표시 이름을 쓰는 모든 단위(W1-2, W1-3b, W3-1a/b, W3-2, U2-1) | `formatMemberDisplayName(email, displayTag)`로 바뀜(91cac00) → 회원 조회에 `display_tag` 포함. W1-2 컬럼 목록에 `display_tag` 추가 |
| W1-3b | 검증값 "pending 1, approved 1" → 현재 1행(approved). UUID 원문 출력 위치는 `market-refunds-client.tsx:102` |
| W1-4 | 처리 대기 건수를 처음부터 공용 함수 `getAdminWorkSummary()`(`src/lib/admin-work-summary-server.ts`)로 만든다. U1-2·U2-2가 같은 함수를 쓴다(세 번 고치지 않게) |
| W1-5 | `users-client.tsx` 자체 지급 모달에 멱등 키가 추가됨(`:87-94`) — 줄 범위 재확인. 동작 없는 "엑셀 다운로드" 버튼(`credits-client.tsx:176-179`)은 여기서 제거 |
| W1-6 | "새 헤더는 잔액을 한 번만 조회"는 3bfac22로 달라짐(`preview-header.tsx:57-98`이 이동·탭 복귀·이벤트에 반응). 레이아웃 재export와 결과 화면 이벤트 발송은 그대로 유효. 80c9d9f(결제 화면 재디자인)는 `checkout-client.tsx`만 바꿔 충돌 없음 |
| W3-3a, W3-3b | "현재 payapp=false"와 "출시 전제 상태로 되돌려 확인" 절차는 스위치가 켜진 지금 맞지 않음. W3-3b(DB-5)는 **폐기**하고 U0-4(DB-A1)로 대체 |
| W3-3c | '통지 실패'·'통지 작업 멈춤' 카드는 U0-4의 전송 상태를 읽는 것으로 바꿔 U1-2에 포함 |
| W3-5b/c | 새 함수가 아니라 **기존 `grant_admin_credits`의 개정**(U3-6, DB-6'). 작업계획서의 "현재" 서술은 12d5936·20261110115000 이전 상태 |
| W3-8a | `preview-header.tsx` 줄 번호가 40여 줄 밀림 |
| W2-1 | `requiredRole`·`legacyNote` 대신 `permission`·`feature` 필드(4-1, 4-2절) |
| W2-4 | **폐기**(레거시 목록·경고 띠) → U0-5 접근 차단 |
| W2-7 | 메뉴 이름 바꾸기는 `site.manage` 권한으로 |
| W4-1~W4-4, W4-7 | 계정별 권한(4-1절, U3-2~U3-9)으로 대체. W4-6은 유지 |

### 0-3. 두 문서에 있던 단위의 처리

| 단위 | 처리 |
|---|---|
| W0-6 런북, W0-7 판매 중지·재개 SQL(DB-0), W0-9 외부 감시 | **0단계**로(이전에는 스위치 전 조건이었음) |
| W1-7a/b/c 영어 숨김(DB-3b) | **취소**(2026-11-13 사용자 결정: 국어·영어 문제마켓 모두 운영) |
| 준비 계획 5-1 회원 상세, 5-13 대시보드 2차 | 2단계로 앞당김(U2-1, U2-2) |
| 5-2 크레딧 수동 회수 | **3단계로 앞당김**(U3-7) — CS가 지급 권한을 받기 전에 되돌릴 수단이 있어야 함 |
| 5-4 문의 추가 답변·이력·검색·페이지 | 검색·페이지는 2단계(U2-3), 대화 이어가기는 4단계(U4-1) |
| 5-5 요금제 '판매중' 스위치 확인 창 | 0단계 W1 묶음에 포함(U0-6) — 판매가 켜진 지금 실수로 끄거나 켜면 바로 고객에게 보임 |
| 5-6 결제 이력 회원 탈퇴(익명화) | 5단계(U5-7). 그 전에는 런북 RB-11(대표 처리) |
| 5-7 마켓 직권 환불 | 5단계(U5-3). 그 전에는 런북 RB-7 |
| 5-9 날짜·금액 표기 통일 | 6단계 |
| 5-10 관리자 2단계 인증 | 6단계 유지. 단 9절 Q-K로 시점 재확인 |
| 5-11 약관 저장 충돌 보호 | 6단계(약관을 고치는 사람이 대표 1명이라 급하지 않음) |
| 5-12 CSV 내보내기 | 5단계(U5-1) |
| 4-5 작업 기록 확대·조회 화면 | 3단계(U3-5) |
| 4-7 회원 개인정보 마스킹·열람 기록, Q9 접속기록 법령 확인 | **보류**. 사유: 법령 확인(대표)이 끝나지 않음. 결과가 "필요"면 3단계 U3-5에 열람 기록을 더한다(Q-L) |
| 6단계(P2) 나머지 | 6단계 유지 |

## 1. 현재 문제 요약

1. **데이터·보안 위험**(DB 확인): 구매 이력 상품 완전 삭제 시 주문·권한·다운로드 기록·환불·후기 연쇄 삭제(`market_items` 참조 FK 13개 CASCADE) / 사용자가 자기 문의의 `admin_response`·`status` 직접 수정 가능 / `source_configs` RLS 꺼짐 / 영어 테스트 상품 1개·광고 3개가 공개 상태 / `test` 요금제(1,000원)가 누구에게나 판매 중.
2. **관리자에게 알려 주는 장치가 없다**: 관리자 화면에 배지·실시간 알림·소리 없음. 새 문의는 슬랙 1곳(`src/lib/slack.ts`, 실패 무기록, 회원 이메일·전화를 슬랙으로 보냄), 환불 요청·결제 경보·판매 자동 중지는 통지 없음. 판매 중지·재개 수단(SQL)과 런북도 아직 없다.
3. **CS의 출발점이 없다**: 결제 주문 조회, 마켓 구매 조회, 회원 상세 화면 없음.
4. **틀린 표시**: 사용자 관리 잔액 전원 0(없는 `user_credits`), 크레딧 관리 유형·환불 통계(없는 `transaction_type`), 대시보드(없는 `admin_logs`, 테스트 `payment_history`, 고정 "정상 작동 중").
5. **권한이 `is_admin` 하나**: 권한을 나눌 수 없고, 지급자·사유가 남지 않으며, 잘못 지급해도 회수 수단이 없다. 가드 없는 서버 액션(`problem-types/actions.ts`, `api/admin/labels/actions.ts`)도 있다.
6. **메뉴 31개 중 15개가 쓰지 않는 기능**, 운영 메뉴가 맨 아래. `/admin/ai-question-generation-runs`는 열기만 해도 만료 로그를 영구 삭제한다. 화면마다 여백·제목·알림 방식이 다르고 모바일에서 사이드바가 본문을 덮는다.
7. 사용자 쪽: 마켓 헤더에 알림 벨 없음, `/checkout`은 예전 헤더, 비밀번호 찾기 없음, 문의는 답변 1회로 끝·첨부 불가.

## 2. 결정 사항

### 2-1. 이번에 정해진 것 (2026-11-13 사용자)

| # | 결정 | 기존 결정과의 차이 |
|---|---|---|
| N-1 | 쓰지 않는 기능의 관리자 메뉴는 숨기고 **페이지 접근도 막는다** | 준비 계획 Q1 (b)를 대체, W2-4 폐기 |
| N-2 | CS 권한을 분리하고 **대표 관리자가 계정별로 권한을 골라 부여** | W4의 "owner/cs 두 등급 고정"을 대체. Q14·Q-11·Q-13은 권한 항목으로 흡수 |
| N-3 | 대기 중이던 마켓 환불 요청 1건은 테스트 데이터 → 삭제 | 완료(11절) |
| N-4 | 구매자 표시 이름 배포 | 완료(91cac00) |

### 2-2. 이 문서의 가정 — 9절에서 다시 묻는다

| # | 가정 | 9절 |
|---|---|---|
| A-1 | 관리자 알림 = 관리자 화면 + 슬랙, 사용자 통지 = 사이트 알림 + 이메일. 알림톡·문자는 범위 밖 | Q-G, Q-A |
| A-2 | 판매 중지·재개는 화면 버튼 없이 미리 검증한 SQL(준비 계획 Q4 (a)) | Q-I |
| A-3 | ~~영어 문제마켓 미운영 유지~~ → **국어·영어 문제마켓 모두 운영**(2026-11-13 변경) | 사용자 결정. W1-7 취소, 이후 단위는 두 과목 모두 대상 |

### 2-3. 그대로 따르는 기존 결정

상품 삭제 = 이력 있으면 숨김(Q-1), 카카오페이 미사용, 메뉴 묶음 순서·이름안, 관리자 지급 원장 유형 `purchase` 유지(Q-5), 지급 사유가 고객 알림에 보인다는 안내(Q-7), 카카오 가입자 비밀번호 재설정 미발송(Q-8), 권한 해제된 관리자 재부여 화면 없음(Q-12), 결제사 관리자 화면은 대표만(Q12).

## 3. 단계와 순서

```
0단계 긴급
  0A 안전: 문의 RLS, source_configs, 상품 삭제 방지, 접근 차단 (영어 숨김은 취소)
  0B 감지·중지 수단: 런북, 판매 중지·재개 SQL, 관리자 이벤트·슬랙 통지, 외부 감시
  0C 틀린 표시: 사용자·크레딧·환불·대시보드
1단계 알림: 관리자 화면 알림, 사용자 벨·이메일
  (권한 토대 U3-2는 2단계 전에 먼저 — 새 API를 처음부터 공용 검사 함수로)
2단계 조회: 주문·결제 조회, 회원 상세, 대시보드, 비밀번호 재설정
3단계 구조·권한: 메뉴 재편, 권한 적용·부여 화면, 작업 기록, 회수, RLS
   ── 여기까지가 "운영 가능" 최소선. CS 계정은 3단계가 끝난 뒤 발급 ──
4단계 문의 강화    5단계 정산·증빙    6단계 디자인 통일
```

- 0A·0B·0C는 서로 기대지 않아 병행한다. **대표 작업(Q-A 메일 설정, Q-G 슬랙 웹훅, W0-9 감시)은 지금 시작**한다. (W1-7b는 취소 — 영어 테스트 상품·광고의 처리는 대표 결정 대기)
- 3단계가 끝나기 전에는 staff에게 권한을 주지 않으므로(Q-J에 따라 기존 계정이 staff 권한 0개가 될 수는 있다), 권한 검사 적용(U3-3)은 영역별로 나눠 커밋·배포해도 중간 상태의 위험이 없다.

## 4. 새로 정한 설계

### 4-1. 계정별 권한 (N-2)

**원칙**: 권한 항목 목록, 항목 사이의 의존, "어느 화면·API·액션이 어느 항목을 요구하는지"는 코드(규칙). **누가 어떤 권한을 가졌는지와 한도 숫자는 DB(데이터)**.

**계정 종류**
- `owner`(대표 관리자): 모든 권한. 권한 부여·관리자 계정 관리·작업 기록 열람은 대표만(부여할 수 없는 고정 권한).
- `staff`(일반 관리자): 대표가 준 권한만. 새 관리자 계정은 권한 0개 `staff`로 만들어진다.
- `is_admin=true`인데 `admin_role`이 비어 있는 계정(이행 기간에 옛 코드로 만들어진 경우)은 **권한 0개 staff로 취급**한다.

**권한 항목(초안, Q-B)**

| 키 | 할 수 있는 일 | 함께 필요한 권한 | 한도 |
|---|---|---|---|
| `support.manage` | 문의 조회·답변·카테고리 | — | — |
| `content.manage` | 공지사항·FAQ 게시(4단계) | — | — |
| `orders.view` | 충전 결제·마켓 구매 조회 | — | — |
| `members.view` | 회원 목록·상세 조회 | — | — |
| `credits.view` | 크레딧 거래 조회 | — | — |
| `credits.grant` | 크레딧 수동 지급 | `members.view`, `credits.view` | 1회, 하루 |
| `credits.revoke` | 크레딧 수동 회수(U3-7) | `members.view`, `credits.view` | 1회 |
| `refunds.market` | 마켓 환불 승인·거부 | `orders.view` | 1건 승인 한도(거부는 한도 없음) |
| `refunds.payment` | 충전 환불 실행, 결제 수동확인, 경보 해소 | `orders.view` | — |
| `products.edit` | 상품·카테고리·이미지 등록·수정·숨김 | — | — |
| `products.delete` | 이력 없는 상품 완전 삭제 | `products.edit` | — |
| `storefront.edit` | 홈 화면 광고·진열 | — | — |
| `reviews.manage` | 후기 삭제·태그 | — | — |
| `pricing.manage` | 충전 상품(요금제) | — | — |
| `site.manage` | 약관·푸터·로고·메뉴 이름 | — | — |
| `reports.view` | 매출 집계·CSV 내보내기(5단계) | `orders.view` | — |

- **의존 규칙**: 부여 화면은 권한을 체크하면 "함께 필요한 권한"을 자동으로 체크하고, 저장 API는 의존이 빠진 조합을 거부한다. 한도가 있는 권한은 **한도 입력이 필수**(비어 있으면 저장 거부 — "체크했는데 이유 없이 거부되는" 상태를 만들지 않는다).
- **화면이 여러 권한에 걸칠 때**: 환불 관리 화면은 `refunds.market`·`refunds.payment` 중 하나가 있으면 열리고 구역은 각 권한이 있을 때만 그린다. 문의 상세의 회원 요약(잔액·최근 결제·구매)은 `members.view`·`orders.view`가 있을 때만 그 구역을 그리고, 없으면 회원 이메일만 보인다.
- **한도 초과 건**: 마켓 환불이 계정의 승인 한도를 넘으면 승인 버튼 대신 "대표 확인 필요" 표시가 뜨고(거부는 가능), 관리자 이벤트(4-3절) `refund_over_limit`으로 대표에게 알린다.
- **staff 본인 비밀번호**: 관리자 계정 화면은 대표 전용이므로, 사이드바 아래 "내 비밀번호 변경"(현재 비밀번호 확인 후 변경)을 U3-4에 둔다.
- `members.manage`(회원 정지·메모)는 대응 기능이 아직 없어 **항목에서 뺀다**. 기능을 만들 때(6단계 이후) 추가한다.

**DB (DB-P1, 추가형)**
```
profiles.admin_role text null  CHECK (admin_role in ('owner','staff'))
  -- 기존 관리자 4명의 배정은 Q-J(권장: 대표 본인 계정만 owner, admin01~03은 staff 권한 0개)
admin_permission_grants(
  user_id uuid FK profiles ON DELETE CASCADE, permission text, limits jsonb NOT NULL DEFAULT '{}',
  granted_by uuid NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, permission))
  -- RLS on. REVOKE ALL FROM anon, authenticated; GRANT SELECT TO authenticated
  -- SELECT 정책: user_id = auth.uid() 또는 is_owner(). 쓰기 정책 없음(service role로만)
public.is_owner()                    SECURITY DEFINER STABLE, search_path = public, pg_temp
                                     -- profiles.is_admin is true AND admin_role = 'owner'
public.has_admin_permission(p text)  SECURITY DEFINER STABLE, search_path = public, pg_temp
                                     -- is_owner() 또는 (profiles.is_admin is true AND grants에 (auth.uid(), p) 존재)
```
- 재귀 없음 확인: `is_admin()` 소유자가 postgres이고 FORCE RLS 테이블이 0개라, 정책 안에서 SECURITY DEFINER 함수가 `profiles`·grants를 읽어도 재귀하지 않는다(DB 확인). authenticated는 `profiles` UPDATE 권한이 없어 `admin_role`을 스스로 올릴 수 없다.
- `limits` 예: `credits.grant` → `{"per_grant": 1000, "per_day": 5000}`, `refunds.market` → `{"per_request": 5000}`. 키가 없으면 **불가**로 판정한다.
- `permission` 값은 CHECK로 묶지 않는다(항목을 더할 때마다 마이그레이션이 필요해지므로). 서버는 코드 목록에 없는 값을 무시한다. 같은 이유로 작업 기록의 `action`도 CHECK로 묶지 않는다.
- `is_admin = (admin_role is not null)`: 관리자 계정 생성 코드(`admin-accounts-server.ts:99`)가 `admin_role`을 함께 쓰도록 바꾼 뒤 CHECK 제약(DB-P2, 제약형 → 코드 먼저, 적용 전 어긋난 행 0건 확인).
- 권한 해제(W4-6): `is_admin=false`, `admin_role=null`, 그 계정의 grants 행 삭제. 마지막 `owner`의 해제·삭제는 서버에서 거부.

**서버 검사(코드)**
- `src/lib/admin-permissions.ts`(순수): 항목 목록·한글 설명·의존, 등록부(4-2절)와 연결.
- `src/lib/admin-permissions-server.ts`: `getAdminAccess()`(요청당 1회 `cache()` — 역할·권한·한도), 세 가지 가드:
  - `requireAdminPagePermission(key)` — 페이지용: 미로그인 → `/admin/login`, 권한 없음 → "권한 없음" 안내 화면.
  - `requireAdminApiPermission(key)` — route용: 401/403 JSON.
  - `assertAdminActionPermission(key)` — 서버 액션용: redirect 없이 `{ success: false, error }` 반환용 예외.
  - 세 가드 모두 그 키가 속한 기능 묶음이 꺼져 있으면 차단한다(4-2절).
- 적용 범위: **관리자 페이지 39개 전부 + 신규 페이지, `api/admin` route 78개, 서버 액션 파일 9개의 모든 export**. App Router 레이아웃은 경로를 모르고 같은 레이아웃 안의 이동에서는 다시 실행되지 않으므로 **페이지마다** 가드를 부른다. `api/admin/session/route.ts`(로그인 화면의 본인 확인)는 예외 목록에 둔다.
- 화면: 사이드바는 권한 있는 메뉴만 그린다. 권한 없는 버튼은 숨긴다. **숨김은 편의이고, 막는 것은 서버 가드와 RLS다.**

**RLS (DB-P3, 축소형 → U3-3 배포 뒤, 전문 검증 3명)**
- 대상은 관리자 조건이 들어간 **쓰기 정책 47개(43개 테이블) 전부**다. `is_admin()` 호출형 35개와 `EXISTS(profiles.is_admin = true)` 인라인형 12개(`credit_sources`, `payment_history`, `refund_requests`, `system_settings`, `problem_types`, `ai_models`, `ai_provider_connections`, `providers`, `problem_type_default_prompts`, `system_prompts` 2개, `display_labels`)를 함께 다룬다(`is_admin()`만 찾으면 12개가 빠진다).

| 묶음 | 테이블 | 바꾸는 방향 |
|---|---|---|
| 돈 | `credit_sources`, `payment_history`, `market_entitlements`, `market_purchase_orders/lines`, `market_purchases`, `refund_requests`, `market_refund_requests` | 관리자 쓰기 정책 제거(쓰기는 service role RPC로만), 조회는 유지 |
| 상품 | `market_items` 계열 8개 테이블 | `has_admin_permission('products.edit')` |
| 문의 | `support_tickets` UPDATE, `support_ticket_categories` | `has_admin_permission('support.manage')` |
| 알림 | `notifications` INSERT | 관리자 세션 INSERT 2곳(`users/credits/route.ts:62`, `tickets/[id]/route.ts:65`)을 service role로 옮긴 뒤(코드 먼저) 관리자 INSERT 정책 제거. 사용자 본인의 `is_read` UPDATE는 유지 |
| 설정 | `pricing_plans` → `pricing.manage`. `system_settings`·`workspace_settings` 쓰기 → `is_owner()`(홈 화면·푸터 저장은 service role이라 영향 없음 — 작업계획서 F10) | |
| 꺼진 기능 | `problem_types`, `ai_*`, `providers`, `generate_*`, `source_configs`, `display_labels`, `system_prompts` 등 | `is_owner()` |

- **조회 정책은 권한별로 나누지 않는다**(관리자면 SELECT 가능, 14개 정책 유지). 이유: 문의·환불·주문·크레딧·후기 화면이 모두 회원 이메일을 조인하는데, `profiles` 조회 정책을 권한별로 바꾸면 조인 값이 오류 없이 비어 조용히 깨진다. 따라서 **조회 구분은 화면·API 가드로만** 하고, 8절 완료 기준의 "직접 쓰기 거부"는 쓰기에 한정한다. 이 한계(권한 없는 staff가 자기 세션으로 DB를 직접 조회하면 회원 이메일 등을 읽을 수 있음)는 Q-L(마스킹·열람 기록)과 함께 대표가 판단한다.
- 적용 전 47개 정책과 세션 클라이언트 쓰기 경로를 다시 조사해 분류표를 확정하고, 리허설에서 권한 없는 staff의 JWT claims로 묶음별 직접 쓰기가 거부되는지, 화면이 쓰는 세션 조회·쓰기가 계속 되는지 확인한다.

### 4-2. 쓰지 않는 기능 접근 차단 (N-1)

- **대상(준비 계획 2절의 레거시 15개 + 하위 경로, Q-D)**: 문제은행(`/admin/questions/**`, `/admin/question-bank/**`), AI(`/admin/problem-types/**`, `/admin/ai-connections`, `/admin/ai-question-generation-runs/**`), 문제생성(`/admin/generate/**`), 지문(`/admin/passages/**`, `/dashboard/admin/passages/**`), `/admin/source-configs`, `/admin/labels`, `/admin/landing-pages`, `/admin/roles`, `/admin/menu-management`(2차).
- **규칙과 데이터**: 경로 접두 → 기능 묶음의 대응은 코드(`src/lib/admin-features.ts`, 뒤에 등록부로 합침). **꺼진 묶음 목록은 DB** `system_settings` 키 `admin_disabled_features`(예: `["question_bank","ai_generation","generate","passages","legacy_site"]`). 이 값은 로그인한 누구나 읽을 수 있지만(`system_settings` SELECT 정책) 민감하지 않다.
- **세 겹으로 막는다**
  1. **미들웨어**(`src/middleware.ts` — 이미 `/api` 포함 모든 경로에서 실행): `/admin`, `/api/admin`, `/dashboard/admin` 아래 경로가 꺼진 묶음에 속하면 페이지 코드가 실행되기 전에 404(페이지) / 404 JSON(API). 대표 계정도 같다. 설정은 **service role로 읽는다**(`system_settings` SELECT 정책이 로그인 사용자 전용이라, 요청자 세션으로 읽으면 비로그인 요청에서 오류가 아닌 빈 결과가 와서 "꺼진 묶음 없음"이 캐시된다 — `/api/admin/**`는 비로그인 요청도 미들웨어를 지나간다). 60초 메모리 캐시(인스턴스별이라 행을 넣은 뒤 최대 60초 지연). **"행 없음"(= 막지 않음)과 "읽기 오류"(= 묶음에 속한 경로를 막음)를 구분하고, 오류 결과는 캐시하지 않는다**(운영 화면 경로는 묶음에 속하지 않으므로 영향 없음).
     - 차단 API 접두: `api/admin/questions`, `question-bank`, `problem-types`, `problem-type-default-prompts`, `ai-connections`, `ai-models`, `ai-question-generation-runs`, `source-configs`, `providers`(실제 구조와 일치, 운영 화면이 부르는 곳 없음 — R1 검증에서 확인).
  2. **서버 액션**: 페이지를 404로 막아도 액션은 호출되므로, 대상 액션 파일의 모든 export 첫 줄에서 기능 묶음을 검사해 실패를 반환한다 — `problem-types/actions.ts`(5개, 현재 가드 없음), `api/admin/labels/actions.ts`(6개, 가드 없음), `landing-pages/actions.ts`, `roles/actions.ts`, `api/admin/prompts`·`settings` 액션, `menu-management/actions.ts`(2차). **export 자체는 지우지 않는다.**
  3. **사이드바**: 꺼진 묶음의 메뉴를 그리지 않는다(지금은 저장값에 없는 메뉴가 자동으로 다시 붙음 — `admin-sidebar.ts:209-214` — 이 자동 추가에서 꺼진 묶음을 제외).
- **끊으면 안 되는 연결**: `market-products-client.tsx:73`의 `@/lib/generate-menu` import(lib는 건드리지 않음), `admin-sidebar-client.tsx:8`이 쓰는 `renameAdminSidebarMenuAction`(`menu-management/actions` 안에 있지만 **운영 기능**이므로 `site.manage` 권한 검사만 두고 기능 묶음 검사 대상에서 뺀다), 같은 파일의 listboard 액션(문제생성 묶음 — 차단), 관리자 계정 삭제의 `generate_listboard_*` 갱신(lib 호출이라 영향 없음). `api/ai/generate-passages.ts`, `api/ocr/actions.ts`, `api/passages/actions.ts`가 `api/admin/*` 액션을 import하므로 **액션에 검사를 넣기 전에 그 호출 경로가 사용자 쪽에서 실제로 닿는지** 확인하고 결과를 단위 보고에 적는다.
- **2차(메뉴관리)**: `/checkout`이 예전 헤더 설정을 읽지 않게 되고(W1-6) 사이트 로고 저장이 `/admin/footer`로 옮겨진 뒤(W2-6) `legacy_site` 묶음에 메뉴관리를 넣는다.
- **다시 켜기**: 설정 행에서 묶음을 뺀다(마이그레이션). 런북에 한 줄.
- **차단으로 잃는 수단**: AI 연결 키 교체·중지 화면을 대표도 못 연다. 사용자 쪽 예전 생성 기능이 실제로 닿지 않는지 U0-5 검증에서 확인하고, 닿는 경로가 있으면 차단 전에 보고한다.

### 4-3. 관리자 알림 체계

**요구**: 사용자가 문의·환불을 보내거나 결제에 문제가 생기면 관리자가 즉시 안다 — 화면을 보고 있을 때, 다른 탭에 있을 때, 휴대폰만 있을 때.

```
(업무 테이블의 변화)  ──DB 트리거: 이벤트 1행 INSERT만──▶  admin_events (추가 전용)
                                                          ├─ Realtime 구독 ─▶ 관리자 화면: 토스트·소리·브라우저 알림·배지 (1~2초)
                                                          └─ 전송 작업(15초 주기 cron) ─▶ 슬랙 (보통 15초 안, 실패 시 재시도)
건수(할 일)는 이벤트가 아니라 업무 테이블에서 센다 → 이벤트가 빠져도 배지·대시보드 숫자는 맞다
```

**DB (DB-A1, 추가형, 전문 검증 3명: 결제·경보 / pg_net·cron·vault / 마이그레이션·되돌리기)**
```
admin_events(                                   -- 추가 전용(UPDATE·DELETE 없음)
  id uuid PK, kind text NOT NULL, severity text NOT NULL,      -- info | warning | critical
  title text NOT NULL, body text, link text NOT NULL,
  ref_table text, ref_id uuid, required_permission text NOT NULL,
  delivery text NOT NULL DEFAULT 'full',        -- full(슬랙+소리) | screen(화면만: 슬랙·소리 없음)
  dedupe_key text UNIQUE,                       -- 짧은 시간 안의 중복만 막는다(INSERT … ON CONFLICT DO NOTHING)
  created_at timestamptz NOT NULL DEFAULT now())
admin_event_deliveries(                         -- 슬랙 전송 상태(Realtime에 싣지 않는다)
  event_id uuid PK FK, channel text, request_id bigint, requested_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0, delivered_at timestamptz, last_error text, gave_up_at timestamptz)
admin_event_dispatch_state(                     -- 전송 작업 상태 1행
  id boolean PK CHECK (id), last_run_at timestamptz, last_run_error text, last_success_at timestamptz)
admin_event_reads(admin_id uuid PK, last_seen_at timestamptz)
  -- 네 표 모두 RLS on, REVOKE ALL FROM anon, authenticated.
  -- admin_events만 GRANT SELECT TO authenticated + 정책 has_admin_permission(required_permission)
  --   (DB-P1 전에는 is_admin(), DB-P3에서 교체). 나머지 세 표는 service role만
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_events;
```

**이벤트 종류와 발생 조건** — 모든 트리거 함수는 `SECURITY DEFINER`, `search_path = public, pg_temp`, **`admin_events` INSERT 한 줄만** 한다(전송 함수 호출·vault 접근·잠금 없음). 실행 역할이 service role·DEFINER 함수·세션으로 제각각이어도 같게 동작한다.

| kind | 조건 | 권한 | 심각도 | dedupe_key |
|---|---|---|---|---|
| `support_ticket_created` | `support_tickets` INSERT | `support.manage` | info | `ticket:<id>` |
| `market_refund_requested` | `market_refund_requests` INSERT | `refunds.market` | info | `mrefund:<id>` |
| `payment_refund_requested` | `refund_requests` INSERT, `origin`이 고객 요청 | `refunds.payment` | info | `prefund:<id>` |
| `payment_external_cancel` | `refund_requests` INSERT, `origin`이 `external_cancel`·`partial_cancel` | `refunds.payment` | warning | `prefund:<id>`(행마다 1회 — 두 번째 부분취소는 새 행이라 다시 울림) |
| `payment_refund_needs_action` | `refund_requests.status`가 `retryable_failed`·`manual_review`로 **바뀔 때** | `refunds.payment` | warning | `prefund:<id>:<status>:<전이 시각, 분 단위>` |
| `payment_manual_review` | `payment_orders.status`가 `manual_review`로 바뀔 때 | `refunds.payment` | warning | `order:<id>:manual_review:<전이 시각, 분 단위>` |
| `payment_alert` | `payment_reconciliation_alerts` INSERT(코드별 통지 설정을 따름) | `refunds.payment` | 경보의 severity | `alert:<id>` |
| `sales_switch_changed` | `payment_runtime_config`의 master·payapp·kakaopay 값이 바뀔 때 | `refunds.payment` | critical | `switch:<changed_at>:<바뀐 뒤 값 3개>` |
| `refund_over_limit` | 앱 코드에서(staff가 한도 초과 건의 승인을 시도해 서버가 거부했을 때 1회) | `refunds.market` | info | `mrefund:<id>:over_limit` |
| `credit_balance_mismatch` | 앱 코드에서(`credit-balance.ts:88-100`의 기존 관리자 알림 자리) | `refunds.payment` | warning | `mismatch:<user_id>:<날짜>` |
| `support_unanswered`, `refund_unanswered` | 재알림 cron(아래) | 각 권한 | info | `<kind>:<id>:<날짜>` |
| `notify_gave_up` | 전송 작업이 한 이벤트를 포기했을 때(**화면 전용** `delivery='screen'` — 슬랙으로 다시 보내면 슬랙 장애 때 포기가 포기를 낳는다) | owner | critical | `gaveup:<event_id>` |

- **`dedupe_key`의 뜻**: 같은 전이가 짧은 시간 안에 두 번 기록되는 것만 막는다. 같은 주문이 해소 뒤 다시 `manual_review`가 되거나 환불이 다시 실패하면 **새 이벤트로 다시 울린다**(키에 전이 시각을 넣는 이유).
- **한 사고가 여러 번 울리는 문제**: 외부 취소 한 건은 환불 요청·수동확인·경보·스위치 변경을 연달아 만든다. 전송 작업은 **한 회차(15초)에 모인 이벤트를 슬랙 메시지 1개**로 묶어 보낸다(종류마다 `ref_id`가 달라 주문 단위 묶음은 하지 않는다). 화면 토스트도 5초 안에 온 이벤트는 "새 알림 N건"으로 묶는다.
- **카페 결제 통보 경보**: 페이앱 계정을 카페 판매와 같이 써서 사이트 밖 결제마다 `PAYAPP_FEEDBACK_ORDER_NOT_FOUND` 경보가 생긴다. 경보 코드별 통지 여부·심각도는 **데이터**(`system_settings` 키 `admin_alert_settings.alert_codes`)로 두고, 이 코드는 기본 "슬랙·소리 없음, 화면 목록에만"으로 한다(Q-M). 적용 방법: 경보 INSERT 트리거가 설정 행을 한 번 읽어 `delivery='screen'`으로 이벤트를 만든다(읽기 실패 시 `full`). 이 경보들은 미해소로 쌓이므로(중복 방지가 `mul_no` 단위) **처리 대기 건수·배지에서는 "사이트 밖 결제 통보 N건"으로 따로 세고**, 환불 관리 화면에 같은 코드 일괄 해소(메모 1개로)를 둔다(U1-2에 포함, 런북 RB-1에 절차). 경보를 만드는 결제 로직은 바꾸지 않는다.
- **개인정보**: `title`·`body`에 회원 이메일·전화번호·문의 본문을 넣지 않는다(슬랙으로 나간다). 예: "새 문의 [환불] 제목 앞 30자". 지금 `src/lib/slack.ts`는 이메일·전화를 슬랙으로 보내고 있어(`api/support/route.ts:69-70`) U1-3에서 제거한다.
- **트리거 실패의 한계를 정확히**: 트리거 본문은 `EXCEPTION WHEN OTHERS`로 감싸 원래 작업을 계속하게 하지만, `statement_timeout`에 의한 취소와 잠금 대기는 이 블록으로 막지 못한다. 그래서 트리거는 잠금을 잡지 않는 INSERT 한 줄로 제한하고, **이벤트가 빠진 경우는 업무 테이블 건수(배지·대시보드)와 재알림이 보완**한다. EXCEPTION 블록의 서브트랜잭션 비용은 결제 함수 16개(주문을 `manual_review`로 바꾸는 함수 수)에 대해 리허설에서 실행 시간으로 확인한다.

**전송 작업** `dispatch_admin_events()` — `cron.schedule('admin-events-dispatch', '15 seconds', …)`(pg_cron 1.6.4, 초 단위 지원)
- 순서: `pg_try_advisory_xact_lock` → 상태 행 `last_run_at` 갱신 → vault `admin_alert_slack_webhook_url` 확인(없거나 `https://hooks.slack.com/services/`로 시작하지 않으면 `last_run_error='WEBHOOK_NOT_CONFIGURED'` 기록 후 종료 — 시도 횟수는 올리지 않는다) → 응답 확인(`net._http_response`: 2xx → `delivered_at`, 실패 → `last_error`, 응답 없음 5분 → 재시도 대상) → 전송(미전송·미포기 이벤트를 묶어 `net.http_post`, 재시도 간격 15초·1·2·4·8·16분, 6회 실패 → `gave_up_at` + `notify_gave_up` 이벤트) → `last_success_at`. 전송 대상은 `delivery='full'`만. `cron.job_run_details`가 하루 약 5,760행 쌓이므로 7일 지난 행을 지우는 정리 cron을 함께 둔다.
- critical 이벤트의 슬랙 메시지는 채널 멘션을 붙인다(야간에도 울리게 — Q-N).
- EXECUTE는 PUBLIC·anon·authenticated·service_role 모두 회수(cron만 실행).
- **전송이 멈춘 것을 아는 방법**: ① 관리자 화면 카드 — "통지 설정 오류"(`last_run_error`), "통지 작업 멈춤"(`last_run_at`이 2분 넘게 과거), "통지 실패 N건"(`gave_up_at`). ② 화면을 안 볼 때를 위한 2차 수단 — 전송 작업이 **5분에 한 번, 웹훅 설정이 정상이고 포기 건이 없을 때만** 외부 감시 서비스(W0-9)의 **하트비트 주소**로 신호를 보내고(설정 오류·포기·작업 정지 모두 신호가 끊기는 것으로 드러난다. 웹훅 등록 전에는 하트비트 감시를 켜지 않는다), 신호가 끊기면 감시 서비스가 자체 수단(이메일·앱 푸시)으로 대표에게 알린다(Q-O. 하트비트 주소는 vault `admin_alert_heartbeat_url`).
- W3-3b에서 가져온 것: 재시도·응답 확인·형식 검사·advisory lock·EXECUTE 회수·상태 행. 바뀐 것: 대상이 경보 표가 아니라 `admin_events`, 판매 스위치 감시는 `payment_runtime_config` UPDATE 트리거(값 3개 비교), 경보 백필 불필요(미해소 경보 0건, 트리거는 새 행부터). health 함수는 바꾸지 않는다.

**재알림** (DB-A2: 설정 행 + `cron` 10분 주기 함수)
- 대상: 접수 후 N시간 지난 `pending` 문의 중 **`is_deleted_by_user=false`**, `pending` 마켓 환불, 처리 필요 충전 환불. 같은 건은 하루 1회(`dedupe_key`).
- `admin_alert_settings`(데이터): 기준 시간(기본 문의 4시간·환불 24시간), **재알림을 보내는 시간대**(기본 09~21시 KST — 밤사이 건은 아침 9시에 모아서 한 번), 야간에도 깨울 심각도(기본 critical만). Q-E·Q-N.

**관리자 화면(코드)**
- 레이아웃의 클라이언트 컴포넌트 `AdminAlertCenter`(종 + 전역 토스트):
  - `GET /api/admin/alerts/summary` → `getAdminWorkSummary()`의 처리 대기 건수(문의 pending·미삭제, 마켓 환불 pending, 충전 환불 처리 필요, 수동확인 주문, 미해소 경보)와 최근 이벤트 20건, 전송 상태 카드 값. 조회에 실패한 항목은 0이 아니라 "확인 불가". 권한 없는 건수는 내려보내지 않는다.
  - 구독: 브라우저 Supabase 클라이언트(관리자 JWT — 선례 `grant-credit-dialog.tsx:11`. Realtime 사용은 이 프로젝트 첫 사례)로 `admin_events` INSERT → 토스트(sonner, 클릭 시 `link`로 이동) + 소리 + 브라우저 `Notification`(허용 시) + summary 다시 조회. 탭이 숨겨져 있으면 문서 제목 앞에 `(N)`.
  - 구독이 끊기면 30초 폴링으로 내려가고 종에 "실시간 연결 끊김"을 표시. 탭이 다시 보일 때도 조회.
  - 소리: 브라우저 정책상 페이지에서 한 번 클릭해야 재생된다. 첫 클릭 때 자동으로 해제하고, 종 옆에 "소리 켜짐/꺼짐"을 항상 표시(관리자별 `localStorage`).
- 사이드바 메뉴 배지(문의 / 환불·결제 확인)는 별도 컴포넌트로 만들어 U3-1의 새 사이드바에 그대로 꽂는다.
- 기존 관리자 대상 `notifications` 삽입(`payapp-webhook-server.ts:104-122`, `credit-balance.ts:88-100`)은 관리자 화면에 벨이 없어 보이지 않았다. U1-3에서 정리한다.

**사용자 통지**
- 마켓 헤더 알림 벨(W3-8a), 마켓 환불 승인·거부 알림(W3-8b), 지급 알림 링크.
- 이메일(U1-6): 출시 전 규모에 맞게 **앱에서 직접 발송**한다(대기 표·전송 함수는 만들지 않는다). `src/lib/notify-user-server.ts`의 `notifyUser({ userId, type, title, message, link, mail })`가 `notifications` INSERT + (설정상 메일 대상이면) Resend 호출을 하고, 실패는 응답을 막지 않고 `notification_mail_failures` 표에 기록한다(대시보드 카드 "메일 발송 실패 N건"). 어떤 통지에 메일을 보낼지와 제목·본문 틀은 `system_settings` 키 `mail_settings`(데이터). 호출 지점이 통지 종류(`reply`·`refund_done`·`refund_rejected`·`credit_granted`)를 넘기므로 `notifications.type`(4종뿐)에 기대지 않는다. 본문은 제목과 링크만(Q-F). 받는 주소는 `profiles.email`, 관리자 합성 도메인(`admin.summersun.local`)은 제외.

## 5. 단위별 작업

표기: **W…** = 작업계획서 명세(0-2절 변경 반영). **U…** = 이 문서에서 정한 단위. 모든 단위는 7절 규칙을 따른다.

### 0단계 — 긴급

**0A 안전**

| 단위 | 내용 | DB | 선행 | 규모 |
|---|---|---|---|---|
| U0-1 | 문의 RLS 구멍 막기 | DB-S1 | — | 소 |
| W1-8 | `source_configs` RLS 켜기 | DB-1 | — | 소 |
| ~~W1-7b~~ | 취소(영어 운영 결정). 영어 테스트 광고 3개·상품 1개의 처리는 대표 결정 | — | — | 대표 |
| ~~W1-7a → W1-7c~~ | 취소(2026-11-13: 국어·영어 모두 운영) | — | — | — |
| W1-1 + W1-1b | 상품 삭제: 이력 있으면 숨김 / 숨김 상품도 구매자는 다운로드 | — | — | 중 |
| W1-10 | 구매 기록 FK CASCADE → RESTRICT | DB-2 | W1-1 배포 | 소 |
| U0-5 | 쓰지 않는 기능 접근 차단 1차 | DB-F1(설정 행) | — | 중 |
| U0-6 | 요금제 '판매중' 스위치 확인 창·실패 표시(준비 계획 5-5) | — | — | 소 |
| U0-2 | 운영 전 데이터 정리 점검(조회 → 사용자 결정) | — | — | 소 |

**U0-1 문의 RLS 구멍**
- 현재(DB 확인): 정책 "Users can soft delete their own tickets"가 UPDATE를 `USING/WITH CHECK (auth.uid() = user_id)`로 허용, authenticated에 전 컬럼 UPDATE 권한, anon에도 테이블 전 권한. 앱의 쓰기는 SECURITY DEFINER RPC 3종(`create_support_ticket`, `update_own_pending_support_ticket`, `soft_delete_own_support_ticket`)과 관리자 답변(`api/admin/support/tickets/[id]/route.ts:49-57`, 세션 + "Admins can update tickets" 정책, 컬럼 4개).
- R1 검증에서 확인된 전제: 사용자 세션으로 `support_tickets`에 직접 쓰는 코드 0건, 구 `PATCH /api/support`(`api/support/route.ts:100-159`)는 호출처 없음 → 같은 커밋에서 삭제.
- DB-S1: 사용자 UPDATE 정책 DROP. `REVOKE ALL ON support_tickets FROM anon`. authenticated는 `REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES` 후 `GRANT UPDATE (status, admin_response, responded_at, updated_at)`만. `support_ticket_categories`도 같은 방식. `notifications`는 **사용자 본인 `is_read` UPDATE(`api/notifications/route.ts:55, 63`)와 관리자 세션 INSERT 2곳을 남기고** 나머지만 회수(관리자 INSERT는 DB-P3에서 정리). 되돌리기 파일은 적용 직전 권한을 조회해 작성.
- 테스트(새) `tests/support-tickets-rls-contract.test.mjs`. 리허설: 일반 회원 claims로 본인 문의 `admin_response` UPDATE 거부, RPC 3종 성공, 알림 읽음 처리 성공, 관리자 claims로 답변 UPDATE 성공 → ROLLBACK.

**U0-5 접근 차단 1차** — 4-2절. 
- 신규 `src/lib/admin-features.ts`(경로 접두 → 묶음, 순수 함수 `resolveAdminFeature(pathname)`), `src/lib/admin-features-server.ts`(설정 읽기·캐시), 수정 `src/middleware.ts`(또는 그것이 부르는 `src/lib/supabase/middleware.ts`), `admin-sidebar.ts`(자동 추가에서 꺼진 묶음 제외), 대상 액션 파일(4-2절 2번).
- DB-F1: `system_settings`에 `admin_disabled_features` 행 INSERT(추가형, `on conflict do nothing`) + 되돌리기(DELETE). **코드를 먼저 배포**(행이 없으면 아무것도 막지 않음 = 지금과 같음) → 행을 넣는 순간 차단.
- 테스트: `resolveAdminFeature` 실행 테스트(대상 경로·하위 경로·운영 경로·비슷한 접두 `/admin/questions-x`), 계약(미들웨어가 세 접두를 봄, 대상 액션 export 전부가 검사 함수를 부름, `renameAdminSidebarMenuAction`은 대상 아님).
- 검증: 행 적용 뒤 대표 계정으로 대상 URL·API 표본이 404, 운영 화면(상품·카테고리·홈·후기·환불·문의·회원·크레딧·요금제·푸터·관리자 계정)이 모두 열리고 저장 전 단계까지 동작. **`/admin/ai-question-generation-runs`는 차단 확인을 응답 코드로만**(`curl -I`가 아니라 차단 적용 뒤 미들웨어가 막는지 — 적용 전에는 열지 않는다).

**U0-2 운영 전 데이터 정리 점검** — 조회만 해서 표로 보고하고 사용자가 정한다(Q-H): `test` 요금제(1,000원/100C, 판매 중 — 누구나 살 수 있음), `payment_history`의 주문 미연결 행 35건(0원 27·유상 8), 테스트 회원과 그 주문·후기·문의, 문의 카테고리 `ai_generation_error`, `payment_methods.kakaopay` `is_enabled=true`, **`accepted_provider_environment='test'`인데 페이앱 주문은 `live`로 기록되는 점**(의도 확인 — 결제 전문 검증 대상), 기존 관리자 계정 admin01~03의 용도(Q-J). 완료 기준: 항목별 결정이 기록되고, 지우기로 한 것은 리허설 뒤 적용.

**0B 감지·중지 수단**

| 단위 | 내용 | DB | 선행 | 규모 |
|---|---|---|---|---|
| W0-6 | 운영 런북(`docs/admin-operations-runbook.md`) | — | — | 중 |
| W0-7 | 판매 중지·재개 SQL | DB-0 | — | 중 |
| U0-4 | 관리자 이벤트·슬랙 통지 + 옛 문의 슬랙 호출 제거 | DB-A1 | W0-7(스위치 시험에 사용) | 중~대 |
| U0-7 | (Q-I가 "중지 버튼"이면) 판매 중지 버튼 | — | W0-7 | 소 |
| W0-9 | 외부 가동 감시 + 하트비트(대표) | — | Q-O | 대표 |

- **W0-6**: 화면이 생기기 전의 대체 절차를 반드시 포함 — RB-1 경보 대응, RB-2 판매 중지·재개, RB-4 잘못 지급 회수(U3-7 전), RB-5 영수증 요청(페이앱 관리자 화면, 대표), RB-7 하자 상품 환불(U5-3 전), RB-8 문의 답변 안내(벨 전), RB-11 탈퇴 요청(U5-7 전), 꺼진 기능 다시 켜기. 휴대폰만 있을 때의 판매 중지 방법(Q-I)도 여기에.
- **W0-7**: 작업계획서 명세대로. 스위치가 이미 켜져 있으므로 **중지 SQL을 먼저** 리허설한다.
- **U0-7(조건부)**: 대시보드와 환불 관리 맨 위에 대표 전용 "충전 판매 중지" 버튼(확인 창 + 사유 필수). 서버는 W0-7의 master 중지와 같은 변경을 service role로 실행하고 `changed_by`·`change_ticket`에 처리자와 사유를 남긴다(→ `sales_switch_changed` 이벤트가 자동으로 울림). **재개는 버튼으로 하지 않는다**(재개 조건 확인이 필요하므로 SQL). 결제 전문 검증 3명.
- **U0-4**: 4-3절 DB-A1 전부(표 4개·트리거·전송 작업·publication). 슬랙 웹훅이 아직 없어도 적용할 수 있다(전송 작업이 `WEBHOOK_NOT_CONFIGURED`를 기록하며 대기, 화면 알림은 웹훅 없이 동작).
  - 리허설(BEGIN…ROLLBACK): 시험 문의·마켓 환불·충전 환불·경보 INSERT, `payment_orders` → `manual_review` UPDATE, `refund_requests` 상태 전이, `payment_runtime_config` UPDATE 각각에서 이벤트 생성과 `dedupe_key` 중복 방지 확인 / 트리거 함수 안에서 강제 예외를 내도 원래 작업 성공 / 전송 작업 실행 뒤 상태(pg_net 큐도 롤백되어 실제 전송 없음) / 웹훅 없음 → `last_run_error` / `attempt_count=6` 행 → `gave_up_at`과 `notify_gave_up` 이벤트 / anon·비관리자 SELECT 불가 / 결제 함수 실행 시간 전후 비교.
  - 적용 뒤(승인 받아): 대표 시험 계정 문의 1건 → 슬랙 도착 → 답변 처리. 시험 경보 1행 → 슬랙 도착 → `resolve_payment_alert`로 메모와 함께 해소. **master 스위치만** 중지 SQL로 껐다가 재개 SQL로 켜서 `sales_switch_changed` 도착 확인(페이앱 스위치는 건드리지 않음, 이용이 적은 시간에, 끝나고 값 3개 SELECT 확인).
  - 실서버에서 슬랙 도착을 확인한 직후, 옛 문의 슬랙 호출(`api/support/route.ts` 61-90행 부근의 프로필 조회 + `sendSlack` 호출, `src/lib/slack.ts`)을 제거해 배포한다 — 옛 호출은 회원 이메일·전화를 슬랙으로 보내고 같은 문의가 두 번 가게 만든다.
  - 되돌리기: cron 해제 → 트리거 → 함수 → publication에서 제거 → 표.

**0C 틀린 표시**

| 단위 | 내용 | 선행 | 규모 |
|---|---|---|---|
| W1-2 | 사용자 관리: 잔액·서버 검색·페이지 | — | 중 |
| W1-5 | 크레딧 관리: 유형·서버 페이지·지급 창 통일 | W1-2 | 중 |
| W1-3a + W1-3b + W3-1a | 환불 관리: 조회 오류 배너·처리 필요 기본 필터·금액·마켓 환불 보강·수동확인 목록에 이메일·거래번호 | — | 중 |
| W1-4 | 대시보드 1차: 거짓 표시 제거 + 처리 대기 카드(`getAdminWorkSummary`) | — | 중 |

### 1단계 — 알림

| 단위 | 내용 | DB | 선행 | 규모 |
|---|---|---|---|---|
| U1-2 | 관리자 화면 알림(종·토스트·소리·브라우저 알림·배지·전송 상태 카드) | — | U0-4, W1-4 | 중 |
| U1-3 | 관리자용 `notifications` 삽입 정리 | — | U1-2 | 소 |
| U1-4 | 미답변 재알림 | DB-A2 | U0-4 | 소 |
| W3-8a + W3-8b | 마켓 헤더 알림 벨, 마켓 환불 처리 알림 | — | — | 소 |
| U1-5 | 사용자 알림 보강 | — | W3-8a | 소 |
| U1-6 | 사용자 이메일 통지 | DB-M1(실패 기록 표·설정 행) | Q-A, Q-F | 중 |

- **U1-2**: 신규 `src/components/layout/admin-alert-center.tsx`, `admin-menu-badge.tsx`, `GET /api/admin/alerts/summary`, `POST /api/admin/alerts/seen`, `public/sounds/admin-alert.mp3`(직접 만든 짧은 알림음). 수정 `(admin)/admin/layout.tsx`, `admin-sidebar-client.tsx`. 테스트(새) `tests/admin-alert-center-contract.test.mjs`(건수는 업무 테이블에서, 실패 시 "확인 불가", 구독 대상·폴링 전환, 권한 없는 건수 미포함) + 순수 함수(이벤트 묶기, 새 이벤트 판정) 실행 테스트. 검증: 로컬은 렌더만. 배포 뒤 대표가 창 두 개로 문의 등록 → 2초 안에 토스트·소리·배지, 다른 탭에서 브라우저 알림.
- **U1-3**: `payapp-webhook-server.ts:104-122`의 관리자용 `notifications` 삽입은 **삭제**(같은 일을 경보 INSERT 트리거가 이미 이벤트로 만든다 — 교체하면 중복). `credit-balance.ts:88-100`만 `admin_events` INSERT(`credit_balance_mismatch`)로 교체. 옛 슬랙 호출 제거는 U0-4에서 이미 끝남.
- **U1-4**: 4-3절 재알림. 완료 기준: 시험 문의를 기준 시간 전으로 만들어(리허설 안에서 `created_at` 조정) 재알림 이벤트 1행, 같은 날 다시 실행해도 추가 없음, 삭제된 문의는 대상 아님, 야간 시간대에는 만들지 않음.
- **U1-5**: 지급 알림에 `link: '/mypage/credits'`(`api/admin/users/credits/route.ts:62-68`). 답변 알림 INSERT 실패 시 응답에 `notificationFailed`(`tickets/[id]/route.ts:65-71`) → 화면 안내. 마이페이지 알림 전체 목록(`/mypage/notifications`, 페이지 나눔) — 벨은 "안 읽음 또는 24시간"만 보여 주므로(`api/notifications/route.ts:15-24`). 로컬에서 벨을 열지 않는다(열면 읽음 처리 = 실서버 쓰기).
- **U1-6**: 4-3절 사용자 통지. Resend 키는 Vercel 환경변수(대표 등록, AI는 이름만 확인), 발신 주소·대상 통지·문구는 `mail_settings`. 검증: 대표 시험 계정(외부 주소)으로 답변 메일 수신, SPF·DKIM pass, 실패를 일부러 내서(잘못된 발신 주소 설정) 실패 기록·카드 확인 후 원복.

### 권한 토대 (2단계 전에 먼저)

| 단위 | 내용 | DB | 선행 | 규모 |
|---|---|---|---|---|
| U3-2 | DB-P1 + 가드 3종 + `getAdminAccess()` | DB-P1 | Q-J | 중 |

- DB-P1은 추가형이라 선행이 없다. 적용해도 기존 동작은 바뀌지 않는다(아무 코드도 아직 가드를 쓰지 않음). 이후 만드는 2단계 API·페이지는 처음부터 가드를 쓴다.
- 전문 검증 3명(권한 모델 / RLS·함수 / 마이그레이션). 리허설: 대표 계정이 `owner`, 함수 2개가 owner·staff(권한 있음/없음)·해제된 계정·비관리자에서 기대값.

### 2단계 — 조회 화면

| 단위 | 내용 | 선행 | 규모 |
|---|---|---|---|
| W3-1b | 주문 조회 › 충전 결제(`/admin/orders`) | W1-3a, U3-2 | 중 |
| W3-2 | 주문 조회 › 마켓 구매 + 다운로드 진단 | W3-1b, W1-1b | 중 |
| U2-1 | 회원 상세(`/admin/users/[id]`) | W1-2, W3-1b, W3-2 | 중 |
| W3-3a | 판매 상태 배지 | W1-3a, W1-4 | 소 |
| U2-2 | 대시보드 2차: 매출·판매 지표 | W1-4 | 중 |
| U2-3 | 문의: 회원·주문 연결, 회원 이메일 검색, 서버 페이지 | U2-1 | 소~중 |
| W1-6 | `/checkout`에 마켓 헤더 | — | 소 |
| W3-7b → W3-7a | 비밀번호 재설정(메일 템플릿 → 코드) | Q-A | 중 |

- **U2-1 회원 상세**: 신규 `src/app/(admin)/admin/users/[id]/page.tsx` + 클라이언트, `src/lib/admin-member-detail-server.ts`(service role, 컬럼 명시 — 생년월일·주소·카카오 ID는 조회하지 않음). 구역: 기본 정보 / 크레딧(쓸 수 있는 잔액 = `get_credit_balance_snapshot`, 원천별 남은 수량·만료일) / 충전 결제 / 마켓 구매·다운로드 / 크레딧 거래 최근 50건 / 환불 요청 / 문의. 구역마다 권한(`orders.view`·`credits.view` 등)이 있을 때만 그리고, 조회 실패는 그 구역만 "불러오지 못했습니다". 진입 링크: 사용자 관리, 주문 조회, 환불 관리, 문의 상세, 후기 관리. 다운로드가 안 되는 구매자에 대한 조치는 화면 안내로 연결(진단 결과 → 상품 편집 링크 / 보상 지급 버튼 — 권한 재부여 기능은 만들지 않는다). 검증: 대표·시험 계정 2명의 구역별 건수를 SELECT와 대조.
- **U2-2**: `src/lib/admin-dashboard-server.ts` — 한국 시간 기준 오늘/이번 달 가입 수, 충전 결제 금액·건수와 환불 금액(`payment_orders`의 `provider_environment='live'` completed/refunded, 환불액은 completed `refund_requests.refund_amount`), 마켓 판매 건수·사용 크레딧, 다운로드 수. 서버에서 1000행 단위로 끝까지 읽어 합산. 화면 순서: 오늘 할 일(`getAdminWorkSummary`) → 판매 상태 배지·전송 상태 카드 → 지표 → 최근 주문 5건·최근 문의 5건. 테스트 환경 주문은 제외하고 그 사실을 표기.
- **U2-3**: `support-client.tsx:559-565` 상세에 회원 상세 링크와 요약(권한에 따라), 검색에 회원 이메일(`support/page.tsx:58-61`), 서버 페이지 나눔과 건수 카드의 서버 집계(`page.tsx:36`, `support-client.tsx:155-157`). 사용자가 삭제한 문의도 읽기 전용으로 열람(`support-client.tsx:457-460`).
- **W3-7**: Q-A가 풀리지 않으면 비밀번호 분실은 처리 경로가 없다 → 그 기간의 대체 절차(대표가 Supabase 대시보드에서 복구 메일 발송 또는 새 계정 안내)를 런북에 적는다.

### 3단계 — 메뉴 재편 · 권한 적용 · 작업 기록

| 단위 | 내용 | DB | 선행 | 규모 |
|---|---|---|---|---|
| U3-1 | 페이지 등록부 + 새 사이드바(W2-1, W2-2/3 수정판) | DB-4a' | 2단계 화면 | 중~대 |
| W2-5, W2-6 | 탭 링크, 사이트 로고를 `/admin/footer`로 | — | U3-1 | 소 |
| U0-5b | 접근 차단 2차(메뉴관리) | DB-F2(설정 행 갱신) | W1-6, W2-6 | 소 |
| U3-3 | 권한 검사 적용(영역별로 나눠 커밋) | — | U3-2, U3-1 | 대 |
| U3-4 | 권한 부여 화면, 내 비밀번호 변경, 권한 해제(W4-6) | — | U3-2, U3-5 | 중 |
| U3-5 | 작업 기록(`admin_audit_log`) + 조회 화면 | DB-7' | — | 중 |
| U3-6 | 지급 함수 개정(행위자·사유·기록·한도) | DB-6' | U3-2, U3-5 | 중 |
| U3-7 | 크레딧 수동 회수 | DB-11' | U3-5 | 중 |
| U3-8 | RLS 강화 | DB-P2, DB-P3 | U3-3 배포 | 중~대 |
| U3-9 | 시험 staff 계정으로 완료 확인 | — | 전부 | 소 |

- **U3-1**: 작업계획서 W2-1·W2-2·W2-3을 따르되 — 등록부 필드에 `permission`·`feature` 추가(U0-5의 `admin-features.ts`를 등록부로 합침), 저장 구조에서 `legacy` 배열 삭제, 과목은 `subjectOrder: ["korean"]`(과목 전환기는 과목이 2개 이상일 때만), 메뉴 구조는 준비 계획 5절 트리에서 레거시 줄을 뺀 것, 회원 상세는 `parentHref=/admin/users`, 모바일 사이드바 기본 접힘, U1-2의 배지 컴포넌트 장착.
- **U3-3 대상표**(구현 직전 전수 확정. 계약 테스트 `tests/admin-guard-coverage-contract.test.mjs`가 **① `(admin)` 아래 모든 `page.tsx` ② `api/admin/**/route.ts` 전부(예외 목록: `session`) ③ 서버 액션 파일 9개의 모든 export**가 가드를 부르는지 검사)

| 영역 | 대상 | 권한 |
|---|---|---|
| 문의 | `admin/support/page.tsx`, `api/admin/support/**` | `support.manage` |
| 주문 조회 | `admin/orders/page.tsx`, `api/admin/orders/**` | `orders.view` |
| 회원 | `admin/users/**` 페이지 | `members.view` |
| 크레딧 | `admin/credits/page.tsx` → `credits.view`. `api/admin/users/credits` → `credits.grant`(+한도), 회수 → `credits.revoke` | |
| 환불 | `admin/refunds/page.tsx`(둘 중 하나). `api/admin/market/refunds/**` → `refunds.market`(+한도). `api/admin/refunds`, `api/admin/payments/**` → `refunds.payment` | |
| 상품 | `admin/market/**`·`market-categories` 페이지, `api/admin/market/**`(**`market/refunds` 제외**: items, files, samples, subproducts, images, image-folders, file-types, subproduct-categories), `api/admin/market-categories/**` → `products.edit`. `items/[id]` DELETE → `products.delete` | |
| 홈 화면 | `main-ad-settings`·`market-main-settings` 페이지와 API | `storefront.edit` |
| 후기 | `reviews`·`review-tags` 페이지와 API | `reviews.manage` |
| 요금제·사이트 | `pricing` 페이지·`pricing/actions`, `footer` 페이지·`footer/actions`, `api/admin/site-logo`, `renameAdminSidebarMenuAction` | `pricing.manage` / `site.manage` |
| 대표 고정 | `admin-accounts` 페이지·`api/admin/admin-accounts/**`, 권한 부여 API, `/admin/audit-log` | owner |
| 공통 | `/admin`(대시보드), `api/admin/stats`, `api/admin/alerts/**` | 관리자면 통과, 내용은 권한별로 걸러서 |
| 꺼진 기능 | 4-2절 대상 페이지·API·액션 | 차단(대표 포함) |

  - 커밋 단위: 영역 한 줄 = 커밋 하나. 지역 `requireAdmin` 정의(52곳)는 그 영역을 바꿀 때 공용 가드로 교체한다.
  - 테스트: 권한 판정 순수 함수 실행 테스트(owner / 권한 있음 / 없음 / 의존 빠짐 / 한도 초과 / 꺼진 기능 / `admin_role` 없는 관리자).
- **U3-4**: `/admin/admin-accounts`(대표 전용)에 계정별 권한 편집 창 — 항목 체크(한글 설명), 의존 자동 체크, 한도 입력 필수, 저장 `PUT /api/admin/admin-accounts/[userId]/permissions`(service role, 대표 검사, 작업 기록). 묶음 버튼("CS 기본": 문의·주문 조회·회원 조회·크레딧 조회·마켓 환불 — 묶음 구성은 `system_settings` 키 `admin_permission_presets`)은 체크만 채우고 저장은 대표가 한다. 권한 변경은 다음 요청부터 반영(`getAdminAccess`가 요청마다 DB를 읽음). staff용 "내 비밀번호 변경".
- **U3-5**: 작업계획서 W3-5a의 표 설계(수정 금지 트리거, RLS on, service role만)를 따르되 `action`은 CHECK 없이 text, **`amount integer` 컬럼 추가**(하루 한도 합산용). 기록 대상: 크레딧 지급·회수, 마켓 환불 승인·거부, 문의 답변, 상품 상태 변경·삭제·가격 변경, 요금제 변경, 약관 저장, 후기 삭제, 관리자 계정 생성·삭제·비밀번호 변경, 권한 부여·회수. 돈·권한 관련(지급·회수·권한)은 **같은 트랜잭션**(RPC 안에서 기록), 마켓 환불은 처리 RPC를 고치지 않고 route에서 처리 성공 뒤 기록하되 실패하면 응답에 경고를 싣고 `admin_events`로 대표에게 알림(환불 RPC 개정은 결제 전문 검증 범위가 커서 이번에는 하지 않음), 나머지는 기록 실패를 로그로만. 조회 화면 `/admin/audit-log`(대표 전용, 처리자·기간·종류 필터, `payment_admin_actions`와 합쳐 보기).
- **U3-6 지급 함수 개정(DB-6')** — 기존 `grant_admin_credits`를 바탕으로 새 시그니처 `grant_admin_credits(p_actor_id uuid, p_user_id uuid, p_amount integer, p_source_category text, p_reason text, p_operation_key text)`를 **오버로드로 추가**(추가형) → 코드 전환 → 옛 5인자 함수 DROP(정리).
  - 유지: 대상 `profiles FOR UPDATE`, `(user_id, operation_key)` 재요청 처리, `ADMIN_GRANT_IDEMPOTENCY_CONFLICT` 규칙, EXECUTE service_role만.
  - 순서: ① 인자 검증(사유 1~500자 포함) ② **재요청이면 기존 결과 반환(한도 검사보다 먼저)** ③ 행위자 확인 — owner면 기존 상한(1회 10,000)만. staff면 그 계정의 `admin_permission_grants('credits.grant')` 행을 `FOR UPDATE`로 잠가(행위자 단위 직렬화 — 프로필 행을 잠그지 않아 `consume_credits`와 잠금 순서가 얽히지 않음) `per_grant`, 그리고 `admin_audit_log`에서 그 행위자의 **한국 시간 당일** 지급 `amount` 합계 + 요청 ≤ `per_day` 확인. 한도 키가 없으면 거부 ④ 대상 프로필 잠금 → 지급(기존 로직) ⑤ 원장 설명 "관리자 지급", `admin_audit_log` 1행(같은 트랜잭션) ⑥ 결과 반환.
  - 코드: `src/lib/credits.ts:422-461`, `api/admin/users/credits/route.ts`, `grant-credit-dialog.tsx`(사유가 고객 알림에 보인다는 안내 — Q-7). 테스트 5개(`admin-credit-grant-idempotency`, `credit-ledger-integrity-migration-contract`, `payment-integrity-migration-contract`, `credit-source-category`, `credit-mutation-post-commit`)를 새 시그니처에 맞게 수정하고 기존 단언(멱등·충돌)은 유지.
  - 세부: 새 인자에 DEFAULT를 두지 않는다(PostgREST가 인자 이름으로 함수를 고르므로 옛 함수와 모호하지 않음), 적용 뒤 `NOTIFY pgrst`. 행위자의 owner 여부는 `is_owner()`가 아니라 `p_actor_id`로 `profiles`를 직접 읽는다(service role 호출이라 `auth.uid()`가 없음). 재요청 판정은 **대상 프로필 잠금 뒤에 한 번 더** 한다(같은 키의 동시 요청이 유니크 오류가 아니라 기존 결과로 끝나게). 기존 충돌 규칙이 비교하던 `payment_method`가 새 시그니처에 없으므로 비교 대상(금액·분류·대상 회원)을 명세에서 다시 정한다.
  - 전문 검증 3명(지급·멱등 / 한도·동시성 / 마이그레이션). 리허설: 같은 staff가 서로 다른 회원에게 동시 지급해도 하루 한도를 넘지 않음(두 세션), 재요청은 한도와 무관하게 기존 결과, 한도 키 없음 거부.
- **U3-7 회수(DB-11')** — 준비 계획 5-2. `revoke_admin_credits(p_actor_id, p_user_id, p_amount, p_reason, p_operation_key)`: 쓸 수 있는 잔액 안에서만, 사유 필수, 원장 설명 "관리자 회수", 작업 기록 같은 트랜잭션, 고객 알림. 회원 상세·크레딧 화면에 버튼. 전문 검증 3명.
- **U3-8**: 4-1절 RLS. DB-P2는 계정 생성 코드 배포 뒤, DB-P3는 U3-3 배포 뒤.
- **U3-9**: "CS 기본" 묶음에 `credits.grant`(한도 입력)를 더한 시험 staff 계정으로 ① **되는 일**: 문의 답변, 주문·회원 조회, 한도 안 지급, 한도 안 마켓 환불 승인, 본인 비밀번호 변경 ② **막히는 일**: 권한 밖 메뉴·URL·API·서버 액션(직접 호출), 한도 초과 지급·환불, DB 직접 쓰기(묶음별) ③ 권한을 하나 회수하면 다음 요청부터 막힘 ④ 꺼진 기능 URL은 대표 계정으로도 404 ⑤ 위 행동이 작업 기록에 남음. 통과 뒤 실제 CS 계정 발급.

### 4단계 — 문의 강화 (출시 뒤 가능)

| 단위 | 내용 | DB |
|---|---|---|
| U4-1 | 이어지는 대화: `support_ticket_messages`(작성자 구분·본문·시각·답변자), 기존 `admin_response`는 첫 답변으로 옮김, 상태 변경 화면, 사용자 추가 질문(→ `admin_events` 종류 `support_ticket_replied` 추가) | DB-T1 |
| U4-2 | 첨부파일(비공개 Storage 버킷, 개수·크기·형식 제한은 데이터) | DB-T2 |
| U4-3 | 답변 템플릿(표 + 관리 화면), 내부 메모, 미답변 경과 시간 표시·오래된 순 정렬 | DB-T3 |
| U4-4 | 공지사항·FAQ(표 + 관리 화면 + 사용자 화면), 문의 작성 전 FAQ 안내 — 권한 `content.manage` | DB-T4 |

### 5단계 — 정산·증빙 (출시 뒤 가능)

| 단위 | 내용 |
|---|---|
| U5-1 | 기간별 매출·환불 집계(일·월, 결제수단별), CSV 내보내기 — 권한 `reports.view` |
| U5-2 | 상품별 판매량·사용 크레딧 집계, 상품 목록 판매량 정렬 |
| U5-3 | 마켓 직권 환불(다운로드 검사 생략, 사유 필수) |
| U5-4 | 페이앱 영수증 주소 저장·표시, 증빙 요청 절차(런북) |
| U5-5 | 만료 예정 크레딧 표시 |
| U5-6 | 가격 변경 이력(U3-5 작업 기록으로 충족되는지 먼저 확인) |
| U5-7 | 결제 이력 회원 탈퇴(익명화) |

### 6단계 — 디자인 통일 외

공통 머리글·표·빈 상태·오류 상태 부품, `alert()`/`confirm()` → 토스트·확인 창, 이중 여백 제거, 표 가로 스크롤, 한글화, 3,629줄 `market-products-client.tsx` 분리, 날짜·금액 표기 통일(5-9), 약관 저장 충돌 보호(5-11), 관리자 2단계 인증(5-10, Q-K), 회원 정지·메모. 0~3단계에서 새로 만드는 화면은 처음부터 `Studio*` 공용 부품과 후기 관리 화면의 틀을 따른다.

## 6. DB 작업 목록

| ID | 내용 | 종류 | 순서 | 검증 |
|---|---|---|---|---|
| DB-S1 | 문의·알림 표 권한 축소 | 축소(앱이 쓰지 않는 권한) | 바로 | 독립 + RLS 관점 |
| DB-1 | `source_configs` RLS | 축소 | 바로 | 독립 1 |
| DB-3b | 공개 과목 설정 행 | 추가 | W1-7a 배포 뒤 | 독립 1 |
| DB-F1 / DB-F2 | `admin_disabled_features` 행 / 메뉴관리 묶음 추가 | 추가 | U0-5 코드 뒤 / W1-6·W2-6 뒤 | 독립 1 |
| DB-2 | 구매 기록 FK RESTRICT | 제약 | W1-1 배포 뒤 | 전문 3명 |
| DB-0 | 판매 중지·재개 SQL | 운영 SQL | 0B | 전문 3명 |
| DB-A1 | `admin_events` 4개 표·트리거·전송 작업·cron·publication | 추가 | 0B | 전문 3명 |
| DB-A2 | 알림 설정 행·재알림 cron | 추가 | DB-A1 뒤 | 독립 1 |
| DB-M1 | 메일 실패 기록 표·`mail_settings` 행 | 추가 | U1-6 코드 전 | 독립 1 |
| DB-P1 | `admin_role`, `admin_permission_grants`, 함수 2개 | 추가 | 2단계 전 | 전문 3명 |
| DB-4a' | 사이드바 구성 행 | 추가 | U3-1 코드 전 | 독립 1 |
| DB-7' | `admin_audit_log`(action CHECK 없음, amount 컬럼) | 추가 | DB-6'·DB-11' 전 | DB-6'과 한 묶음 |
| DB-6' | 지급 함수 개정(오버로드 추가 → 코드 → 옛 함수 DROP) | 추가 → 정리 | DB-P1·DB-7' 뒤 | 전문 3명 |
| DB-11' | 회수 함수 | 추가 | DB-7' 뒤 | 전문 3명 |
| DB-P2 | `is_admin`–`admin_role` CHECK | 제약 | 계정 생성 코드 배포 뒤 | 독립 1 |
| DB-P3 | RLS 쓰기 정책 47개 재분류 | 축소 | U3-3 배포 뒤 | 전문 3명 |
| DB-T1~T4 | 문의 강화 | 추가 | 4단계 | 단위별 |

- 대체 관계: DB-5 → DB-A1, DB-6 → DB-6', DB-7 → DB-7', DB-9a/9b/10 → DB-P1/P2/P3, DB-4a → DB-4a'. DB-4b(옛 사이드바 행 정리)·DB-12는 작업계획서대로.
- "DB 작업 전 덤프" 규칙 유지(무료 플랜, 자동 백업 없음).

## 7. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 진행 | 단위마다 구현 → 독립 검증 PASS → 커밋. push·배포는 사용자 결정 |
| 테스트 | `npx tsc --noEmit`(소스 오류 0), 바꾼 파일 eslint(새 오류 0), `node --test tests/*.test.mjs` 실패 목록이 기준선(현재 1375개 중 45건)과 같고 새 실패 없음 |
| 하드코딩 금지 | 메뉴 구성·꺼진 기능·권한 부여·한도·알림 기준·경보 코드별 통지·메일 문구는 DB. 권한 항목·의존·화면이 요구하는 권한·경로→기능 묶음·판정 규칙은 코드 |
| 로컬 | localhost:4000은 실서버 DB → 화면 조회만. 쓰기 확인은 배포 뒤 대표 시험 계정으로 |
| DB | 추가형은 DB 먼저, 축소·제약형은 코드 먼저. 실서버 BEGIN…ROLLBACK 리허설 PASS + 사용자 승인. 결제·크레딧·권한·알림 전송 DB는 전문 검증 3명 |
| 열지 말 화면 | `/admin/ai-question-generation-runs` — U0-5로 차단되기 전까지 로컬·실서버 모두 열지 않음 |
| 운영 시험 | 실서버 쓰기 시험은 대표 시험 계정과 시험 계정만 산 상품으로, 대상 id를 사전 승인받고, 끝나면 원복·SELECT 확인. **실결제가 필요한 시험(충전 환불 요청 등)은 `test` 요금제 1,000원 1건으로, 사용자 승인 뒤** |
| 표현 | 사이트는 출시 전(실사용자 없음). 다만 충전 판매 스위치는 켜져 있으므로 돈 관련 변경은 실제 고객이 있는 것처럼 다룬다 |

## 8. 완료 기준

- **0A**: 일반 회원 세션으로 `support_tickets.admin_response` 수정 불가. `source_configs` RLS 켜짐. 이력 있는 상품은 어떤 경로로도 삭제 불가(DB-2 뒤). 꺼진 기능의 URL·API가 대표 계정으로도 404이고 액션 직접 호출이 실패, 운영 화면은 모두 정상. 요금제 '판매중' 스위치가 확인 창을 거치고 실패를 표시(U0-6). U0-2 항목별 결정 기록.
- **0B**: 런북 작성(독립 검증 1회), 중지·재개 SQL 리허설 PASS, **대표가 RB-1·RB-2를 한 번 따라 함**. 시험 문의·시험 경보·master 스위치 변경이 슬랙에 도착하고, **대표(와 CS가 채널에 있다면 CS) 휴대폰 잠금 화면에 푸시가 뜸**. 웹훅을 등록하기 전 상태에서 전송 상태 행의 `last_run_error`가 `WEBHOOK_NOT_CONFIGURED`(0B에서는 SELECT로 확인, 화면 카드는 U1-2). 외부 감시의 시험 알림 도착, 하트비트를 끊으면(전송 cron을 승인 받아 잠시 해제) 감시 서비스가 알림 → 원복.
- **0C**: 사용자·크레딧·환불·대시보드 숫자가 같은 시점 SELECT와 일치.
- **1단계**: 시험 회원이 문의·마켓 환불을 보내면 관리자 화면에서 2초 안에 토스트·소리·배지, 다른 탭에서는 브라우저 알림, 슬랙 도착. 충전 환불 요청은 `test` 요금제 실결제 1건으로 확인. 한 사고에서 나온 여러 이벤트가 슬랙 메시지 1개로 묶임. 재알림은 U1-4 기준. 답변·환불 처리 시 사용자가 마켓 헤더 벨에서 확인, 메일 수신(U1-6).
- **2단계**: "결제했는데 크레딧 없음"(주문번호·이메일·거래번호 검색), "샀는데 다운로드 안 됨"(진단), "이 회원 내역", **영수증 요청(`mul_no` 검색 → 페이앱 화면)**을 화면만으로 처리. 대시보드 지표가 SELECT와 일치. **비밀번호 재설정: 외부 주소로 메일 수신 → 새 비밀번호 로그인, PC에서 요청 → 휴대폰에서 링크 열기**(Q-A가 풀린 경우. 아니면 런북 절차 확인).
- **3단계**: 사이드바에 쓰지 않는 기능 메뉴 0개. U3-9의 ①~⑤ 통과. 지급·회수·환불·권한 변경이 작업 기록에 남음. 잘못 지급한 크레딧을 화면에서 회수.
- 모든 단계: 독립 검증 PASS, 새 테스트 실패 없음.

## 9. 사용자 확인이 필요한 것

| Q | 질문 | 권장 |
|---|---|---|
| Q-A | 고객 메일 발송: Resend 도메인 인증과 Supabase SMTP 설정이 끝났는지(비밀번호 재설정·답변 메일의 전제) | 안 끝났으면 **지금** 대표가 설정(작업계획서 W0-8 절차) |
| Q-B | 4-1절 권한 항목이 맞는지 | 초안대로 시작(항목은 코드 한 곳이라 추가 쉬움) |
| Q-C | CS 계정 한도(1회 지급, 하루 지급, 마켓 환불 1건 승인) | 계정마다 대표가 입력 |
| Q-D | 차단 대상에 `/admin/roles`, `/admin/labels`, `/admin/landing-pages`, `/admin/menu-management`를 넣을지 | 넣는다(메뉴관리는 2차) |
| Q-E | 미답변 재알림 기준과 시간대 | 문의 4시간·환불 24시간, 09~21시에만 |
| Q-F | 사용자 메일 본문 범위 | 제목과 링크만 |
| Q-G | 관리자 알림 슬랙: 채널(새로 만들지), **받는 사람(CS도 채널에 넣을지 — 슬랙은 권한별로 걸러지지 않아 CS도 결제 경보를 본다)** | 새 채널·새 웹훅, 대표가 vault에 등록. CS 포함 여부는 대표 결정 |
| Q-H | U0-2 정리 대상, **특히 `test` 요금제(1,000원, 지금 누구나 구매 가능)**와 `accepted_provider_environment='test'` 값 | 시험이 끝나면 `test` 요금제 비활성. 환경 값은 결제 전문 검증 뒤 결정 |
| Q-I | 판매 중지 방법: SQL만(A-2) 유지할지, **휴대폰에서도 누를 수 있는 "판매 중지" 버튼(대표 전용, 중지만 — 재개는 SQL)**을 둘지 | 중지 버튼만 둔다. 스위치가 켜진 지금, 밖에서 문제를 알았을 때 멈출 수단이 필요 |
| Q-J | 기존 관리자 4명의 역할: 대표 본인 계정과 admin01~03 | 본인 계정만 owner, admin01~03은 staff 권한 0개(쓰지 않으면 삭제) |
| Q-K | 관리자 2단계 인증 시점 | CS 계정 발급 전(3단계 끝)으로 당기는 것을 권장 — 권한이 나뉘어도 대표 계정이 뚫리면 전부 뚫림 |
| Q-L | 회원 개인정보 마스킹·열람 기록(접속기록 법령 확인). 함께 판단할 한계: **권한이 0개인 관리자 계정도 자기 로그인으로 DB를 직접 조회하면 회원 이메일·결제 내역을 읽을 수 있다**(화면·API에서는 막힘, 4-1절) | 대표가 법령 확인 → 필요하면 U3-5에 열람 기록 추가. 쓰지 않는 관리자 계정은 권한 0개로 두지 말고 삭제·해제 |
| Q-M | 카페 결제 통보 경보(`PAYAPP_FEEDBACK_ORDER_NOT_FOUND`)의 알림 | 슬랙·소리 없이 화면 목록에만 |
| Q-N | 야간 알림: critical(판매 자동 중지, 통지 실패 등)은 밤에도 멘션으로 깨울지 | 깨운다. 그 밖은 아침에 모아서. 슬랙 방해 금지 시간에는 멘션도 푸시가 안 올 수 있으므로 대표 휴대폰의 슬랙 알림 일정을 8절 0B 푸시 확인 때 함께 점검 |
| Q-O | 통지가 멈췄을 때의 2차 수단: 외부 감시 하트비트(감시 서비스가 메일·앱으로 알림) | 사용한다(W0-9와 같은 서비스) |

### 9-1. 결정 결과 (2026-11-13 사용자)

| Q | 결정 |
|---|---|
| Q-G | 슬랙은 기존 채널(`create_ai_quiz`)을 그대로 쓴다. 대표가 그 웹훅 주소를 Vault에 `admin_alert_slack_webhook_url`로 등록(U0-4 때 안내) |
| Q-I | 대표 전용 "충전 판매 중지" 버튼을 둔다(중지만, 재개는 SQL) → U0-7 확정 |
| Q-H | `test` 요금제는 대표가 직접 끈다(AI는 건드리지 않음). 나머지 U0-2 항목은 조회 뒤 결정 |
| Q-J | 기존 관리자 4명은 그대로 둔다(테스트로 사용 중). DB-P1에서 **네 계정 모두 `owner`**로 시작하고, 조정은 대표가 권한 부여 화면에서 |
| Q-D | `/admin/roles`·`/admin/labels`·`/admin/landing-pages`는 0단계(U0-5)에서 차단 — 이 데이터를 읽는 곳이 관리 화면·예전 화면뿐임을 코드로 확인(`user_roles`는 관리 화면만, `display_labels`는 `features/bank/question-list`만, 랜딩은 `legacy/page.tsx`·`[workspaceSubject]/page.tsx`만). `[workspaceSubject]` 경로가 방문자에게 열리는지는 U0-5에서 확인해 열리면 먼저 보고. `/admin/menu-management`는 2차(U0-5b) |
| Q-A | Resend·Supabase 메일 설정 완료(수신 테스트는 아직). W3-7·U1-6 배포 때 실제 수신 확인 |
| 그 밖(Q-B, Q-C, Q-E, Q-F, Q-K~Q-O) | 해당 단계에 들어갈 때 확인. 그 전에는 권장안으로 진행 |

## 10. 위험과 대응

| 위험 | 대응 |
|---|---|
| 트리거가 결제·문의 등록에 영향 | 트리거는 잠금 없는 INSERT 한 줄, 예외는 잡되 한계(시간 초과·잠금 대기)를 인정하고 리허설에서 실행 시간 비교. 빠진 이벤트는 건수·재알림이 보완 |
| 알림 과다로 무시하게 됨 | `dedupe_key`, 묶음 전송, 경보 코드별 설정, 재알림 하루 1회·시간대 |
| 권한 검사 누락(페이지 39·route 78·액션 9파일) | 전수 계약 테스트 + RLS(DB-P3) 이중 방어 + U3-9 실제 계정 시험 |
| 권한 적용 중 대표가 잠김 | owner는 권한 표와 무관하게 통과, 마지막 owner 해제 금지, DB-P1 리허설에서 대표 계정 owner 확인 |
| 접근 차단이 운영 화면을 끊음 | 차단은 경로 접두 기준, 운영 화면이 대상 API를 부르지 않음을 확인(R1), 끊으면 안 되는 연결을 계약 테스트로 고정, 설정 읽기 실패 시 운영 경로는 영향 없음 |
| 슬랙으로 개인정보 유출 | 이벤트 제목·본문에 이메일·전화·본문 금지(트리거 SQL을 계약 테스트로 검사), 기존 `slack.ts` 제거 |
| Realtime 구독 실패 | 30초 폴링으로 전환·표시, 건수는 항상 업무 테이블 기준 |
| 지급 한도 동시성 | 행위자의 권한 행 `FOR UPDATE`로 직렬화, 두 세션 리허설 |
| 출시 스위치가 이미 켜져 있음 | 0B(중지 SQL·통지·런북)를 0A와 병행해 가장 먼저 |

## 11. 이번에 한 일 (계획 외 기록)

- 2026-11-13: 테스트 마켓 환불 요청 1건 삭제(`market_refund_requests` id `2267990d…`, `test003@test.com`, pending, 2,500C, 연결 행 없음 — 사용자 지시). 주문·권한은 그대로.
- 2026-11-13: 구매자 표시 이름 코드(e107427, 91cac00) push, 배포 READY(`dpl_3rKy4uKR19w12mr4F1pdvRsLN787`).

## 12. 검증 기록

| 회차 | 대상 | 검증 | 결과 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | G(운영자 관점) | **FAIL** | 1 스위치가 켜졌는데 경보 통지·중지 수단·런북이 뒤 순서 → 0B 신설 2 전송 작업이 멈춘 것을 모름 → 상태 행·카드·하트비트 3 휴대폰·야간 미검증 → 8절 푸시 확인, 시간대·멘션 설정 4 알림 누락(상태 전이)·과다(카페 경보, 시스템 생성 환불, 삭제 문의) → 종류·`dedupe_key`·코드별 설정 5 기존 단위 누락(W1-7 등) → 0-3 처리표 6 9절 질문 누락 → Q-I~Q-O 7 완료 기준 누락 → 8절 보강 8 권한 의존 규칙 없음 → 4-1 의존·한도 필수 9 페이지·액션 누락 방지 없음 → 가드 3종·전수 계약 테스트. 권고 반영: 접근 차단 앞당김, 회수를 3단계로, 건수 함수 하나로, 한도 초과 건 처리, 내 비밀번호 변경, `members.manage` 제외 |
| R1 | 초안 | H(개발 실현성) | **FAIL** | 1 지급 RPC가 이미 있음 → DB-6'(개정·오버로드·행위자 잠금·한도 순서) 2 RLS 범위 구멍 → 47개 정책 전체 분류, 함수에 `is_admin` 조건, 새 표 권한 회수, 조회는 범위 밖 명시 3 서버 액션·페이지 가드 → 가드 3종, 페이지별 호출, 액션 검사 4 트리거 권한·트리거 안 전송·전송 상태 → DEFINER·INSERT만·15초 cron·상태 표 분리 5 W 명세 변경 → 0-2 표 6 빠진 단위·사실 오류 → 0-3 표, 수치 정정(route 78·지역 가드 52, 미연결 35건, 정책 47개, U1-3 줄). 권고 반영: 미들웨어 차단, 권한 토대를 2단계 앞으로, U3-3 영역별 분할, `profiles` 조회 정책 유지, DB-7' 합침·CHECK 없음, 웹훅과 DB-A1 분리, 기존 관리자 통지 정리, 메일은 앱에서 직접 |
| R2 | 개정 1 | G | **PASS** | R1 9건 해소, 처리 경로 없는 업무 없음. 강한 권고 4건: `dedupe_key`가 영구라 재발이 묻힘, 카페 경보를 조용히 둘 자리와 건수 분리, Q-I 권장안의 단위 없음, 0B 기준이 1단계 화면에 기댐 |
| R2 | 개정 1 | H | **PASS** | R1 6건 해소. 문서에 못 박을 것 2건: 미들웨어 설정은 service role로 읽고 오류와 행 없음을 구분, 묶음 전송 기준과 포기 이벤트의 전송 제외. 구현 세부 권고 10건 |
| 확정 | 개정 1 + R2 권고 | 작성자 | 반영 | 미들웨어 읽기 방식, `delivery` 열(화면 전용 이벤트), `dedupe_key`에 전이 시각, 회차 단위 묶음, 카페 경보 건수 분리·일괄 해소, U0-7(조건부 중지 버튼), 옛 슬랙 호출 제거를 U0-4로, 하트비트 조건·주기, cron 기록 정리, DB-6' 세부(재요청 재판정·행위자 확인·충돌 비교 대상), U3-9 시험 권한, 0B 기준을 SELECT로. 설계 구조 변경 없음 |
