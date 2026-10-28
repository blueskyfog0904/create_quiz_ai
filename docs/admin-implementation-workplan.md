# 관리자 페이지 개선 구현 작업계획서

- 작성일: 2026-10-29 · 기준 HEAD 25bad66 · 상태: **확정안 — 독립 검증 2명 PASS(R3), 결정 질문(7절) 답변 대기**
- 상위 문서: `docs/admin-operations-readiness-plan.md`(무엇을, 왜 — 이하 "준비 계획"). 이 문서는 **어떻게**: 작업 단위마다 바꿀 파일·함수, 테스트, DB 의존·순서, 검증 방법.
- 범위: 준비 계획의 0단계(런북·재개 SQL), 1단계, 2단계, 3단계, 4a단계. **Supabase 서울 이전(`docs/supabase-seoul-migration-plan.md`)은 제외**하되 순서는 그것에 맞춘다. 5단계(P1)·4b·6단계(P2)는 이 문서 범위 밖(별도 작업계획).
- 단위 ID는 준비 계획 ID 앞에 `W`를 붙인다(예: 준비 계획 1-1 → W1-1).
- 작성: 코드·운영 DB(SELECT만) 조사 담당 3명(1단계 / 3단계 / 2·4a단계) 초안을 메인 에이전트가 합침.

## 0. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 진행 | 단위마다 구현 → 독립 검증 PASS → 다음 단위. 단위는 각자 커밋, push·배포는 사용자 결정 |
| 테스트 | `npx tsc --noEmit`, 바꾼 파일 eslint, `node --test --test-reporter=tap tests/*.test.mjs`의 실패 목록이 `docs/payapp-phase0-baseline-fails.txt`(43건)와 같고 새 실패 없음. 계약 테스트는 기존 `tests/*.test.mjs`처럼 소스를 읽어 정규식으로 검사. 1단계 화면 계약 검사는 `tests/admin-phase1-contract.test.mjs` 한 파일에 단위별 `test()` |
| 하드코딩 금지 | 데이터(메뉴 구성·레거시 목록·공개 과목·CS 한도)는 DB, 페이지 등록부·판정 규칙은 코드 |
| 로컬 확인 | localhost:4000은 **운영 DB**를 씀 → 화면 GET만. 삭제·승인·지급·알림 벨 열기·비밀번호 재설정 같은 쓰기는 하지 않음(확인창은 열었다 취소까지). 쓰기 확인은 배포 뒤 대표 시험 계정으로 운영에서 |
| DB 순서 | 추가형(새 컬럼·함수·테이블·설정 행)은 DB 먼저 → 코드, 축소·제약형은 코드 먼저 → DB. DB 쓰기는 운영 BEGIN…ROLLBACK 리허설 PASS + 사용자 승인. 결제·크레딧·권한 DB는 전문 검증 3명 |
| 브랜치·배포 | **main 병합 = 운영 배포**. 배포 시점이 DB 단계 뒤인 코드는 **병합 조건마다 브랜치를 따로** 둔다: `admin/after-db5`(W3-3c), `admin/after-smtp`(W3-7a), `admin/after-db4a`(W2 묶음 13), `admin/after-db6`(W3-5c), `admin/after-db9a`(W4 묶음 15). 각 브랜치는 **병합 직전에 main 기준으로 rebase**하고 전체 테스트를 다시 돌린다(main 묶음과 같은 파일을 고침: W3-1b·W2-6 ↔ W2-2/3, W1-4·W3-3a ↔ W3-3c(`payment-sales-status-server.ts`·`dashboard-client.tsx`), W2-5 B14 링크 ↔ W2-5 탭 링크(`market-main-settings-client.tsx`), W4-6a ↔ W4-1·W4-6b). 그 코드를 import하는 계약 테스트(DB-4a·DB-9a·DB-10 계약 등)도 같은 브랜치에 둔다(main 기준선에 새 실패를 만들지 않게). **마이그레이션 SQL 파일과 SQL만 읽는 계약 테스트는 main에 커밋해도 됨**(자동 적용 CI 없음, `3cf3a90`·`6990809` 선례). "배포 보류" = main 미병합 |
| 배포 동결·되돌리기 | 서울 이전 **C-0(전날, 전환 전 배포 ID 기록)부터 C-9까지** main 병합·배포 금지. 단위 되돌리기는 **revert 후 재배포**가 기본. 이전 전에 Instant Rollback을 썼다면 다음 배포 전에 Undo Rollback(Hobby는 롤백 뒤 새 배포를 운영 도메인에 자동 연결하지 않음). C-9 뒤에는 전환 전 배포로 Instant Rollback 금지 |
| 운영 시험 | 운영 쓰기 시험(삭제·숨김·다운로드·지급·알림 벨·비밀번호 재설정·스위치)은 **대표 시험 계정**과 **시험 계정만 산 상품**으로, 이용이 적은 시간에, 대상 id를 사전 승인받고, 끝나면 즉시 원복·SELECT 확인 |
| 열지 말 화면 | `/admin/ai-question-generation-runs`와 `/admin/ai-question-generation-runs/[runId]`는 **로컬·운영 모두 열지 않음**(열면 운영 만료 로그 상세가 영구 삭제, R3). 이 두 경로가 관련된 검증은 코드로만 |
| 서울 리허설 중 로컬 | 서울 이전 H-9 동안 `.env.local`이 새 DB를 가리키므로 그 기간 로컬 검증 중지. 로컬 검증 전 `grep -c <옛 ref> .env.local`로 대상 확인 |
| 서울 이전과의 관계 | **DB 쓰기는 모두 서울 이전 완료 뒤 새 DB에**(이전 리허설~본 전환 동안 옛 DB 스키마 변경 금지). **DB가 필요 없는 코드 단위는 지금 진행·배포 가능**(옛 DB·새 DB에서 똑같이 동작) — 배포 금지 구간은 위 "배포 동결" 행(C-0~C-9) |

## 1. 전체 순서와 배포 묶음

```
[지금 — main에 코드만, 서울 이전과 병행(배포 동결 C-0~C-9 제외)]
  묶음 1: W1-1 + W1-1b                         (같은 배포 필수)
  묶음 2: DB-13 파일·계약 테스트 + W1-9a       (DB-13 파일이 먼저 있어야 B1 계약 테스트 수정 가능)
  묶음 3: W1-3a + W1-3b + W3-1a                (refunds 화면)
  묶음 4: W1-4 → W3-3a                         (대시보드·배지)
  묶음 5: W1-2 + W1-5                          (users-client)
  묶음 6: W1-6                                 (결제 화면 헤더, 단독)
  묶음 7: W1-7a                                (공개 화면 영어 숨김, 단독)
  묶음 8: W3-8a + W3-8b                        (알림)
  묶음 9: W3-1b + W3-2                         (주문 조회)
  묶음 10: W2-5(B14 링크만) + W2-6 + W4-6a
  병행(대표): W0-6 작성, W1-7b(영어 테스트 데이터 비공개 — 관리 화면 데이터 변경은 동결 중에도 허용), W0-9
  병행(파일만): DB-0·DB-1·DB-2·DB-3b·DB-5·DB-7·DB-6·DB-4a·DB-9a·DB-10 마이그레이션·계약 테스트, 0절의 조건별 `admin/after-*` 브랜치 코드
[서울 이전 완료 뒤 — 새 DB]
  DB-1 → DB-13 → DB-3b → DB-0 리허설 → W0-6 대표 따라 하기
  → DB-5 → 묶음 11: W3-3c(main 병합)
  → W0-8(Resend·SMTP — 서울 P-7 경로면 이전 전에 이미 끝남) → W3-7b(템플릿) → 묶음 12: W3-7a(main 병합)
  → DB-2(전문 검증, 병행 가능)
  ── 페이앱 출시 스위치 ──
     조건(준비 계획 Q8): W0-6·W0-7·W0-8·W0-9, 1단계 전부(W1-10=DB-2는 제외·병행), W3-1·W3-2·W3-3·W3-7·W3-8
     → 출시 직후 확인(6-1절)
  → DB-4a → 묶음 13: 2단계(W2-1, W2-2/3, W2-4, W2-5 탭 링크, W2-7) → DB-4b
  → DB-7 → DB-6 → 묶음 14: W3-5c
  → DB-9a → 묶음 15: 4a 코드(W4-1 코드, W4-2, W4-3, W4-6b) → DB-9b → DB-10 → W4-7 시험 CS 계정 검증 → CS 계정 발급
```

- 지금 배포하는 묶음은 DB 스키마에 기대지 않아 옛 DB·새 DB에서 똑같이 동작한다.
- 서울 이전 계획 1절의 동결은 "옛 프로젝트의 스키마·DB 설정 변경"이고, 코드 배포는 C-0~C-9만 금지(그 문서도 같게 맞춤).

## 2. 0단계 — 출시 스위치 전 운영 준비

### W0-6 운영 런북
- 산출물 `docs/admin-operations-runbook.md`: 준비 계획 9절 RB-1·RB-2·RB-4~RB-11을 "언제 / 무엇을 본다(SELECT) / 무엇을 한다 / 누가 / 고객 안내 문구"로. 돈·개인정보 SQL 규칙(즉석 SQL 금지, 필요 시 작성 → 리허설 → 3명 검증 → 승인)과 4a 전 모든 RB는 대표 실행 명시.
- 런북 SQL은 cron을 jobid가 아니라 **jobname**으로 가리킴(새 DB에서 jobid가 달라짐). 숨김 상품의 다운로드까지 막아야 하는 경우(저작권·하자)는 '파일 비활성화'로 차단하는 절차를 RB에 포함(Q-1).
- 검증: 작성은 지금(독립 검증 1회). 대표 따라 하기(RB-1·RB-2)는 서울 이전 뒤 DB-0 리허설·DB-5 적용 후 새 DB에서. 규모 중.

### W0-8 고객 메일 발송(SMTP) — 대표
- 서울 이전 계획 P-7(Confirm email이 켜져 있으면 전환 전) 또는 A-4(꺼져 있으면 전환 직후) 중 한 곳에서 한 번만: Resend 가입·도메인 등록 → 가비아 DNS(`send` MX·TXT, `resend._domainkey` TXT — 기존 Zoho 레코드는 건드리지 않음) → API 키 → **새 서울 프로젝트** Authentication → Emails → SMTP Settings → URL Configuration 확인.
- 검증: 팀원이 아닌 외부 주소로 복구 메일 수신, 메일 헤더에서 SPF·DKIM pass 확인. W3-7a 배포의 전제.

### W0-9 외부 가동 감시 — 대표
- 무료 업타임 감시 서비스로 `https://www.summersuninst.com/`(GET)을 1~5분 간격 감시, 다운 시 W3-3b와 같은 슬랙 채널(Q11)로 알림. 결제 통보 URL은 POST 전용이라 사이트 감시로 대신.
- 검증: 감시 서비스의 시험 알림이 슬랙에 도착. 지금 가능.

### W0-7 판매 재개·수동 중지 SQL (DB-0)
- 산출물 `supabase/ops/payapp_sales_resume.sql`, `payapp_sales_stop.sql`, `master_sales_stop_resume.sql`(카카오페이 미사용으로 제외). 재개: 이미 켜져 있으면 중단, health가 끄는 조건(미지급 10분 초과, money-risk manual_review, 취소 표식 미처리, 스케줄러 stale·연속 실패)과 같은 SELECT가 0건일 때만, `payapp_merchant_id` 유지 확인, `changed_by`·`change_ticket` 기록. 계약 테스트 `tests/payapp-sales-ops-contract.test.mjs`.
- 검증: 서울 이전 뒤 새 DB에서 BEGIN…ROLLBACK 리허설, 전문 검증 3명. 실제 실행은 자동 중지 시 대표 승인으로.

## 3. 1단계 — P0 안전·고장 수정

