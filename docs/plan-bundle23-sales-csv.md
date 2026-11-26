# 23번 묶음 계획 · 매출·정산 CSV(첫 월말 전까지)

작성일: 2026-11-26
판: 4 (검증 PASS, 2026-11-26)
- 3판은 보안 FAIL(major 1: 만료 소멸 식이 service_role 도 못 읽게 잠긴 탈퇴 보관함을 읽음)이었다. 반영은 16절 표, 고친 곳은 `(4판)`.
- 2판은 돈 PASS, 보안 FAIL(major 1: 참고 금액 함수가 service_role 로는 부를 수 없는 운영 helper 를 씀)이었다. 반영은 15절 표, 고친 곳은 `(3판)`.
- 1판은 돈·보안 두 관점 모두 FAIL(major 5)이었다. 반영은 14절 표에 있고, 고친 문단 끝에 `(2판)` 을 붙였다.
- 작업 순서표 6단계 23번 '매출·정산 CSV(첫 월말 전까지)'를 만든다.
- 출처: `docs/operations-readiness-gaps.md` 1-15, 운영 개선 계획 U5-1(권한 `reports.view`), 런북 RB-10 월말 정산 대조(`docs/admin-operations-runbook.md` 9절), 13번 계획 14절.
- **이 묶음이 매출 숫자의 정의를 정한다(3절).** 21번 대시보드는 같은 정의·같은 함수를 쓰므로 23번을 먼저 한다.
- 결제·크레딧 기록을 **읽기만** 한다.

## 0. 대표 결정과 질문
**이미 정해진 것**: 매출 집계는 대표가 권한을 준 계정만(2026-11-20). 테스트 계정은 출시 전에 지운다. 세금 신고 수치의 기준은 **페이앱 정산 자료**이고, 우리 DB 는 그것과 맞춰 보는 용도다(RB-10).

**질문** — 답이 오기 전에는 기본안으로 진행한다.

Q1. 무엇을 '매출'로 볼지
- 기본안: **두 표를 함께 낸다.** (가) 결제 기준(충전 결제·환불·순액, 부가세 분리) (나) 크레딧 흐름(지급·되돌림·사용·회수·소멸·잔액).
- 신고 기준은 세무사 답(크레딧 부가세 과세 시점) 뒤 대표가 정한다(`launch-owner-todo.md` 6절).

Q2. PG 수수료
- 기본안: **넣지 않는다**(DB 에 값이 없음). '페이앱 정산 자료와 맞춰 볼 칸'(건수·결제·환불)만 둔다.

Q3. 회원 개인정보가 든 CSV
- 기본안: **만들지 않는다.** 기본 CSV 에는 회원 칸이 없다.
- (나) 꼭 필요하면 대표 전용·사유 필수·열람 기록·이메일 한 칸만인 판을 둔다(5-3).
- **기본 CSV 에는 열람 기록·사유가 없다**(회원 정보가 없어 작업 기록 `sales_report_export` 만). 13번 계획 14절(701행)의 'CSV 는 사유·열람 기록 `export`'는 회원 칸 판에만 해당하도록 13번 담당이 문장을 고친다. (2판)

Q4. 권한
- 기본안: 기본 CSV·화면 = `reports.view`(이미 있는 키, `orders.view` 함께 필요). 회원 칸 판 = 대표만.

Q5. 일정
- 기본안: 11월분(11-30 마감)은 **RB-10 SQL** 로 대조한다(3-4 대조 예시). CSV 는 **12월분 대조(2027-01 첫 주) 전**에 운영 반영.

Q6. 무상 크레딧과 '참고 금액'
- 기본안: 사용 크레딧을 원으로 바꾼 '참고 금액'은 **유상 뿌리**(요금제 구매, 재지급은 원래 유상 출처로 거슬러 올라감)만 계산한다. 관리자 지급·보너스·옛 분류·뿌리를 못 찾은 재지급은 0원. (2판)
- 주문이 이어지지 않은 옛 plan_purchase 출처(`payment_order_id` 없음, 예: 2026-03 출처)는 단가를 알 수 없어 0원으로 두고, 그 C 를 '단가 알 수 없음' 경고 줄로 따로 보인다. (3판)

Q7. 파일 형식
- UTF-8(BOM), 쉼표, `\r\n`, 금액은 정수(원), 날짜는 한국 시간 `YYYY-MM-DD HH:MM:SS`.

Q8. 월 마감 고정 표
- 기본안: 만들지 않는다. 정의를 고정하고 내려받을 때마다 파일 지문(sha256)을 작업 기록에 남긴다. 다시 받았을 때 달라지면 지문으로 드러난다.

## 1. 지금 상태(코드·운영 DB 읽기 전용 확인, 2026-11-26)
**충전 결제 `payment_orders`**
- 실결제 = `provider = 'payapp' AND provider_environment = 'live'`. CHECK `payment_orders_provider_snapshot_check` 가 페이앱 주문을 live 로만 허용한다.
- 부가세: 같은 CHECK 가 `tax_free_amount = 0`, `vat_amount = round(expected_amount / 11)` 을 강제한다 → **부가세는 저장된 `vat_amount`**, 공급가액 = `expected_amount − vat_amount`.
- 결제수단 `payment_method_code` → `payment_methods.label`(card '신용·체크카드', naverpay '네이버페이', phone, tosspay). 요금제는 `plan_name_snapshot`.
- 매출에 드는 상태는 `completed`·`refunded`(RB-10 9-1). `manual_review`·`cancel_pending` 은 지금 0건.

