# 관리자 페이지 운영 준비 점검·개선 계획

- 작성일: 2026-10-28 · 기준 HEAD 3cf3a90(main) · 상태: **확정안 — 독립 검증 PASS(R4), 사용자 결정 반영(2026-10-29, 10-1절)**
- 요청: "관리자 페이지 전문가 입장에서 현재 관리자 페이지를 분석해 문제점을 확인하고 개선 계획을 작성. 사용 안 하는 메뉴는 legacy로 따로 두고, 현재 쓰는 메뉴로만 정리. 곧 운영에 들어가니 운영에 필요한 기능·부족한 기능 확인."
- 사용자 전제(2026-10-28): 운영 서비스는 **문제마켓 하나**, 문제은행·문제생성은 사용 안 함. '(임시)' 메뉴(메인광고설정, 문제마켓 메인 관리)는 사용 중인 정식 메뉴. 사용자 화면의 예전 기능은 `src/app/legacy`로 이미 옮김. 운영 인력은 **대표 1명, CS 1명**.
- 이 문서는 **분석과 계획**이다. 코드·DB는 바꾸지 않았다. 조사는 코드 읽기와 운영 DB SELECT(개인정보는 집계만)로 했다.
- 조사 방법: 영역별 현황 조사 3명(A 콘텐츠·AI, B 마켓·사이트, C 회원·결제·CS) → 관점별 분석 3명(D 운영 업무, E 권한·보안·감사, F 정보구조·UX) → 이 계획서 → 독립 검증 2명(G 운영자 관점, H 개발 실현성). 근거는 `file:line` 또는 "DB 확인".

## 0. 이전 계획과의 관계

`docs/admin-redesign-proposal.md`(2026-10-02, 이하 "10-02 제안서")와 `docs/admin-phase1a-plan.md`가 있다.

| 항목 | 상태 |
|---|---|
| 1a U1·U2(문제마켓 그룹 카드 제거, 과거 화면으로 새는 링크) | 완료(87a2d28) |
| D14 홈 '교재와 출처' 섹션 삭제 | 완료(d128874) |
| 1a 나머지(대시보드 지표 P0-1, 회원 서버 페이지네이션 P0-2, `/checkout` 크롬 P0-5) | **미완** — 이 문서 1·3단계로 흡수 |
| 1b 사이드바·과목 전환(D15 B, D16 공통 순서, 4-4 DB 저장 구조) | **미완** — 이 문서 2단계로 흡수 |
| Phase 2 디자인 통일, Phase 4 정리 | 미착수 — 이 문서 6단계(P2)에 그대로 남김 |
| 10-02 이후 사용자 요청으로 생긴 것 | 과목별 메뉴 이름 바꾸기(b58023a), 국어 우선 과목 전환(48c5103), 상품 등록·관리 메뉴 분리(f0198c2) |

확정 결정 D1~D17은 그대로 따른다. 이번 분석으로 **다시 정해야 할 것**은 10절에 모았다(레거시 보관 방식 D1, 결제 설정 화면 D7, 메뉴 이름안 D8, 영어 운영 D11, 메뉴 이름 저장 방식).

## 1. 핵심 결론

1. **메뉴 31개 중 문제마켓 운영에 필요한 것은 16개**(통합하면 메뉴 13개 + 신설 2개). 나머지 15개(문제은행·AI·문제생성·지문·출처·표기값·랜딩·회원가입 역할, 그리고 사이트 로고만 옮기고 남는 메뉴관리)는 문제마켓 사용자 화면·마켓 관리 화면과 **코드·데이터 의존이 없음**을 import 추적과 DB로 확인했다 → 레거시.
2. **지금 바로 막아야 할 데이터 위험 2건**: 상품 '완전 삭제'가 이미 산 사람의 주문·다운로드 권한·환불·후기를 연쇄 삭제한다(구매 이력 상품 11개, 주문 17건). `source_configs` 테이블은 RLS가 꺼져 공개 키로 누구나 수정·삭제할 수 있다.
3. **CS 업무의 출발점이 막혀 있다**: 결제 주문 조회(주문번호·페이앱 `mul_no`·카카오 `tid`), 마켓 구매 주문 조회, 회원 상세 화면이 없다. "결제했는데 크레딧이 없어요", "다운로드가 안 돼요", 영수증 요청을 화면으로 처리할 수 없다. 고객 쪽에도 비밀번호 찾기가 없고(우회로도 없음), 문의 답변이 와도 고객이 알 방법(마켓 알림 벨·이메일)이 없다.
4. **결제 경보를 아무도 모른다**: health가 판매를 자동으로 꺼도 외부 통지가 없고, 판매가 꺼졌는지 보여 주는 화면도 없다. 경보는 `/admin/refunds`를 열어야 보이는데 그 페이지는 조회 실패를 "경보 없음"으로 보여 준다.
5. **이미 고장 난 표시 4곳**: 대시보드(문제은행 지표, 없는 테이블 조회로 0 고정, "정상 작동 중" 고정 문구), 사용자 관리 크레딧 전원 0C(없는 테이블 `user_credits`), 크레딧 관리 환불 필터·통계 0(없는 컬럼 `transaction_type`), 사용자 관리 20명 한계.
6. **대표/CS 권한 구분이 없다**: 권한은 `profiles.is_admin` 하나. CS 계정을 지금 만들면 대표 비밀번호 변경·관리자 삭제·약관 수정·환불 실행·결제 수동확인까지 모두 할 수 있다. 관리자 크레딧 지급은 지급자·사유가 원장에 남지 않는다.

## 2. 메뉴별 판정

| # | 현재 메뉴 (href) | 판정 | 근거 (요약) | 새 위치 |
|---|---|---|---|---|
| 1 | 대시보드 `/admin` | 유지·재작성 | 문제은행 지표, `admin_logs`(없는 테이블)·`amount.sum()`(집계 미허용)으로 0 고정, 시스템 상태 고정 문구(`dashboard-client.tsx:301-330`, `api/admin/stats/route.ts:110-189`) | 맨 위 |
| 2 | 메뉴관리 `/admin/menu-management` | 분할 → 레거시 | 헤더·문제생성·라이브러리 메뉴 설정은 예전 헤더만 읽음(마켓 헤더는 `CategoryMegaMenu`). 사이트 로고(마켓 헤더·푸터 반영)만 유지 → '사이트 정보·약관'으로 이동. 관리자 사이드바 순서 편집은 2단계 저장 구조로 대체. 단 `/checkout`이 예전 헤더 설정을 아직 읽음(1단계 1-6에서 해소) | 레거시(로고는 설정으로) |
| 3 | 랜딩페이지 관리 | 레거시 | `/legacy`, `/english`, `/korean`만 사용 | 레거시 |
| 4 | (임시)메인광고설정 | 유지 | 홈 상단 광고(`(solvook)/page.tsx:30-31`) | 문제마켓 ▸ 홈 화면(탭) |
| 5 | (임시)문제마켓 메인 관리 | 유지·통합 | 인기·최신 영역 설정 4개, 저장 행 0건(기본값 동작) | 문제마켓 ▸ 홈 화면(탭) |
| 6 | 문제마켓 상품 등록 | 통합 | 상품 관리와 같은 컴포넌트(`mode="create"`), 목록에 등록 버튼 있음(`market-products-client.tsx:2235`). `/new` 라우트는 유지 | 문제마켓 ▸ 상품 |
| 7 | 문제마켓 상품 관리 | 유지 | 국어 공개 147·임시 1 | 문제마켓 ▸ 상품 |
| 8 | 문제마켓 이미지 관리 | 유지 | 상품 이미지 선택기와 같은 저장소 | 문제마켓(공통) ▸ 이미지 보관함 |
| 9 | 카테고리 메뉴 관리 | 유지 | 국어 61, 영어 0. 메가메뉴·`/categories` | 문제마켓 ▸ 카테고리 |
| 10~14 | 문제 목록·업로드·연도교재·문제유형·백필 | 레거시 | 문제은행 미사용. 관리자 업로드 문제 0건, metadata 0건 | 레거시 |
| 15 | 국어/영어지문 관리(+`/models`, `/prompts`) | 레거시 | 실제로는 AI 프롬프트·모델 설정. 사용처는 `(dashboard)/generate`·legacy뿐 | 레거시 |
| 16 | AI 문제 유형 관리 | 레거시 | 문제생성 전용 | 레거시 |
| 17 | AI API 연결 관리 | 레거시 | 마켓에서 `lib/ai/*` import 0 | 레거시 |
| 18 | AI 생성 로그 | 레거시 | 102건 모두 만료. **페이지를 열면 만료 로그 상세가 영구 삭제됨**(`ai-question-generation-runs/page.tsx:20`) | 레거시(경고 표시) |
| 19 | 출처 관리 | 레거시 | 마켓 상품의 출처는 자유 입력(`market-products-client.tsx:2909`). 마켓 메인 설정의 바로가기 링크만 있음(`market-main-settings-client.tsx:77`) | 레거시 |
| 20 | 표기값 관리 | 레거시 | `display_labels`를 읽는 곳이 관리 화면 자신뿐(죽은 기능) | 레거시 |
| 21 | 문제생성 상품 관리 | 레거시 | 문제생성 전용 | 레거시 |
| 22 | 사용자 관리 | 유지·보강 | 회원을 찾는 유일한 화면. 0C 오표시, 20명 한계, `select('*')` | 고객 응대 ▸ 회원 |
| 23 | 회원가입 관리 `/admin/roles` | 레거시 | `user_roles`를 가입 화면이 쓰지 않음(회원 13/14 role null) | 레거시 |
| 24 | 고객지원 관리 | 유지·보강 | 마이페이지 1:1 문의 처리 | 고객 응대 ▸ 문의 |
| 25 | Footer 설정 | 유지·개명 | 푸터 + **약관 원문**(`terms/page.tsx:12`) | 설정 ▸ 사이트 정보·약관(+로고) |
| 26 | 요금제 관리 | 유지 | 페이앱·카카오 주문 API가 읽음(`api/payments/payapp/orders/route.ts:150`). **절대 레거시 금지** | 설정 ▸ 충전 상품 |
| 27 | 크레딧 관리 | 유지·보강 | 환불 필터 고장, 100건 한계, 차감 없음, 지급 감사 없음 | 고객 응대 ▸ 크레딧 |
| 28 | 환불 관리 | 유지·보강 | 충전 환불 + 결제 수동확인·경보 + 마켓 환불이 한 페이지 | 고객 응대 ▸ 환불·결제 확인 |
| 29 | 후기 관리 | 유지 | 국어 3건 | 문제마켓 ▸ 후기(탭) |
| 30 | 후기 태그 관리 | 통합 | 09-01 이후 수정 없음 | 문제마켓 ▸ 후기(탭) |
| 31 | 관리자 ID 관리 | 유지·보강 | 역할 구분 없음, 삭제 시 처리자 기록·주문 연쇄 문제 | 설정 ▸ 관리자 계정 |
| — | `/dashboard/admin/passages` 옛 경로 | 레거시(메뉴 아님) | `(admin)` 레이아웃 밖이라 관리자 가드 없음, `(admin)` 쪽과 중복 | 레거시 목록에만 |