### W1-1 상품 삭제: 이력 있으면 숨김, 없으면 완전 삭제 (R1, 사용자 결정)
- 현재: `src/lib/market-item-cleanup.ts:94-143` `getItemsWithHistory`(비공개)는 `market_purchases`·`market_download_events`·`market_purchase_orders`·`market_entitlements` 4개만 봄. `:145-181` `hardDeleteMarketItemWithAssets`는 **파일 먼저(:169-170) → DB(:172-180)**. `api/admin/market/items/[id]/route.ts:207-244` DELETE는 `requireNoHistory` 없음, 오류는 모두 500. **일괄 삭제는 서버 경로가 없고** `market-products-client.tsx:1434-1485` `handleBulkDelete`가 단건 DELETE를 `Promise.allSettled`로 반복. 단건 경로 `handleArchive` 1228-1262(자동 업로드 임시 상품 취소 겸함)·`handleDeleteFromList` 1264-1293, 확인창 3505-3525(단건)·3573-3602(일괄).
- DB: `market_items` 참조 FK 13개 모두 CASCADE, 이력 상품 11개(orders·lines·entitlements 각 17, downloads 18, refund_requests 2, reviews 3).
- 변경:
  1. lib: `getItemsWithHistory`에 `market_purchase_lines`·`market_refund_requests`·`market_item_reviews`를 더해 export. 조회 오류는 throw(판정 실패 시 지우지 않음).
  2. lib 순서: `hardDeleteMarketItemWithAssets` = 조건 검사 → `collectMarketItemStorageTargets`(경로 먼저 수집) → `requireNoHistory` 판정 → `market_items` delete → `removeStorageTargets`. 파일 삭제 실패는 throw하지 않고 `console.error` + `{ storageCleanupFailed }`. 자동 정리 cron(`cleanupAutoUploadDraftMarketItems`)도 같은 순서.
  3. lib 신규 `deleteOrHideMarketItem({ itemId, workspaceSubject, updatedBy })`: 이력 있으면 `updateMarketItem(id, { status: 'hidden', updated_by })`(이미 hidden이면 생략) → `{ result: 'hidden' }`, 없으면 `hardDeleteMarketItemWithAssets({ …, requireNoHistory: true })` → `{ result: 'deleted' }`(완전 차단은 DB-2). **`market_items` delete가 `error.code === '23503'`(FK 위반 — DB-2 적용 뒤 판정과 삭제 사이에 구매가 끼는 경우)이면 `updateMarketItem(hidden)` → `{ result: 'hidden' }`**. 파일 삭제는 DB 삭제 뒤라 이 경우 파일은 그대로 남음. 구현 메모: 지금 `hardDeleteMarketItemWithAssets`는 `throw new Error(error.message)`(`market-item-cleanup.ts:178-180`)로 오류 코드를 버리므로 코드를 함께 넘기도록 바꿈(테스트 ⑥이 확인).
  4. route: DELETE가 3을 부르고 `{ success: true, data: { result } }`. 캐시 태그 2개 유지. **서버 일괄 route는 만들지 않음**(판정은 이미 상품마다 서버에서, W4-2 대표 검사 지점 1곳 — 결정 Q-2).
  5. 화면: 단건 2곳은 `result === 'hidden'`이면 "구매·환불·후기 이력이 있어 삭제하지 않고 숨김 처리했습니다", 일괄은 `deletedIds`·`hiddenIds`로 나눠 지운 것만 목록에서 빼고 "삭제 N개 / 이력이 있어 숨김 처리 M개" toast. 확인창 3곳에 "구매·환불·후기 이력이 있는 상품은 삭제되지 않고 숨김 처리됩니다(구매자 다운로드는 유지)". 자동 업로드 취소 문구는 그대로.
- 테스트 수정: `market-products-admin-hide-action.test.mjs:84-100`, `market-images-display.test.mjs:172-185`(mock을 `deleteOrHideMarketItem`, `{result:'deleted'}`), `market-item-cleanup-storage-contract.test.mjs:29-33`, `market-v2-cleanup-orphan-rollback-contract.test.mjs:17-22`(이력 판정 모양을 그대로 검사 → 7개 테이블 구조로 수정). 통과 유지 확인: `market-auto-upload-cleanup-route-contract.test.mjs:23-33`. 확인창 3곳 중 `handleArchive`는 AlertDialog가 아니라 `window.confirm`(1234-1236).
- 테스트(새) `tests/market-item-delete-or-hide.test.mjs`(`tests/helpers/market-images-harness.mjs`의 `load`·`createFakeAdmin`·`loadRoute`로 실행): ① 이력 테이블 7개 중 하나만 있어도 update(hidden)만, delete·remove 없음 ② 이력 없으면 파일 목록 → delete → remove 순서 ③ remove 오류면 throw 없이 기록 ④ 이력 조회 오류면 throw·delete 없음 ⑤ route `data.result` ⑥ 가짜 admin이 delete에 23503을 돌려주면 update(hidden)만, remove 없음(지금은 CASCADE라 운영에서 나지 않으므로 이 테스트로만 확인). 계약: `from()` 대상 7개, 화면 문구.
- DB 없음(DB-2는 별도). 검증: 이력 판정 SELECT로 11개, 로컬은 확인창 문구만. 배포 뒤 대표가 운영에서 **이력 없는 임시 상품 1개**와 **대표 시험 계정만 산 상품 1개**(일반 고객이 산 상품 6개는 쓰지 않음, id 사전 승인)로 시험 → 숨김된 상품은 W1-1b 다운로드 시험까지 한 번에 하고 **즉시 published로 원복** → `status`·행 0건·storage 0건 SELECT. DB-2 적용 뒤에는 FK 위반(23503)을 500이 아니라 숨김으로 처리하도록 W1-10에서 함께 확인. 규모 중, 위험 중(삭제 경로). 서버 응답과 화면 문구 같이 배포.

### W1-1b 숨김 상품도 구매자는 계속 다운로드 (F11, 결정 Q-1)
- 현재: `getActiveMarketSubproductFileForDownload`(`market-items-server.ts:1505-1525`)가 `status !== 'published'`면 null → 다운로드 route(`api/market/items/[itemId]/download/route.ts:58-62`) 404. 운영 다운로드 18건은 모두 이 경로(subproduct_file). 구매자가 숨김 상품에 닿는 다른 경로는 검증자가 모두 확인: 내 서재는 상태로 거르지 않고 `detailAvailable`만 false, 옛 다운로드 경로는 `getMarketItemById`가 상태를 보지 않아 이미 허용(`market_purchases` 0행), 환불 자격·후기 route도 상태를 보지 않음, 상세·샘플·조회수는 404(의도). **막히는 곳은 v2 다운로드 1곳**. 현재 hidden 상품 0개라 기존 숨김 상품이 다시 열리는 일은 없음.
- 변경: 호출처가 다운로드 route 하나뿐이므로 옵션 없이 조건을 `status in ('published','hidden')`으로 바로 바꿈(권한 검사는 route가 이어서 하므로 권한 있는 구매자만 받음). 삭제(`deleted_at`)·비활성(`is_active=false`)·파일 비활성은 계속 막음. 공개 목록·상세·구매 경로는 바꾸지 않음(숨김 = 신규 노출·구매 중지). 진단 함수(W3-2)도 같은 규칙.
- 테스트: 실행 테스트 — 숨김 상품 + 권한 있음 → 파일 반환, 숨김 + 권한 없음 → 403, 삭제·비활성 → 404. 계약: 조건이 published·hidden 둘만 허용.
- DB 없음. 검증: W1-1 운영 시험과 한 번에(대표 시험 계정만 산 상품, 다운로드 기록 행이 생기고 그 주문은 환불 불가가 되므로 시험 계정에만). 규모 소. **W1-1과 같은 배포.**

### W1-2 사용자 관리: 잔액·서버 검색·페이지네이션 (B2, B3)
- 현재: `users/page.tsx:9-15` `select('*')`·`.limit(20)` 두 번, `:22-29` 없는 `user_credits` → 전원 0C, `users-client.tsx:62-69` 20명 안 검색, `:262-278` 페이지 버튼 자리표시.
- 변경: 1a U4 설계 재사용, 단 검색 컬럼은 `email`·`phone`·`organization`(profiles에 `name` 없음). `page.tsx`: `searchParams` q·page·pageSize, 컬럼 `id, email, phone, organization, role, is_admin, provider, created_at`만, 개수 → `getListPagination` → `.range`, 범위 초과·검색어 이스케이프는 `market-categories-server.ts:168, 185-197` 패턴. 잔액은 현재 페이지 회원 id로 `credit_sources`(`status='active'` and `expires_at is null or > now`, `get_credit_balance_snapshot`의 `spendable_balance`와 같음 — 만료일 있는 원천이 이제 1행 있어 `profiles.credits` 캐시와 다를 수 있음)를 한 번 조회해 합산. `users-client.tsx`: 화면 필터 제거, **`useState(initialUsers)` 제거하고 props를 바로 그림**(W1-5의 `router.refresh()` 뒤 잔액이 갱신되도록 — `useState` 초기값은 새 props를 반영하지 않음), 검색 폼 제출 → `router.push`, `StudioListPagination`(`getPageHref`).
- 테스트(새, 계약): `user_credits`·`select('*')`·`.limit(20)`·`name.ilike`·`users.filter(`·`useState(initialUsers)` 없음, `from('credit_sources')`·`.eq('status', 'active')`·`expires_at.is.null`·`getListPagination`·`.range(`·`StudioListPagination` 있음.
- DB 없음. 검증: profiles 14 = 화면 총 N명, 잔액 있는 회원 수(현재 6)·금액을 SELECT와 대조, `?page=2` 보정, 검색어 `,`·`(`·`%`. 규모 중. W1-5보다 먼저(같은 파일).

### W1-3a 환불 관리: 조회 오류 배너·기본 필터·경보 위로·승인 금액 (B5, B6, B8)
- 현재: `refunds/page.tsx` 조회 4개(:38, :70, :100, :106)가 `error`를 버림. 순서는 충전 환불 → 결제 확인(경보는 `payment-review-client.tsx:234`, 주문 표 아래) → 마켓 환불. `refunds-client.tsx:138` 기본 `pending_review`, '확인 필요' 카드는 `retryable_failed`만. 승인 다이얼로그 `:481`·목록 `:364` 금액이 `source.plan.price`(현재 가격). **실제 처리 금액 기준은 `refund_requests.refund_amount`**(카카오 경로 `point-charge-refund-processor.ts:187,209`가 이 값을 넘기고, 페이앱은 전취소 `processPayAppRefund` 96-110).
- 변경: `page.tsx` 조회마다 `{ data, error }` → `loadErrors` → 맨 위 서버 배너(`role="alert"`, "다음 목록을 불러오지 못했습니다 — 비어 보여도 처리할 건이 있을 수 있습니다"). 순서 배너 → `PaymentReviewClient` → `RefundsClient` → 마켓. `payment-review-client.tsx`(배치만): 경보 블록을 주문 표 위로, 설명 "위 환불 요청" → "아래 환불 요청". `refunds-client.tsx`: 필터 `needs_action`(=`pending_review`·`retryable_failed`·`manual_review`) 기본 + "처리 필요 전체", 확인 필요 카드는 `retryable_failed`+`manual_review`, 금액 `refund_amount ?? order.expected_amount`(없으면 '-'). 참고: 페이앱은 전취소(`processPayAppRefund` 96-110), 카카오 경로가 `refund_amount`를 넘김. 부분취소 회수 대상 건은 `refund_amount`가 신청 기준액(전액)이라(`refunds-client.tsx:185` 주석) 그 건은 '신청 기준액' 라벨로 구분.
- 테스트: 기존 `payapp-admin-contract.test.mjs:59-69`, `point-charge-compliance-ui-contract.test.mjs:90-93`, `provider-refund-processing-contract.test.mjs:95-99` 통과 유지. 새 계약: 4개 조회 `error`·`loadErrors`, `<PaymentReviewClient`가 `<RefundsClient`보다 앞, `useState('needs_action')`, `plan?.price` 없음, `refund_amount ??`, 경보 블록이 `<Table` 앞.
- DB 없음. 검증: 상태별 SELECT(현재 completed 3, 수동확인 0, 미해소 경보 0)와 카드 비교, 오류 배너는 코드로. 규모 소~중. W1-3b보다 먼저(같은 page).

