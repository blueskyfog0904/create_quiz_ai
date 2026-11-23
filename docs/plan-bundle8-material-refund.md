# 8번 묶음 계획: 자료 환불 30일·예외 환불·패키지 부분 환불·환불정책 조항 (8판)

작성일: 2026-11-23 · 순서표 `docs/prelaunch-work-order.md` 8번 · 앞 묶음: `docs/plan-bundle7-purchase-notice.md`(배포 완료)
8판 변경: 7회차 검증(4명 FAIL — major 는 7판의 새 장치 두 곳에 몰림) 반영 — 대표 정산은 취소 진행 중이면 거절·⓪ 원천에만 재량·다른 경로 문턱 동일 적용·장부 검사, 문의는 고치기 전 판을 보관하고 환불 의사가 처음 담긴 판의 시각을 기준으로, 엔진 시그니처 통일, 9번 이관(재지급 사슬).
7판 변경: 6회차 검증(4명 FAIL — 공통 major 는 대표 확인 요청을 닫는 경로) 반영 — 대표 정산 함수, (e) NEEDS_OWNER 는 pending 요청을 남김, 전화·이메일 철회는 대표 경로(증빙 필수), 연결 문의는 회원 수정 시각 기준·내용 사본, 활성 서브상품 (상품, 분류) 유일 인덱스(교체본 판정 고정), 잔액 기록 순서.
6판 변경: 5회차 검증(4명 FAIL, major 4갈래) 반영 — **단순화 두 가지**: ① 현금 환불 이력·취소 진행 중인 원천이 걸린 주문은 자동 계산하지 않고 대표 확인으로 넘김(겹침 상한식 삭제) ② 구성과 다른 종류의 추가 자료를 받은 것은 대상을 줄이지 않음(판정 불가·관리자 지정 장치 삭제, 교체본은 받은 것으로 봄). 그 밖에 업그레이드 기준 PDF 승인 차단을 DB 에서 강제, 고객센터 철회는 1:1 문의 연결 필수·접수 시각은 문의 작성 시각으로 고정.
5판 변경: 4회차 검증(마이그레이션 PASS, 3명 FAIL) 반영 — 현금 환불과 겹치는 원천 몫 상한, 처리 안 된 취소 표시 대기, 만료 임박 원천은 재지급, 판정 불가 요청 닫기 규칙(값 갱신·원 시각·관리자 지정), 고객센터 철회를 전체 환불까지(withdrawal), 업그레이드 기준 PDF 함께 신청, 교체본으로 이용권 대체, 거부 코드 검사·근거, 재지급 원장 잔액·사유 기록.
4판 변경: 3회차 검증(4명 FAIL, 수렴) 반영 — 원천 분류 ④를 현금 환불 실제 범위로, 처리 중 원천은 모두 대기, 마감 SQL 식 수정(timestamp 명시), 거부 사유 코드·재신청 사슬, 이용권 재구성은 정확히 맞추기(회수 포함), 전액 도달 시 주문 refunded, 미리보기 RPC, 판정 불가 신청도 기록, 연결 표 FK·탈퇴, 되돌리기(기간 낮추지 않음·재적용 가능), 엔진 두 단계, 정책 정리 범위.
3판 변경: 2회차 검증(4명 FAIL, blocker 없음) 반영 — 원천 분류식(상태 먼저), 재지급 원장·연결 표·회수 금지, 확인값 뜻 통일, 첫 쓰기 전 판정 규칙, 이용권 재구성 함수(다른 주문 환불 때 패키지 몫 복원), 완전 환불 주문 이용권 전부 회수, 심사 중 차단을 목록 함수까지, 예외 환불 한도를 DB 안에서, 마감 시각(한국 날짜 기준), 고객센터 접수 = 신청, 재신청 시 원 신청 시각 승계, 고지 필수 내용, 되돌리기는 증빙 보존.
2판 변경: 1회차 검증(4명 FAIL) 반영 — 기존 승인 1건 인덱스 교체, 명목 누계, 원천별 배정 기록·만료분 재지급, 업그레이드 구멍, 이용권 충돌, 대상 자료만 차단, 거부 사유 필수, 처리 기한, 절차.
**확정(2026-11-23, 대표 결정)**: 계획 검증 7회(결제 3명·법 1명) 뒤 8판으로 확정. 큰 결함(구현 불가·과다·중복 환불·권리 침해)은 모두 해결됐고, 8판에서 고친 부분과 남은 세부는 **구현 검증(결제 3명·법 1명, PASS 까지)과 DB 리허설**에서 잡는다. 지적 기록: scratchpad b8-verify1~7.txt.

## 0. 대표 결정(2026-11-23)과 그 안에서 정한 것
- **대표 확인(2026-11-23)**: 아래의 '3·5·6·7판에서 정함' 항목(마감 = 구매일 + 30일 24시, 하자 환불 기간 제한 없음, 다시 지급한 크레딧 회수 금지(관리자 지급분 포함), 현금 환불 이력 원천은 대표 정산, 구성과 다른 종류 추가 자료는 대상에 영향 없음)을 그대로 확정.
- 받지 않은 자료 환불 기간 **30일**(값은 `market_purchase_policy.refundDays`). 마감은 **구매일(한국 시간) + 30일의 24:00**(민법 기간 계산과 같고 회원에게 유리 — 3판에서 정함).
- 패키지 부분 환불 금액: **정가 비율**(이번 대상 정가 합 ÷ 구매 때 구성 정가 합 × 낸 크레딧, 1크레딧 미만 버림). 이번 환불로 남는 구성이 없어지면 **남은 금액 전부**.
- 문제(HWP) 파일을 받을 때 그 HWP 자료에 활성 PDF 파일이 있었으면 **문제(PDF)도 받은 것**.
- 부분 환불은 **회원이 자료 보관함에서 신청** → 관리자 승인. **받지 않은 자료 환불(전체·부분 모두)은 회사가 표시한 연락처(1:1 문의·이메일·전화)로 접수해도 같은 효력** — 1:1 문의는 관리자가 문의와 '환불 의사가 처음 담긴 판'을 고르고 기준 시각은 DB 가 읽은 그 판의 작성 시각(회원이 문의를 고치면 고치기 전 판이 보관됨), 이메일·전화는 대표만 처리하며 증빙 메모(수신 시각·발신 주소 또는 통화 기록)와 범위 검사(주문 시각 ≤ 입력 시각 ≤ now) 필수. 같은 판정·금액식, 재량으로 줄이지 않음, 금액 한도 없음.
- **현금 환불 이력이 있거나 결제 취소가 진행 중인 크레딧 원천**으로 결제한 주문의 자료 환불은 자동으로 계산하지 않는다. 엔진이 `MARKET_REFUND_NEEDS_OWNER` 로 멈추고(요청은 pending 으로 남아 대기 목록·3영업일 알림에 오름), 대표가 **대표 정산 함수**(2-4 (h))로 **문제가 된 원천(⓪)의 몫만** 복구·재지급·미지급을 정해 닫는다(정상 원천은 자동 규칙대로). 결제 취소가 아직 진행 중이면 그 처리가 끝난 뒤 정산한다(3영업일이 취소 처리 때문에 늦어질 수 있음 — 취소 처리를 먼저). 관리자 크레딧 지급(grant_admin_credits)은 쓰지 않는다. 처리 기한 3영업일(6·7판에서 정함 — 출시 전이라 드묾).
- 하자·소개와 다른 자료의 **예외 환불**: `refunds.market` + 계정별 1건 한도(주문 누계 기준, 대표는 한도 없음), 사유·접수 시각 필수, 작업 기록, 본인 계정 불가. **기간 제한을 두지 않는다**(지금 고지가 기간 없이 약속 — 고지보다 좁게 쓰지 않음, 3판에서 정함).
- **만료된 크레딧 몫은 다시 지급**: 원천 종류 `system_refund`, 유효기간 = 환불 시각 + 구매 때 그 원천에 남아 있던 기간(최소 1일, 원천에 만료가 없으면 만료 없음). 아직 만료되지 않았어도 남은 기간이 min(구매 때 남아 있던 기간, 30일)보다 짧으면 같은 방식으로 다시 지급(복구 직후 사라지지 않게). 다시 지급한 크레딧은 **관리자 회수 대상이 아니다**(결제 대금의 환급 — 원래 원천이 관리자 지급분이어도 같게, 3·5판에서 정함).