## 3. 문제점

### 3-1. 데이터·보안 위험 (즉시)

| ID | 위험 | 근거 | 영향 |
|---|---|---|---|
| R1 | 상품 완전 삭제가 구매 기록 연쇄 삭제 | `api/admin/market/items/[id]/route.ts:207-235`가 `requireNoHistory` 미전달. `market_items`를 참조하는 FK 13개가 모두 ON DELETE CASCADE이고 `market_purchase_orders`, `market_purchase_lines`, `market_entitlements`, `market_refund_requests`, `market_purchases`, `market_download_events`, `market_item_reviews`가 포함(DB 확인). 파일을 DB보다 먼저 지움(`lib/market-item-cleanup.ts:169-176`). 이력 오류도 route가 500으로 반환(`route.ts:225-242`). 이력 판정 `getItemsWithHistory`에 lines·refund_requests 누락. 확인창에 구매자 경고 없음, 일괄 삭제도 같은 경로 | 구매자의 다운로드 권한·주문·환불 기록 영구 소실 |
| R2 | `public.source_configs` RLS 꺼짐 | anon·authenticated에 DELETE·INSERT·UPDATE·TRUNCATE(advisor ERROR) | 공개 키로 누구나 수정·삭제 |
| R3 | AI 생성 로그 페이지 진입 = 데이터 삭제 | `ai-question-generation-runs/page.tsx:20` → `pruneExpiredAiQuestionGenerationRuns()` | 만료 로그 102건 상세 영구 삭제 |
| R4 | Footer 저장이 약관까지 전체 덮어쓰기, 버전 확인 없음 | `lib/footer-content-server.ts:49-57` | 오래 열린 화면에서 저장하면 B1 약관(마이그레이션으로 고친 문구)이 되돌아감 |
| R5 | 영어 테스트 데이터 공개 | `main_ad_carousel.items.english` 3개("광고제목 테스트", alt "ㅇㅇ", 링크 `/english`), 영어 상품 "샘플 테스트" 공개. 사용자 헤더에 영어 전환 버튼 있음(`preview-header.tsx:15,232`) | 누구나 테스트 광고·상품을 봄 |
| R6 | 관리자 계정 삭제의 부작용 | 처리자 기록 `refund_requests.processed_by`·`market_refund_requests.processed_by` FK SET NULL. 그 계정의 마켓 주문·`credit_transactions` CASCADE. `market_item_sample_pages.created_by` FK가 있는데 코드 주석은 없다고 가정(`admin-accounts-server.ts:189-197`) → 부분 실패 가능(추정) | 감사 기록·주문 소실 |
| R7 | 관리자 로그인 보안 | 유출 비밀번호 차단 꺼짐(advisor WARN), MFA 0건, 비밀번호 8자, 앱 단 시도 제한 없음 | 관리자 계정 탈취 위험 |
| R8 | 관리자 JWT로 돈 관련 테이블 직접 쓰기 가능 | `credit_sources`, `market_entitlements`, `market_purchase_*`, `refund_requests`, `market_refund_requests`, `payment_history`, `pricing_plans`, `market_items`의 RLS가 `is_admin()`에 `ALL` 허용. 앱 쓰기는 대부분 service role이지만 **요금제 관리는 세션 클라이언트로 `pricing_plans`를 씀**(`pricing/actions.ts:3,13-103`), 레거시 출처 관리도 세션 클라이언트(`api/admin/source-configs/route.ts:23,76`) | 지금은 관리자 4명 모두 신뢰라 작음. **CS 역할을 만들면 앱 권한을 우회하는 통로** |

### 3-2. 운영 업무 공백

| ID | 공백 | 근거 |
|---|---|---|
| G1 | 결제 주문 조회 없음(주문번호·`mul_no`·`tid`·이메일 검색, 결제·대사 상태) | 관리자 화면 중 `payment_orders`를 읽는 곳은 `manual_review` 목록뿐(`refunds/page.tsx:68-84`). 그 목록에도 고객 이메일·`mul_no` 표시 없음 |
| G2 | 마켓 구매 주문·다운로드 권한·다운로드 기록 조회 없음 | `market_purchase_orders`(17), `market_entitlements`, `market_download_events`를 보는 관리자 화면 없음 |
| G3 | 회원 상세(통합 이력) 없음 | `/admin/users/[id]` 없음 |
| G4 | 결제 경보 외부 통지·판매 상태 표시 없음 | 경보는 DB pg_cron `payment-reconciliation-health-5m`(`enforce_payment_reconciliation_health()`)이 만들고 판매도 끔. 대사는 별도 cron `payment-reconciliation-http-5m` → `api/internal/payments/reconcile`. health 함수는 경보 행만 남기고 통지하지 않음. `payment_reconciliation_alerts`에는 통지 기록 컬럼이 없음(DB 확인). 슬랙 통지(`sendSlackNotification`)는 1:1 문의에만 사용(`api/support/route.ts:77`). 결제 경보 알림은 `notifications` 표에만 들어가 예전 헤더 벨에서만 보임 |
| G5 | 카카오페이 `manual_review` 해소 경로 없음(부분취소 1종 제외) | `allowedReviewActions`(`payment-review-actions.ts:29-46`)와 DB RPC 가드가 카카오에 지급·미결제 처리를 주지 않음. 수동확인 1건이면 카카오 판매가 꺼진 채로 남음 |
| G6 | 크레딧 수동 차감 없음, 지급 감사 없음 | `grantCreditsAsAdmin`(`src/lib/credits.ts:396-458`)에 지급자·사유 없음, 설명 "크레딧 N개 구매"·type `purchase`, insert 여러 개가 트랜잭션 밖 |
| G7 | 마켓 고객 화면에 알림 벨 없음, 이메일 발송 없음 | 벨은 `SiteChrome`(예전 헤더)에만, 마켓 `PreviewHeader`에 없음. 메일·알림톡 발송 코드 없음 → **문의 답변 도착**(`inquiry_reply` 알림 5건이 저장만 됨), 환불 완료, 크레딧 지급을 고객이 알 수 없음 |
| G8 | 고객 비밀번호 찾기 없음, 우회로도 없음 | 로그인 화면 링크·`resetPasswordForEmail`·recovery 처리 없음. 마이페이지 비밀번호 변경은 **기존 비밀번호 확인이 먼저**(`(solvook)/mypage/profile/_components/profile-view.tsx:118-140`)라 복구 메일로 로그인해도 바꿀 수 없음. 회원 14명 중 이메일 가입 12명 |
| G9 | 결제 이력 회원 탈퇴 처리 도구 없음 | 회원은 탈퇴가 막히고 문의로 유도됨(`api/auth/withdraw/route.ts:33-44`), 관리자 쪽 처리 없음 |
| G10 | 월별 매출·환불 집계·내보내기 없음 | 결제사 정산과 대조할 자료 없음 |
| G11 | 마켓 하자 상품(다운로드 이력 있음) 환불 불가 | `market-refunds.ts:354-358`. 서명 URL만 발급돼도 다운로드로 계산 |
| G12 | 판매 재개·수동 중지는 마이그레이션뿐, 재개 SQL도 아직 없음 | D7(결제 설정 화면 만들지 않음)에 따른 설계. 체크리스트 출시 5는 "재개 마이그레이션을 새로 만든다"(`payapp-db-migration-checklist.md:225`)이고 미리 만든 재개 SQL은 없음. health는 페이앱 미지급 1건이 10분만 넘어도 판매를 끔 → 자동 중지 1회마다 작성·리허설·승인을 거쳐 수 시간 판매 중단 가능. 10절 Q4 |

### 3-3. 고장·오표시

| ID | 문제 | 근거 |
|---|---|---|
| B1 | 대시보드가 운영과 무관하고 0 고정, "정상 작동 중" 고정 | 위 2절 1번. "오늘"이 서버 로컬 자정(`stats/route.ts:26-27`, UTC 추정), 테스트 결제가 매출에 섞임 |
| B2 | 사용자 관리 크레딧 전원 0C | 없는 테이블 `user_credits`(`users/page.tsx:22-25`). 잔액 출처는 1a U4 결정대로 `credit_sources`의 사용 가능 잔액(사용자 화면과 같은 값, `profiles.credits`는 캐시) |
| B3 | 사용자 관리 20명 한계, 검색도 그 안에서, 페이지 넘김 비활성 | `users/page.tsx:9-15`, `users-client.tsx:62-68, 262-279` |
| B4 | 크레딧 관리 환불 필터·통계 0, 환불이 지급 합계에 섞임 | 없는 컬럼 `transaction_type`(`credits/page.tsx:43-45`, `credits-client.tsx:34,70-73`). 실제 컬럼 `type`의 값은 `consume`·`purchase`·`refund`(필터 값 `system_refund` 등도 맞지 않음). 최근 100건만 |
| B5 | 환불 관리 조회 오류 무시 → "경보 없음·요청 없음"으로 보임 | `refunds/page.tsx:38,70,100,106` |
| B6 | 환불 관리 기본 필터가 '대기중'만 → 재처리 필요·수동확인 필요 건이 목록에 안 보임 | `refunds-client.tsx:138` |
| B7 | 마켓 환불 승인·거부 실패가 화면에 안 보임, 확인 창·메모·상품명 없음, 사용자 UUID 원문 | `market-refunds-client.tsx:38-55, 87, 94, 99-113` |
| B8 | 충전 환불 승인 다이얼로그 금액이 요금제 현재 가격 | `refunds-client.tsx:480` |
| B9 | 사용자 관리 화면의 크레딧 지급에 확인 단계·사유 필수 없음 | `users-client.tsx:78-150`(크레딧 화면 `grant-credit-dialog.tsx`에는 확인 있음) |
| B10 | 문의 답변이 화면상 1회, API는 덮어쓰기(이력 없음), 답변자 미기록, 관리자 답변 경로 중복 | `support-client.tsx:586-604`, `api/admin/support/tickets/[id]/route.ts:48-58`, `api/support/route.ts:100` |
| B11 | 요금제 '판매중' 스위치가 확인 없이 결제 화면에 즉시 반영, 실패는 console만 | `pricing/pricing-plans-client.tsx:56-66` |
| B12 | 날짜가 브라우저 시간대(KST 지정 없음), 금액 표기 `₩`/`원`·`C`/`크레딧` 혼재 | F 보고 file:line 목록(5단계 5-9) |
| B13 | `/checkout`이 예전 헤더 → 메뉴관리의 예전 헤더 메뉴(문제생성 등) 노출 가능 | `app/checkout/layout.tsx`가 `<SiteChrome>` 사용(20c3c94), `lib/header-navigation-server.ts:86`(화면 미확인). 결과 화면은 `checkout/payapp/result`, `checkout/kakaopay/result` |
| B14 | 마켓 메인 설정의 '카테고리 관리' 링크가 `/admin/menu-management`로 잘못 연결, 출처 관리(레거시) 링크 | `market-main-settings-client.tsx:74-79` |