### W1-3b 환불 관리: 마켓 환불 (B7)
- 현재: `market-refunds-client.tsx:38-55` catch 없음, `:99-114` 확인창·메모 없이 PATCH, `:87` UUID 원문, `:94` 영문 상태, 상품명 없음. 승인 후 실패 시 상태 `approved`로 남고 `admin_note`에 "[환불 처리 실패: 단계]"(`market-refunds.ts:542-546`)인데 화면에 안 보임.
- 변경: page 조회 `'*, user:profiles!market_refund_requests_user_id_fkey(email), item:market_items!market_refund_requests_item_id_fkey(title)'`(FK 이름 DB 확인). 승인·거부 공통 AlertDialog(상품명·회원·크레딧, 메모 → `adminNote` — API는 이미 받음 `route.ts:56-57`), catch → `toast.error`, 성공 `result.message` toast, 회원 `formatMemberDisplayName`, 상품 열, 상태 한글화(`market-refunds.ts:8`), `admin_note` 열.
- 테스트: `market-refund-api-ui-contract.test.mjs:57-58` 통과 유지. 새 계약: `catch`·`toast.error`·`AlertDialog`·`adminNote`·`item?.title`, FK 이름 2개, `{request.user_id}` 원문 출력 없음.
- DB 없음. 검증: 상태별 SELECT(pending 1, approved 1) = 화면, 확인창은 열었다 취소. 규모 소. W1-3a 다음.

### W1-4 대시보드 1차: 거짓 표시 제거 + 처리 대기 카드 (B1)
- 현재: `api/admin/stats/route.ts:26-27` 서버 로컬 자정, `:56-93` 레거시 `questions`, `:110-145` 없는 `admin_logs`, `:171-192` `amount.sum()`(항상 0). `dashboard-client.tsx` 카드 5개(:102-143, 가입만 유효), 최근 문제·`/admin/questions` 링크(:185-246, :192), 학년 TOP5(:248-298), "정상 작동 중" 3개(:301-330).
- 변경: 신규 `src/lib/kst-period.ts`(순수, `@/` import 없음) `getKstPeriodStarts(now)`(UTC+9, W1-5도 사용). `route.ts` 인증부(:7-23) 유지, 나머지: 오늘·이번 달 가입 수 + 처리 대기 7개 개수만 — 세션 클라이언트: `support_tickets`(`status='pending'` and `is_deleted_by_user=false`, `support-client.tsx:155` 기준 — `deleted_at` 컬럼 없음), `market_refund_requests`(pending). **service role(`createPaymentAdminClient`)**: `refund_requests`(pending_review / retryable_failed·manual_review), `payment_orders`(manual_review), `payment_reconciliation_alerts`(미해소) — authenticated 권한 없음 확인. 조회가 실패한 항목은 0이 아니라 "확인 불가"로 표시(전체 500으로 대시보드를 막지 않음, W3-3a와 같은 방식). 화면: 가입 카드 1개 + "처리 대기" 카드(항목별 숫자, `/admin/support`·`/admin/refunds` 링크, 0 아니면 강조), "기준: 한국 시간". 레거시 블록 삭제. 매출 지표는 5-13.
- 테스트(새): `tests/kst-period.test.mjs`(UTC 14:59/15:00, 월 첫날·말일, 1월 1일). 계약: route에 `admin_logs`·`.sum()`·`from('questions')`·`setHours` 없음, 3개 테이블 `createPaymentAdminClient`, 항목별 실패 처리, 화면에 `정상 작동 중`·`/admin/questions`·`학년 TOP 5` 없음.
- DB 없음. 검증: 같은 시점 SELECT 비교(현재 문의 대기 **0**(pending 1건은 사용자 삭제), 마켓 환불 대기 1, 나머지 0). 규모 중.

### W1-5 크레딧 관리: type 필터·서버 페이지네이션·지급 다이얼로그 재사용 (B4, B9)
- 현재: `credits/page.tsx:11-15` 최근 100건, `:42-46` 없는 `transaction_type`, `:57` 총 건수 = 불러온 건수. `credits-client.tsx:30-42, 60-92` `transaction_type`·`system_refund`. DB `type`: consume 312, purchase 36(+278,700), refund 36(+33건 5,601 / −3건 36,000). purchase에 결제 충전과 관리자 지급이 섞임. `users-client.tsx:55-152` 자체 지급 모달은 확인 단계 없고 category를 보내지 않아 'other'.
- 변경: `page.tsx` `searchParams` type(all/purchase/consume/refund)·q·page·pageSize, 컬럼 명시, `.eq('type', …)`, 검색은 설명 ilike + 이메일로 찾은 회원 id를 `.or`로, 개수 → `getListPagination` → `.range`. 통계 카드는 이번 달(KST) 행의 type·amount만 **1000행 단위로 끝까지 나눠 읽어**(PostgREST 기본 상한에 잘리지 않게) 서버 합산: 충전·지급 / 사용 / 환불 복원(+) / 환불 회수(−). 화면 필터 값을 실제 값으로, `router.push`·`StudioListPagination`, 배지는 type 기준. `users-client.tsx`: 자체 모달(:55-60, :71-113, :117-152) 삭제 → `<GrantCreditDialog open={grantOpen} onOpenChange={setGrantOpen} initialUser={selectedUser} onSuccess={() => router.refresh()} />`(필수 prop `open`·`onOpenChange`, `grant-credit-dialog.tsx:22-27`)(initialUser면 상세 단계부터, 사유 필수·확인 단계 `grant-credit-dialog.tsx:45-57, 84-98`). 안 쓰게 된 import 정리.
- 테스트(새, 계약): `transaction_type`·`system_refund` 없음, `.eq('type'`·`getKstPeriodStarts`·`.range(` 있음, `users-client`에 `GrantCreditDialog`, `/api/admin/users/credits` 직접 fetch 없음.
- DB 없음. 검증: type별 SELECT(312/36/36) = 필터 결과, 이번 달 합계, 지급은 확인 단계까지 열고 취소. 규모 중. W1-2·W1-4 다음.

### W1-6 `/checkout`에 마켓 헤더 (B13)
- 현재: `src/app/checkout/layout.tsx:1-6`이 이미 있고 `<SiteChrome>`(예전 헤더). 1a의 `path-aware-site-chrome`은 삭제됨(`site-chrome-layout-contract.test.mjs:31`). 결과 화면 `payapp/result/page.tsx:12`·`kakaopay/result/page.tsx:6`은 `<main className="studio-theme…">`, 잔액 갱신 이벤트 없음. 새 헤더는 처음 한 번만 잔액 조회(`preview-header.tsx:60-79`).
- 변경: `layout.tsx` → `export { default } from '@/app/(solvook)/layout'`(`pricing/layout.tsx`와 같음). 결과 페이지 2곳 `<main>` → `<div>`(중첩 방지, 클래스 유지). result-client 2곳: `status === 'completed'`를 처음 확인한 분기에서 한 번만 `fetch('/api/credits/balance')` → `dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance } }))`, 실패 무시.
- 테스트: 수정 `site-chrome-layout-contract.test.mjs:12`(checkout을 `OWN_CHROME_LAYOUTS` 18-25로). 기존 `kakaopay-checkout-contract:94-98`·`payapp-routes-contract:115-125` 통과 유지. 새 계약: 재export, 이벤트가 completed 분기 안.
- DB 없음. 검증: `/checkout?planId=…`(결제 버튼 누르지 않음), `/checkout/payapp/result?orderId=없는값`에서 마켓 헤더. 잔액 이벤트는 출시 직후 대표 실결제 시험에서. 규모 소, 위험 중(결제 화면, 파일 4개로 되돌림).

### W1-7a 영어 문제마켓 숨김 — 코드 (R5, 사용자 결정)
- 현재 영어 진입점: 헤더 영어 탭 `preview-header.tsx:15, 236-244`, 검색 과목 선택 `:308`, `?subject=english` 수용 `:33-37`, 메가메뉴 `category-mega-menu.tsx:34-37`, 홈 `(solvook)/page.tsx:27-31`·`solvook-home-view.tsx:33-38`, **`search/page.tsx:15-17`은 과목 없으면 영어**(`DEFAULT_WORKSPACE_SUBJECT='english'`), 서재·장바구니 탭 `library-view.tsx:43`·`cart-view.tsx:56`, **`(solvook)/library/page.tsx:40-43`은 `?subject`가 없고 구매 이력도 없으면 english**(헤더의 `libraryHref='/library'`로 진입).
- 설정 데이터: **새 키 `system_settings.market_public_subjects` = `{"subjects":["korean"]}`**(기존 키는 레거시·관리자용·과목별이라 부적합). `system_settings`는 비로그인이 못 읽으므로 서버에서 service role로 읽어 넘김. **행이 없으면 모든 과목 공개(지금 동작)** → 코드를 먼저 배포해도 화면 불변, 행을 넣는 순간 영어 숨김.
- 변경: 신규 `src/lib/public-subjects.ts`(순수): `normalizePublicSubjects(value)`(유효 과목만, 비었거나 형식 오류면 전체), `resolvePublicSubject(param, subjects, fallback)`(fallback이 비공개면 첫 공개 과목). 신규 `src/lib/public-subjects-server.ts`(service role, 60초 캐시 — 기존 `unstable_cache` 방식, `preview-home-cache.ts`). **캐시하는 함수 안에서는 오류를 던지고, 캐시 바깥에서 잡아 기본값(전체 공개)을 돌려주고 기록만**(오류 기본값이 60초 캐시되어 숨김 행이 있어도 영어가 보이는 일을 막음. 오류 시 기본값 선례 `footer-content-server.ts:35`. 공개 레이아웃 3곳이 쓰므로 throw가 밖으로 나가면 사이트 전체 500, 서울 전환 키 교체 시점에도 노출). `(solvook)`·`terms`·`(auth)` 레이아웃 3곳이 `publicSubjects`를 `PreviewHeader`에(preview 레이아웃은 전체). 헤더: 비공개 과목 param 무시, 과목 탭·검색 과목 선택은 공개 과목만, `CategoryMegaMenu`에 과목 목록 전달. 홈·검색·**서재** page는 공개 과목 안에서만 과목을 정하고(기존 기본값이 비공개면 첫 공개 과목) 비공개 과목 데이터는 조회하지 않음. 서재·장바구니 탭도 숨김(운영 영어 권한·주문 0건이라 "영어 권한이 있으면 탭 유지" 규칙은 두지 않음 — 영어 재개 시 설정 행만 바꾸면 됨). 영어 코드·데이터 삭제 없음.
- 테스트: 기존 `market-home-browser.test.mjs:30-32`, `market-home-ui-contract.test.mjs:26`, `solvook-preview-flow-contract.test.mjs:300`은 영어 탭 코드를 조건부로 남겨 통과(같은 파일 기준선 13번은 원래 실패). 새 `tests/public-subjects.test.mjs`(행 없음 → 전체, `["korean"]` → 국어만, 잘못된 값 제거, 빈 배열 → 전체, fallback). 계약: 레이아웃 3곳이 읽기 함수 사용, 읽기 함수가 오류 시 기본값 반환, `search/page.tsx`·`library/page.tsx`가 공개 과목 기준으로 기본값을 정함, DB-3b 마이그레이션 키 = 코드 키.
- DB: 없음(행은 DB-3b). 검증 ① **배포 직후(행 없음)**: 화면이 지금과 같음(`/search` 기본 english 유지 — 행이 없으면 전체 공개라 의도대로 불변). 검증 ② DB-3b 뒤: `/`, `/?subject=english`(국어로), `/search`, 메가메뉴, `/terms/*`, 로그인 화면 헤더에 영어 없음. 규모 중, 위험 낮음~중(공개 화면 여러 곳).

### W1-7b 영어 테스트 데이터 비공개 (DB-3a, 대표, 지금)
- 영어 광고 3개 `isActive=false`, 영어 공개 상품 1개 숨김. 운영 관리자 화면(메인광고설정·상품 관리 `?subject=english`)에서 **대표가 직접, 지금**(결정 Q-3 — 관리 화면 데이터 변경은 서울 이전 동결 중에도 허용되고, 테스트 광고 공개는 즉시 위험이므로). DB-3b·DB-13 같은 마이그레이션은 서울 C-2에서 history를 다시 덤프하지 않으므로 이전 뒤. 검증 SELECT: 영어 광고 isActive 0, 영어 공개 상품 0.

### W1-7c 공개 과목 설정 행 (DB-3b, 추가형, 서울 이전 뒤)
- `system_settings` INSERT(`market_public_subjects`) 마이그레이션 + 되돌리기(DELETE). W1-7a 배포 뒤 권장(반대여도 무해).