## 1. 범위
하는 것
- A. 30일(DB 값)과 마감식(TS·SQL·문구 같게).
- B. 구매 시점 패키지 구성 기록.
- C. 패키지 부분 환불(회원 신청 → 승인).
- D. 관리자 예외 환불(주문 조회 > 마켓 구매).
- E. 환불 엔진 하나(전체·부분·예외 공통): 원천별 배정 기록, 만료분 재지급, 현금 환불된 원천 몫만 부족분.
- F. 이용권 재구성 함수 하나: 어떤 환불 뒤에도 '돈을 내고 남긴 자료'는 받을 수 있고, 다 돌려받은 자료는 받을 수 없게.
- G. 업그레이드 할인 구멍 막기(evaluate_market_targets R5).
- H. 환불정책 본문·구매 고지·부분 환불 확인 문구(대표 확인 뒤 DB).
- I. 운영 장치: 거부 사유 필수, 대기 환불 알림 시간 확인, 예외 환불 관리자 이벤트 정리, 재지급 크레딧 회수 금지.

하지 않는 것
- 결제 함수 `checkout_market_selection`(md5 `0cda5ff7…` 그대로).
- 옛 구매(market_purchases, 운영 0행)의 부분·예외 환불 — (a)의 legacy 경로는 지금 코드 그대로.
- 충전 크레딧 환불(9번). 9번에 넘김: '자료 환불로 다시 받은 크레딧의 원래 원천이 유료면 유료로 본다(8절 서비스 종료·7절 미성년자 취소 포함, market_refund_reissued_sources 를 원래 원천까지 재귀로 따라감)', '재지급 몫은 원래 원천을 미사용으로 만들지 않는다(재지급 원천이 그 몫을 대신 — 이중 환불 방지)', 재지급 뒤 원래 결제 전액 취소 경보.
- 환불 기간 '구매 당시 값' 판정(늘리는 방향이라 지금 값; 줄일 때는 동의 기록의 refund_days).

## 2. DB (마이그레이션 1개 + 되돌리기, 리허설 → 대표 승인 → 적용)
공통: `SET LOCAL lock_timeout='3s'; statement_timeout='60s'`. 잠금 순서 profiles → 환불 요청 → 주문 → 라인 → 원천 → 이용권(이용권은 UPDATE·INSERT 만). 마이그레이션은 재적용을 전제로 `IF NOT EXISTS`·`CREATE OR REPLACE` 를 쓴다. 적용 창 금지: 마켓 결제·환불 승인·**구매 고지 저장**. 순서: **DB 적용 → 타입 재생성·코드 배포 → 배포 직후 VERIFY 쿼리(refundDays 30·키 수) → 정책 본문 저장**, 모두 판매를 켜기 전 같은 날.
**판정 규칙**: 새 함수는 잠금 뒤 모든 거절 판정(상태·대상·금액·부족분)을 **첫 쓰기 전에** 끝내고 jsonb code 로 돌려준다. 첫 쓰기 뒤의 실패는 모두 RAISE(전체 롤백).

### 2-1. 설정
- `market_purchase_policy` 원본 jsonb 위에: refundDays 30, 새 키 `partialRefundConfirmNotice`, checkboxLabel·confirmNotice·detailRefundNotice 를 대표 확정 문구로(5절). VERIFY: 30, 키 10개, 자리표시 규칙.
- 지문이 바뀌어 열린 구매 확인창은 409(7번 흐름). 캐시 키에 버전(`market_purchase_policy:v2`).
- 관리자 저장 함수: 읽은 **원본 jsonb** 위에 문구 키만 덮고, `WHERE key=… AND value->'refundDays' = 읽은 값`(0행이면 "다시 시도").

### 2-2. 패키지 구성 기록 `market_bundle_line_components`(추가 전용)
- 열: line_id → market_purchase_lines ON DELETE CASCADE, order_id(FK 없음), subproduct_id, category_slug, list_price_credits ≥0, created_at. PK(line_id, subproduct_id).
- `AFTER INSERT ON market_purchase_lines … WHEN (NEW.line_type='bundle')` 트리거(함수 SECURITY DEFINER·search_path public,pg_temp·실행 권한 회수): 상품의 활성·미삭제 서브상품을 그 순간 값으로. 0행이면 `RAISE 'MARKET_BUNDLE_COMPONENTS_EMPTY'`(결제 전체 롤백, 두 구매 API 409). (f)에서 패키지 판매 가능 판정에 '활성·미삭제 서브상품 ≥1'을 더해 기준을 맞춘다.
- 채우기는 건수 고정 없이 '구성 행이 없는 모든 bundle 라인'을 지금 값으로(eligibility 에 'backfilled' 표시 — 지금은 시험 주문 1건).
- 권한: RLS·정책 없음, 전부 회수 뒤 service_role SELECT. 추가 전용 트리거(UPDATE·TRUNCATE 거부, DELETE 는 라인 또는 주문이 없을 때만).
- 운영 규칙(7번): 구매자가 있는 서브상품은 숨김만, 삭제·교체는 권리침해·법령 사유일 때만 — 교체하면 전환된 이용권도 옮기는 절차를 운영 메모로.