**충전 환불 `refund_requests`**
- RB-10 9-2 는 `rr.provider = 'payapp' AND rr.status = 'completed'`, 시각 `COALESCE(provider_cancelled_at, processed_at)` 이다. 완료 4행 중 payapp 1행(1,000원), 나머지 3행은 `provider = 'toss'`(2026-02 옛 행).
- 지금 대시보드(`src/lib/admin-dashboard-server.ts:89-101`)는 `processed_at` 을 써서 어긋난다 → 21번에서 맞춘다.
- `origin`: user·external_cancel·partial_cancel. 수동 처리는 `payment_admin_actions.external_method`(CHECK: payapp_cancel_request·bank_transfer·provider_admin_cancel). 지금 0건.
- `reason`·`admin_note`(4행 모두 채워짐)는 회원·관리자 자유 글이고 10번 가림 대상이다(`redaction_reviewed_at`). (2판)

**충전 환불의 크레딧 회수** (2판)
- 자동 `finalize_point_charge_refund` 는 미사용일 때만 동작하고 출처 전체를 뺀다.
- 수동 `complete_manual_point_charge_refund` 는 원래 출처 + 재지급 자손(`credit_source_reissued_descendants`)의 **쓸 수 있는 잔량만** 회수한다(`v_recovered`). 남은 가족 잔량이 있으면 출처는 `active`, 주문은 `completed` 로 남는다. 원장에 원천별 `type='refund', resource_type='refund_request'` 음수 행을 넣고, `payment_admin_actions.recovered_credits`·`details.sources[]`(원천별 recovered, 만료 정리분 `expired_cleared`)를 남긴다.
- 그래서 '환불된 출처의 initial_credits' 로 세면 이미 사용으로 센 크레딧을 두 번 세거나, 부분 환불을 빠뜨린다.