### W1-8 `source_configs` 잠금 (R2, DB-1, 서울 이전 뒤)
- 현재(DB): RLS 꺼짐, 정책 0, 4행, anon·authenticated에 모든 권한. FK·트리거 없음. 사용처 `api/admin/source-configs/route.ts`(GET·POST)·`[id]/route.ts`(PATCH·DELETE)는 `is_admin` 확인 뒤 세션 클라이언트 → 관리자 정책이면 계속 동작. 레거시 비관리자 화면의 관리자 GET 호출은 이미 403.
- 마이그레이션: `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon`, `REVOKE TRUNCATE, TRIGGER, REFERENCES … FROM authenticated`, `CREATE POLICY … FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())`, `NOTIFY pgrst`. 되돌리기 파일은 **서울 이전 뒤 새 DB에서 다시 조회한** 적용 직전 권한으로.
- 테스트(새) `tests/source-configs-rls-contract.test.mjs`. 검증: RLS 켜짐·anon 권한 0·정책 1, advisor ERROR 사라짐, `/admin/source-configs` 목록 조회. 규모 소. 서울 이전 V-4(RLS 꺼짐 일치) 뒤.

### W1-9a 카카오페이 문구 정리 — 코드 (사용자 결정)
- 현재: `footer-content.ts:179`(위탁 '(주)카카오페이' 줄), `:231`("결제대행사(페이앱) 또는 카카오페이를 통해"), `:233`("휴대폰 결제와 카카오페이를"), `terms/[documentSlug]/page.tsx:86-90`(같은 결제수단 문장). `:154, 177`의 카카오 **로그인** 문구는 유지.
- 변경: 3줄을 B1 문체로("결제대행사(페이앱)를 통해", "…휴대폰 결제를 사용할 수 있습니다", 위탁 줄 삭제), 약관 화면 문장도 같게(결정 Q-4: 문구만, `payment_methods`에서 읽게 바꾸는 일은 범위 밖 기록). DB-13 전까지 약관 화면 고정 안내와 DB 본문이 잠깐 어긋남(카카오페이가 이미 꺼져 있어 화면이 더 정확).
- 테스트 수정: `footer-content.test.mjs:83, 113`, `payment-provider-policy-contract.test.mjs:17`, **`payapp-migration-b1-contract.test.mjs:38-48`**(B1 새 문장이 코드 기본값에 있는지 검사 → B1 문장을 DB-13 옛→새 쌍으로 바꾼 뒤 비교). 규모 소. 지금 가능.

### W1-9b 약관 카카오페이 문구 (DB-13, 데이터, 서울 이전 뒤·출시 스위치 전)
- `supabase/migrations/<ts>_admin_db13_terms_kakaopay.sql` + 되돌리기 + 적용 전 원문 `…_before.json`. B1 구조: `SET LOCAL` 타임아웃, `c_expected_md5`(현재 `0eaa00b3ac686387a4c9110b2fc085ca` — **새 DB에서 다시 확인**), 옛 조각 정확히 1번 검사, `jsonb_set` 고정 경로 2개(`policyDocuments,refundPolicy,content` / `privacyPolicy,content`), 적용 뒤 '카카오페이' 0건·다른 내용 무변경 검증, `NOTIFY pgrst`.
- 테스트(새) `tests/admin-db13-terms-kakaopay-contract.test.mjs`. 검증: '카카오페이' 0건, '카카오 로그인' 유지, 약관 화면 3종. `payment_methods.kakaopay`(is_enabled=true)는 결제 DB라 건드리지 않음(기록만).

### W1-10 구매 기록 FK 보호 (DB-2, 제약형, W1-1 배포 뒤·서울 이전 뒤)
- `market_items`를 참조하는 구매·권리·후기 FK(`market_purchase_orders`/`lines`, `market_entitlements`, `market_refund_requests`, `market_purchases`, `market_download_events`, `market_item_reviews`) CASCADE → RESTRICT. 마이그레이션 + 되돌리기 + 계약 테스트. **전문 검증 3명**. 출시 스위치를 막지 않음(관리자 화면 경로는 W1-1이 막음). 함께: `deleteOrHideMarketItem`이 판정과 삭제 사이에 구매가 끼어 FK 위반(23503)이 나면 500이 아니라 숨김으로 처리(코드는 W1-1에 미리 넣어 둠).

## 4. 3단계 — 공개 판매 전 운영 필수 기능

### 4-0. 조사로 새로 확인한 사실

| # | 사실 | 근거 | 영향 |
|---|---|---|---|
| F11 | **숨김(hidden) 상품은 이미 산 사람도 내려받을 수 없음** | `getActiveMarketSubproductFileForDownload`(`market-items-server.ts:1510`)가 `status !== 'published'`면 null → 다운로드 route(`api/market/items/[itemId]/download/route.ts:58-62`)가 404. 메인 에이전트가 코드로 직접 확인 | W1-1(이력 있으면 숨김)과 0-1 수칙이 구매자 다운로드를 막음 → **W1-1b 신설, 결정 Q-1** |
| F12 | 마켓 환불 승인·거절 때 고객 알림을 만들지 않음 | `api/admin/market/refunds/**`, `lib/market-refunds.ts`에 `notifications` insert 없음(충전 환불은 `api/admin/refunds/route.ts:103-118`에서 생성) | W3-8b(결정 Q-9) |
| F13 | 알림 벨은 열기만 해도 모든 알림을 읽음 처리(PATCH 쓰기) | `notification-bell.tsx:116-134` | 로컬 dev(운영 DB)에서 벨을 열면 운영 쓰기 → 운영 화면에서 대표 시험 계정으로만 확인 |
| F14 | `payment_provider_transactions` 0행, 결제 주문은 toss 테스트 12건뿐 | DB 집계 | W3-1은 실제 `mul_no` 없이 검증 → 실결제 뒤 재확인 |
| F15 | `credit_transactions`에 `(user_id, operation_key)` 유니크 인덱스 있음 | DB 인덱스 | W3-5 RPC가 새 인덱스 없이 중복 지급 방지 |
| F16 | pg_net 응답 보관(`pg_net.ttl`) 6시간 | `pg_settings` | DB-5 재시도는 "응답 행 없음 + 일정 시간 경과 = 유실" 처리 |
| F17 | anon·authenticated가 `credit_sources`·`credit_transactions`에 TRUNCATE 권한 보유(PostgREST로는 호출 불가) | DB 권한 | W4-4 권한 정리 때 함께 회수 |

### W3-1a 수동확인 목록에 이메일·`mul_no` 표시
- 현재: `admin/refunds/page.tsx:70-84` select에 이메일·거래번호 없음, 타입 `payment-review-client.tsx:41-51`, 표시 `:209-214`.
- 변경: select에 `user:profiles!payment_orders_user_id_fkey(email)`, transaction의 `provider_transaction_id`. `PaymentReviewOrder`에 `email`·`providerTransactionId`, 표에 열 1개.
- 테스트: `payapp-admin-contract.test.mjs:43-64` 유지 + "수동확인 select에 email·provider_transaction_id" 단언.
- DB 없음. 검증: `status='manual_review'` SELECT(지금 0건) = 화면. 규모 소. **W1-3 뒤(같은 파일).**

### W3-1b 주문 조회 › 충전 결제 (`/admin/orders`)
- 패턴: 페이지(서버, `buildAdminMenuMetadata`, `AdminMenuName`) → 클라이언트(`useListQuery`, `StudioListPagination`) → GET API(지역 `is_admin` 검사) → lib(service role, 건수 먼저 세고 range). 본보기 `api/admin/reviews/route.ts:9-35`, `lib/market-reviews-server.ts:335-395`.
- 신규: `src/app/(admin)/admin/orders/page.tsx`(탭 `?tab=payments|market`) + `orders-client.tsx`, `GET /api/admin/orders/payments`(refunds route와 같은 지역 `requireAdmin`), `src/lib/admin-orders-server.ts` `listPaymentOrdersForAdmin()`(`createPaymentAdminClient`). 지금 사이드바 기본 목록(`admin-sidebar.ts`의 기본 items와 `getDefaultAdminSidebarMenuItems`)에 `/admin/orders`를 `/admin/refunds` 다음에 추가(2단계 전이라 저장된 국어 설정에서는 목록 끝에 붙음, DB-4a에서 자리 확정).
- 조회: 기준 `payment_orders` + `user:profiles!payment_orders_user_id_fkey(email)`, `method:payment_methods!payment_orders_payment_method_fkey(label)`, `transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(provider_transaction_id, provider_status, paid_amount, paid_feedback_recorded_at, admin_paid_confirmed_at, cancel_feedback_recorded_at, cancel_processed_at, partial_cancel_feedback_recorded_at, partial_cancel_processed_at, partial_cancel_amount)`(PostgREST select는 와일드카드 불가 — 컬럼을 하나씩), `source:credit_sources!payment_orders_source_id_fkey(id, initial_credits, remaining_credits, status, expires_at)`(**FK 양방향이라 이름 지정 필수**), `refunds:refund_requests!refund_requests_payment_order_id_fkey(id, status, origin, refund_amount, created_at, processed_at)`. 페이지의 order id로 `payment_admin_actions` 별도 조회.
- 검색: `q` 한 칸 — 이메일 부분 일치(profiles 먼저 → user_id IN, 와일드카드 이스케이프는 reviews 방식), 주문번호 정확 일치, 거래번호 정확 일치(ppt 먼저 → id IN). 필터 provider·status·environment·기간(KST 날짜 → `+09:00` 경계). created_at desc, 20/50건.
- 테스트(새) `admin-orders-contract.test.mjs`: `is_admin` 검사, service role, `payment_orders_source_id_fkey` 지정, `provider_transaction_id` 검색, `.range` 전 건수, 사이드바에 `/admin/orders`, 페이지가 `AdminMenuName href="/admin/orders"`.
- DB 없음. 검증: provider·status별 SELECT 건수(12건) = 화면 필터 건수, 검색 3종 대조(조회만이라 로컬 가능). 규모 중.

### W3-2 주문 조회 › 마켓 구매 (같은 페이지 탭)
- 현재 데이터: 주문 17(완료 16·환불 1), 줄 17, 권한 17(subproduct 15·item 2), 다운로드 기록 18, 환불 요청 2, 옛 `market_purchases` 0. `credit_consumptions` 키가 `source_id`/`sourceId` 혼재.
- 신규: `GET /api/admin/orders/market` + `listMarketOrdersForAdmin()`(`createAdminClient`).
- 조회: 기준 `market_purchase_orders` + `user:profiles!market_purchase_orders_user_id_fkey(email)`, `item:market_items!market_purchase_orders_item_workspace_fkey(title, status, is_active, deleted_at)`, `lines:market_purchase_lines!market_purchase_lines_order_workspace_fkey(line_type, price_credits, status, subproduct:market_item_subproducts!market_purchase_lines_subproduct_workspace_fkey(title, is_active, deleted_at), bundle:market_item_bundle_options!market_purchase_lines_bundle_workspace_fkey(label))`, `entitlements:market_entitlements!market_entitlements_order_workspace_fkey(scope, status, subproduct_id, file_id)`, `refunds:market_refund_requests!market_refund_requests_order_id_fkey(status, requested/approved_refund_credits, created_at)`. 다운로드 기록은 order id IN 별도(건수·최근 시각·상세 20건), 권한 범위 파일은 `market_subproduct_files`(is_active, deleted_at).
- **다운로드 진단**: 다운로드 route와 같은 규칙을 순수 함수 `src/lib/market-download-diagnosis.ts`로 — 상품 상태(W1-1b 결과 반영), 파일 활성·미삭제, 권한 active, 대기 중 환불 없음. 다운로드 route도 이 함수를 쓰게 해 규칙이 한 곳에만 있게 함.
- 검색: 이메일, 주문 id, 상품명(market_items 먼저 → item_id IN), 상태, 기간, 과목.
- 테스트: 진단 함수 단위 테스트(숨김·비활성 파일·환불 대기·권한 refunded), 계약 테스트(composite FK 이름, 관리자 검사, service role), `credit_consumptions` 두 키 처리.
- DB 없음. 검증: SELECT 집계(17·17·18) = 화면. 다운로드 route가 진단 함수를 쓰도록 바뀌므로 **배포 뒤 대표 시험 계정으로 다운로드 1회**(다운로드 기록 행 생성·그 주문 환불 불가 → 시험 계정에만). 규모 중. W3-1b 뒤, W1-1b 반영.