### 2-3. 열·표·인덱스
- `market_refund_requests`: `refund_kind`('full'|'partial'|'exception', 기본 full), `refund_subproduct_ids uuid[]`, `allocated_items jsonb`(원소 `{source_id, taken, restored, reissued, reissued_source_id, reissued_expires_at, unrecovered, reason}`), `requested_by uuid → profiles ON DELETE SET NULL`, `support_ticket_id uuid null`, `claim_received_at timestamptz`(예외는 필수, 부분은 신청 시각 — 고객센터 경로면 접수 시각), `prior_request_id uuid null`(재신청이 원 신청 시각을 이어받을 때).
- `market_purchase_orders`: `refund_committed_credits`(승인 요청 금액 합 = 명목 누계), `refunded_credits`(복구 + 재지급 실제 합). CHECK `0 <= refunded_credits <= refund_committed_credits <= charged_credits`. 채우기는 건수 고정 없이: **모든 v2 주문**의 committed = 승인 요청 requested 합, refunded = approved 합(재적용에도 같은 규칙). VERIFY: 주문별 두 값 = 승인 요청 합.
- 새 표 `market_refund_reissued_sources`(source_id PK → credit_sources ON DELETE CASCADE, request_id → market_refund_requests ON DELETE CASCADE, original_source_id(FK 없음), created_at): 재지급 원천 연결. RLS 켬·정책 없음, PUBLIC·anon·authenticated·service_role 회수 뒤 service_role SELECT(VERIFY). 추가 전용 가드는 7번 선례처럼 '부모 원천 또는 요청이 이미 없을 때만 DELETE'.
- `market_refund_requests` 추가 열: `reject_code`, `claim_type text`(예외: defect|withdrawal), prior_request_id 부분 유일 인덱스. support_ticket_id 는 FK 없음(탈퇴 route 가 문의를 먼저 지움).
- 인덱스: 기존 `uq_market_refund_requests_pending_order`(pending·approved) DROP → `(order_id) WHERE v2 AND status='pending'`, `(order_id) WHERE v2 AND status='approved' AND refund_kind='full'`.
- `market_refund_requests` BEFORE INSERT 검사: kind full 인데 주문 committed <> 0 이면 거절(TS 직접 INSERT 경로 보호).
- `trg_admin_event_market_refund_requested` → `WHEN (NEW.status='pending')`.
- 활성·미삭제 서브상품의 `(item_id, category_id)` 부분 유일 인덱스(운영 중복 0건 확인) — 같은 분류는 언제나 교체본이 되도록. 관리자 상품 화면은 이 위반을 '같은 분류의 자료가 이미 있습니다'로 안내.
- `support_tickets.member_updated_at timestamptz` 추가, 새 표 `support_ticket_revisions`(ticket_id → support_tickets ON DELETE CASCADE, subject, message, category_id, written_at, created_at; 추가 전용 — 부모 문의가 없을 때만 DELETE, RLS·service_role SELECT). `update_own_pending_support_ticket` 재정의(사전 md5 `ed40fb5a478afaf27a5f1440aca1eb70`, 새 md5 고정): 고치기 직전 판(그 판이 쓰인 시각 = 이전 member_updated_at 또는 created_at)을 revisions 에 넣고 member_updated_at = now().

### 2-4. 함수
**공용 판정 `market_bundle_refund_state(p_order_id)`**(내부) → {composition, provided, refunded, list_sum}
- provided: 이 주문(order_id)의 다운로드 → 파일 → 서브상품. 구성 밖 서브상품을 받았어도 그 category_slug 가 구성 서브상품과 같으면 그 구성을 받은 것으로 본다(교체본). question_pdf 는 'question_pdf 기록, 또는 question_hwp 자료 파일을 받은 시각에 그 HWP 자료에 활성 PDF 파일(created_at ≤ 시각, deleted_at 이 NULL 이거나 시각 뒤, PDF 판정식은 evaluate_market_targets 와 같음)이 있었음'.
- refunded: 승인 요청들의 refund_subproduct_ids 합집합(full 승인은 구성 전체).
- 구성의 어느 category_slug 와도 맞지 않는 서브상품(구성과 관계없는 추가 자료)을 받은 것은 provided·대상 어디에도 영향을 주지 않는다(회원에게 유리 — 6판에서 판정 불가 장치 삭제).

**환불 엔진 `market_refund_allocate` / `market_refund_settle`**(내부; 호출자가 잠금 완료)
- A = requested. 원천별 '남은 소비' = 주문 소비 내역(source_id·sourceId, 같은 원천 합침) − 같은 주문 이전 승인 요청들의 allocated_items.taken 합.
- 원천을 FOR UPDATE 한 뒤 분류(**상태 먼저**):
  ⓪ (이 주문의 남은 소비 > 0 인 **모든** 원천에 적용) 그 원천에 완료된 현금 환불(`refund_requests` completed, source_id 기준)이 1건이라도 있거나, status='pending_refund' 이거나, 그 원천 결제에 처리되지 않은 취소·부분취소 표시(payment_provider_transactions 기록 있음·처리 시각 없음)가 있으면 → `MARKET_REFUND_NEEDS_OWNER`(대표 확인 — 0절). 
  ① status='active' AND (expires_at IS NULL OR expires_at − now() ≥ min(구매 때 남은 기간, 30일)) → 복구(구매 때 남은 기간 ≤ 30일이면 사실상 항상 ②로 감 — 의도. 관리자가 일부 회수한 지급분도 status active 라 여기로 와 소비분이 복구되고 다시 회수할 수 있음).
  ② status='active' AND (만료됨 또는 ①의 기간 미달) → 재지급.
  ③ status='refunded' 이고 ⓪에 해당하지 않음(원인을 알 수 없는 상태 — 관리자 회수는 status 를 바꾸지 않으므로 정상 흐름에선 생기지 않음) → NEEDS_OWNER.
  ④ 원천 상한 초과(initial − remaining − 이번 누적 < 배정량) 또는 소비 내역 결손(남은 소비 합 < A) → unrecovered(사유 capped / unmatched).