**크레딧 출처·원장** (2판: 사실 고침)
- `credit_sources.source_category`: plan_purchase(유효기간 365일)·admin_grant·system_refund·bonus·legacy_unknown. 상태 active·pending_refund·refunded.
- 기존 system_refund 17행은 모두 2026-03 의 옛 '크레딧 100개 구매' 행이고 자료 환불 재지급이 아니다. `market_refund_reissued_sources` 는 0행.
- 원장 `credit_transactions.type` 은 분류가 섞여 있다(관리자 지급이 `purchase`, 관리자 회수가 `refund` 음수, 자료 환불 되돌림이 `refund` 양수 `resource_type='market_refund'`).
- **만료 뒤에도 잔량이 그대로 남는다는 1판 서술은 틀렸다.** 만료 뒤 잔량을 원장 행 없이 0 으로 바꾸는 길이 둘 있다: 수동 충전 환불(`payment_admin_actions.details.sources[].expired_cleared`), 결제 회원 탈퇴 익명화(대표 경로 — 작업 기록 `admin_audit_log` `member_withdraw` 의 `details.expired_cleared` 에 회원별 합계, 탈퇴 보관함 `withdrawn_member_records.forfeit_breakdown` 에 출처별). **탈퇴 보관함은 service_role 도 읽지 못하게 잠겨 있다**(`20261126100000_member_withdrawal.sql:442-447`, 이메일·전화·사유가 든 표). (4판) 지금 만료된 출처는 0개다. (3판)
- **비결제 회원 탈퇴**는 그 회원의 `market_purchase_orders`·`market_refund_requests`·`credit_consumption`·`credit_transactions`·`credit_sources` 를 지운다(`20261126100000_member_withdrawal.sql` 6-1'). 그래서 지난 기간 크레딧 흐름이 나중에 줄 수 있다. 결제 기준 표는 영향 없다. (3판)
- 출처별 차감 기록 표 `credit_consumption`(source_id·amount·resource_type·resource_id·created_at)이 주문 행과 상관없이 남는다. 11월 `market_purchase%` 19행 48,000 C 로 원장 consume 합과 같다. (3판)
- 유상 뿌리 찾기 함수 `credit_source_paid_root(p_source_id)`(재지급 → `market_refund_reissued_sources.original_source_id` → plan_purchase 뿌리·`payment_order_id`)가 있다. `anonymize_member` 도 이것으로 유상·무상 소멸을 나눈다. **이 helper 와 `credit_source_reissued_descendants` 의 EXECUTE 는 postgres 에만 있다**(service_role 없음, 부르는 운영 함수는 DEFINER). (3판)
- 잔액 계산(운영 함수 `revoke_admin_credits` 등) = `status IN ('active','pending_refund') AND (expires_at IS NULL OR expires_at > now())`.

**자료 판매** (2판)
- `market_purchase_orders`: `charged_credits`, `refunded_credits`, `credit_consumptions`, `purchase_type`(subproduct·bundle), `workspace_subject`.
- 자료 환불 `market_refund_requests`: `approved_refund_credits`, `processed_at`, `allocated_items`(새 행은 출처별 `restored`(원래 출처에 되돌림)·`reissued`(만료가 가까운 출처만 새 system_refund)·`unrecovered`). 11월 승인 2건 5,000 C 는 **`allocated_items` 가 비어 있다**(옛 방식 행).
- **11월 원장과 주문 표가 5,000 C 어긋난다**: 원장 `consume`(resource_type `market_purchase%`) 18행 48,000 C, 주문 표(실패 제외) 16건 43,000 C. 11-10 두 건(2,000·3,000 C) 원장 행에 맞는 주문 행이 없다. 원장 `resource_id` 는 주문 id 가 아니라 상품·구성 id 다. 원인은 거의 드러났다(12절 1): 같은 시험 계정(11-11 1,000원 결제 계정)의 실제 차감이고 잔액이 끊김 없이 이어지지만, 주문·이용권 행만 없고 11-16 에 같은 상품을 다시 샀다 — 시험 재구매를 위해 주문·이용권 행을 지운 흔적으로 보인다. (3판)

**그 밖**
- 관리자 회수: `admin_audit_log.action='credit_revoke'` 3건 200 C(기록 시작 11-19), 원장 회수 행도 11월 3건 −200 C 로 같다.
- 권한: `reports.view` 받은 직원 0명. 관리자 owner 4·staff 1.
- 13번 열람 기록(`admin_member_access_log`, `recordMemberAccess`)과 `adminRequestMeta` 는 아직 없다(지금은 `src/lib/member-withdrawal-server.ts:471` `withdrawalRequestMeta` 만). (2판)
- 마이그레이션: 운영 마지막 적용 `20261216100000`. 12번 파일 `20261214100000`(커밋 cbe27ee, DB 미적용), 13·14·16번 계획 확정.

## 2. 목표
1. 권한 있는 관리자가 `/admin/reports` 에서 기간을 고르고 요약을 본 뒤 CSV 를 내려받는다.
2. 정의는 3절 하나다. 같은 기간을 다시 받으면 같은 숫자가 나온다(기록이 바뀌지 않았다면). 단, 비결제 회원 탈퇴는 그 회원의 크레딧·자료 구매 기록을 지우므로 지난 기간 크레딧 흐름이 줄 수 있다(파일 머리 줄에 적음, 결제 기준은 영향 없음). (3판)
3. 결제 기준 요약 = 건별 합계 = RB-10 9-1·9-2 결과(3-4).
4. 한국 시간 경계로 센다. 부가세 포함·부가세·공급가액을 나눈다.
5. 기본 CSV 에 회원 정보가 없다. 내려받을 때마다 작업 기록이 남는다.

## 3. 정의
### 3-1. 결제 기준(원) — RB-10 과 같은 식 (2판)
- **결제**: RB-10 9-1 그대로. `provider='payapp' AND provider_environment='live' AND status IN ('completed','refunded') AND approved_at IS NOT NULL`, 승인 시각이 기간 안. 뒤에 환불된 주문도 결제한 달에 넣는다.
  - 금액 `expected_amount`, 부가세 `vat_amount`, 공급가액 = 금액 − 부가세. 결제수단별(`payment_methods.label`, 없으면 코드)·요금제별(`plan_name_snapshot`).
- **환불**: RB-10 9-2 그대로. `refund_requests.provider='payapp' AND status='completed'`, 시각 `COALESCE(provider_cancelled_at, processed_at)` 이 기간 안, 금액 `refund_amount`, 경위 `origin` 별.
  - 완료 환불에 금액이 비어 있으면 그 기간 결제 기준 결과 전체를 '확인 불가'로 멈춘다.
  - 환불 부가세 = `round(refund_amount / 11)`. 전액 환불이면 원 주문 `vat_amount` 와 같아야 한다(다르면 경고).
- **순액** = 결제 − 환불(각자 자기 시각). 다른 달 결제의 환불이 섞일 수 있음을 머리 줄에 적는다.
- **수동 처리 환불**: RB-10 9-3 처럼 `external_method IS NOT NULL` 을 별도 줄로.
- **경고**: 기간 끝 기준 `manual_review`·`cancel_pending` 주문 수, 완료 전 부분취소 수.

### 3-2. 크레딧 흐름(C) (2판: 전면 고침)
| 줄 | 정의 | 시각 |
|---|---|---|
| 지급 | `credit_sources.initial_credits`, 분류별(요금제 구매·관리자 지급·자료 환불 재지급·보너스·옛 분류) | `created_at` |
| 자료 환불 되돌림 | `allocated_items` 의 `restored` 합(원래 출처 잔량을 되살림 — 지급이 아님) | `processed_at` |
| 자료 환불 재지급 | `allocated_items` 의 `reissued` 합 | `processed_at` |
| 자료 환불 못 돌려줌 | `allocated_items` 의 `unrecovered` 합(따로 한 줄) | `processed_at` |
| (옛 행) | `allocated_items` 가 없으면 `approved_refund_credits` 를 '되돌림(옛 방식, 나눔 없음)' 한 줄로 두고 표시 | `processed_at` |
| 자료 구매 사용 | **원장 기준**: `type='consume' AND resource_type LIKE 'market_purchase%'` 금액 합. 과목·구매 방식 나눔은 주문 표(`charged_credits`)로 하고, 두 합의 차이를 '주문 행 없는 사용' 줄로 보인다 | 원장 `created_at` |
| 충전 환불 회수 | 원장 `type='refund' AND resource_type='refund_request'` 음수 행 합(자동·수동 모두, 실제 회수한 양). 원천 분류별 | 원장 `created_at` |
| 관리자 회수 | `admin_audit_log` `credit_revoke` 의 `amount`. 원장 회수 행 수와 같은지 경고 | `created_at` |
| 만료 소멸 | `expires_at` 이 기간 안인 출처(상태 무관)의 **만료 시점 잔량** = 지금 `remaining_credits` + 수동 충전 환불 정리분(`payment_admin_actions.details->'sources'` 의 `expired_cleared`, source_id 기준). 탈퇴로 정리된 만료 잔량은 출처별로 읽을 수 없어 이 줄에 넣지 않고 아래 줄로 따로 (4판) | `expires_at` |
| 탈퇴 때 정리된 만료 잔량 | 작업 기록 `member_withdraw` 의 `details.expired_cleared` 합(**탈퇴 처리 시각 기준**, 출처의 만료 시각 기준이 아님 — 그만큼 지난 기간 '만료 소멸'이 줄어 보일 수 있다고 머리 줄에 적음) (4판) | `admin_audit_log.created_at` |
| 탈퇴 소멸 | 원장 `type='withdrawal_forfeit'` | 원장 `created_at` |
| 생성 기능 사용 | 원장 `consume` 중 자료 구매 외(꺼진 기능). 0 이 아니면 경고 | 원장 `created_at` |
| 잔액 | **내려받는 시각** `status IN ('active','pending_refund')`·만료 전 `remaining_credits` 합. `pending_refund` 분은 따로 | 생성 시각 |
- 대조 경고: '재지급 합 = 같은 기간 `market_refund_reissued_sources` 로 이어진 출처의 `initial_credits` 합', '원장 consume 합 = 주문 표 합'.
- 크레딧 표는 **운영 참고**라는 줄을 머리에 둔다(문구는 DB, 4-2). 과거 잔액은 다시 만들 수 없어 기간 흐름이 잔액으로 맞아떨어지는 표는 만들지 않는다.

### 3-3. 사용분 참고 금액(원) (2판)
- 출처마다 유상 뿌리를 찾는다. 방법은 `credit_source_paid_root` 와 같은 규칙(재지급 → `market_refund_reissued_sources.original_source_id` 를 거슬러 올라감)을 **함수 안 재귀 CTE 로 직접** 쓴다(helper 를 부르지 않음, 4-1). (3판) 뿌리가 plan_purchase 이면 단가 = 뿌리 주문 `expected_amount ÷ 뿌리 initial_credits`(원 결제 금액 기준 고정 — 뒤의 전액·부분 환불과 무관).
- **총사용**: `credit_consumption`(resource_type LIKE 'market_purchase%')의 출처별 amount × 단가(차감 시각 기간). C 합이 원장 '자료 구매 사용'과 같다. 과목·구매 방식 나눔에만 주문 표를 쓴다. (3판)
- **환불 차감**: `allocated_items` 의 출처·양 × 같은 출처 단가(환불 처리 기간, 음수). 옛 행은 그 주문 `credit_consumptions` 비율로 나눈다.
- **순사용** = 총사용 − 환불 차감. 원 미만 버림, 끝수 줄 따로.
- 주문 행이 없는 사용도 출처는 `credit_consumption` 으로 알 수 있어 참고 금액에 넣고, 과목·구매 방식만 '알 수 없음'으로 둔다. (3판)

### 3-4. 11월 대조 예시(운영 읽기, 2026-11-26 기준) (2판)
| 항목 | 값 |
|---|---|
| 결제(9-1) | 5건 60,600원, 부가세 5,509원, 공급가액 55,091원 — 네이버페이 3건 49,700원(4,518), 신용·체크카드 2건 10,900원(991) |
| 환불(9-2) | 1건 1,000원(고객 요청, 결제사 취소 시각 있음), 환불 부가세 91원 = 원 주문 부가세 |
| 순액 | 59,600원(부가세 5,418원, 공급가액 54,182원) |
| 수동 처리 환불(9-3)·수동 확인 주문 | 0건 |
| 크레딧 지급 | 요금제 구매 63,100 C(5건, 1건은 환불), 관리자 지급 10,200 C(4건) |
| 자료 구매 사용 | 원장 48,000 C, 주문 표 43,000 C(차이 5,000 C, 11-10 두 건) |
| 자료 환불 | 2건 5,000 C(옛 방식 행), 원장 되돌림 +5,000 C |
| 충전 환불 회수 | −100 C / 관리자 회수 200 C(3건) |
- 구현 뒤 리허설 R2 와 화면 첫 확인에서 이 표와 같아야 한다(12월 1일 이후 다시 읽으면 11월 늦은 환불 등으로 바뀔 수 있음 — 그때 RB-10 SQL 로 다시 뽑아 비교). 크레딧 줄은 그 사이 비결제 회원 탈퇴가 있으면 줄 수 있다. (3판)

### 3-5. 기간
- 한국 날짜(시작·끝 포함) 또는 달. `getKstDateStart`(`src/lib/kst-period.ts`)로 `[시작 00:00 KST, 끝 다음 날 00:00 KST)`. 최대 366일. 미래는 지금까지.

## 4. DB 변경(마이그레이션 `<버전>_bundle23_sales_report.sql`, 버전은 적용 순서에 맞춰 정함)
표를 만들지 않는다.
### 4-1. 함수
모두 `LANGUAGE sql(또는 plpgsql) STABLE SECURITY INVOKER SET search_path = public, pg_temp`. **운영 helper(`credit_source_paid_root`·`credit_source_reissued_descendants`)는 부르지 않는다**(EXECUTE 가 postgres 에만 있어 service_role 로 부르면 실패). 필요한 규칙은 함수 안 재귀 CTE 로 직접 쓴다. helper 에 GRANT 를 더하거나 DEFINER 로 바꾸지 않는다. (3판)
- **탈퇴 보관함 `withdrawn_member_records` 도 읽지 않는다.** 이 표에 service_role GRANT(표·열 모두)를 더하지 않는다. 네 함수가 읽는 표는 모두 service_role SELECT 가 이미 있는 표(payment_orders·refund_requests·payment_methods·payment_provider_transactions·payment_admin_actions·credit_sources·credit_transactions·credit_consumption·market_purchase_orders·market_refund_requests·market_refund_reissued_sources·admin_audit_log·profiles)뿐이다. 새 DEFINER 함수는 두지 않는다. (4판)
- 권한: `REVOKE ALL … FROM PUBLIC, anon, authenticated` 뒤 `GRANT EXECUTE … TO service_role`(운영 `pg_default_acl` 이 새 함수에 anon·authenticated EXECUTE 를 줌). 기간 367일 넘으면 예외. 호출 쪽 `statement_timeout` 20초.
- `report_charge_daily(p_from, p_to)` → 한국 날짜별 결제 건수·금액·부가세, 환불 건수·금액·부가세, 결제수단별·요금제별 금액(jsonb). 0 채움. 환불 금액 빈 행이면 예외 `REFUND_AMOUNT_MISSING`. **충전(원)만 담는다**(21번이 `reports.view` 구역에서만 부름). (2판)
- `report_payment_lines(p_from, p_to)` → 건별. **열 허용 목록**: 구분(결제/환불), 주문번호 `order_id`, 결제요청번호, 결제수단 코드·이름, 요금제 이름, 주문 상태, 금액, 부가세, 공급가액, 결제 시각, 환불 시각, 환불 경위 `origin` 코드·이름, 처리 방식 `external_method` 코드·이름. **넣지 않는 칸**: `reason`·`admin_note`·`note`·`details`·`before_state`·`after_state`·`partner_user_id`·`payment_key`·`user_id`·이메일·전화·IP. (2판)
- `report_credit_flow(p_from, p_to)` → 3-2 줄별 합계(분류·과목별 행)와 대조 경고.
- `report_credit_usage_value(p_from, p_to)` → 3-3 총사용·환불 차감·순사용(뿌리 분류별 C·원).
### 4-2. 설정 행(데이터)
- `system_settings` 키 `sales_report_content`(INSERT … ON CONFLICT DO NOTHING): 머리 문구·화면 안내·`definitionVersion: 1`. 초안이고 대표가 고친다.
- **이 행은 로그인 회원 누구나 읽을 수 있다**(운영 정책 `Authenticated users can view system settings`). 내부 절차·계좌·담당자 같은 정보는 넣지 않는다. 화면 안내는 '페이앱 정산 자료와 맞춰 보세요 · 절차는 런북 RB-10' 수준만 두고, 대표 편집 카드에도 같은 안내 줄을 둔다. (3판)
- RESTRICTIVE 정책 `system_settings_sales_report_content_no_client_write`(15번 방식). 표 잠금이라 새벽에 짧게(`lock_timeout = '3s'`).
### 4-3. VERIFY·되돌리기
- VERIFY: 함수 4개·INVOKER·search_path·EXECUTE 는 service_role 만, `report_payment_lines` 반환 열 = 허용 목록, 정책 1개, 설정 행 필수 키.
- 되돌리기 `supabase/rollback/<버전>_bundle23_sales_report_down.sql`(코드 먼저, 21번 코드가 쓰면 21번부터): 함수·정책 DROP, 설정 행 DELETE.
### 4-4. 리허설(운영, `BEGIN … ROLLBACK`, 반복 가능, 15번 11-2 원칙)
| 경우 | 기대 |
|---|---|
| R1 | 적용 → 되돌리기 → 남는 것 0 → 다시 적용 |
| R2 | 2026-11 결과 = 3-4 표 = RB-10 9-1·9-2·9-3 |
| R3 경계 | 가짜 주문(되돌림): 11-30 23:59:59 KST → 11월, 12-01 00:00 → 12월, 11월 결제·12월 환불, test·manual_review·failed 제외, 빈 환불 금액 → 예외 |
| R4 크레딧 | 가짜 출처·주문: 미사용 자동 환불, **사용분 있는 수동 환불**(회수 = 잔량만), **자손 회수**, **부분 환불**, 만료(기간 안/밖), **만료 뒤 수동 환불로 0 된 출처**(expired_cleared 로 복원), restored·reissued·unrecovered 가 섞인 자료 환불, 유상·무상·재지급 뿌리가 섞인 참고 금액·끝수, **주문 없는 옛 plan_purchase 출처(단가 알 수 없음)**, **결제 회원 탈퇴로 0 된 만료 출처(만료 줄에서 빠지고 '탈퇴 때 정리된 만료 잔량' 줄에 탈퇴 시각으로 잡힘)** (4판), 주문 행 없는 사용 (3판) |
| R5 | **네 함수 모두 `SET LOCAL ROLE service_role` 로 실행해 성공**(postgres 권한으로만 돌리면 helper·보관함 권한 문제를 못 잡음). 기간 안에 가짜 탈퇴 작업 기록(`member_withdraw`, `expired_cleared` 있음)을 넣어 그 경우도 service_role 로 성공. anon·authenticated 거절 (3판·4판) |
| R6 | 366일 실행 시간, 367일 예외 |

## 5. 코드 변경
### 5-1. 공통
- `src/lib/sales-report.ts`(순수): 기간 해석, 열 정의(열마다 형식: 문자열·정수·시각), CSV 만들기(BOM, `\r\n`, 따옴표 감싸기), 합계 검산, 파일 이름.
  - **수식 주입 막기** (2판): **모든 문자열 칸**(머리 줄·열 제목·DB 문구·결제수단·요금제 이름 포함)이 `=`·`+`·`-`·`@`·탭·CR 로 시작하면 앞에 `'`. 숫자 칸은 열 정의가 정수인 것만 숫자로 내보낸다(음수 순액 `-1000` 은 숫자 그대로).
- `src/lib/sales-report-server.ts`(server-only, 서비스 키): 함수 호출, 경고 모으기, 설정 문구(없으면 예외).
- 요청 정보: 13번 `adminRequestMeta` 가 아직 없으면 이 묶음에서 `withdrawalRequestMeta` 를 `adminRequestMeta`(`src/lib/admin-request-meta.ts`, `Request`·`headers()` 둘 다 받음, 13번 계획과 같은 이름·모양)로 옮겨 만든다. 13번이 먼저면 그대로 쓴다. (2판)
### 5-2. 기본 CSV route
- `GET /api/admin/reports/export?kind=summary|payments|credits|usage&from=&to=`, `requireAdminApiPermission('reports.view')`, `Cache-Control: no-store`.
- 순서: 쿼리 → 파일 만들기 → sha256 → 작업 기록(실패면 500, 파일 없음) → 응답.
### 5-3. 회원 칸 판(Q3-나를 고를 때만) (2판)
- `kind=payments_with_member`, **`POST` 전용(사유는 본문, GET 으로 오면 405 — 사유가 URL·요청 기록에 남지 않게)**, `requireAdminApiPermission('owner')`, 사유 1~200자 필수. (3판) 13번 M0 가 운영에 없으면 화면에 없고 route 는 409.
- 순서: 쿼리 → 회원 id 모으기(탈퇴 회원 제외, 이메일 칸 비움) → `recordMemberAccess({ screen: 'export', memberIds, fields: ['email'], reason })` 를 200명씩(`context.part`) → 하나라도 실패하면 500, 파일 없음 → 작업 기록 → 응답.
- 이 판을 고르면 01-11 시행 처리방침 2절 열람 기록 정의('이메일·휴대폰 번호를 보여 주는 관리자 화면을 열 때')가 내려받기를 포함하는지 **12-10 게시 전**에 확인한다(게시 뒤 문구 잠김).
### 5-4. 화면·메뉴
- `src/app/(admin)/admin/reports/page.tsx`(`requireAdminPagePermission('reports.view')`) + 클라이언트, 20번 부품.
- 사이드바 '주문·결제' 묶음에 `/admin/reports`, `ADMIN_SIDEBAR_MENU_REQUIREMENTS` 에 `'reports.view'`.

## 6. 화면 `/admin/reports`
- 위: 기간(이번 달·지난달·직접), 정의 판, '한국 시간 기준'.
- 경고 띠: 수동 확인·취소 처리 중 주문, 부분취소 처리 전, 환불 금액 빈 행('확인 불가', 내려받기 막음), 주문 행 없는 사용, 만료 과소 집계 가능, 생성 기능 사용.
- 요약 표: 결제 기준(결제·환불·순액 × 부가세 포함·부가세·공급가액, 결제수단별), 크레딧 흐름(3-2), 참고 금액(3-3).
- 내려받기 4개. 누르면 공통 확인 창("기간 ○○의 ○○ CSV 를 내려받습니다. 내려받은 기록이 남습니다.").
- '페이앱 정산 자료와 맞춰 보기' 안내(4-2 수준 한 줄, DB 문구 — 9-4 절차 요약은 넣지 않음, 절차는 런북에서 봄). (4판) 대표에게만 머리 문구 편집 카드.

## 7. 개인정보 최소화
- 기본 CSV 4종은 4-1 허용 목록 열만 있다. 회원 자유 글(환불 사유·메모)은 넣지 않는다 — 파일로 나간 글은 10번 가림이 미치지 않는다. (2판)
- 주문번호는 다른 표와 이으면 회원을 찾을 수 있으므로 권한자만 받고 기록이 남는다.
- 파일은 서버에 저장하지 않는다. 런북 RB-10 에 적는다: 기본 CSV 는 **결제 기록 보관 기간(처리방침, 5년)이 끝나면 파기**, 회원 칸 판은 **대조가 끝나면 바로 지움**. (2판)

## 8. 작업 기록 종류(`src/lib/admin-audit-log.ts`)
| 종류 | 이름 | 남기는 곳 | details |
|---|---|---|---|
| `sales_report_export` | 매출·정산 CSV 내려받기 | route(파일 주기 전) | 종류, 기간, 정의 판, 줄 수, 합계 몇 개, sha256, request |
| `sales_report_content_update` | 매출 CSV 안내 문구 수정 | 서버 액션 | 바뀐 칸, 글자 수 |
- 13번 보관 정책에서 2년 쪽(결제 처리가 아니라 조회).

## 9. 시험
- `tests/bundle23-sales-report.test.mjs`(순수): 기간(월·날짜·윤년·연말·366일·미래), CSV(BOM·감싸기), 수식 주입(`=HYPERLINK` 결제수단 이름, '-' 로 시작하는 머리 문구, CR, 음수 순액은 숫자), 요약 = 건별 합, 참고 금액 끝수.
- 계약: 가드(`reports.view`, 회원 판 owner), 사이드바·가드 표 시험 갱신, 작업 기록이 응답보다 먼저, `no-store`, **`report_payment_lines` 반환 열 = 허용 목록**(금지 칸 이름 목록을 시험에 적음), 회원 판 기록 순서(기록 실패 → 파일 없음), **회원 판 GET → 405**, 함수 권한 회수 줄, **4-1 함수 본문에 `credit_source_paid_root`·`credit_source_reissued_descendants`·`withdrawn_member_records` 없음**, 마이그레이션에 `withdrawn_member_records` GRANT 없음. (3판·4판)
- 리허설 4-4.

## 10. 검증 관점(계획·구현 모두 PASS 까지)
**결제 DB 전문 검증 3명** + 개인정보 1명.
1. 결제·환불 정의: RB-10 과 같은 식인가, 부분취소·수동 처리·manual_review, 부가세, 3-4 숫자
2. 크레딧 흐름: 회수·되돌림·재지급·만료 복원·두 번 셈 없음, 뿌리 단가
3. 마이그레이션·권한: 함수 권한·INVOKER·열 허용 목록·되돌리기·리허설
4. 개인정보: 열 허용 목록, 회원 판 기록 순서, 파일 파기, 처리방침 문구

## 11. 배포 순서
1. 계획 검증 PASS → 0절 답 반영. 이 PASS 커밋에서 **13번 계획 701행**('CSV 는 사유·열람 기록 export')을 '회원 칸 판에만'으로 함께 고친다(조정자 승인 뒤, 그 한 줄만). (3판)
2. 구현 → 계약 시험 → 구현 검증 PASS
3. 리허설 → **DB 적용**(새벽 짧게, 승인)
4. 로컬 확인(나 → 대표, 내려받으면 작업 기록 1행이 생김을 미리 알림) → push·배포
5. 11월분을 3-4·RB-10 과 맞춰 봄 → 런북 RB-10 에 'CSV 로 대조'·파일 파기 줄 → 대표가 필요한 직원에게 `reports.view`
6. 21번이 같은 함수를 쓰도록 이어감
- 마감: 12월분 대조(2027-01 첫 주) 전.

## 12. 열린 질문
1. 11-10 자료 구매 두 건(2,000·3,000 C): 시험 계정의 실제 차감이고 주문·이용권 행만 지워진 흔적으로 보인다(1절). 정의는 원장 기준 + '주문 행 없는 사용' 경고로 유지한다. 지운 사람·때를 확인할지 대표가 정한다(기본: 확인하지 않음, 시험 계정이라 출시 전 정리 대상). (3판)
2. 비결제 회원 탈퇴가 크레딧·자료 구매 기록을 지워 지난 기간 크레딧 흐름이 줄어드는 것을 받아들일지(기본: 받아들이고 머리 줄로 알림. 결제 기준 표는 영향 없음). (3판)
3. Q1 세무사 답이 오면 머리 문구·참고 금액 표 이름을 바꿀지.
4. 1,000원 시험 결제(11-11, 환불 완료)는 실결제라 11월 숫자에 들어간다. 그대로 둔다(기본).

## 13. 범위 밖
- 월 마감 고정 표, PG 수수료 계산, 세금계산서, 페이앱 자료 자동 가져오기, 24번 백업 스크립트.

## 14. 1판 검증 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| 돈 major | 충전 환불 회수를 initial_credits 로 셈 | 3-2 원장 `refund_request` 음수 행(실제 회수량), 1절 사실, R4 경우 |
| 돈 major | 만료 소멸을 조회 시점 잔량으로 셈 | 3-2 만료 시점 잔량 = 지금 + `expired_cleared`, 탈퇴 정리 경고, 1절 사실 고침, R4 |
| 돈 major | 자료 환불 = 재지급으로 둠 | 3-2 restored·reissued·unrecovered·옛 행 줄, 대조 경고 좁힘, 1절 사실 |
| 돈 major | 재지급을 무상으로, 환불된 사용을 사용으로 | Q6·3-3 유상 뿌리·총사용/환불 차감/순사용 |
| 돈 minor | 잔액에 pending_refund 빠짐 | 3-2 잔액 줄 |
| 보안 major | 건별 '경위' 칸이 자유 글을 실을 수 있음 | 4-1 열 허용 목록·금지 칸, 7절, 9절 열 비교 시험 |
| 보안 minor | 회원 판 기록 순서·200명 나눔·실패 시 거부·파기·처리방침 | 5-3, 7절 |
| 보안 minor | 13번 701행과 규칙 불일치 | Q3 명시, 13번 담당 고침 요청 |
| 보안 minor | 수식 주입 범위·CR·음수 | 5-1, 9절 |
| 보안 minor | `adminRequestMeta` 없음·파일 파기 기준 | 5-1, 7절 |
| (지시) | RB-10 과 정확히 맞추기·11월 예시 | 3-1 RB-10 식 그대로, 3-4 대조 표, 11월 원장·주문 5,000 C 차이 발견(12절 1) |

## 15. 2판 검증 반영 (3판)
| 관점 | 지적 | 반영 |
|---|---|---|
| 보안 major | 참고 금액이 service_role 로 부를 수 없는 helper 를 씀 | 4-1 helper 금지·재귀 CTE·GRANT/DEFINER 금지, 3-3, R5 `SET LOCAL ROLE service_role`, 9절 |
| 보안 minor | 설정 행을 회원이 읽을 수 있음 | 4-2 내부 정보 금지 안내 |
| 보안 minor | 회원 판 사유가 GET URL 에 실림 | 5-3 POST 전용·GET 405, 9절 |
| 보안 minor | 13번 701행 고치는 단계 없음 | 11절 1 |
| 돈 minor | 참고 금액 총사용을 주문 표로 셈 | 3-3 `credit_consumption` 기준, 1절 사실, 12절 1 증거 |
| 돈 minor | 탈퇴 만료 정리 기록이 있음·비결제 탈퇴가 기록을 지움 | 1절, 3-2 만료 식, 목표 2·3-4 단서, 12절 2 |
| 돈 minor | 주문 없는 옛 plan_purchase 단가 | Q6, R4 |

## 16. 3판 검증 반영 (4판)
| 관점 | 지적 | 반영 |
|---|---|---|
| 보안 major | 만료 소멸 식이 service_role 도 못 읽는 탈퇴 보관함을 읽음 | 4-1 보관함 읽기·GRANT 금지(읽는 표 목록 고정), 3-2 탈퇴 정리분은 작업 기록 `member_withdraw` 합계를 탈퇴 시각 줄로, 1절 사실, R4·R5·9절 |
| 보안 minor | 6절 안내가 9-4 요약을 넣으라 함 | 6절을 4-2 수준 한 줄로 |


## 17. 구현 메모 (2026-11-27)
**만든 것**
- 마이그레이션 `supabase/migrations/20261222100000_bundle23_sales_report.sql`(19번 뒤 버전), 되돌리기 `supabase/rollback/20261222100000_bundle23_sales_report_down.sql`.
- 리허설 `supabase/scripts/bundle23_rehearsal/`(generate.mjs → a_light.sql·b_full.sql, `--check` 로 최신 여부 확인).
- 코드: `src/lib/sales-report.ts`(순수), `src/lib/sales-report-server.ts`, `src/app/api/admin/reports/export/route.ts`, `src/app/(admin)/admin/reports/`(page·client·actions), 사이드바 '주문·결제' 묶음 `/admin/reports`(`reports.view`), 작업 기록 종류 2개.
- 시험: `tests/bundle23-sales-report.test.mjs`(순수·계약 11건), 가드 표·사이드바·기능 묶음 시험에 새 화면·route·액션 줄.

**리허설 결과** — light 를 운영에서 실행(BEGIN…ROLLBACK, 2026-11-27): R1~R6·Z 모두 통과.
- R2: 11월 = RB-10 9-1·9-2·9-3 다시 계산 = 3-4 표(결제 5건 60,600원·부가세 5,509·공급가액 55,091, 네이버페이 3건 49,700(4,518)·카드 2건 10,900(991), 환불 1건 1,000원·부가세 91, 순액 59,600·순 부가세 5,418, 수동 처리·수동 확인 0, 지급 요금제 63,100 C(5)·관리자 10,200 C(4), 원장 사용 48,000·주문 표 43,000·차이 5,000, 옛 방식 자료 환불 2건 5,000, 충전 환불 회수 100, 관리자 회수 3건 200). 12월 1일 뒤 다시 돌리면 실데이터가 바뀌어 3-4 고정값 줄이 실패할 수 있다(그때 RB-10 줄은 그대로 맞아야 한다).
- R5: 네 함수 모두 `SET LOCAL ROLE service_role` 로 성공(가짜 `member_withdraw` 기록이 든 기간 포함), service_role 은 회원 보관 표를 여전히 못 읽음, anon·authenticated 는 EXECUTE 거절.
- R6: 366일 네 함수 30ms, 367일·거꾸로 된 기간은 `SALES_REPORT_PERIOD_INVALID`.
- full(b_full.sql)은 돌리지 않았다(정책 만들기가 표 잠금 — DB 적용 직전 새벽에).

**계획에서 정한 것(구현 판단)**
- `report_charge_daily` 는 표 대신 jsonb `{days[], warnings{}}` 를 돌려준다(3-1 경고 — 수동 확인·취소 처리 중 주문, 완료 전 부분취소, 전액 환불 부가세 불일치, 환불 요청 없는 수동 처리 기록 — 를 같은 함수에서 내려고). 날짜별 결제수단·요금제·환불 경위·환불 결제수단 나눔도 그 안에 있다. `report_credit_flow`·`report_credit_usage_value` 도 jsonb, `report_payment_lines` 만 RETURNS TABLE(VERIFY 가 열 목록을 본다).
- 건별 환불 줄의 금액은 양수(구분 칸 '환불'), 결제 시각 칸에는 원 주문 승인 시각을 넣어 다른 달 결제의 환불을 알아보게 했다. 결제요청번호 = `payment_provider_transactions.provider_transaction_id`(RB-10 9-4 와 같음). 경위·처리 방식 이름은 코드 이름표(`admin-orders.ts`), 결제수단 이름은 DB `payment_methods.label`.
- 만료 소멸은 `expires_at` 이 [시작, min(끝, 지금)) 인 출처만 센다(아직 만료되지 않은 잔량을 소멸로 세지 않게).
- 참고 금액 환불 차감은 `allocated_items` 의 restored + reissued(실제로 돌려준 양)만 뺀다 — unrecovered 는 사용으로 남긴다. 옛 행은 주문 `credit_consumptions` 비율로 내림 나눔, 나머지는 첫 출처에. 분류별 원은 버림, 합계 원 = 분류별 합, 끝수 = 정확한 합 − 그 합.
- 관리자 회수 대조는 원장 `type='refund' AND resource_type IS NULL AND amount<0` 행 수와 비교한다(관리자 회수 함수가 넣는 모양).
- 호출 제한 20초는 서버 키 호출의 `abortSignal(AbortSignal.timeout(20s))` 로 했다(함수 안 statement_timeout 은 이미 시작한 문장에 걸리지 않는다).
- CSV 는 summary·payments 를 만들 때마다 요약 = 건별 합을 맞춰 보고, 어긋나면 409(파일 없음). 완료 환불 금액이 비면 409·화면은 결제 기준 '확인 불가'(크레딧·참고 금액은 그대로 보임).
- 회원 칸 판(5-3)은 Q3 기본안대로 만들지 않았다(13번 열람 기록에 기대는 길 없음 — 13번 운영 미적용과 무관하게 배포 가능).

**남은 것**
- 구현 검증(10절 4관점) → full 리허설(새벽) → DB 적용(승인) → 로컬 확인(나 → 대표, 내려받으면 작업 기록 1행) → push.
- 13번 계획 701행 문장 고치기(11절 1, 조정자 승인 뒤), 런북 RB-10 'CSV 로 대조'·파일 파기 줄(11절 5, 배포·11월 대조 뒤).
- 메뉴 이름 '매출·정산'과 설정 행 문구는 초안(대표가 관리자 화면에서 고침).

**구현 검증 반영(3관점 PASS, minor 5건, 2026-11-27)**
- 참고 금액 'paid'(원 단가)는 실결제 주문만(`provider_environment='live'` + `completed`·`refunded`). 그 밖의 주문에 이어진 요금제 구매 출처는 `paid_test`(시험·미완료 결제, 0원) + 경고 `test_payment`.
- 결제 경고 `fulfillmentPendingOrders`(지급 대기 — 승인 시각이 지급 때 채워져 지난 기간에 소급해 들어감) + 화면·CSV 경고 줄 + 런북 RB-10 9-1 한 줄.
- 수식 주입: 앞쪽 공백·줄바꿈(전각 공백 포함)을 건너뛴 첫 글자와 전각 ＝＋－＠ 도 막는다.
- 기간 고르기 입력칸은 주소 기간이 바뀌면 다시 맞춘다(key).
- down 에 정책 남음 검사(DDL 구역 안이라 light 사본은 함께 뺌).
- light 리허설 운영 재실행: R1~R6·Z 통과(R2 11월 값 그대로, R3 지급 대기 경고, R4 시험 결제 출처 0원·경고 추가).