### W3-3a 판매 상태 배지 (코드만)
- 현재 `payment_runtime_config` 1행(master=true, payapp=false, kakao=false, env=`test`, merchant 없음). 실제 판매 가능 판정은 `checkout/page.tsx:57-95`(master && payapp && `payapp_merchant_id === PAYAPP userId`).
- 신규: `src/lib/payment-sales-status-server.ts`(config 읽기 + checkout과 같은 조건, 판매자 ID는 일치 여부 boolean만), 서버 컴포넌트 `PaymentSalesStatusBadge`를 `refunds/page.tsx`·`admin/page.tsx` 맨 위에. 카카오는 값대로 "꺼짐". 시각 KST. 조회 실패면 "확인 불가".
- 테스트: 두 페이지에 배지, 판정이 세 값 모두 봄, 실패 시 "확인 불가". DB 없음. 규모 소. W1-3·W1-4 뒤(같은 파일).

### W3-3b 결제 경보·판매 스위치 통지 (DB-5, 추가형, 서울 이전 C-7 뒤)
- 통지는 경보를 넣은 쪽과 관계없이 **행 기준**(health 외에 웹훅의 `PAYAPP_FEEDBACK_UNAUTHORIZED`도 경보를 넣음). health 함수는 바꾸지 않음.

```sql
-- 1) 경보 통지 상태 컬럼
ALTER TABLE payment_reconciliation_alerts
  ADD notify_request_id bigint, ADD notify_requested_at timestamptz,
  ADD notify_attempt_count int NOT NULL DEFAULT 0, ADD notified_at timestamptz,
  ADD notify_last_error text, ADD notify_gave_up_at timestamptz;
UPDATE … SET notified_at = now(), notify_last_error = 'BACKFILL_SKIPPED' WHERE resolved_at IS NOT NULL;
-- 2) 판매 스위치 통지 상태 1행(id boolean PK CHECK(id)):
--    last_master/last_payapp/last_kakaopay, last_notified_at, pending_snapshot jsonb, request_id, requested_at,
--    attempt_count, gave_up_at, last_error, last_run_at, last_run_error
--    적용 시 payment_runtime_config 현재 값으로 채움(지난 변경 미통지). RLS on·정책 없음·service_role SELECT만
-- 3) public.notify_payment_alerts() SECURITY DEFINER, search_path public, extensions, vault, net, pg_temp
--  a. pg_try_advisory_xact_lock 실패 시 종료, last_run_at = now()
--  b. vault 'payment_alert_slack_webhook_url' 없거나 https://hooks.slack.com/services/ 로 시작하지 않으면 last_run_error 후 종료
--  c. 응답 확인: request_id 있고 notified_at 없는 행 → net._http_response 조회. 2xx → notified_at,
--     실패·timeout·error → last_error·request_id 비움, 행 없음 + 요청 후 5분 → 'NO_RESPONSE'
--  d. 전송: 미통지·미포기·요청 없음 행(회차당 최대 10), attempt_count >= 6 → gave_up_at, 백오프 1·2·4·8·16분,
--     net.http_post(body: 코드·심각도·메시지·KST 시각·details 요약 + 현재 판매 상태 3개·env + /admin/refunds 링크, timeout 10s)
--  e. 스위치 감시: 현재 3개 값 ≠ last_*이고 진행 중 요청이 없으면 전송(바뀐 스위치, 이전→현재, changed_by·ticket·at),
--     2xx 확인 뒤 last_* ← pending_snapshot
--  REVOKE ALL FROM PUBLIC, anon, authenticated, service_role
-- 4) cron.schedule('payment-alert-notify-1m', '* * * * *', 'SELECT public.notify_payment_alerts();')
```

- 되돌리기: `cron.unschedule` → 함수 → 상태 테이블 → 컬럼(W3-3c 코드를 먼저 되돌림).
- **슬랙 webhook(대표 직접)**: Slack Incoming Webhooks에서 통지 채널(Q11) URL 발급(문의용과 같은 채널이면 새로 발급 권장) → 새 서울 프로젝트 Integrations → Vault에 이름 `payment_alert_slack_webhook_url`(또는 SQL Editor `select vault.create_secret('<URL>', 'payment_alert_slack_webhook_url', '결제 경보 통지');` 후 스니펫 삭제) → AI는 값 없이 존재·접두만 확인. 교체는 `vault.update_secret`.
- 테스트(새) `payment-alert-notify-contract.test.mjs`: `net._http_response` 확인, 재시도 상한 6, 백필은 해소 경보만, 스위치 초기값을 config에서, EXECUTE 회수, health 미변경, 되돌리기 파일 역순.
- 검증: ① 운영 BEGIN…ROLLBACK 리허설(함수 직접 실행 → 상태 SELECT, pg_net 큐도 롤백되므로 실제 전송 없음) ② 승인 후 적용 → 스위치 전, 승인을 받아 (a) 시험 코드 경보 1행 INSERT → 슬랙 도착 → `resolve_payment_alert`로 메모와 함께 해소(이 메모는 체크리스트 출시 1 점검 대상) (b) **master 스위치만** DB-0 중지 SQL로 false → 슬랙 도착 → DB-0 재개 SQL로 true(카카오·페이앱 스위치는 건드리지 않음 — 카카오를 켜면 고객에게 테스트 결제가 열리고, 페이앱을 켜면 사실상 출시) → 출시 전제 상태(master=true, payapp=false, `payapp_merchant_id` NULL)와 미해소 경보 0건을 SELECT로 확인. 출시 스위치 자체도 "페이앱 꺼짐→켜짐" 통지로 확인됨.
- 규모 중~대. **전문 검증 3명**(대사·경보 / pg_net·cron·vault / 마이그레이션·되돌리기).

### W3-3c 대시보드 '통지 실패' 카드 (코드, DB-5 뒤)
- `payment-sales-status-server.ts`에 `notify_gave_up_at` 있는 미해소 경보 수, 상태 행 `gave_up_at`·`last_run_error`·`last_run_at`(5분 넘게 실행 없음 = "통지 작업 멈춤") 조회 → W1-4 대기 카드 영역에 '통지 실패' 카드.
- 테스트: 새 컬럼·상태 테이블을 읽음. 규모 소. W1-4·DB-5 뒤.

### W3-5a `admin_audit_log` (DB-7, 추가형)
- 본보기 `payment_admin_actions`(actor FK 없음, `prevent_payment_admin_action_mutation`, RLS on·정책 없음, service_role SELECT만). `admin_logs`는 마이그레이션 파일만 있고 DB에 없음.
- 설계: `id uuid PK`, `actor_id uuid NOT NULL`(FK 없음), `actor_email text`(스냅샷), `action text CHECK IN ('credit_grant')`(4b에서 확장), `target_user_id uuid`, `target_type text`, `target_id uuid`, `reason text CHECK(btrim <> '')`, `details jsonb NOT NULL DEFAULT '{}'`, `created_at`. 인덱스 (target_user_id, created_at desc), (actor_id, created_at desc). 수정 금지 트리거(UPDATE/DELETE 행 단위 + TRUNCATE 문장 단위). `record_admin_audit(...)` SECURITY DEFINER, EXECUTE service_role만.
- 테스트: 트리거 3종, 권한 회수, RLS on, 되돌리기. 검증: 리허설에서 INSERT 성공, UPDATE·DELETE·TRUNCATE 실패, anon·authenticated SELECT 불가. 규모 소~중. DB-6보다 먼저 적용, 검증은 DB-6과 한 묶음.

### W3-5b `admin_grant_credits` RPC (DB-6, 추가형)
- 대체 대상: `grantCreditsAsAdmin`(`credits.ts:396-458`, credit_sources → 잔액 동기화 → payment_history 0원 → credit_transactions `purchase` "크레딧 N개 구매", 트랜잭션 밖, 지급자·사유 없음). 호출처는 `api/admin/users/credits/route.ts:50` 하나.
- 시그니처: `admin_grant_credits(p_actor_id uuid, p_user_id uuid, p_amount int, p_source_category text, p_reason text, p_operation_key text) RETURNS jsonb`, SECURITY DEFINER, `search_path public, pg_temp`, `REVOKE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`(`resolve_payment_alert` 방식, `20261020090000_…:107-108`).
- 순서: ① 검증(금액 1~10000, 사유 1~500자, 분류 admin_grant·bonus·system_refund, operation_key 필수) ② `p_actor_id`가 `is_admin`인지 ③ 대상 `profiles FOR UPDATE`(consume_credits와 같은 잠금 순서) ④ 같은 `(user_id, operation_key)` 원장이 있으면 기존 결과 반환(F15) ⑤ credit_sources INSERT(expires_at NULL — 기존 관리자 지급 10건과 같음) ⑥ 잔액 = active+pending_refund·미만료 합계 → `profiles.credits` ⑦ payment_history 0원 completed(기존 동작 유지, Q-6) ⑧ credit_transactions(`purchase`, '관리자 지급', `resource_type 'admin_grant'`, operation_key) ⑨ admin_audit_log ⑩ `{source_id, new_balance, replayed}`.
- 원장 유형은 `'purchase'` 유지 권장(고객 화면은 `source_category`로 이미 "지급", `credit-transaction-display.ts:14-44`; 바꾸면 W1-5 필터와 마이페이지 필터에서 빠짐, Q-5).
- 테스트: 계약(권한 회수, 관리자 확인, 잠금, operation_key 재사용, 감사 INSERT가 함수 안). 검증: 운영 BEGIN…ROLLBACK — 대표 시험 계정 1 지급 → source·tx·history·audit 각 1행과 `get_credit_balance_snapshot` 일치 → 같은 키 재호출 시 증가 없음 → 비관리자·0원·빈 사유 실패 → ROLLBACK, 동시 호출 직렬화. 규모 중. **전문 검증 3명**(지급·멱등 / 감사·권한 / 마이그레이션·되돌리기). DB-7 뒤.

### W3-5c 코드 전환 (DB-6 뒤)
- `grantCreditsAsAdmin` 본문을 RPC 호출로(actorId·reason·operationKey 추가, paymentMethod 제거). route는 `user.id`·사유·`operationKey`(zod uuid). `grant-credit-dialog.tsx:94-112`는 열릴 때 `crypto.randomUUID()`. 사유가 고객 알림에 보인다는 안내(Q-7).
- 테스트 수정: `credit-source-category.test.mjs:32-36,53`, `credit-balance-source-of-truth.test.mjs:58` → "RPC `admin_grant_credits` 호출, operation_key 전달".
- 검증: 배포 후 대표 승인 받아 시험 계정에 1크레딧 실지급 → 감사 SELECT(회수 수단 5-2 전이라 시험분은 남음). 규모 소. W1-5 뒤.

### W3-7a 고객 비밀번호 재설정 (코드)
- 현재: 로그인 화면에 링크 없음, `resetPasswordForEmail`·`verifyOtp` 없음, `/auth/callback`은 PKCE(`auth/callback/route.ts:86-88`), 마이페이지 변경은 기존 비밀번호 확인 먼저(`profile-view.tsx:118-150`, 최소 6자 `:165`). 미들웨어는 새 경로를 보호하지 않음.
- 화면: ① 로그인 화면 "비밀번호를 잊으셨나요?" → `/forgot-password` ② `(auth)/forgot-password/page.tsx`: 이메일 → 서버 액션 `requestPasswordReset` — 관리자 도메인(`isAdminAccountEmail`)은 미발송, 카카오 가입자 처리(Q-8), `resetPasswordForEmail(email)`, **보냈든 안 보냈든 같은 안내 문구** ③ `(auth)/reset-password/page.tsx`: URL `token_hash`·`type=recovery` → 새 비밀번호·확인 → **제출할 때** `verifyOtp({ token_hash, type: 'recovery' })` → `updateUser({ password })` → `signOut({ scope: 'others' })` → 홈. 만료·사용됨이면 다시 요청 링크.
- token_hash 이유: PKCE verifier 불필요(다른 기기 OK), 제출 시 검증이라 메일 스캐너 미리 열기에 토큰이 소모되지 않음.
- **W3-7b 메일 템플릿**(대표, Supabase 대시보드): Recovery 링크 `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`.
- 테스트(새) `password-reset-contract.test.mjs`: 로그인 화면 링크, `resetPasswordForEmail`·관리자 도메인 차단·응답 문구 하나, 재설정 화면이 `verifyOtp` + `type: 'recovery'` + `updateUser({ password` 사용·`signInWithPassword` 미사용, 두 화면이 `(auth)` 그룹.
- DB 없음. **전제: SMTP(Resend, 서울 이전 A-4) + W3-7b**. 배포는 W0-8(SMTP) 뒤, **W3-7b 템플릿을 먼저 바꾸고 바로 코드 배포**(반대면 옛 링크 메일이 나감).
- 검증: 운영에서 대표 시험 계정(팀원이 아닌 외부 주소)으로만 — 수신 → 새 비밀번호 로그인, PC 요청 → 휴대폰 열기, 링크 재사용 실패, 관리자 도메인 미발송. 규모 중.