- 배정: 복구 가능 원천을 소비 역순으로 상한(initial − remaining − 이번 누적) 안에서 → 재지급 → unrecovered. Σtaken = A.
- 확인값 뜻(전 경로 공통, 옛 코드와 호환): `restorable = 복구 + 재지급`. unrecovered > 0 이면 `p_confirmed_refund_credits = restorable` 일 때만 진행(아니면 `MARKET_REFUND_SHORTFALL`, details {requested, restorable, restored, reissued, unrecovered, sources:[{source_id, reason, amount}]}). unrecovered = 0 이면 확인값 불필요. 부족분 경보 지금처럼(dedupe 요청 id). (a)는 지금처럼 **RAISE + DETAIL** 형식(옛 TS 가 읽는 형식)을 유지한다.
- 엔진은 두 단계(시그니처 통일): `market_refund_allocate(p_order_id, p_amount) → jsonb 배정`(쓰기 없음) → `market_refund_settle(p_request_id, p_admin_id, p_allocation jsonb)`(실행). 확인값(SHORTFALL) 검사는 각 진입 함수((a)(d)(e)(h))가 allocate 결과로 첫 쓰기 전에 한다. (e)는 INSERT 전에 allocate 로 모든 거절을 판정한다.
- allocated_items 원소와 부족분 경보 details 에 원천별 reason 을 남긴다(사후 판단 근거).
- 실행: 복구 > 0 일 때만 `refund_credits(user, 복구, 'market_refund', request_id, '문제마켓 구매 환불', items)`(items = ① 복구 배정분만 정규화한 {source_id, amount}), 반환 refunded = 복구·skipped = 0 아니면 `MARKET_REFUND_AMOUNT_MISMATCH`. 재지급: 원래 원천마다 credit_sources(category system_refund, initial = remaining = 재지급량, expires_at = now() + GREATEST(원천.expires_at − 주문.created_at, 1일)) + credit_transactions(type 'refund', source_id 새 원천, resource_type 'market_refund', resource_id 요청 id, operation_key `'market_refund_reissue:'||요청||':'||원래 원천`, original_operation_key 는 비움) + `market_refund_reissued_sources` + profiles.credits 재계산. 순서: 재지급 원천을 먼저 만들고 → refund_credits 호출(재계산에 재지급분이 포함되어 최종 잔액) → 재지급 거래를 같은 최종 잔액으로 기록 — 모든 거래 balance_after = 최종 잔액(잔액 점검 쿼리 거짓 불일치 방지). 원천에 만료가 없으면 재지급도 만료 없음. payment_history 는 만들지 않음. grant_admin_credits 는 부르지 않음.
- 주문 committed += A, refunded += 복구 + 재지급. **committed = charged 가 되면 주문·라인 refunded**(모든 경로 공통). 요청 approved, approved_refund_credits = 복구 + 재지급, allocated_items, processed_by/at.

**이용권 재구성 `market_rebuild_order_entitlements(p_user_id, p_item_id)`**(내부, 모든 환불 경로 끝에서 호출, 멱등)
- 이 회원·상품의 주문마다 '남길 서브상품'을 계산: 서브상품 주문은 completed 이고 committed < charged 면 그 서브상품. 패키지 주문은 completed 이고 committed < charged 일 때 (구성 − refunded) ∪ (구성 밖으로 받은 서브상품 중 같은 분류의 구성이 refunded 에 없는 것) — 단 item 이용권이 revoked 면 없음(관리자 회수 존중).
- 패키지 주문에 환불이 한 번이라도 있으면(committed > 0) item 이용권은 refunded. 그 주문 출처 subproduct 이용권을 **남길 집합과 정확히 같게** 맞춘다: 남길 집합에 없는 active 것은 refunded, 남길 것 중 이 회원의 active 이용권이 하나도 없는 것은 생성(이미 다른 주문으로 가지면 만들지 않음). 주문이 refunded 면 그 주문 출처 이용권은 모두 refunded.
- 서브상품 주문의 이용권도 같은 규칙(남길 집합 = 그 서브상품 또는 없음). 뒤에 단건 주문을 환불하면 같은 호출에서 패키지 몫 이용권이 다시 생긴다.
- **교체본 대체**: 남길 구성 서브상품이 비활성·삭제 상태면 같은 상품의 같은 분류 활성·미삭제 서브상품으로 대신 남긴다(같은 분류가 여럿이면 대체하지 않고 경보). 전환 뒤 교체가 일어나면 운영 절차로 재구성을 다시 호출한다.

**(a) `approve_market_refund` 재정의**(시그니처 그대로; 사전 md5 `3639ac23…`, 새 md5 VERIFY 고정)
- v2: 잠금·상태·다운로드 재검사는 지금과 같음 + kind full 아니면 `MARKET_REFUND_KIND_MISMATCH`, committed <> 0 이면 TARGET_CHANGED, 업그레이드 기준 주문 검사(위) → 엔진. 부족분 메모 문구는 원천별 사유 요약(capped·unmatched)으로 — (d)·(e)·(h)도 같은 형식 → 주문·라인·이용권 refunded → 재구성. legacy: 지금 7~11단계 그대로.

**(c) `request_market_partial_refund(p_user_id, p_order_id, p_expected_credits, p_reason, p_prior_request_id)`**
- 잠금 profiles → 주문. 본인·completed·bundle, 대기 요청 없음.
- 기준 시각: p_prior_request_id 가 같은 회원·주문의 partial 요청이고 status rejected·`reject_code='TARGET_CHANGED'`·그 주문의 가장 최근 요청이면 **그 요청의 claim_received_at**(사슬이 이어져도 원 시각 유지), 아니면 now(). prior_request_id 는 부분 유일 인덱스(한 번만).
- 마감 공용 SQL 함수 `market_refund_deadline(created_at, days)` = `(((created_at AT TIME ZONE 'Asia/Seoul')::date + days + 1)::timestamp AT TIME ZONE 'Asia/Seoul')`, 조건 `기준 시각 < 마감`(예: 11-23 23:30 KST 구매 → 12-24 00:00 KST 마감). TS 도 같은 식, 표 테스트(23:59:59·00:00:00 경계), 리허설은 세션 TimeZone UTC·Asia/Seoul 두 번. 설정 못 읽으면 POLICY_UNAVAILABLE.
- 구성 있음. 다운로드 0 이고 committed 0 이면 `FULL_REFUND_AVAILABLE`.
- 대상 = 구성 − provided − refunded(비면 NOTHING_TO_REFUND). 금액 = 남는 구성이 없으면 charged − committed, 아니면 floor(charged × 대상 정가 합 ÷ list_sum)(list_sum 0 판정 불가). ≤0 이면 NOTHING_TO_REFUND. 화면값과 다르면 AMOUNT_CHANGED. 유일 인덱스 위반은 ALREADY_PENDING.
- INSERT(kind partial, 대상, claim_received_at = 기준 시각, prior_request_id, eligibility_snapshot = 판정 근거). AMOUNT_CHANGED 응답에는 지금 대상·금액을 싣는다.
- 회원이 대상을 고르지는 않는다(받지 않은 자료 전부 — 확인 문구에 '남기려면 먼저 받은 뒤 신청').