### 3-4. 권한·감사

- 서버의 관리자 검사 누락은 **문제마켓 관련 route·action에서 없음**(E 전수 점검: route 78개, 핸들러 126개). 누락은 레거시 쪽(`ai-models`·`providers` GET, `labels/actions.ts`, `problem-types/actions.ts`, `/dashboard/admin/passages`)뿐이고 RLS가 쓰기를 막는다.
- 검사 함수가 3종(`requireAdminPanelUser`, `requireAdmin`, `requireMarketImageAdmin`) + 지역 복사본 약 50곳. 동작은 같아서 정리하지 않는다(필요한 곳에만 역할 검사 추가).
- 감사: `payment_admin_actions`(append-only, 잘 설계됨)는 결제 확인·경보 해소·수동 환불·거절·페이앱 취소만 기록, 운영 건수 0. 충전 환불 "승인"(`claim_point_charge_refund`), 크레딧 지급, 관리자 계정 생성·삭제·비밀번호 변경, 요금제 변경, 약관 저장, 상품 삭제·상태 변경, 마켓 환불, 문의 답변은 감사 없음. 조회 화면 없음.

### 3-5. 구조·사용성

- 사이드바: 31개 평면 목록, '문제마켓' 묶음은 6개뿐(후기·Footer는 밖), '문제은행' 묶음은 전부 레거시.
- 사이드바 순서·이름이 과목별로 따로 저장됨(`workspace_settings.admin_sidebar_navigation`): 국어 31개·'(임시)' 제거 이름 2개, 영어 18개(옛 순서)·이름 변경 없음 → 과목을 바꾸면 메뉴가 달라짐. 10-02 제안서 D16(공통 1벌)과 반대 상태.
- 과목 전환 버튼과 "현재 관리 대상"이 과목 무관 화면(회원·환불·요금제 등)에도 표시됨(`admin-sidebar-client.tsx:234-235`).
- 공통 부품(`useListQuery`, `StudioListPagination`, `StudioPageHeader`)이 있으나 상품·후기만 사용. 관리자 영역에 `loading.tsx`·`error.tsx` 없음, `alert()`·toast 혼재.
- 대형 파일(`market-products-client.tsx` 3605줄)은 리팩터링 근거가 없어 손대지 않는다(필요한 줄만 수정).

## 4. 운영 업무 처리 가능 여부 (D 시나리오 요약)

- '담당'은 4a(역할 분리) 이후 기준이다. **4a 전에는 CS 계정을 발급하지 않으므로(0-4, Q7) 아래 CS 업무도 모두 대표가 처리**한다. 오픈 첫 주 대표 업무량은 이 표 전체다.

| 업무 | 담당 | 지금 | 해소 작업 |
|---|---|---|---|
| 아침 점검(대기 건·경보·판매 상태) | 대표 | 불가(대시보드 고장) | 1-4, 3-3 |
| 아침 점검(매출·가입 지표) | 대표 | 불가 | 5-13(그 전에는 결제사 관리자 화면) |
| 결제했는데 크레딧 없음 | CS→대표 | 불가(결제 건 조회 없음) | 3-1 |
| 다운로드 안 됨 | CS | 불가(주문·권한 조회 없음) | 3-2 |
| 문의 답변 도착 안내 | CS | **불가**(고객이 답변을 알 수 없음) | 3-8, 그 전에는 런북 RB-8 |
| 고객 비밀번호 분실 | CS | **불가**(우회로 없음) | 0-8(메일 발송 전제) + 3-7 |
| 영수증(매출전표) 요청 | CS | 불가(`mul_no`를 모름) | 3-1 + 런북 RB-5 |
| 충전 환불(고객 요청) | 대표 | 가능(금액 표시 오류) | 1-3 |
| 휴대폰 당월 경과·정산 후 환불 | 대표 | 가능(계좌 송금 후 수동 완료) | 런북 RB-6 |
| 마켓 환불 | CS | 부분(확인·메모·오류 표시 없음) | 1-3 |
| 하자 상품 환불 | 대표 | 부분(크레딧 보상으로 우회) | 5-7, 런북 RB-7 |
| 보상 크레딧 지급 | CS | 부분(감사 없음) | 3-5 |
| 잘못 지급한 크레딧 회수 | 대표 | 불가 | 5-2, 그 전에는 런북 RB-4 |
| 고객 잔액 안내 | CS | 불가(0C 오표시) | 1-2 |
| 상품 등록·가격 변경·판매 중지 | 대표(Q14 (나)면 4a 후 CS도, 0-1 숨김 수칙은 CS에게도 적용) | 가능 | — |
| 상품 삭제 | 대표 | **위험** | 0-1, 1-1, DB-2 |
| 메인 광고·카테고리 변경 | 대표 | 가능 | — |
| 약관 수정 | 대표 | 부분(덮어쓰기 위험) | 0-5, 5-11 |
| 결제 경보 인지 | 대표 | **불가** | 3-3 |
| 사이트·결제 통보 URL 다운 인지 | 대표 | 불가 | 0-9 |
| 경보 대응·판매 재개 | 대표 | 재개 SQL 없음 | 0-7, 런북 RB-1·RB-2 |
| CS 퇴사·계정 회수 | 대표 | 부분(삭제 시 기록 소실) | 4-6, 런북 RB-9 |
| 월말 정산 대조 | 대표 | 불가 | 5-12, 그 전에는 런북 RB-10 |
| 결제 이력 회원 탈퇴 | 대표 | 불가 | 5-6, 그 전에는 런북 RB-11 |

## 5. 목표 사이드바 구조

10-02 제안서 D15(과목을 1단계 묶음으로 펼침)·D16(과목 메뉴 순서 공통 1벌)·D17(후기는 과목 메뉴)을 따른다. 과목 전환 토글은 없어지고 과목 메뉴 링크가 과목을 직접 담는다(`?subject=`). 과목 무관 화면에는 과목 표시가 없다.

```
대시보드(오늘 할 일) ................... /admin
고객 응대
  문의 .................................. /admin/support
  환불·결제 확인 ........................ /admin/refunds          (경보·판매 상태를 맨 위로)
  주문 조회 (신설) ...................... /admin/orders           탭: 충전 결제 | 마켓 구매
  회원 .................................. /admin/users            (회원 상세 /admin/users/[id]는 메뉴 아님)
  크레딧 ................................ /admin/credits
문제마켓 · 국어
  상품 .................................. /admin/market/products?subject=korean   (/new 포함)
  카테고리 .............................. /admin/market-categories?subject=korean
  홈 화면 ............................... /admin/main-ad-settings?subject=korean  탭: 광고 배너 | 진열 설정
  후기 .................................. /admin/reviews?subject=korean           탭: 후기 | 태그
문제마켓 · 영어   (국어와 같은 4개, ?subject=english — Q3에 따라 표시 여부는 데이터로)
이미지 보관함 ........................... /admin/market/images
설정
  충전 상품 ............................. /admin/pricing
  사이트 정보·약관 ...................... /admin/footer           (+ 사이트 로고 섹션 이동)
  관리자 계정 ........................... /admin/admin-accounts
  작업 기록 (신설, 대표 전용, 4b) ....... /admin/audit-log
레거시 ................................. (Q1: 접힌 묶음 또는 /admin/legacy 목록)
```

- 메뉴 13개 + 신설 2개. 탭 통합(홈 화면, 후기)은 **라우트·컴포넌트를 합치지 않고** 두 화면 위에 탭 링크를 두고, 사이드바 항목이 두 경로 모두에서 강조되도록 한다(`activeHrefs`).
- **D8과의 차이(Q10)**: 10-02 트리와 비교해 묶음 이름(회원·고객/결제/사이트 설정 → 고객 응대/설정), 항목 이름(이미지 라이브러리 → 이미지 보관함, 충전 상품 유지), 과목 메뉴에서 출처 관리·게시판 메뉴 제외(둘 다 쓰는 곳이 관리 화면과 예전 헤더뿐, `market-board-server.ts`는 이미 삭제), **'관리자 메뉴 구성' 화면 제외**(국어 저장 순서가 예전 기본 순서와 같아 실제로 쓴 적 없음). 메뉴 구성을 바꿀 때는 사이드바 구성 데이터를 마이그레이션으로 수정한다.
- 묶음 순서 가정: 고객 응대가 문제마켓보다 위(Q6).

## 6. 레거시 처리