### W3-8a 마켓 헤더 알림 벨
- 현재: `NotificationBell`은 옛 헤더(`header-client.tsx:396`)에만. 60초 폴링(`/api/notifications`), 열면 모두 읽음 PATCH(F13). 알림 링크(`/mypage/support`·`/mypage/credits`·`/mypage/payments`)는 모두 `(solvook)`에 있음.
- 변경: `preview-header.tsx` 로그인 상태에만 — 데스크톱은 크레딧 링크 앞(`:351-366` 부근), 모바일 상단은 장바구니 옆(`:200-213`). 벨 버튼 `aria-label="알림"`. 스타일 통일은 6단계.
- 테스트: `auth-chrome-contract`, `market-home-ui-contract`, `solvook-preview-original-visual-contract`, `studio-adoption-contract` 실행·기준선 비교. 새 단언: `isLoggedIn`일 때만 렌더.
- DB 없음. 검증: 렌더는 로컬, **벨 열기는 운영에서 대표 시험 계정으로만**. 규모 소.

### W3-8b (결정 Q-9) 마켓 환불 처리 알림
- `api/admin/market/refunds/[id]/route.ts`에서 승인·거절 성공 뒤 `notifications` INSERT(충전 환불 `notifyRefundCompleted` 방식, 링크는 마이페이지). **알림 INSERT가 실패해도 환불 응답은 성공으로**(기록만). 규모 소, DB 없음.
- 테스트: 계약(성공 뒤 INSERT, 실패를 삼킴). 검증: 지금 대기 중인 실제 고객 마켓 환불 1건을 시험 삼아 처리하지 않음 — 배포 뒤 **첫 실제 처리**에서 `notifications` 행 생성을 SELECT로 확인.

## 5. 2단계 — 메뉴 정리

### 5-0. 조사로 새로 확인한 사실

| # | 사실 | 영향 |
|---|---|---|
| F1 | 운영 `workspace_settings.admin_sidebar_navigation`은 국어 1행(31개, labels 2)·영어 1행(18개), `system_settings`에는 키 없음 | DB-4a 전제 맞음, DB-4b 대상 2행 |
| F2 | 관리자 기본 과목은 국어(`admin-workspace.ts:6`, 48c5103) | 영어 데이터만 있는 레거시는 `subject: english` 필수 |
| F3 | 페이지 `fallback` 이름이 사이드바 이름과 다른 곳이 많음(`page.tsx:9` "관리자 대시보드", `problem-types/page.tsx:57`, `refunds-client.tsx:253`) | 2-2 적용 시 페이지 제목이 등록부 이름으로 바뀜(의도) |
| F4 | `market-main-settings-client.tsx:74-79` 링크 목록이 `AdminMenuName href={href} fallback={label}`(187) 사용 | 2-5 링크 수정을 2-2보다 먼저(같이) 배포 |
| F5 | 상품 일괄 삭제는 화면이 단건 `DELETE /api/admin/market/items/[id]`를 반복 호출(`market-products-client.tsx:1440대`) | 대표 검사·삭제 규칙은 핸들러 1개 |
| F6 | `market_item_sample_pages.created_by`가 `auth.users`를 NO ACTION으로 참조, 관리자 참조 648행. 코드 주석(`admin-accounts-server.ts:211-212`)은 반대 | 샘플 페이지를 만든 관리자 삭제 시 부분 실패가 실제로 남(R6 확정) |
| F7 | `profiles`에 `admin_role` 없음, 무관한 `role` 컬럼 있음. authenticated·anon에 UPDATE 권한 없음, 관리자 4명 | 사용자가 스스로 역할을 올릴 수 없음, `role`과 혼동 주의 |
| F8 | 관리자 쓰기 정책(`is_admin`) 테이블 정확히 43개. `market_category_items`·`market_item_reviews`·`market_review_tags`·`market_images`에는 관리자 쓰기 정책 없음(service role만) | 4-4 분류표(아래) |
| F9 | `question-bank-is-admin-prerequisite-contract.test.mjs:75`가 마이그레이션의 `is_admin` 정책이 `to authenticated`인지 검사 | DB-9a·DB-10 새 정책도 `to authenticated` |
| F10 | 홈 진열·메인 광고·푸터 쓰기는 service role 우선(`workspace-settings.ts:33-35`, `main-ad-carousel-server.ts:34-42`, `footer-content-server.ts:46`) | DB-10에서 두 설정 테이블을 `is_owner()`로 바꿔도 CS 홈 화면 편집 유지 |

### W2-1. 페이지 등록부 (코드 규칙)

- 현재: `admin-sidebar.ts:58-73`(그룹 href 상수, 하드코딩), `:76-84`(그룹), `:104-138`(기본 순서 31개), `:158-192`(`getDefaultAdminSidebarMenuItems`).
- 변경: `ADMIN_PAGE_REGISTRY` 하나로 — 필드 `href, name, icon, scope('common'|'subject'), exact?, parentHref?, tabLabel?, requiredRole?('owner'), legacyNote?`. `parentHref`가 있는 페이지(탭·`/new`)는 사이드바 항목이 아니라 부모 강조 범위에 들어감. `requiredRole`은 W4-3 전까지 읽지 않음.

| href | 기본 이름 | scope | 강조 | 역할 |
|---|---|---|---|---|
| `/admin` | 대시보드 | common | exact | — |
| `/admin/support` | 문의 | common | 접두 | — |
| `/admin/refunds` | 환불·결제 확인 | common | 접두 | — |
| `/admin/orders`(W3-1에서 추가) | 주문 조회 | common | 접두 | — |
| `/admin/users` | 회원 | common | 접두 | — |
| `/admin/credits` | 크레딧 | common | 접두 | — |
| `/admin/market/products` | 상품 | subject | 접두(`/new` 포함, exact 제거) | — |
| `/admin/market/products/new` | 상품 등록 | subject | parent=products | — |
| `/admin/market-categories` | 카테고리 | subject | 접두 | — |
| `/admin/main-ad-settings` | 홈 화면(tab "광고 배너") | subject | 자신+market-main-settings | — |
| `/admin/market-main-settings` | 홈 화면 진열 설정(tab "진열 설정") | subject | parent=main-ad | — |
| `/admin/reviews` | 후기(tab "후기") | subject | 자신+review-tags | — |
| `/admin/review-tags` | 후기 태그(tab "태그") | subject | parent=reviews | — |
| `/admin/market/images` | 이미지 보관함 | common | 접두 | — |
| `/admin/pricing` | 충전 상품 | common | 접두 | owner |
| `/admin/footer` | 사이트 정보·약관 | common | 접두 | owner |
| `/admin/admin-accounts` | 관리자 계정 | common | 접두 | owner |
| `/admin/legacy`(신설) | 레거시 | common | 접두 | owner |
| 레거시 16개(`/admin/menu-management`, `/admin/landing-pages`, `/admin/generate/products`, `/admin/problem-types`, `/admin/ai-connections`, `/admin/ai-question-generation-runs`(legacyNote: 열면 만료 로그 삭제), `/admin/questions`, `/admin/questions/upload`, `/admin/question-bank/options`, `/admin/question-bank/problem-types`, `/admin/question-bank/backfill`, `/admin/passages`, `/admin/source-configs`, `/admin/labels`, `/admin/roles`, `/dashboard/admin/passages`(목록 전용)) | 지금 이름 그대로(레거시 계약 테스트 무수정) | 지금 scope | 접두(questions는 exact) | owner |

- 레거시 배열(`legacy`) 항목은 scope 규칙을 적용하지 않음(과목 없는 레거시 행 `/admin/passages` 등이 "scope 불일치"로 조용히 빠지지 않게). scope 규칙은 `common`·`subjectItems`에만.
- 테스트(새) `tests/admin-page-registry-contract.test.mjs`: `AdminMenuName`·`buildAdminMenuMetadata`를 쓰는 href(grep 수집, W3-1b 뒤 32개)가 모두 등록부에 있음, `parentHref`가 등록 href를 가리킴, `ADMIN_QUESTION_BANK_MENU_HREFS`·`ADMIN_MARKET_MENU_HREFS` 없음.
- 규모 소(1파일). 단독 배포 금지(W2-2와 같이).

### W2-2. 새 저장 구조 읽기·정규화, 이름 해석, 메뉴관리 카드 제거

**W2-2a 정규화·서버 읽기**
- 현재: `normalizeAdminSidebarNavigationConfig`(`admin-sidebar.ts:194-228`)는 `{items, labels}`만, `getAdminSidebarNavigationConfig(subject)`(`admin-sidebar-server.ts:11-20`)는 과목별 `workspace_settings`, `admin-sidebar.tsx:7-8`은 두 과목을 모두 읽음.
- 변경: 순수 함수 `normalizeAdminSidebarNavigation(input)`:
  1. 입력이 없거나 객체가 아니면 등록부 기본값(이름 없는 공통 묶음 1개, subject 페이지는 `subjectItems`, 레거시 비움, `subjectOrder` `["korean","english"]`).
  2. 미등록 href 버림, 중복은 첫 것만(레거시는 href+subject 쌍), `parentHref` 페이지는 버림.
  3. scope 불일치 버림(`common`·`subjectItems`에만 적용, `legacy` 항목은 예외 — W2-1).
  4. 데이터 어디에도(`common`·`subjectItems`·`legacy`·`hidden`) 없는 사이드바용 등록 페이지는 자동 배치(common → 마지막 '미분류' 묶음, subject → `subjectItems` 끝).
  5. `subjectOrder`는 유효 과목만·중복 제거, 빈 배열 허용.
  6. `labels` 키는 등록 href·데이터 묶음 id만, 30자 제한 유지.
- `getAdminSidebarNavigation()`: service role로 `system_settings` 키를 읽어 정규화, `react` `cache()`로 감쌈. **옛 `workspace_settings` 경로는 만들지 않음**. 읽기 순서: 새 행 → 없으면 등록부 기본 순서.

**W2-2b 이름 해석**
- 현재: `buildAdminMenuMetadata`(`admin-sidebar-server.ts:66-82`)·`AdminMenuName`(`admin-menu-labels.tsx:46-52`)가 과목별 labels → fallback. Provider는 `labelsBySubject`.
- 변경: `labels[href]` → 등록부 `name` → `fallback`. Provider 값 `{labels, legacyHrefs, visibleSubjects, role(W4-3), rememberSavedLabel(key,label)}`. `buildAdminMenuMetadata`의 `searchParams` 인자는 남김(페이지 11개 무수정). 페이지 31개(W3-1b 뒤 32개) 무수정.

**W2-2c 메뉴관리의 '관리자 메뉴 순서' 카드 제거**
- 현재: `menu-management-client.tsx` 64-73(import), 87, 215-216·231·265-269·274-275(state), 366-394(이동), 573-590(저장), 809-897(카드). `actions.ts` 70, 129, 156-169(`saveAdminSidebarNavigationConfigAction`).
- 변경: 위 부분과 `MenuManagementPageData.adminSidebarConfig` 삭제. 이 변경으로 고아가 되는 `saveAdminSidebarNavigationConfig`, `moveAdminSidebarHref`, `moveAdminSidebarNavigationNode`, 노드 타입, `resolveAdminSidebarMenuItems/Nodes` 삭제. listboard 액션 export(`generate-products-client.tsx:43-47`, `generate-product-edit-client.tsx:28-32`가 import)는 유지. `actions.ts:5-6` 기존 죽은 import는 손대지 않음.