**미리보기 `preview_market_partial_refund(p_user_id, p_order_id)`**(service_role, 읽기 전용·잠금 없음): {code, targets, amount, deadline, provided}. 보관함·상품 상세·관리자 대화상자가 이 값을 쓰고, 계약 테스트는 미리보기 = (c) 판정.

**(d) `approve_market_partial_refund(p_request_id, p_admin_id, p_admin_note, p_confirmed_refund_credits)`**
- 같은 잠금. kind partial·주문 completed. 기간은 다시 보지 않음(신청 시각 기준). 재판정: 대상 중 provided 가 생겼거나 금액이 달라지면 **(d)가 직접 그 요청을 status rejected·`reject_code='TARGET_CHANGED'`·안내 문구로 바꾸고** jsonb TARGET_CHANGED 를 돌려준다(첫 쓰기 전 판정 규칙의 유일한 예외 — 거부 기록 자체가 목적). 회원 화면은 같은 주문 최신 요청이 이 코드면 재신청에 priorRequestId 를 자동으로 채운다. → 엔진 → 재구성.
- `market_refund_requests.reject_code text CHECK in ('TARGET_CHANGED','PROVIDED_CONFIRMED','OTHER')`. 관리자 거부(TS)는 코드 선택 + 사유 필수. kind partial 과 '요건을 갖춘 full'(다운로드 0·기간 안·기준 주문 차단 아님)은 TARGET_CHANGED·PROVIDED_CONFIRMED 만 허용하고 OTHER 는 요건 미달 요청에만(서버 검사). PROVIDED_CONFIRMED 는 근거(연결 문의 id 또는 제공 경로·시각 메모) 필수, 회원 알림에 요약. 계정 공유 등 약관 위반은 9절 별도 조치로, 철회 거부와 섞지 않음.

**(e) `admin_exception_market_refund(p_admin_id, p_order_id, p_claim_type, p_subproduct_ids, p_expected_credits, p_expected_committed, p_reason, p_support_ticket_id, p_claim_received_at, p_confirmed_refund_credits)`**
- p_claim_type:
  - `defect`(하자·소개와 다름 — 기간·다운로드 무관): 1건 한도(주문 누계) 적용, p_claim_received_at 필수(now 이하·주문 created_at 이상), p_support_ticket_id 선택.
  - `withdrawal`(연락처로 접수된 받지 않은 자료 환불): `p_claim_channel` 'ticket'|'email'|'phone'. ticket 은 **p_support_ticket_id 필수**, `p_ticket_revision_id`(환불 의사가 처음 담긴 판, 없으면 지금 판) — DB 가 같은 회원·주문 이후 작성인지 확인하고 기준 시각 = 그 판의 작성 시각(지금 판이면 마지막 회원 수정 시각, 없으면 created_at; p_claim_received_at 무시), 모든 판의 제목·본문·분류·시각 사본을 eligibility_snapshot 에 남김(탈퇴로 문의가 지워져도 증빙 유지), 관리자 대화상자에서 판별 본문을 보여 주고 '이 주문 환불 의사' 확인 필수. email·phone 은 **대표만**, p_claim_received_at 필수(주문 created_at ≤ 값 ≤ now()), 증빙 메모 필수. TARGET_CHANGED 로 거부된 앞 신청이 있으면 그 claim_received_at 이 더 이르면 그것. 금액 한도 없음. DB 가 판정 강제: 서브상품 주문·다운로드 0 패키지는 '그 주문 다운로드 0 이고 기준 시각 < market_refund_deadline' 이면 남은 금액 전부, 패키지 일부는 (c) 규칙(대상 = 구성 − provided − refunded, 같은 금액식).
- 같은 잠금. 행위자 권한을 DB 안에서 확인: refunds.market 권한 행 FOR UPDATE(대표는 생략). defect 이고 대표가 아니면 per_request 한도 ≥ committed + 이번 금액(revoke_admin_credits 와 같은 방식). withdrawal 은 한도 없음. 본인 주문이면 거절. 주문 completed, committed = p_expected_committed, 대기 요청 없음, 사유·접수 시각 필수.
- 업그레이드 기준 주문(체크아웃 batch result_payload 의 upgradeBaseOrderId = 이 주문, 그 업그레이드 주문이 completed 이고 committed < charged)이면 `UPGRADE_BASE_ORDER`(업그레이드 주문 먼저 — 그 주문이 전액 환불되면 refunded 가 되어 풀림).
- **업그레이드 기준 PDF 의 받지 않은 자료 환불**: 회원이 업그레이드(HWP 차액) 주문 U 의 환불을 신청할 때 화면이 기준 PDF 주문 P 도 '함께 신청'을 받아 P 의 전체 환불 요청을 같은 시각으로 pending 으로 남긴다(TS 전체 신청의 기준 주문 차단은 'U 가 completed 이고 U 에 대기·승인 요청이 없을 때만'으로 좁힘). P 승인은 U 가 refunded 가 된 뒤 — **(a) v2 단계에 DB 검사**: 이 주문을 upgradeBaseOrderId 로 가진 U 가 completed 이고 committed < charged 이면 `MARKET_REFUND_UPGRADE_BASE_ORDER` RAISE(대기 여부 무관). TS 도 '신청 생성' 판정(대기 중 U 허용)과 '승인 재판정'(U completed 면 차단)을 나눈다. 기간은 각 요청의 신청 시각.
- 대상: 서브상품 주문은 전체(금액 charged − committed). 패키지는 p_subproduct_ids ⊆ 구성 − refunded, 금액은 (c)와 같은 식(구성 밖으로 받은 서브상품은 대화상자에 표시 — 구성 전부를 환불하면 함께 회수). 화면값과 다르면 AMOUNT_CHANGED.
- 금액 ≤ 0 이면 NOTHING_TO_REFUND. 첫 쓰기 전에 allocate 로 SHORTFALL·NEEDS_OWNER 판정. NEEDS_OWNER 이면 **pending 요청(kind exception, claim_type, 대상·금액·기준 시각·문의 사본)을 남기고** code NEEDS_OWNER 를 돌려준다(대표 정산 대기). 아니면 요청 INSERT(approved, kind exception, claim_type) → settle → 재구성 → `record_admin_audit('market_refund_exception')`.