- **삭제하지 않는다.** 라우트 파일·API·테이블·URL 모두 그대로. 사이드바 기본 구성에서만 빠진다.
- 레거시 대상: 2절 판정이 '레거시'인 15개 메뉴 + `/passages/models`, `/passages/prompts`, `/problem-types/[id]/test`, `/dashboard/admin/passages`.
- 레거시 목록은 사이드바 구성 데이터(`legacy` 항목)에서 읽는다(10-02 4-4). 문제은행·AI·문제생성처럼 데이터가 영어에만 있는 레거시는 항목에 `subject: english`를 넣는다(관리자 기본 과목이 국어라 빈 화면이 열리지 않게, 10-02 4-2 표).
- 레거시 화면 진입 시 상단에 "레거시 화면 — 현재 서비스에서 쓰지 않음" 띠(레이아웃의 작은 클라이언트 컴포넌트, 현재 경로가 레거시 목록에 있는지로 판단).
- 주의 표시: AI 생성 로그(진입 시 만료 로그 삭제, R3), 메뉴관리(1-6 전까지 결제 화면 헤더가 읽음).
- 보관 방식(Q1): (a) 사이드바 맨 아래 **접힌 '레거시' 묶음**(10-02 D1) 또는 (b) 사이드바에서 빼고 **`/admin/legacy` 목록 페이지**에서만 진입.
- 레거시로 빼도 지켜야 할 연결:
  - `market-products-client.tsx:73`의 `@/lib/generate-menu` 상수 import → lib 파일 이동 금지.
  - **메뉴관리(레거시)가 사이드바 헬퍼에 의존**: `menu-management-client.tsx:64-73`이 `resolveAdminSidebarNavigationNodes`·`moveAdminSidebarNavigationNode`·`moveAdminSidebarHref`·노드 타입을 import, `menu-management/actions.ts:7-16,129,156-169`이 `getAdminSidebarNavigationConfig`·`saveAdminSidebarNavigationConfig` 사용. 2-2에서 이 화면의 '관리자 메뉴 순서' 카드를 제거하고(옛 저장소에 다시 쓰지 않게) 나머지 카드(헤더·문제생성·라이브러리 메뉴)는 그대로 둔다.
  - `renameAdminSidebarMenuAction`은 `menu-management/actions`에 있고 사이드바만 import → export 이름 유지(저장소만 바꿈). 같은 파일의 listboard 액션은 `generate-products-client.tsx:43-47`·`generate-product-edit-client.tsx:28-32`가 import → 그대로 유지.
  - 대시보드 `/admin/questions` 링크(1-4에서 제거), `market-main-settings-client.tsx:74-79` 링크(2-5, 테스트 `market-home-admin-route-contract.test.mjs:56-57,62-63` 함께 수정), 관리자 계정 삭제의 `generate_listboard_*` 갱신(4-6).
  - `questions`·`system_settings`·`pricing_plans` 테이블은 지우지 않는다(마이페이지 활동·회원 탈퇴·푸터·로고·광고·결제).

## 7. 개선 계획

원칙: 단위마다 구현 → 독립 검증 PASS → 다음 단위(검증 루프). 하드코딩 금지(데이터는 DB). 필요한 줄만 수정. DB 순서는 8절 규칙(추가형은 DB 먼저, 축소·제약은 코드 먼저). DB 쓰기는 운영 BEGIN…ROLLBACK 리허설 PASS + 사용자 승인 후. 결제·환불·크레딧 DB 변경은 역할별 전문 검증 3명 PASS 필수. push는 사용자가 결정.

### 7-0. 실행 순서

```
0단계(수칙은 즉시, 런북·재개 SQL은 스위치 전)
 → 1단계(P0 안전·고장)
 → 3단계 P0(3-1·3-2·3-3·3-7·3-8)
 → ── 페이앱 출시 스위치(Q8) ──
 → 2단계(메뉴 정리: 스위치를 막지 않음, 인력이 되면 1·3단계와 병행 가능)
 → 3-5 → 4a(역할 분리: CS 계정 발급 전 필수, Q7. CS가 급하면 2단계보다 먼저)
 → 5단계(P1)·4b
 → 6단계(P2)
```

- 3-5(크레딧 지급 감사)는 4a 전에는 대표만 지급하므로 스위치 조건이 아니라 **4a의 선행 조건**이다(4-2의 CS 지급 한도가 3-5 RPC에 의존).
- DB-2(구매 FK RESTRICT)는 전문 검증 3명이 필요해 기간이 길다. 관리자 화면 경로는 1-1이 막고, 남는 통로(관리자 JWT 직접 호출)는 관리자 4명이 모두 대표 측이라 스위치를 막지 않는다 → 3단계와 병행.

### 0단계 — 개발 없이 바로

| ID | 내용 | 누가 / 산출물 |
|---|---|---|
| 0-1 | 상품은 **완전 삭제하지 말고 상태를 '숨김'(hidden)으로**(CS가 상품을 편집하게 되면 CS에게도 적용). '보관'(archived)은 서재·다운로드가 `deleted_at`으로 거를 수 있어(추정) 1-1 전까지 쓰지 않음 | 대표 |
| 0-2 | **AI 생성 로그 페이지 열지 않기** | 대표·CS |
| 0-3 | 관리자 비밀번호 12자 이상으로 변경. Supabase Auth의 **유출 비밀번호 차단**은 플랜(Pro 이상 기능일 수 있음)을 확인한 뒤 켜기 — 고객 가입에도 적용됨 | 대표(보안 설정이라 사용자가 직접) |
| 0-4 | CS 계정: 4a 전에는 **발급하지 않는 것이 기본**. 그 기간 문의·환불은 대표가 처리. 발급이 꼭 필요하면 대표와 같은 권한임을 알고 발급(Q7) | 대표 |
| 0-5 | 약관(Footer) 화면은 열자마자 수정·저장하고 오래 열어 두지 않기(R4) | 대표 |
| 0-6 | **운영 런북 `docs/admin-operations-runbook.md` 작성**(9절 RB 목록). 스위치 전 완료, 대표가 RB-1·RB-2를 한 번 따라 해 보기(리허설 SQL로). 돈·개인정보를 고치는 런북 SQL 규칙은 9절 머리말 | 작성: 개발 / 확인: 대표 |
| 0-7 | **판매 재개·수동 중지 SQL 미리 작성·리허설**: 페이앱용 1개와 전체(`master_accepts_new_orders`) 중지·재개 1개(카카오페이는 미사용 결정으로 제외)(재개 조건 0건 가드 — health가 끄는 조건과 같은 SELECT, `payapp_merchant_id` 유지 확인, `changed_by`·`change_ticket` 기록, 이미 켜져 있으면 중단). 운영 BEGIN…ROLLBACK 리허설 PASS까지. 실제 실행은 자동 중지 후 대표 승인으로 SQL Editor에서(예상 10분) | DB-0 |
| 0-8 | **고객 메일 발송 확인(3-7의 전제)**: 운영 `auth.users` 집계상 확인 메일 발송 기록이 11/14명 없고 복구 메일은 0건 → 고객에게 Supabase 메일을 보낸 적이 없음. Supabase 기본 SMTP는 팀원 주소에만 보내고 발송량이 매우 적다(검증자 지식, 대시보드 확인 필요) → Supabase 대시보드 Auth → SMTP에서 확인하고, 없으면 **커스텀 SMTP(발신 도메인 SPF·DKIM 포함) 설정**, 메일 템플릿·리다이렉트 URL 설정 | 대표(Q13) |
| 0-9 | **외부 가동 감시**: 사이트와 결제 통보 URL을 외부 업타임 감시(무료 수준)로 보고 3-3과 같은 슬랙 채널로 받기. health는 결제 대사만 보므로 사이트 다운은 따로 감시해야 함 | 대표 |

### 1단계 — P0 안전·고장 수정

| ID | 내용 | 변경 | DB | 검증 |
|---|---|---|---|---|
| 1-1 | **상품 삭제 = 이력 있으면 숨김, 없으면 완전 삭제**(사용자 결정 2026-10-29): 이력 판정(`getItemsWithHistory`)에 `market_purchase_lines`·`market_refund_requests`·`market_item_reviews` 추가. 삭제 요청(단건·일괄)에서 서버가 상품마다 판정해 **구매·환불·후기 이력이 있으면 상태를 '숨김'(hidden)으로 바꾸고, 없을 때만 완전 삭제**. 응답에 '삭제 N개 / 이력이 있어 숨김 처리 M개'를 돌려주고 화면 toast로 표시. 확인창에 "구매·후기 이력이 있는 상품은 삭제되지 않고 숨김 처리됩니다" 안내. 완전 삭제 시 **삭제할 Storage 경로를 먼저 모은 뒤(DB 삭제 후에는 파일 행도 연쇄로 사라짐) DB 행 삭제 → 성공 시 파일 삭제** 순서(지금은 파일 먼저). 파일 삭제가 실패하면 고아 파일만 남는다(구매자 영향 없음, 로그로 남김) | `api/admin/market/items/[id]/route.ts`(일괄 삭제 경로 포함), `lib/market-item-cleanup.ts`, `market-products-client.tsx` 확인창 문구·결과 toast만 | DB-2(병행) | 계약 테스트: 삭제가 이력 판정을 거치고 이력 있으면 숨김, 삭제 순서. 이력 있는 상품 id로 판정 SELECT 결과 확인(쓰기 route 호출 금지) |
| 1-2 | 사용자 관리: 잔액은 `credit_sources` 사용 가능 잔액(1a U4 결정, 사용자 화면과 같은 계산), 서버 검색(`email`·`phone`·`organization` — `profiles`에 `name` 컬럼 없음, 0645a7f)·페이지네이션(`StudioListPagination`), `select('*')` → 필요한 컬럼만 | `users/page.tsx`, `users-client.tsx` | 없음 | 계약 테스트: `user_credits`·`name` 미사용, 컬럼 명시. 회원 14명 전체 검색, 잔액이 사용자 화면 값과 같음 |
| 1-3 | 환불 관리: 조회 4개 오류를 배너로, 기본 필터 "처리 필요 전체", 경보 카드를 맨 위로, 마켓 환불 catch·확인 창·상품명·이메일 표시, 충전 환불 승인 금액을 주문 금액으로 | `refunds/page.tsx`, `refunds-client.tsx`, `market-refunds-client.tsx`, `payment-review-client.tsx`(배치만) | 없음 | 계약 테스트 + 화면 확인(조회만) |
| 1-4 | 대시보드 1차: 거짓 표시 제거(`admin_logs`, "정상 작동 중", 문제은행 카드, `/admin/questions` 링크) + **처리 대기 건수 카드**(미답변 문의, 충전 환불 대기·재처리, 마켓 환불 대기, 수동확인 주문, 미해소 경보) | `dashboard-client.tsx`, `api/admin/stats/route.ts` | 없음 | 카드 숫자 = 운영 DB SELECT 값 |
| 1-5 | 크레딧 관리: `transaction_type` → `type`, 필터 값을 실제 값(`consume`·`purchase`·`refund`)으로, 서버 페이지네이션. 사용자 관리의 지급 버튼은 크레딧 화면 지급 다이얼로그(확인·사유) 재사용 | `credits/page.tsx`, `credits-client.tsx`, `users-client.tsx` | 없음 | 계약 테스트 + 환불 필터 값 = SELECT |
| 1-6 | `/checkout` 헤더를 마켓 헤더로: `checkout/layout.tsx`의 `<SiteChrome>`을 마켓 크롬으로 교체(현재 파일 기준, 10-02 1a P0-5 근거는 낡음). 결제 결과 화면(`checkout/payapp/result`, `checkout/kakaopay/result`)에서 지급 확인 후 `credit-balance-updated` 이벤트를 보내 새 헤더(`preview-header.tsx:60-79`, 처음 한 번만 조회) 잔액을 갱신 | `checkout/layout.tsx`, 결과 화면 2곳 | 없음 | `tests/site-chrome-layout-contract.test.mjs:9-25`에서 checkout을 `OWN_CHROME_LAYOUTS`로. 결제 시작·결과 화면 브라우저 확인(실결제 없이 화면만) |
| 1-7 | **영어 문제마켓 당분간 미운영**(사용자 결정, 추후 개발 가능): 영어 테스트 광고 3개·상품 비공개(DB-3), 관리자 사이드바의 영어 묶음은 사이드바 구성 데이터에서 숨김(2단계, 데이터라 다시 켜기 쉬움), 사용자 헤더의 영어 전환 버튼(`preview-header.tsx:15,232`) 숨김 — 영어 공개 여부를 설정 데이터로 두고 헤더가 읽음(하드코딩 금지). 영어 데이터·코드는 삭제하지 않음 | `preview-header.tsx`, 설정 읽기 | DB-3, 공개 여부 설정 행 | SELECT로 영어 공개 0건, 헤더에 영어 전환 없음, `/?subject=english` 직접 접근 시 동작 확인 |
| 1-8 | `source_configs` 잠금 | 없음 | DB-1 | advisor ERROR 사라짐, 레거시 출처 화면 조회 동작 |
| 1-9 | **카카오페이 문구 정리**(카카오페이 미사용 결정 2026-10-29): 운영 약관(`system_settings.site_footer_content`)의 카카오페이 4곳(환불정책 결제수단·환불 경로, 개인정보처리방침 위탁 '(주)카카오페이' 줄), 약관 화면 코드(`terms/[documentSlug]/page.tsx:88`), 코드 기본값(`footer-content.ts:179,231,233`)에서 제거. 페이앱 출시 스위치 전에 적용. 카카오페이 결제 코드·DB는 지우지 않고 꺼진 채로 둠(`kakaopay_accepts_new_orders=false` 유지) | `terms/[documentSlug]/page.tsx`, `footer-content.ts` | DB-13(B1 후속 약관 마이그레이션) | 운영 약관 화면에 '카카오페이' 0건, B1 계약 테스트 갱신 |