- 테스트 수정: `admin-sidebar-navigation.test.mjs`(6-15 import, 30-64 재작성, 66-113 삭제, 115-193 재작성, 195-261 삭제, 263-267, 269-274(W2-3), 276-286 "카드 없음", 288-297 `/new`=자식·접두 강조), `admin-sidebar-menu-rename.test.mjs`(22-41, 43-55 '홈 화면', 57-63 삭제, 81·98), `market-images-ui-contract.test.mjs:24-32`.
- 테스트(새): 새 행 없으면 등록부 기본 순서, 미배치 등록 페이지 자동 배치, scope 불일치 버림, 이름 해석 순서, 서버가 `workspace_settings`를 읽지 않음.
- 배포 직전: `select key from system_settings where key='admin_sidebar_navigation'`로 DB-4a 행 확인.
- **W2-2와 W2-3은 한 단위(W2-2/3)로 구현·커밋**: W2-2가 지우는 `resolveAdminSidebarNavigationNodes`와 Provider `labelsBySubject`를 `admin-sidebar-client.tsx:15,54`가 쓰므로 따로 커밋하면 `tsc`가 실패.
- 규모 중~대(코드 약 8파일, 테스트 3파일). 위험: 이름 변경 범위(F3), 링크 라벨(F4).

**DB-4a 행**(Q1·Q3·Q6·Q10 반영, 마이그레이션 `insert … on conflict (key) do nothing` + 되돌리기 `delete where key=…`)

```json
{
  "common": [
    { "id": "top", "name": null, "items": ["/admin"] },
    { "id": "customer", "name": "고객 응대", "items": ["/admin/support", "/admin/refunds", "/admin/orders", "/admin/users", "/admin/credits"] },
    { "id": "market", "name": "문제마켓", "subjects": true },
    { "id": "library", "name": null, "items": ["/admin/market/images"] },
    { "id": "settings", "name": "설정", "items": ["/admin/pricing", "/admin/footer", "/admin/admin-accounts"] },
    { "id": "legacy-entry", "name": null, "items": ["/admin/legacy"] }
  ],
  "subjectOrder": ["korean"],
  "subjectItems": ["/admin/market/products", "/admin/market-categories", "/admin/main-ad-settings", "/admin/reviews"],
  "legacy": [
    { "href": "/admin/menu-management", "subject": "korean" },
    { "href": "/admin/menu-management", "subject": "english" },
    { "href": "/admin/landing-pages" },
    { "href": "/admin/generate/products", "subject": "english" },
    { "href": "/admin/problem-types", "subject": "english" },
    { "href": "/admin/ai-connections" },
    { "href": "/admin/ai-question-generation-runs", "subject": "english" },
    { "href": "/admin/questions", "subject": "english" },
    { "href": "/admin/questions/upload", "subject": "english" },
    { "href": "/admin/question-bank/options", "subject": "english" },
    { "href": "/admin/question-bank/problem-types", "subject": "english" },
    { "href": "/admin/question-bank/backfill", "subject": "english" },
    { "href": "/admin/passages" },
    { "href": "/admin/source-configs", "subject": "english" },
    { "href": "/admin/labels" },
    { "href": "/admin/roles" },
    { "href": "/dashboard/admin/passages" }
  ],
  "hidden": [],
  "labels": {}
}
```

- `"subjects": true` 묶음이 과목 묶음 위치. `subjectOrder`의 과목마다 "문제마켓 · 국어"로 그림. 영어 재개는 `subjectOrder`에 `"english"`를 추가하는 마이그레이션 1개(Q3).
- 테스트(새) `admin-sidebar-db4a-contract.test.mjs`: SQL의 JSON을 정규화했을 때 '미분류' 0건, 레거시 목록·`subject`가 위와 같음, `/admin/menu-management` 2번, 모든 href가 등록부에 있음(**`/admin/orders` 때문에 W3-1이 먼저**).

### W2-3. 과목 묶음 펼침, 과목 무관 화면의 과목 표시 제거
- 현재: `admin-sidebar-client.tsx` 51-58(현재 과목 노드만), 174(모든 링크에 과목), 156-161(`isActive` 경로만), 232-237(스위처·"현재 관리 대상").
- 변경: common 항목은 과목 없이 링크, 과목 묶음 항목은 `withAdminWorkspaceSubject(href, 묶음 과목)`. 강조 = 경로가 강조 범위 안(`p === h || p.startsWith(h + '/')`) + 과목 항목이면 현재 과목도 같음. 232-237 삭제.
- W2-3b: 홈 화면 두 페이지 안의 `AdminWorkspaceSwitcher`(`main-ad-settings-client.tsx:385`, `market-main-settings-client.tsx:90`)가 Provider `visibleSubjects`만 보여 주고 과목이 1개면 숨음(결정 Q-10). `SUBJECTS` 상수는 그대로라 `admin-workspace-default-korean-contract` 통과.
- 테스트(새): 과목 무관 화면 링크에 `subject` 없음, 과목 메뉴 순서 두 과목 동일. 수정: `admin-sidebar-navigation.test.mjs:269-274`.
- 규모 중(1~2파일).

### W2-4. `/admin/legacy` 목록과 레거시 경고 띠
- `admin/legacy/page.tsx`(신규, 서버): `getAdminSidebarNavigation().legacy`를 읽어 등록부 이름(같은 href 2번이면 " · 국어/영어"), 과목, 링크(`subject` 있으면 과목 붙임), `legacyNote` 경고(AI 생성 로그는 **들어가기 전에** 경고 — 띠는 서버 렌더 뒤라 R3를 못 막음).
- `components/layout/admin-legacy-banner.tsx`(신규, 클라이언트): `layout.tsx:21`의 `{children}` 위. Provider `legacyHrefs`와 `usePathname()` 경계 접두 비교(`/admin/legacy` 제외). 하위 경로 포함. `/dashboard/admin/passages`는 레이아웃 밖이라 목록에만.
- 테스트(새): 레거시 href는 기본 구성 밖·레거시 목록 안, 띠가 legacy 데이터에서 읽음(href 상수 없음), `layout.tsx`가 띠를 그림. `admin-sidebar-menu-rename.test.mjs:78`의 layout 정규식 확인.
- 검증 시 `/admin/ai-question-generation-runs`·`[runId]`는 열지 않음(0절). 레거시 목록·띠는 다른 레거시 화면으로 확인.
- 규모 중(신규 2, 수정 1).

### W2-5. 탭 링크와 B14 링크 수정
- 변경: 공용 `AdminTabLinks`(소비처 2곳, 탭 이름은 등록부 `tabLabel`, `?subject` 유지) → `main-ad-settings-client.tsx:379` 근처, `market-main-settings-client.tsx:85` 근처, `reviews/page.tsx:27`, `review-tags/page.tsx:27`. 링크 목록(`market-main-settings-client.tsx:74-79`): `/admin/menu-management` → `/admin/market-categories`, `/admin/source-configs` 삭제.
- 테스트: `market-home-admin-route-contract.test.mjs:62-63`(market-categories 있음, source-configs 없음). 56줄은 유지.
- 규모 소. **B14 링크 부분은 DB 무관 → 지금 가능**(F4 때문에 W2-2보다 먼저).

### W2-6. 사이트 로고 섹션 이동
- 현재 `menu-management-client.tsx:19,899`. 변경: `footer/site-logo-settings.tsx`로 옮겨 `footer/page.tsx`의 `<FooterSettingsClient/>` 아래에 그림, 메뉴관리에서 제거.
- 테스트(새) 1개(푸터 페이지가 그림, 메뉴관리는 안 그림). 규모 소. **지금 가능.**

### W2-7. 메뉴 이름 바꾸기: 공통 1벌, 대표 전용
- 현재: `renameAdminSidebarMenuAction(key,label,subject)`(`actions.ts:171-192`), `saveAdminSidebarMenuLabel`(`admin-sidebar-server.ts:48-63`, 과목별 upsert), 클라이언트 `admin-sidebar-client.tsx:76,81`.
- 변경: export 이름 유지, 과목 인자 제거. service role로 **원본 JSON을 읽어 `labels`만 바꿔 `value` update**(정규화 결과를 통째로 쓰면 등록부에 없는 href가 지워짐). 행이 없으면 만들지 않고 오류(행은 마이그레이션으로만). 권한은 W4-2 전 `requireAdmin`, 뒤 `requireAdminRole('owner')`. `revalidatePath('/admin','layout')` 유지.
- 테스트: `admin-sidebar-menu-rename.test.mjs:57-73` 수정. 새: 저장이 `labels`만 바꿈, `workspace_settings`를 쓰지 않음. 규모 소.

**DB-4b**: 2단계 배포 확인 후 `delete from workspace_settings where setting_key='admin_sidebar_navigation'`(2행) + 되돌리기(원본 2행 INSERT).

## 6. 4a단계 — 대표/CS 역할 분리 (CS 계정 발급 전 필수)

### W4-1. `admin_role`, `is_owner()`, CS 한도 (DB-9a → 코드 → DB-9b)
- **DB-9a**(추가형, DB 먼저, 전문 검증 3명): `profiles.admin_role text check (admin_role in ('owner','cs'))`, `update … set admin_role='owner' where is_admin is true`(4행), `is_owner()`(`is_admin()`과 같은 형식, 조건 **`is_admin is true and admin_role = 'owner'`** — 옛 코드로 해제된 계정이 대표로 남지 않게). CS 한도 행 `system_settings` 키 `admin_cs_limits`(`{"creditGrantMaxPerAction":N,"creditGrantMaxPerDay":M,"marketRefundMaxCredits":K}`, 숫자는 대표 결정 — 결정 Q-11). 새 정책은 `to authenticated`(F9).
- **코드**: `admin-accounts-server.ts:99` 생성 시 `{is_admin:true, admin_role}`(기본 `'cs'`, 화면에서 선택), `listAdminAccounts`(`:32-35`)가 `admin_role` 반환, 역할 변경 API(대표 전용, 마지막 대표 강등·해제 금지).
- **DB-9b**(제약형, 코드 먼저): 적용 전 `coalesce(is_admin,false) <> (admin_role is not null)` 0건 확인 → `check (coalesce(is_admin,false) = (admin_role is not null))`. `is_admin`을 쓰는 곳은 생성 코드뿐(grep).
- 테스트(새): 마이그레이션 계약(CHECK, 백필, `is_owner`의 `is_admin is true`, `to authenticated`, 한도 행, 되돌리기), `createAdminAccount`가 `admin_role`을 씀.
- 위험: `admin_role`을 읽는 코드가 DB-9a보다 먼저 배포되면 대표 검사 전부 실패 → 순서 엄수.

### W4-2. 공용 역할 검사와 대표 전용 핸들러
- `src/lib/auth.ts` 추가: `getAdminRole()`(`is_admin`이 아니면 null, `is_admin`인데 role 없으면 `'cs'` — 최소 권한), `requireAdminRole('owner')`(페이지·서버 액션, redirect), `requireAdminRoleApi('owner')`(API, `{user, role}` 또는 401/403 JSON). 지역 복사본 약 50곳은 정리하지 않음.

| 대표 전용 | 파일 / 핸들러 |
|---|---|
| 관리자 계정 | `api/admin/admin-accounts/route.ts` GET·POST, `[userId]/route.ts` PATCH·DELETE(+W4-6 해제·역할 변경) |
| 요금제 | `admin/pricing/actions.ts` `upsertPricingPlan`·`deletePricingPlan`·`togglePlanStatus` |
| 약관·사이트 정보·로고 | `admin/footer/actions.ts` `saveSiteFooterContentAction`, `api/admin/site-logo/route.ts` POST |
| 메뉴 이름 저장 | `menu-management/actions.ts` `renameAdminSidebarMenuAction` |
| 충전 환불 실행 | `api/admin/refunds/route.ts` PATCH |
| 결제 수동확인·경보 해소 | `api/admin/payments/review/route.ts` PATCH, `api/admin/payments/alerts/route.ts` PATCH |
| 상품 삭제(일괄 포함, F5) | `api/admin/market/items/[id]/route.ts` DELETE(CS는 숨김 PATCH로) |
| 크레딧 차감 | 5-2가 만들어질 때 처음부터 대표 전용 |