**(h) 대표 정산 `settle_market_refund_by_owner(p_request_id, p_owner_id, p_items jsonb, p_note, p_confirmed_refund_credits integer DEFAULT NULL)`**(service_role)
- 첫 쓰기 전 판정(순서대로): 같은 잠금 순서, DB 안에서 대표 확인(is_owner), 본인 주문 거절, 요청 pending 재확인 → **요청 kind 별로 (a)/(d)/(e)와 같은 판정을 그대로 다시 적용**(full: 다운로드 0·committed 0·업그레이드 기준 U 검사, partial: (d) 재판정, exception: (e)의 UPGRADE_BASE_ORDER·claim 규칙; 바뀌었으면 TARGET_CHANGED) → `market_refund_allocate` 를 불러 **NEEDS_OWNER 가 아니면 `MARKET_REFUND_NOT_OWNER_CASE`**(정상 경로로) → ⓪ 원천 가운데 pending_refund·열린 refund_requests(pending_review·processing·retryable_failed·manual_review)·처리 안 된 cancel/partial_cancel 표시가 하나라도 있으면 **`MARKET_REFUND_CANCEL_IN_PROGRESS`**(요청 pending 유지 — 대표 정산은 '완료된 현금 환불 이력'처럼 결과가 확정된 원천에만).
- p_items 는 **⓪(·③) 원천만** 받는다: `{source_id, restored, reissued, unrecovered, reason}`. 나머지 원천은 allocate 배정값을 그대로 쓴다(p_items 에 들어오면 엔진 값과 같아야 통과). 검사: source_id 유일, 원천별 합 ≤ 그 원천의 남은 소비, 전체 합(⓪ 지정 + 엔진 배정) = 요청 금액 A, restored 는 ①과 같은 기간 조건·원천 상한(initial − remaining) 이하, unrecovered 는 ⓪ 원천에만, reason·p_note 필수, 소비 내역 결손(unmatched)은 source_id 없는 unrecovered 원소로만.
- 실행은 엔진 settle 과 같은 장부·같은 순서: 재지급 원천 먼저 → refund_credits(반환 refunded = Σrestored·skipped = 0 아니면 MARKET_REFUND_AMOUNT_MISMATCH) → 재지급 거래(최종 잔액) → `market_refund_reissued_sources`(회수 불가), allocated_items(원천별 taken = restored + reissued + unrecovered, reason 'owner_settled' + 원천별 사유), committed += A, refunded += 복구 + 재지급, committed = charged 면 주문·라인 refunded, 요청 approved(refund_subproduct_ids 그대로), 재구성, `record_admin_audit('market_refund_owner_settle')`, 부족분 경보.
- NEEDS_OWNER 요청은 이 함수로만 닫는다(거부는 요건 미달일 때만 — reject_code 규칙 그대로).
- **구현 검증에서 더한 규칙(2026-11-23)**:
  - 예외 요청은 일반 승인 경로가 없으므로, 대기 원인(열린 충전 환불·취소 표시)이 풀려 allocate 가 OK 이면 p_items 빈 배열로 **엔진 배정대로 정산**한다. 이때 미지급이 있으면 (e)와 같은 확인값 규칙(MARKET_REFUND_SHORTFALL → p_confirmed_refund_credits = restorable). 창을 연 뒤 원인이 풀렸는데 예전 원천 값을 보내면 OWNER_CONTEXT_STALE.
  - 부분 요청과 고객센터 접수 예외(withdrawal, 패키지)는 (d)처럼 대상·금액을 다시 판정해, 바뀌었으면 요청을 TARGET_CHANGED 로 거부해 닫고 회원에게 알린다.
  - 대표가 ⓪ 원천 몫을 덜 지정해 정상 원천 재배정에 unmatched 가 생기면 ITEMS_INVALID(결손이 아닌데 결손으로 적히지 않게). 그래서 대표 지정 경로에서 unmatched 는 생기지 않는다.
  - 미리보기 `preview_market_partial_refund` 는 신청 함수와 같은 규칙으로 앞 신청(TARGET_CHANGED 로 거부된 최근 부분 신청)의 시각을 기준으로 판정하고 prior_request_id 를 돌려준다.
  - 다시 정의한 함수의 새 md5(VERIFY 고정, 다음 묶음 사전 검사 기준): approve `5039e98d8060a72f40b93e5f4db00417`, evaluate `56f84c9673e7663b5f14c10d2bf890d9`, revoke `8c1f5e5e316c18b48556c18ca9bad86f`, 문의 수정 `cb221135b63d2bcc590b7fa4d2a082b0`.

**(f) `evaluate_market_targets` 재정의**(사전 md5 `128f6ad5…`, 새 md5 고정): R5 의 두 쿼리 모두 출처 주문 `purchase_type='subproduct'` 인 PDF 이용권만 차액 기준. 패키지 판매 가능 판정에 활성 서브상품 ≥1. TS 미리보기(upgradeCandidate)도 같은 규칙.

**(g) `revoke_admin_credits` 재정의**(사전 md5 `3e64b0a4a9163d72d561ee5503fba429`·새 md5 고정): `market_refund_reissued_sources` 에 있는 원천은 회수 거절.

**거부**: `rejectMarketRefund` 는 위 reject_code 규칙대로, 사유 필수, 회원 알림에 사유.
**알림**: 기존 `remind_unanswered_admin_work` 의 마켓 환불 대기 시간 설정을 확인해 3영업일 안 처리되게 값을 정한다(필요할 때만 재정의 — 사전 md5 `c5f96dc4…`). 부분 신청도 같은 경로인지 리허설.

공통: 새 함수 SECURITY DEFINER·search_path public,pg_temp, 실행 권한 회수(내부 함수는 service_role 도), 새 API 는 40P01·40001 → 409 '잠시 후 다시'. VERIFY: ACL·DEFINER, 표 권한, 인덱스·트리거 정의, approve·evaluate·revoke 새 md5, checkout md5 그대로, 설정 값, 기존 주문 누계.

### 2-5. 되돌리기
- down 은 **approve·evaluate·revoke 함수, 승인 유일 인덱스, BEFORE INSERT 검사만** 원래대로 되돌린다. 구성 기록 트리거·새 표·열·가드·권한은 남긴다(증빙, 옛 코드에 영향 없음). **refundDays 는 낮추지 않는다**(30일 고지에 동의한 구매가 있을 수 있음 — 문구 키도 그대로 두고 옛 코드는 새 키를 무시). 부분·예외 요청, 재지급, 대표 정산이 1건이라도 있으면 down 을 멈춘다(RAISE). down 은 support_tickets 열·문의 수정 함수·유일 인덱스도 되돌리지 않는다(증빙·데이터 규칙).
- 4절에 down → 그 사이 패키지 구매·전체 환불 → 재적용 리허설(approve `3639ac23…`·evaluate `128f6ad5…`·revoke 원래 md5 복원, 재적용 뒤 누계·구성 채우기 확인). 재적용 사전 검사는 문의 수정 함수의 원래·새 md5 둘 다 받는다. 재적용은 구매 고지 문구를 덮지 않는다(첫 적용에서만 넣음, refundDays 30 만 다시 넣음).
- **운영 순서**: 되돌릴 때는 코드를 먼저 이전 배포로 되돌린 뒤 down(새 코드가 지워진 함수를 부르지 않게). 되돌린 기간에는 옛 코드의 마감식(구매 시각 + 30×24시간)이 고지(다음 날부터 30일째 24시)보다 최대 하루 짧고 예외 환불 함수도 없으므로, 그 기간의 마감 경계 신청·고객센터 철회는 1:1 문의로 받아 두었다가 재적용 뒤 (e)로 처리한다. DB 적용부터 코드 배포까지는 관리자 화면에서 구매 고지를 저장하지 않는다(옛 코드가 새 키를 지움).