### 2단계 — 메뉴 정리 (10-02 1b 흡수)

**저장 구조와 이행**(10-02 4-4를 현재 코드에 맞게 보정):

- 새 키 `system_settings.admin_sidebar_navigation` 1행(형식은 10-02 4-4: `common` 묶음, `subjectOrder`, `subjectItems` 공통 1벌, `legacy`, `hidden`). Q2가 (a)면 같은 행에 공통 `labels`(href → 이름) 1벌을 둔다.
- 이름 출처: **등록부(코드)의 기본 이름 → 새 행 `labels`(있으면) 순**. 기존 `workspace_settings` korean 행의 labels 2개('메인광고설정', '문제마켓 메인 관리')는 새 이름('홈 화면')과 충돌하므로 **옮기지 않고 버린다**.
- 이름을 읽는 곳 정리: `buildAdminMenuMetadata`(`admin-sidebar-server.ts:66-82`)와 `AdminMenuName`(`admin-menu-labels.tsx:46-52`)이 과목별 labels를 `?subject`로 읽고, 31개 페이지가 각자 `fallback` 이름을 넘긴다(예: `main-ad-settings-client.tsx:379` "(임시)메인광고설정"). 두 곳이 **href로 등록부 이름을 먼저 찾고, 페이지 `fallback`은 등록부에 없을 때만** 쓰게 바꾼다 → 페이지 31개는 수정하지 않는다(2개 파일 수정).
- 읽기 순서: 새 `system_settings` 행 → 없으면 **등록부 기본 순서**(레거시 구분 없음). 옛 과목별 `workspace_settings` 경로는 남기지 않는다(운영에서는 DB-4a가 먼저 들어가 실행될 일이 없는 죽은 코드가 되므로). 2단계 배포 직전에 새 행이 들어갔는지 SELECT로 확인한다.
- DB 순서: 새 행 입력(DB-4a)은 **추가형**이라 옛 코드가 무시한다 → **DB-4a 먼저 → 2단계 코드 배포**. 옛 `workspace_settings` 2행 정리(DB-4b)는 배포 확인 후.
- 등록부는 `AdminMenuName`·`buildAdminMenuMetadata`를 쓰는 31개 href를 **모두** 담는다(탭 하위 `/admin/market-main-settings`, `/admin/review-tags` 포함 — 없으면 labels 폐기 후 페이지 대체 이름 '(임시) 문제마켓 메인 관리'(`market-main-settings-client.tsx:85`)로 돌아감). 계약 테스트로 확인. DB-4a의 JSON이 등록부·정규화와 맞는지(레거시 `subject` 포함)도 계약 테스트로 확인.
- `system_settings`에는 관리자 INSERT 정책이 없다(UPDATE만) → 새 행은 마이그레이션으로 만들고, 이름 저장(Q2 (a))은 service role 헬퍼로 쓴다.

| ID | 내용 | 변경 |
|---|---|---|
| 2-1 | 페이지 등록부(코드 규칙): href → 기본 이름·아이콘·`scope`(common/subject)·`activeHrefs`. '(임시)' 제거 등 이름 정리는 등록부에서 | `src/lib/admin-sidebar.ts` |
| 2-2 | 새 저장 구조 읽기·정규화(위), 메뉴관리 화면의 '관리자 메뉴 순서' 카드 제거, `renameAdminSidebarMenuAction` export 유지·저장소 변경 | `admin-sidebar.ts`, `admin-sidebar-server.ts`, `admin-sidebar.tsx`, `admin-sidebar-client.tsx`, `admin-menu-labels.tsx`, `menu-management-client.tsx`, `menu-management/actions.ts` |
| 2-3 | 과목 묶음 펼침(D15 B), 과목 무관 화면에서 과목 전환·"현재 관리 대상" 제거 | `admin-sidebar-client.tsx`, `admin-workspace-switcher*` |
| 2-4 | 레거시 보관(Q1 결과대로) + 레거시 경고 띠 | 사이드바 클라이언트, 레이아웃, (b)면 `admin/legacy/page.tsx` 신규 |
| 2-5 | 탭 링크: 홈 화면(광고↔진열), 후기(후기↔태그). 마켓 메인 설정의 잘못된 '카테고리 관리' 링크·출처 링크 수정(B14) | 해당 client 4개 |
| 2-6 | 사이트 로고 섹션을 사이트 정보·약관 화면으로 이동(`SiteLogoSettings`는 독립 컴포넌트, provider는 루트 layout) | `footer/page.tsx` |
| 2-7 | 메뉴 이름 바꾸기: Q2 결과대로(공통 1벌 저장 또는 버튼 제거) | 사이드바 클라이언트, `admin-menu-labels.tsx` |

- 테스트 갱신: `admin-sidebar-navigation.test.mjs`(30-150, 195-260, 약 288), `admin-sidebar-menu-rename.test.mjs:22-100`, `admin-workspace-default-korean-contract`, `market-images-ui-contract.test.mjs:24-32`, `market-home-admin-route-contract.test.mjs:56-57,62-63`, 등록부 이름이 바뀌면 `question-bank-admin-options`·`question-bank-backfill`·`question-bank-problem-types-api`·`admin-ai-question-generation-runs` 계약 테스트. 신규: "레거시 href는 기본 구성 밖·레거시 목록 안", "과목 무관 화면 링크에 `subject` 없음", "과목 메뉴 순서는 두 과목 동일", "새 행이 없으면 등록부 기본 순서", "등록부가 31개 href를 모두 담음", "DB-4a JSON이 등록부와 맞음".
- 검증: 브라우저로 국어·영어 메뉴, 레거시 진입·경고 띠, 탭 강조, 페이지 제목 이름. 전체 테스트 실패 목록이 기준선과 같을 것.

### 3단계 — P0 운영 필수 기능 (공개 판매 전)

| ID | 내용 | 변경 | DB |
|---|---|---|---|
| 3-1 | **주문 조회 › 충전 결제**: 이메일·주문번호·결제사 거래번호(`payment_provider_transactions.provider_transaction_id` 조인 — 페이앱 `mul_no`, 카카오 `tid`) 검색, 결제수단·상태·연결 크레딧 원천(유효기간 `credit_sources.expires_at` 포함)·환불 상태, 기간 필터. `manual_review` 목록에도 이메일·`mul_no` 표시 | `admin/orders/page.tsx` 신규, 조회 API 1개, 지금 사이드바 기본 목록(`admin-sidebar.ts`)에 `/admin/orders` 추가(2단계 전이라 현재 구조에) | 없음(SELECT, service role) |
| 3-2 | **주문 조회 › 마켓 구매**: 회원·상품·주문 줄·다운로드 권한·다운로드 기록·환불 요청 | 같은 페이지 탭 | 없음 |
| 3-3 | **판매 상태 배지 + 결제 경보 통지**: ① `/admin/refunds`·대시보드 맨 위에 `master_accepts_new_orders`·페이앱·카카오 신규 주문 허용·`accepted_provider_environment`·마지막 변경자 표시. ② 통지는 **대사 route와 분리**(대사 route 실패로 생기는 `SCHEDULER_STALE`·`REPEATED_FAILURE` 경보도 통지되도록): 별도 pg_cron 작업이 미통지 경보를 `pg_net`으로 슬랙 webhook(vault 보관, 기존 `payment-reconciliation-http-5m`이 vault를 읽는 선례 있음)에 보내고, **본문에 현재 판매 상태를 함께 싣는다**. 같은 작업이 **판매 스위치 자체도 감시**한다: 판매 허용 값 3개(`master_accepts_new_orders`·`payapp_accepts_new_orders`·`kakaopay_accepts_new_orders`)가 마지막으로 통지한 값과 달라지면 `changed_by`와 상관없이 통지한다(행에 `changed_at`·`changed_by`가 한 벌뿐이라 health가 끈 직후 수동 변경이 끼면 덮어써지므로 값의 변화로 감지, 어느 스위치가 바뀌었는지도 본문에 표시). 통지 작업은 1분 주기. health는 판매를 끌 때 항상 경보를 새로 남기지는 않는다(페이앱 `RECONCILIATION_UNHEALTHY`는 경보를 남기지 않고, 앞쪽 블록은 코드 하나를 골라 같은 코드가 미해소면 새 행을 넣지 않음 — `20261019090000_payapp_migration_a.sql:3936,3951`) → 경보만 보면 카카오 경보가 열린 동안 페이앱이 조용히 꺼질 수 있어서다. health 함수는 건드리지 않는다. ③ `pg_net`은 비동기라 **요청 id를 기록하고 다음 회차에 `net._http_response`로 성공을 확인, 실패면 다시 보낸다**(통지 완료 시각은 성공 확인 후에 찍음). 재시도는 상한(예: 6회)을 두고, 상한에 도달한 통지는 대시보드에 '통지 실패' 카드로 표시한다(1-4 대기 카드에 이 카드를 더하는 것은 3-3의 변경 범위). RB-2 재개 절차에는 '관련 경보 해소 후 재개'를 넣는다. BEGIN…ROLLBACK 리허설에서는 pg_net 큐도 롤백돼 실제 도착은 승인 후 적용에서만 확인 | 배지 컴포넌트 | DB-5 |
| 3-5 | **관리자 크레딧 지급 감사·원자성**: `admin_grant_credits(p_actor_id, p_user_id, p_amount, p_reason)` RPC가 `credit_sources`·원장·감사 기록(`admin_audit_log`)을 한 트랜잭션으로. 원장 표시 "관리자 지급", 사유 필수 | `src/lib/credits.ts`, `api/admin/users/credits/route.ts` | DB-7 → DB-6 |
| 3-6 | ~~카카오 `manual_review` 해소 경로~~ — **카카오페이 미사용 결정(2026-10-29)으로 제외**. 나중에 카카오페이를 다시 쓰기로 하면 이 항목과 DB-8을 되살린다 | — | — |
| 3-7 | **고객 비밀번호 재설정**: 로그인 화면 "비밀번호 찾기" → `resetPasswordForEmail` → recovery 세션에서 새 비밀번호 설정 화면(기존 비밀번호 확인 없이). 다른 기기에서 링크를 여는 경우를 고려해 PKCE 대신 token_hash 검증을 검토. 그 전까지는 우회로 없음(G8) | 사용자 쪽 로그인·신규 화면, auth callback | 없음. **전제 0-8**(실제 고객 주소로 메일 발송 가능) |
| 3-8 | **마켓 헤더 알림 벨**: 기존 `NotificationBell`을 `PreviewHeader`에 붙임 → 문의 답변·환불 완료·지급 알림이 보임. 그 전에는 런북 RB-8 | `preview-header.tsx` | 없음 |