| CS 한도 분기 | 내용 |
|---|---|
| `api/admin/users/credits/route.ts` POST | CS면 `amount ≤ creditGrantMaxPerAction`, 하루 누적은 `admin_audit_log` 합계로(W3-5 선행) |
| `api/admin/market/refunds/[id]/route.ts` PATCH approve | CS면 환불 크레딧 ≤ `marketRefundMaxCredits`(컬럼은 구현 때 DB 확인), 거부는 허용 |

- 상품·카테고리·홈 화면·후기 편집에는 검사 없음(Q14 (나)).
- 테스트(새) `admin-role-contract.test.mjs`: 위 핸들러마다 대표 검사, 한도 분기가 `admin_cs_limits`를 읽음, 상품 PATCH에는 대표 검사 없음.
- 위험: 서버 액션의 redirect — `rename`은 `{success:false}`로 감쌈. 규모 중(약 11파일).

### W4-3. 사이드바 역할 표시
- `AdminSidebar`(서버)가 `getAdminRole()`을 Provider·클라이언트에 넘김. `requiredRole:'owner'` 항목은 CS에게 빼고 빈 묶음 숨김. 연필 버튼은 `role==='owner'`일 때만(`admin-sidebar-client.tsx:194,261`). 머리에 "대표"/"CS" 표시. `/admin/legacy`는 `requireAdminRole('owner')`(레거시 화면 자체는 DB-10이 막음).
- 선택(결정 Q-13): 환불 화면의 충전 환불·수동확인 버튼, 상품 삭제 버튼을 CS에게 숨김(서버 403은 그대로).
- 테스트: 등록부 owner 집합 = W4-2 대상 화면, 연필 버튼 role 조건. 규모 소.

### W4-4. RLS 강화 (DB-10: 코드 먼저, 전문 검증 3명)
새 정책은 모두 `to authenticated`.

| 분류 | 테이블 | 변경 |
|---|---|---|
| 돈 (8) | credit_sources, payment_history, market_entitlements, market_purchase_orders, market_purchase_lines, market_purchases, refund_requests, market_refund_requests | 관리자 `ALL` → `SELECT`(`is_admin()`) |
| 설정 (3) | pricing_plans(ALL), system_settings(UPDATE), workspace_settings(INSERT·UPDATE·DELETE) | `is_owner()`(F10) |
| 상품 (8) | market_items, market_item_bundle_options, market_item_files, market_item_sample_pages, market_item_subproducts, market_subproduct_categories, market_subproduct_files, market_file_types | Q14 (나) → `is_admin()` 유지 |
| 레거시 (21 + source_configs) | ai_models, ai_provider_connections, ai_question_generation_runs, display_labels, generate_listboard_generation_job_events, generate_listboard_generation_job_items, generate_listboard_generation_jobs, generate_listboard_post_items, generate_listboard_posts, generate_menu_entries, market_menu_entries, problem_type_default_prompts, problem_type_test_runs, problem_types, providers, question_bank_books, question_bank_problem_types, question_bank_question_metadata, question_bank_years, system_prompts, user_roles, (DB-1 이후) source_configs | `is_owner()` |
| 유지 (3) | notifications(INSERT), support_tickets(UPDATE), support_ticket_categories(INSERT·UPDATE) | 변경 없음 |

- 적용 전: 세션 클라이언트 쓰기 경로 전수 재확인(알려진 것: `pricing/actions.ts` → 대표 전용, 레거시 `source-configs` → 대표).
- 리허설: `set local role authenticated` + `request.jwt.claims`로 CS를 흉내 내 돈·설정·레거시 쓰기 거부 확인.
- 테스트: 마이그레이션 계약(분류별 정책, `to authenticated`, 되돌리기), F9 기준선 유지.

### W4-6. 관리자 "권한 해제", 삭제는 대표만, R6 수정
- **W4-6a(코드만, 지금 가능)**: `deleteAdminAccount`(`admin-accounts-server.ts:191-212`)에 `market_item_sample_pages.created_by` null 처리 추가·211-212 주석 수정(F6), 비울 대상을 먼저 모두 확인한 뒤 바꾸는 순서로(부분 실패 방지). `revokeAdminAccount`(`is_admin=false`)와 PATCH `{action:'revoke'}` 추가, 화면 기본 버튼을 '권한 해제'로, 삭제는 보조 버튼·강한 확인 문구. 검사가 요청마다 DB를 보므로 해제 즉시 앱·RLS 모두 차단.
- W4-6a 검증: 계약 테스트 + 코드 확인. 운영 확인이 필요하면 승인을 받아 시험 관리자 계정을 만들어 해제 → SELECT(`is_admin=false`) 후 정리(샘플 페이지를 만든 관리자 삭제 경로는 운영에서 시험하지 않음).
- **W4-6b(DB-9a 후)**: 해제 시 `admin_role=null`도, 마지막 대표 해제·삭제·강등 금지, 본인 해제 금지, 해제·삭제는 대표 전용. 다시 권한 주는 화면은 만들지 않음(새 ID 발급, 결정 Q-12).
- 테스트(새): sample_pages 정리, 해제가 `is_admin=false`(+`admin_role=null`), 마지막 대표 보호, 해제 버튼 기본.

### W4-7. 시험 CS 계정으로 4a 완료 확인 (DB-10 뒤, 실제 CS 발급 전)
- 대표 승인을 받아 시험 CS 계정 생성(관리자 계정 화면, `admin_role='cs'`) → 운영에서 W4-2 대표 전용 작업마다 403 확인, CS 허용 작업(문의 답변 — **시험 회원이 만든 시험 문의에만**, 상품 편집 — 시험 상품에만 후 원복, 한도 이하 지급 — 시험 회원에게 1크레딧) 동작 확인, CS JWT로 돈·설정·레거시 테이블 직접 쓰기 거부 확인(리허설과 같은 SQL) → W4-6 권한 해제로 회수 → SELECT로 `is_admin=false`·`admin_role` null. 준비 계획 11절 4a 완료 기준.

## 6-1. 출시 직후 확인 (체크리스트 출시 1~5에 추가)

| 확인 | 단위 |
|---|---|
| 대표 실결제 주문을 `/admin/orders`에서 `mul_no`로 검색 | W3-1b(F14 — 실데이터 첫 확인) |
| 결제 결과 화면에서 헤더 잔액이 바로 갱신 | W1-6 |
| 페이앱 꺼짐→켜짐 슬랙 통지 도착 | W3-3b |
| 지급·결제 알림이 마켓 벨에 표시 | W3-8a |
| 판매 상태 배지가 "판매 중" | W3-3a |

## 7. 결정 질문

준비 계획 10-1에서 정해진 것 외에, 구현을 위해 새로 정할 것. 권장안대로라면 "권장대로"로 답하면 됨.

| Q | 질문 | 권장 |
|---|---|---|
| Q-1 | 숨김 상품의 구매자 다운로드(F11) | **유지**(W1-1b): 숨김 = 신규 노출·구매 중지, 이미 산 사람은 계속 받음. 이것 없이는 "이력 있으면 숨김"이 구매자 접근을 끊음. 다운로드까지 막아야 하는 경우(저작권·하자)는 파일 비활성화로(런북) |
| Q-2 | 상품 일괄 삭제 방식 | 화면이 단건 DELETE를 반복하고 결과를 합침(서버 일괄 route 없음) |
| Q-3 | 영어 테스트 광고·상품 비공개 방법 | **지금** 대표가 관리 화면에서 직접(W1-7b, 데이터 변경은 동결 중에도 허용) |
| Q-4 | 약관 화면의 결제수단 문장(코드 고정) | 이번에는 문구만 고침, `payment_methods`에서 읽게 바꾸는 일은 기록만 |
| Q-5 | 관리자 지급 원장 유형 | `'purchase'` 유지(고객 화면은 이미 "지급"으로 표시, 바꾸면 필터에서 빠짐) |
| Q-6 | 관리자 지급 시 `payment_history` 0원 행 | 유지(기존과 같게, 매출 집계는 `payment_orders` 기준이라 영향 없음) |
| Q-7 | 지급 사유가 고객 알림에 그대로 보임 | 지급 화면에 "사유는 고객 알림에 표시됩니다" 안내 추가 |
| Q-8 | 카카오 가입자가 비밀번호 재설정을 요청할 때 | 같은 안내 문구로 응답하되 메일은 보내지 않음(이메일 비밀번호 로그인이 새로 생기지 않게) |
| Q-9 | 마켓 환불 승인·거절 알림(W3-8b, F12) | 진행 |
| Q-10 | 홈 화면 안 과목 전환 버튼도 사이드바 과목 설정을 따름(W2-3b) | 따름 |
| Q-11 | CS 한도 숫자 3개(1회 지급, 하루 지급, 마켓 환불)와 저장 위치 | 숫자는 대표 결정, 로그인 사용자에게 보여도 되면 `system_settings`, 안 되면 대표 전용 테이블 |
| Q-12 | 권한 해제된 관리자에게 다시 권한 주는 화면 | 만들지 않음(새 ID 발급) |
| Q-13 | 대표 전용 버튼(충전 환불·수동확인·상품 삭제)을 CS 화면에서 숨김 | 숨김(서버 403은 그대로) |

## 8. 검증 기록

| 회차 | 대상 | 검증 | 결과 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 1 구현 실현성·코드 정확성 | **FAIL** | 1 W1-7a `library/page.tsx` 기본 english 누락 2 W1-2 `useState(initialUsers)`로 지급 뒤 잔액 미갱신 3 W1-9a는 DB-13 파일이 먼저 4 W2-2만 커밋하면 tsc 실패 → W2-2/3 한 단위 5 W1-4 문의 대기 기준값 0·`is_deleted_by_user`. 권고 반영: W1-1 테스트 목록·`window.confirm`, W1-1b 옵션 없이 조건 변경(구매자 경로 전수 확인), W1-3a 금액 근거·부분취소, W1-5 prop·1000행, W3-1b 컬럼 명시, W2-1 레거시 scope·32개 |
| R1 | 초안 | 2 운영·순서·위험 | **FAIL** | 1 main 병합 = 배포 → `admin/after-db` 브랜치 규칙 2 동결 C-0~C-9·revert 되돌리기·서울 계획 문구 정합 3 W0-8·W0-9 단위, W3-8b·W2-5 탭 순서, W1-10 스위치 조건 제외 4 W3-3b 시험은 master만·출시 전제 확인 5 W1-1 시험 상품은 시험 계정 구매분·원복 6 AI 생성 로그 두 경로 열지 않음 7 W1-7a 오류 시 기본값·배포 직후 회귀 확인 8 W3-2 다운로드 실제 확인 9 W4-7 시험 CS 계정 검증. 권고 반영: W0-6 분리·jobname, 6-1 출시 직후 확인, W3-7b 먼저, W1-7b 지금, 서울 리허설 중 로컬 검증 중지, Q-1 파일 비활성화 경로, W1-4 항목별 실패, DB-2 뒤 23503 처리, 배포 묶음 |
| R2 | 개정 1 | 1 구현 실현성·코드 정확성 | **FAIL** | R1 5건 반영 확인. 1 브랜치 하나에 병합 조건 5가지 → 조건별 브랜치·rebase 2 W1-1에 23503 처리·테스트 ⑥ 없음. 권고 반영: W1-7a 캐시 안 throw·밖 기본값, W2-2a 규칙 3 레거시 예외·32개, W1-3a 근거 정합 |
| R2 | 개정 1 | 2 운영·순서·위험 | **FAIL** | R1 9건 반영 확인. 1 브랜치(위와 같음)·계약 테스트 위치 2 0절 "서울 이전과의 관계" 옛 문구. 권고 반영: 서울 계획 12행·A-7·동결 시작점, W3-8b 검증·실패 삼킴, W4-6a 검증, W4-7 시험 문의만, W0-8 P-7 경로 표기 |
| R3 | 개정 2 | 1 구현 실현성·코드 정확성 | **PASS** | R2 필수 2건 반영 확인. 권고 반영: 1절 브랜치 이름, 겹치는 파일 2쌍 추가, 23503 오류 코드 전달 구현 메모 |
| R3 | 개정 2 | 2 운영·순서·위험 | **PASS** | R2 필수 2건 반영, 서울 이전 계획과 정합 확인. 권고 반영: 1절 브랜치 이름, 출시 직후 확인 절 번호 |
| 확정 | 개정 2 + R3 권고 | 작성자 | 반영 | 문구 정정만(설계 변경 없음) |