## 3. 코드
- 대기 요청 조회를 공용 헬퍼 하나로: {kind, refund_subproduct_ids}. 다운로드 route·상품 상세 목록(listMarketSubproductDownloadFilesForUser)·보관함(listMarketLibraryRowsForUser)이 같은 규칙 — partial 대기면 대상 서브상품(교체본 포함) 파일만 막고 나머지는 계속 받음.
- `market-refunds.ts`: 전체 환불 판정에 committed > 0 이면 blocked(부분 신청 안내). 보관함 상태 우선순위 pending > 부분 환불 가능 > approved. 금액 표시는 최신 요청 값, 구매일은 출처 주문 created_at(상세·보관함). 마감식 TS = SQL(한국 날짜) 표 테스트. 보관함 환불 행의 주문 목록에 'completed 이고 committed < charged 인 패키지 주문' 포함.
- 회원 API `POST /api/market/refunds`: kind partial, expectedCredits, priorRequestId → (c). AMOUNT_CHANGED·ALREADY_PENDING 409, POLICY_UNAVAILABLE 503, 40P01 409.
- 보관함 화면: "받지 않은 자료 환불 신청" — 대상·예상 크레딧·partialRefundConfirmNotice.
- 관리자 환불 화면: 종류·대상·경과일, NEEDS_OWNER 는 '대표 확인 필요' — 대표에게만 '원천별 정산' 대화상자(원천 내역·현금 환불 이력 표시, (h) 호출), 부분 승인 (d), 거부는 reject_code 선택 + 사유 필수, 부족분 안내는 원천별 사유(전액 현금 환불·관리자 회수 등)로.
- 대시보드 판매액(readMarketTotals)은 charged − refunded_credits 로 집계.
- 관리자 주문 조회 > 마켓 구매: 주문 상태에 '부분 환불 N크레딧', "예외 환불" 대화상자(서브상품 체크·받은 기록·이미 환불·구성 밖 받은 자료·업그레이드 기준 안내, 금액, 사유·접수 시각·1:1 문의 연결) → `POST /api/admin/market/orders/[id]/exception-refund` → (e)(본인 주문 403은 DB 판정이 최종).
- 운영 규칙: 한 서브상품의 여러 파일은 같은 내용의 다른 형식일 때만(내용이 다르면 다른 분류의 서브상품으로 나눔 — 같은 분류 둘은 인덱스가 막음). 하자 주장을 인정하지 않을 때는 1:1 문의 답변에 근거를 쓰고 대표에게 공유. 자료 환불 문의는 (e) 처리 전까지 미처리로 둔다(미처리 알림 유지).
- 한계(9번으로 넘김): 재지급 뒤 원래 결제가 PG 전액 취소되면 재지급분을 회수하는 장치 없음 → 외부 취소·수동 환불 완료 흐름에서 market_refund_reissued_sources 로 연결된 재지급이 있으면 경보.
- 구매 API: MARKET_BUNDLE_COMPONENTS_EMPTY 409. 작업 기록 `market_refund_exception`·`market_refund_owner_settle`, 가드 표, 타입 재생성.

## 4. 검증
- 결제 3명 + 법 1명 PASS 까지(계획·구현 각각).
- 리허설 판정표: 30일·키·마감 경계(한국 날짜), 구성 트리거(3행·0행 롤백), 부분 금액(워크북만·PDF만·HWP 만 PDF 있음/없음·워크북+PDF·교체본 다운로드·구성 밖 다른 종류 → 대상 그대로), 부분 → 예외 나머지 = charged, 예외 → 부분, 예외 → 예외, 전체 승인 → 새 요청 거절, 일부 환불 주문 전체 승인·전체 INSERT 거절, 원천 분류(active 만료 → 재지급(기간), 만료 임박 → 재지급, 직접 만든 refunded·현금 기록 없음 → NEEDS_OWNER, 부분 회수한 admin_grant(active) → ① 복구 → 재회수 가능, 앞 원천 만료 → 다른 원천 배정, 한 요청 재지급 2개·같은 주문 두 요청 같은 원천 재지급), 재지급 원장·연결·회수 거절, 확인값(restorable = 복구 + 재지급), 부족분 미확인 예외 → 요청 0건, 단건 보유 + 패키지 → 부분 승인 → 단건 환불 → 패키지 몫 이용권 생김, 구성 밖 다운로드 + 구성 전부 예외 → active 0, 부분 대기 중 구성 밖 다운로드 → 승인 거절, 부분 뒤 HWP 가격 = 정가, 업그레이드 기준 예외 거절, 동시 신청·동시 예외 → 두 번째 거절, 한도(주문 누계), 만료 임박 원천 → 재지급, 현금 환불 이력 원천·pending_refund·처리 안 된 취소 표시 → NEEDS_OWNER(첫 쓰기 전, (e)는 pending 요청 생성) → 대표 정산(committed·이용권 회수·재신청 거절·지급분 회수 거절), 취소 진행 중 대표 정산 → CANCEL_IN_PROGRESS·격리 완료 뒤 정산 성공, 정상 요청에 (h) → NOT_OWNER_CASE, 정상 원천 unrecovered 지정 → 거절, ⓪ 원천만 지정 + 정상 원천 엔진 배정 → 잔액 점검 0행, U completed 인 P 의 (h) → 거절, 이메일 29일 접수 → 32일 대표 처리 전액, 마감 전 작성 → 마감 뒤 수정 → 처음 판 시각 기준 전액, 마감 뒤 수정으로 처음 환불 의사 → 그 판 시각 기준 거절, 탈퇴 뒤 문의 사본 유지, 같은 분류 서브상품 추가 시도 → 인덱스 거절, 복구 + 재지급 혼합 → 잔액 점검 쿼리 0행, 관계없는 추가 자료 다운로드 → 대상 그대로, 1:1 접수 29일 → 32일 처리 전액(withdrawal, 기준 시각 = 문의 작성 시각, 입력 시각 조작 무시), 문의 없이 withdrawal → 거절, U·P 함께 신청 → P 먼저 승인 시도 거절 → U 승인 → P 승인, U 거부 뒤 P 승인 거절, 교체본 대체(H 받음 → H 교체 → W 부분 승인 → H′ 이용권 1개), 재신청 사슬(두 번 거부 → 원 시각 유지, 다른 사유 거부 → 승계 안 됨, prior 재사용 거절), 판정 불가 신청 → manual 요청 → (e)로 닫힘, 부분 승인 → 남은 것 일부 예외 → 그 이용권 active 0, 교체본 회수, 업그레이드 주문 예외 → 기준 PDF 예외 가능, 마감 경계(TimeZone 두 번), 옛 코드 + 새 DB 부족분 승인(RAISE 형식), admin_events pending 만, 패키지 구매·재지급 받은·문의 연결 예외 환불 회원 탈퇴, 권한, md5, down → 그 사이 거래 → 재적용.
- 계약 테스트: API·화면 세 곳 차단 규칙·한도·가드·kind·7번 테스트 갱신.
- 로컬 확인은 내가 먼저(신청·승인 누르지 않음), 그다음 대표.