### 4단계 — 역할 분리·감사

**4a (CS 계정 발급 전 필수, Q7)**

| ID | 내용 | 변경 | DB |
|---|---|---|---|
| 4-1 | `profiles.admin_role`(`owner`/`cs`), `is_owner()` 함수, 기존 관리자 4명 → `owner`, CS 한도 설정 행(크레딧 지급·마켓 환불 한도는 데이터)은 DB-9a(DB 먼저). `is_admin = (admin_role is not null)` CHECK 제약은 관리자 계정 생성 코드(`admin-accounts-server.ts:99`가 지금 `is_admin`만 씀)가 `admin_role`을 함께 쓰도록 바뀐 뒤 DB-9b(코드 먼저) | `admin-accounts-server.ts` | DB-9a → 코드 → DB-9b |
| 4-2 | 공용 `requireAdminRole('owner')`(API용 JSON 버전 포함)를 **대표 전용 핸들러에만** 추가(Q14 (나) 기준): 관리자 계정(`admin-accounts/**`), 요금제(`pricing/actions`), 약관·사이트 정보·로고 저장(`footer/actions`, `site-logo`), 사이드바 메뉴 이름 저장(Q2 (a)), 충전 환불 실행(`refunds` PATCH), 결제 수동확인·경보 해소(`payments/review`·`alerts` PATCH), 상품 완전 삭제(`market/items/[id]` DELETE·일괄 삭제), 크레딧 차감(5-2). CS 한도 분기: 크레딧 지급(`users/credits`), 마켓 환불(`market/refunds/[id]`). 상품·카테고리·홈 화면·후기 편집은 CS도 허용(검사 추가 없음). Q14 (가)면 문제마켓 쓰기 route·action 34개 파일이 추가됨 | 위 목록의 route·action(파일 수는 구현 계획에서 확정) | — |
| 4-3 | 사이드바 등록부에 필요 역할 표시, CS에게는 대표 전용 메뉴와 메뉴 이름 바꾸기(연필) 버튼 숨김(메뉴 숨김은 편의일 뿐 권한은 4-2·4-4가 막음) | 등록부·사이드바 | — |
| 4-4 | RLS 강화(CS가 JWT로 PostgREST를 직접 불러 앱 검사를 우회하지 못하게): 돈 관련 테이블(`credit_sources`, `payment_history`, `market_entitlements`, `market_purchase_orders/lines`, `market_purchases`, `refund_requests`, `market_refund_requests`)의 관리자 정책 `ALL` → `SELECT`. 설정 테이블(`pricing_plans` — 요금제 관리가 세션 클라이언트로 쓰므로, `system_settings` UPDATE, `workspace_settings` 쓰기)은 `is_owner()`. 상품·카테고리 테이블(`market_items` 계열, `market_category_items`)은 Q14 (나)면 `is_admin()` 유지(CS도 편집), (가)면 `is_owner()`. 레거시 테이블(`ai_provider_connections`, `problem_types`, `generate_*`, `market_menu_entries`, `source_configs` 등)도 `is_owner()`. `support_tickets` UPDATE·`notifications` INSERT는 CS도 쓰므로 유지. 적용 전 `is_admin` 쓰기 정책 43개 테이블 전수와 세션 클라이언트 쓰기 경로를 재확인 | — | DB-10(**코드 먼저**) |
| 4-6 | 관리자 "권한 해제"(`is_admin=false`, 역할 null)를 기본으로, 삭제는 대표만. `market_item_sample_pages.created_by` FK와 주석 불일치(R6) 수정 | `admin-accounts-server.ts`, 화면 | — |

**4b (P1, Q9 결과에 따라 범위 조정)**

| ID | 내용 |
|---|---|
| 4-5 | `admin_audit_log` 기록 대상 확대(관리자 계정 생성·삭제·비밀번호·역할, 요금제, 약관 저장, 상품 상태 변경, 마켓 환불, 문의 답변, 크레딧 차감) + 조회 화면 `/admin/audit-log`(대표 전용, `payment_admin_actions`와 UNION view — DB-12). 그 전에는 Supabase SQL 조회로 대신 |
| 4-7 | 회원 화면 개인정보 마스킹(CS), 전체 열람은 대표만·열람 기록 |

### 5단계 — P1 (오픈 첫 달)

| ID | 내용 | 규모 |
|---|---|---|
| 5-1 | 회원 상세 `/admin/users/[id]`(3-1·3-2 조회 재사용) | 중 |
| 5-2 | 크레딧 수동 차감 RPC(트랜잭션, 사유 필수, 대표 전용, 감사 기록) — DB-11 | 중 |
| 5-4 | 문의 추가 답변·답변 이력·답변자 기록, 중복 답변 경로 정리, 회원 기준 검색, 페이지네이션 | 소 |
| 5-5 | 요금제 '판매중' 스위치 확인 창·실패 표시 | 소 |
| 5-6 | 결제 이력 회원 탈퇴(익명화: 개인정보 컬럼 비우기 + 로그인 차단, 결제 기록 유지, 대표 전용) | 중 |
| 5-7 | 마켓 하자 상품 직권 환불(다운로드 검사 생략 옵션, 사유 필수, 대표 전용) | 소 |
| 5-9 | 공통 KST 날짜 포맷터와 금액 표기 통일(유지 메뉴만) | 소~중 |
| 5-10 | 관리자 MFA(대표 TOTP + aal2 검사), 로그인 실패 제한 | 중 |
| 5-11 | 약관 저장 충돌 보호(`updated_at` 비교) — 오픈 전에 약관을 다시 고칠 계획이면 1단계로 | 소 |
| 5-12 | 결제·환불 월별 CSV 내보내기(3-1 화면) | 소 |
| 5-13 | 대시보드 2차(10-02 D9 지표): 오늘/이번 달 가입, 충전 결제 금액·건수(`payment_orders`를 운영 환경 조건으로 서버에서 합산, KST 기준 — 관리자 지급이 `payment_history`에 0원 completed로 들어가므로 `payment_history`는 쓰지 않음), 마켓 구매·다운로드 | 중 |

### 6단계 — P2 (이후)

10-02 제안서 Phase 2 디자인 통일(토큰·공통 부품·`alert()` 제거·모바일), Phase 4 정리(미적용 마이그레이션 삭제 등), 결제 영수증 URL 저장·표시, 부정 이용 차단, `payment_reconciliation_runs` 정리 작업(30일 지난 행 11,457), 레거시 무검사 GET·advisor WARN(문제은행 SECURITY DEFINER 함수 6개, `workspace_subject_backfill_audit` view, `handle_new_user` search_path) 정리, 관리자 대신 충전 환불 요청 만들기, 사이트 전체 공지 수단.

## 8. DB 작업 목록

순서 규칙(H 지적 반영):
- **추가형**(새 컬럼·함수·테이블·설정 행): **DB 먼저 → 코드**. 옛 코드는 새 객체를 무시하므로 안전하고, 새 코드가 없는 객체를 찾다 실패하는 구간이 없다.
- **축소·제약형**(FK RESTRICT, RLS 축소, 옛 행 정리): **코드 먼저 → DB**. 옛 코드가 막힌 경로를 쓰지 않게 된 뒤 적용.
- 모두 마이그레이션 + 되돌리기 파일 + 계약 테스트, 운영 BEGIN…ROLLBACK 리허설 PASS, 사용자 승인 후 적용.

| ID | 내용 | 형 | 순서 | 전문 검증 3명 | 시점 |
|---|---|---|---|---|---|
| DB-0 | 페이앱·전체(master) 판매 재개·수동 중지 SQL(0-7). 리허설만, 실제 실행은 자동 중지 시 승인 후 | 데이터 | — | **필수** | 스위치 전 |
| DB-1 | `source_configs` RLS on + `is_admin()` 정책 + anon 권한 회수(레거시 출처 화면은 세션 클라이언트라 관리자는 계속 동작) | 축소 | 코드 변경 없음 | — | 1단계 |
| DB-2 | `market_items`를 참조하는 구매·권리·후기 FK(`market_purchase_orders`/`lines`, `market_entitlements`, `market_refund_requests`, `market_purchases`, `market_download_events`, `market_item_reviews`) CASCADE → RESTRICT. 구매 기록이 있는 상품은 어떤 경로로도 삭제 불가 | 제약 | 1-1 배포 후 | **필수** | 3단계와 병행 |
| DB-3 | 영어 테스트 광고 3개·상품 비공개 | 데이터 | — | — | Q3 답 후 |
| DB-4a | `system_settings.admin_sidebar_navigation` 1행 입력(레거시 `subject`, 3단계 신설 `/admin/orders` 포함). JSON은 Q1·Q3·Q6·Q10 결정 후 확정 | 추가 | **DB 먼저** | — | 2단계 코드 전 |
| DB-4b | 옛 `workspace_settings` 사이드바 2행 정리 | 축소 | 2단계 배포 확인 후 | — | 2단계 후 |
| DB-5 | `payment_reconciliation_alerts` 통지 상태 컬럼(요청 id·완료 시각·재시도 횟수) + 판매 스위치 통지 상태 1행(마지막으로 통지한 판매 허용 값 3개 — 적용 시 현재 값으로 채워 지난 변경을 통지하지 않음) + 통지 함수(pg_net, 응답 확인·재시도 상한) + pg_cron 작업. health 함수는 변경 없음. webhook URL은 대표가 vault에 직접 저장 | 추가 | DB만 | **필수**(대사 테이블) | 3-3 |
| DB-7 | `admin_audit_log` 테이블·잠금 트리거·기록 함수(EXECUTE는 service_role만) | 추가 | **DB 먼저** | 필수(감사 설계) | 3-5 |
| DB-6 | `admin_grant_credits` RPC. `p_actor_id`를 인자로 받으므로 **EXECUTE는 service_role만**(관리자 JWT로 다른 사람 이름의 기록을 남기지 못하게) | 추가 | **DB 먼저** | **필수** | 3-5 |
| DB-8 | ~~카카오 `manual_review` 해소 RPC 확장~~ — 카카오페이 미사용으로 제외 | — | — | — | — |
| DB-9a | `admin_role` 컬럼·`is_owner()`·기존 관리자 `owner` 채우기·CS 한도 설정 행 | 추가 | **DB 먼저** | 필수(권한) | 4a |
| DB-9b | `coalesce(is_admin,false) = (admin_role is not null)` CHECK 제약(`is_admin`은 nullable이라 NULL이 통과하지 않게, 또는 NOT NULL 함께). 적용 전 "`is_admin`이 참이고 `admin_role`이 null인 행 0건" 확인(DB-9a 이후 옛 코드로 만든 관리자가 있으면 채움) | 제약 | **코드 먼저**(관리자 생성 코드가 `admin_role`을 씀) | 필수(권한) | 4a |
| DB-10 | 4-4 범위: 돈 관련 테이블 관리자 RLS `ALL`→`SELECT`, 설정·레거시 테이블 `is_owner()`, 상품·카테고리 테이블은 Q14에 따라((나) `is_admin()` 유지 / (가) `is_owner()`) | 축소 | **코드 먼저** | **필수** | 4a |
| DB-11 | 크레딧 차감 RPC(EXECUTE는 service_role만) | 추가 | **DB 먼저** | **필수** | 5-2 |
| DB-13 | 약관에서 카카오페이 문구 제거(1-9, B1 후속). 적용 전 원문 기록·되돌리기 파일 | 데이터 | 1-9 코드 배포 후 | — | 페이앱 스위치 전 |
| DB-12 | 감사 조회 UNION view(`admin_audit_log` + `payment_admin_actions`, service_role만) | 추가 | **DB 먼저** | 필수(감사) | 4b |

## 9. 운영 런북 (`docs/admin-operations-runbook.md`, 0-6)

스위치 전에 작성하고, 대표가 RB-1·RB-2를 리허설 SQL로 한 번 따라 해 본다. 각 항목은 "언제 / 무엇을 본다 / 무엇을 한다 / 누가 / 고객 안내 문구"로 쓴다.

- **돈·개인정보를 고치는 런북 SQL 규칙**: 미리 만든 DB-0(재개·중지)만 리허설·전문 검증 3명을 마친 상태로 둔다. RB-4(크레딧 회수)·RB-11(익명화)은 빈도가 낮아 **필요할 때 작성 → 운영 BEGIN…ROLLBACK 리허설 → 전문 검증 3명 → 대표 승인 → 적용**(예상 1~2일)으로 하고, 런북에는 그동안 고객에게 보낼 안내 문구를 둔다. **즉석 SQL 실행은 금지.** 조회 SELECT는 자유.
- 실행자: 4a 전에는 모든 RB를 대표가 실행한다.

| RB | 업무 | 내용 | 대체되는 시점 |
|---|---|---|---|
| RB-1 | 결제 경보·사이트 다운 수신 시 대응 | 경보 코드별(미지급 10분 초과, money-risk `manual_review`, 취소 표식 미처리, 스케줄러 stale, 연속 실패, 피드백 인증 실패 등) 확인 SELECT와 조치, 사이트·결제 통보 URL 다운(0-9) 시 Vercel 상태 확인 | 상시 |
| RB-2 | 판매 재개·수동 중지 | DB-0 재개 SQL 실행 절차(관련 경보 해소 → 조건 0건 확인 → 승인 → SQL Editor 실행 → 상태 확인). 수동 중지는 DB-0 중지 SQL(페이앱, 전체는 `master_accepts_new_orders`). 판매 중지 동안 홈 광고 배너로 공지 | 상시(D7) |
| RB-4 | 잘못 지급한 크레딧 회수 | 위 규칙대로 필요할 때 SQL 작성·검증(`credit_sources`·`credit_transactions`·잔액 캐시를 한 트랜잭션으로). 그동안 해당 회원에게 즉시 보낼 안내 문구, 회수 전에 이미 사용된 크레딧의 처리 기준(대표 결정) | 5-2 |
| RB-5 | 영수증(매출전표) 발급 | 3-1에서 `mul_no` 확인 → 페이앱 판매자 관리자에서 발급. 실행: 4a 전 대표 / 후 Q12에 따라 | 상시 |
| RB-6 | 휴대폰 당월 경과·정산 후 환불 | 문의로 계좌 받기 → 송금 → 화면에서 수동 완료 → **문의 본문의 계좌번호 삭제·마스킹** | 상시 |
| RB-7 | 하자 상품 환불 | 크레딧 보상 지급(사유 "환불") + 문의 답변 | 5-7 |
| RB-8 | 고객 고지(문의 답변 도착 등) | 답변 후 가입 이메일로 직접 안내(보낸 메일 계정·문구 지정). 실행: 4a 전 대표 / 후 CS | 3-8 |
| RB-9 | CS 퇴사 | 관리자 계정 **삭제하지 말고** 권한 해제(`is_admin=false`). 페이앱·Supabase·Vercel·슬랙 계정 회수 체크리스트 | 4-6 |
| RB-10 | 월말 정산 대조 | 결제사 정산 자료 기준 + 저장된 집계 SQL(월별 `payment_orders`·`refund_requests`) | 5-12 |
| RB-11 | 개인정보 열람·삭제·결제 이력 회원 탈퇴 | 열람은 Supabase 조회 후 메일 회신. 탈퇴(익명화)는 위 규칙대로 필요할 때 SQL 작성·검증 | 5-6 |

## 10. 사용자 결정 필요

| Q | 질문 | 선택지 | 권장 |
|---|---|---|---|
| Q1 | 레거시 보관 방식(D1 재확인) | (a) 사이드바 맨 아래 접힌 '레거시' 묶음(10-02 D1) / (b) 사이드바에서 빼고 `/admin/legacy` 목록 | **(b)**: 운영자가 실수로 들어가지 않음(AI 로그 삭제 화면 포함). 목록은 같은 데이터에서 읽으므로 나중에 (a)로 바꾸기 쉬움 |
| Q2 | 메뉴 이름 바꾸기(연필 버튼) | (a) 유지하되 과목 공통 1벌로 저장 / (b) 버튼 제거, 이름은 등록부(코드)에서 | **(a)**: 사용자가 요청해 만든 기능이고 이름을 데이터로 두면 하드코딩 금지와 맞음. 과목별 저장만 없앰 |
| Q3 | 영어 문제마켓 운영(D11 재확인) | (a) 계속 운영: 영어 메뉴 유지, 테스트 데이터만 비공개 / (b) 당분간 미운영: 영어 메뉴를 사이드바 데이터에서 숨김, 사용자 헤더 영어 전환도 숨김 | 사업 결정. 어느 쪽이든 테스트 광고·상품 비공개(DB-3) 필요 |
| Q4 | 판매 재개 버튼(D7 "결제 설정 화면 만들지 않음") | (a) D7 유지: 상태 배지 + 미리 리허설한 재개 SQL(0-7) / (b) 대표 전용 재개 버튼(조건 0건일 때만, 감사 기록) | **(a)** 오픈 초기. 자동 중지가 잦으면 (b) 재검토 |
| Q5 | 카카오페이 실결제 전환 시점 | 페이앱과 함께 / 나중 | 함께라면 3-6·DB-8이 스위치 전 |
| Q6 | 사이드바 묶음 순서 | 고객 응대 먼저 / 문제마켓 먼저 | 고객 응대 먼저 |
| Q7 | CS 계정 발급 시점 | 공개 판매 전 / 후 | **4a 완료 후**. 그 전에는 대표가 문의·환불 처리(0-4) |
| Q8 | 페이앱 출시 스위치 조건 | (a) 0-6·0-7·0-8·0-9·1단계(1-9 약관 정리 포함)·3-1·3-2·3-3·3-7·3-8 완료 후(DB-2·3-5는 병행) / (b) 스위치 먼저, P0 병행 | **(a)**. 대표 본인 실결제 시험은 스위치 적용 직후 가능하지만 스위치는 모든 고객에게 열림 |
| Q9 | 관리자 작업 기록(접속기록) 보관 의무 | 법령 확인 필요(개인정보처리시스템 접속기록) | 결과에 따라 4b 범위(열람 기록 포함 여부)와 시점 |
| Q10 | 메뉴 이름안 D8 재확인 | 5절 트리 이름(고객 응대/설정, 이미지 보관함 등)과 '관리자 메뉴 구성' 화면 제외 / 10-02 D8 이름 유지 | 5절 안. 운영 업무 이름으로 묶는 편이 2명 운영에 쉬움. 이름은 Q2 (a)면 언제든 화면에서 바꿀 수 있음 |
| Q11 | 경보·문의 통지 채널과 받는 사람 | 슬랙(대표 휴대폰 알림 확인) / 이메일 / 문자 | 슬랙: 문의 통지가 이미 슬랙(`SLACK_WEBHOOK_URL`)이라 같은 채널. 운영 Vercel에 값이 있는지·대표가 휴대폰으로 받는지 대표가 확인 |
| Q12 | CS의 결제사 관리자 계정 접근 | 허용 / 대표만 | 대표만(영수증은 CS가 요청 → 대표 발급), 문의 빈도가 높아지면 재검토 |
| Q13 | 고객 메일 발송(SMTP) | Supabase 대시보드 Auth → SMTP 확인 결과에 따라 커스텀 SMTP 설정 여부 | 커스텀 SMTP 설정(발신 도메인 SPF·DKIM). 비밀번호 재설정(3-7)이 이것 없이는 실제 고객에게 동작하지 않음 |
| Q14 | CS의 문제마켓 편집 권한(상품·카테고리·홈 화면·후기) | (가) 대표만: 상품·카테고리·홈 화면·후기 쓰기 route·action 34개 파일에 대표 검사 추가 + 상품 테이블 `is_owner()` / (나) CS도 편집, 상품 완전 삭제만 대표 전용 | **(나)**: 2명 운영에 단순하고 변경이 작음. 상품 관리 쓰기는 service role이라 RLS만 바꿔서는 막을 수 없음. (가)를 고르면 4-2·4-4 범위가 커짐 |