## 5. 대표 확인 필요(문구 — 구현 전에 초안 드림)
1. 환불정책 새 절 '문제마켓 자료 환불': 마감(구매일 + 30일 24시), 다운로드한 자료(받은 것으로 보는 자료 포함) 단순 변심 불가, 자료 안 파일 하나만 받아도 그 자료를 받은 것, HWP 안 PDF 규칙, 하자·소개와 다름은 기간 없이 다운로드 뒤에도 고객센터, 고객센터 접수도 신청과 같음, 패키지 정가 비율(구성 정가 합은 문제 PDF 포함)·버림·남는 자료 없으면 전액, 부분 환불 뒤 남은 PDF 는 HWP 차액 기준 아님, 업그레이드 기준 PDF 주문, 환불 수단(결제에 쓴 크레딧, 만료분 재지급 규칙, 다시 받은 크레딧은 회수 대상 아님, 그 크레딧의 현금 환불은 2·3절), 처리 3영업일·거부 사유 통지. 3절 ③(자료는 새 절로, '열람' 삭제), ⑤('단순 변심' 삭제, 부정 사용은 9절, 법정 철회는 제한하지 않음), 1절(개별 조건은 회원에게 더 유리할 때만 우선), 4절(보완 요청은 하자·오류 주장에만, 받지 않은 자료 환불은 기록으로 판정), 6절(부분 환불은 환불된 자료만 회수), 새 절에 '자료 환불로 다시 받은 크레딧은 3절⑥의 무상 크레딧이 아님', 거부는 판정 근거 변경·제공 사실 확인일 때만, 업그레이드 문장은 단순 변심에 한정하고 하자는 업그레이드 주문과 함께 환불.
2. 구매 고지 checkboxLabel(받은 것으로 보는 자료 포함)·confirmNotice(자료 단위 판정·HWP 안 PDF·정가 비율)·detailRefundNotice(버림·구성 정가 합 기준).
3. partialRefundConfirmNotice: 이번 대상·금액식, 받지 않은 자료가 모두 함께 환불됨(남기려면 먼저 받은 뒤 신청), 환불 뒤 남은 자료만 받음, 남은 PDF 는 HWP 차액 기준 아님.
4. 정책 추가 문장: 회사가 표시한 연락처(1:1 문의·이메일·전화)로 환불 의사를 보낸 시각을 신청 시각으로 봄(전체·부분 모두), 충전 환불이 있었던 크레딧으로 산 자료는 담당자가 확인해 3영업일 안 개별 정산, 구성과 관계없는 추가 자료를 받은 것은 환불 대상에 영향 없음, 마감 표시는 '구매일 다음 날부터 30일째 되는 날 24시까지'(화면은 'N월 N일(한국 시간)까지'), 업그레이드 기준 PDF 는 '업그레이드 주문을 먼저(또는 함께) 환불하면 환불 가능, 하자는 두 주문 함께', 하자 환불은 하자 자료 몫이 원칙이되 그 하자로 패키지 이용 목적을 이룰 수 없으면 전체 환불 요청 가능, 9절 보류는 사실 확인 기간에 한하고 사유를 알림·법정 철회는 제한하지 않음, '복구된 크레딧은 원래 충전분 유효기간을 따르고 기간이 지났거나 짧으면 다시 지급', 9번 이관 '자료 환불로 복구된 크레딧은 사용하지 않은 것으로 본다'.
5. 참고(결과 알림): 정가 비율 분모는 문제 PDF 포함 8,000이라 상세 화면 비교가(5,500)와 다름.

## 근거(사실 조사, 2026-11-23, 운영 DB 읽기 전용)
- 결제 함수: 주문 1 = 라인 1 = 이용권 1(패키지 scope 'item'), 주문별 credit_consumptions.
- 패키지 64개 모두 3구성(workbook 2,500·question_pdf 2,500·question_hwp 3,000), 패키지 4,500. 주문: subproduct 완료 13·환불 2, bundle 완료 1. 환불 요청 approved 2, pending 0. 옛 구매 0행. question_hwp 144개가 hwp+pdf 두 파일.
- 인덱스: `uq_market_refund_requests_pending_order`(pending·approved), `uq_market_entitlements_active_subproduct`·`_active_item`.
- 다운로드 기록 'subproduct_file' 은 파일·주문·이용권 id NOT NULL(CHECK), 파일은 soft delete(기록 NULL 0건). 삭제된 서브상품 3개 있음(교체 가능성).
- `approve_market_refund`(md5 3639ac23…): 주문 전체만, 다운로드 있으면 거절, 원천 순서 복구, 만료·환불 원천은 부족분. `refund_credits`: 만료·비활성 원천 건너뜀. `credit_sources.status` = active·pending_refund·refunded, 만료는 expires_at. 원천 종류 plan_purchase·admin_grant·system_refund(관리자 지급분 17건 존재)·bonus·legacy_unknown. `revoke_admin_credits` 는 admin_grant·bonus·system_refund 회수 가능. `uq_credit_transactions_user_operation_key`.
- 대기 요청이 있으면 그 주문 이용권 다운로드 차단(route·상세 목록·보관함). 환불 요청 AFTER INSERT 트리거가 상태 무관 관리자 이벤트.
- 환불정책 1절(개별 조건 우선), 3절 ③(다운로드·열람 시 제한될 수 있음)·⑤(단순 변심 제한될 수 있음).