### 10-1. 결정 결과 (2026-10-29)

| Q | 결정 |
|---|---|
| 상품 삭제(1-1) | 구매·환불·후기 이력이 있으면 숨김으로 처리, 없을 때만 완전 삭제 |
| 결제·주문 조회(3-1·3-2), 경보 통지(3-3), 비밀번호 찾기(3-7) | 만든다 |
| Q3 영어 | 당분간 미운영, 추후 개발 가능 → 1-7(테스트 데이터 비공개, 관리자·사용자 화면에서 영어 숨김, 데이터·코드는 보존) |
| Q5 카카오페이 | **사용하지 않기로 결정** → 3-6·DB-8 제외, 0-7·RB-2에서 카카오 제외, 1-9·DB-13으로 약관의 카카오페이 문구 정리. 결제 코드·DB는 꺼진 채 보존 |
| Q1·Q2·Q4·Q6·Q7·Q8·Q9·Q10·Q11·Q12·Q13·Q14 | 권장안대로. Q9는 법령 확인 결과에 따라 4b 범위 조정, Q11은 대표가 휴대폰 슬랙 알림 확인, Q13은 대표가 SMTP 설정 |

## 11. 완료 기준

- 0단계: 런북 작성, 재개·중지 SQL 리허설 PASS, 대표가 RB-1·RB-2를 한 번 따라 함, SMTP 확인·설정(0-8), 외부 가동 감시 연결(0-9).
- 1단계: R1·R2·B1~B9 해소. 이력 있는 상품은 관리자 화면에서 삭제 불가(DB-2 후에는 어떤 경로로도). 대시보드·사용자·크레딧·환불 화면 숫자가 운영 DB SELECT와 일치.
- 2단계: 사이드바에 레거시 메뉴 0개, 레거시 URL은 모두 그대로 열림(영어 데이터 레거시는 영어로), 국어·영어 메뉴 순서 동일, 과목 무관 화면에 과목 표시 없음, 페이지 제목이 등록부 이름.
- 3단계: 4절 표의 "결제했는데 크레딧 없음"·"다운로드 안 됨"·"결제 경보 인지"·"문의 답변 도착 안내"·"고객 비밀번호 분실"이 화면만으로 처리됨. 비밀번호 재설정은 **팀원이 아닌 실제 외부 주소로 메일 수신 → 새 비밀번호로 로그인**까지 확인하고, **PC에서 요청 → 휴대폰에서 메일 링크 열기**도 확인(지금 `/auth/callback`은 PKCE `exchangeCodeForSession`이라 다른 기기에서 실패할 수 있음 → 필요하면 token_hash 방식 메일 템플릿). 경보 통지 확인: 리허설에서는 pg_net 큐가 롤백되므로 **스위치 전(페이앱이 꺼져 있어 판매 영향 없음)에 승인을 받아 시험 경보 1행과 시험 스위치 변경 기록으로 슬랙 도착 확인 → 시험 경보 해소·원복**. 대사 route 실패 상황의 감지 로직은 리허설에서 SELECT로 확인.
- 4a: CS 계정으로 4-2 목록의 대표 전용 작업 시도 시 서버가 403, CS JWT로 돈 관련·설정·레거시 테이블 직접 쓰기 불가(리허설에서 확인, Q14 (가)면 상품 테이블 포함), 크레딧 지급이 감사 기록에 남음, 관리자 계정 생성이 `admin_role`과 함께 동작.
- 모든 단계: 전체 테스트 실패 목록이 기준선과 같고 새 실패 없음, 독립 검증 PASS.

## 12. 검증 기록

| 회차 | 대상 | 검증 | 결과 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | G(운영자 관점) | **FAIL** | 1 비밀번호 런북 실행 불가(마이페이지 변경이 기존 비밀번호 요구) → 3-7 P0 2 문의 답변을 고객이 알 수 없음 → 3-8 P0·RB-8 3 경보 통지를 대사 route에 두면 stale·연속 실패 경보 누락 → DB cron + pg_net(3-3, DB-5) 4 판매 재개 SQL 실체 없음 → 0-7·DB-0 5 런북 산출물·누락 항목 → 9절 RB-1~11 6 실행 순서 모호 → 7-0 7 D8 무질문 변경 → Q10. 권고 반영: 4단계 4a/4b 분할, 0-4 임시 운영, 0-3 플랜 확인, 0-1 숨김/보관, 1-5 type 값, 3-1 유효기간, RB-6 계좌 마스킹, RB-2 공지, DB-2 후기 포함, Q11 통지 채널 |
| R1 | 초안 | H(개발 실현성) | **FAIL** | 1 "모두 코드 배포 후" → 추가형 DB 먼저/축소형 코드 먼저(8절) 2 사이드바 이행 설계 → 2단계 저장 구조와 이행(이름 출처·labels 폐기·읽기 폴백·DB-4a/4b·`AdminMenuName`) 3 메뉴관리의 사이드바 헬퍼 의존 → 6절·2-2 4 요금제 세션 클라이언트 → R8·4-4 5 파일 먼저 삭제·500·후기 → 1-1·DB-2 6 `/checkout` 근거 낡음 → 1-6 재작성 7 경보 중복 방지 컬럼 없음 → DB-5 필수 8 `profiles.name` 없음·잔액 출처 → 1-2. 권고 반영: 테스트 목록, 3-1 조인, 5-13 매출 출처, 3-3 배지 항목, 레거시 `subject`, `system_settings` INSERT 정책, 4b 연기 |
| R2 | 개정 1 | G | **FAIL** | R1 7건 해소 확인. 새 지적: 1 비밀번호 재설정의 메일 발송 전제(SMTP) 누락 → 0-8·Q13·11절 외부 주소 확인 2 4절·RB 담당 'CS'가 4a 전 CS 미발급과 모순 → 4절 머리말·RB 실행자 3 돈·개인정보 런북 SQL 검증 규칙 없음 → 9절 규칙(필요 시 작성·리허설·3명 검증, 즉석 SQL 금지), RB-3 삭제(카카오는 3-6 후에만 엶). 권고 반영: 3-5를 스위치 조건에서 4a 선행으로, pg_net 응답 확인·재시도, 외부 가동 감시 0-9, 4a를 2단계보다 먼저 둘 수 있음, 카카오 수동 중지 SQL |
| R2 | 개정 1 | H | **FAIL** | R1 8건 중 7건 해소. 새 지적: 1 DB-9의 CHECK 제약은 제약형 → DB-9a(DB 먼저)/9b(코드 먼저) 2 '새 행 없으면 지금 동작 그대로'가 2-3·2-7과 모순·죽은 코드 → 등록부 기본 순서로 축소, 배포 전 SELECT 확인 3 4-4에 상품 테이블 누락 → 상품·설정·레거시 테이블 `is_owner()`, Q14 4 판매 중지 통지의 상태 저장 없음 → 경보 통지 본문에 판매 상태, 한계 문서화·RB-2 경보 해소 후 재개. 권고 반영: 6절 import 사실 수정, 등록부 31 href·탭 하위 페이지, 1-1 Storage 경로 선수집, RPC EXECUTE service_role, DB-7 범위·DB-12, DB-4a JSON 계약 테스트, 레거시 테이블 권한 |
| R3 | 개정 2 | G | **FAIL** | R2 3건 해소, 정합 확인. 새 지적 1: health가 판매를 끌 때 항상 경보를 남기지는 않음(페이앱 UNHEALTHY 무경보, 코드 하나 선택·미해소 시 미삽입) → 3-3·DB-5에 판매 스위치 변경 감시 추가(health 무변경). 권고 반영: 11절 통지 확인을 스위치 전 승인 시험으로, 3-7 다른 기기·token_hash, RB-4 사용된 크레딧 처리, DB-0에 master 중지·재개 |
| R3 | 개정 2 | H | **FAIL** | R2 4건 해소. 새 지적 1: Q14 '상품은 대표만'이 4-2 목록과 불일치(상품 쓰기는 service role이라 RLS로 못 막음, 34개 파일) → Q14 권장을 (나) CS도 편집·완전 삭제만 대표로, 4-2 목록 명시, 4-4·11절 정합. 권고 반영: DB-9b `coalesce`·사전 0건 확인, DB-5 재시도 상한·대시보드 표시, 메뉴 이름 저장 대표 전용, DB-4a 확정 시점·`/admin/orders` 포함 |
| R4 | 개정 3 | G | **PASS** | R3 필수 해소, 새 모순 없음, 첫 주 처리 경로 없는 업무 없음. 권고 3건(스위치 감시를 값의 변화로·주기 명시, '통지 실패' 카드 소속, 4절 Q14 반영) |
| R4 | 개정 3 | H | **PASS** | R3 필수 해소, 4-2 경로 실재·쓰기 핸들러 확인, Q14 (나)와 4-4 설정 테이블 `is_owner()` 비충돌(홈 화면 저장은 service role). 권고 3건(DB-10 문구를 Q14에 따라, 스위치 감시를 값 3개 변화로·초기값, CS에게 연필 버튼 숨김) |
| 확정 | 개정 3 + R4 권고 | 작성자 | 반영 | R4 권고 6건(중복 1건)을 문구로 반영: 3-3·DB-5 판매 허용 값 3개 변화 감시·1분 주기·초기값, '통지 실패' 카드 소속, DB-10 Q14 조건, 4-3 연필 버튼, 4절·0-1 Q14 반영. 설계 변경 없음 |
