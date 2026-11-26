# 21번 묶음 계획 · 대시보드(기간 선택·지표 카드·그래프·판매 순위·상품 현황)

작성일: 2026-11-26
판: 3 (검증 PASS, 2026-11-26) — PASS 뒤 minor 3개를 같은 판에서 반영함(16절, 문단 끝 `(PASS 뒤)`)
- 2판은 권한·데이터 PASS, 화면 FAIL(major 2: 주소에 프리셋이 없음, 자료 판매 함수 행 수가 PostgREST 1,000행 상한을 넘음)이었다. 반영은 15절 표, 고친 곳은 `(3판)`.
- 1판은 권한·데이터, 화면 두 관점 모두 FAIL(major 5, 겹친 것을 합치면 3)이었다. 반영은 14절 표에 있고, 고친 문단 끝에 `(2판)` 을 붙였다.
- 작업 순서표 6단계 21번 '대시보드'(기간 선택, 지표 카드, 그래프 — **매출 그래프는 대표가 준 권한이 있는 계정만**, 판매 순위, 상품 현황)를 만든다.
- 출처: `docs/admin-ux-improvement-plan.md` 3절·1차-다(A-01~A-11)·8절, 운영 개선 계획 U2-2·U0-7.
- 충전(원) 숫자는 **23번 계획 3-1 정의와 `report_charge_daily`** 를 쓴다. 자료 판매·활동·순위는 이 묶음의 원 없는 함수가 맡는다(5절). 화면 부품은 20번 0단계.
- 조회만 한다.

## 0. 대표 결정과 질문
**이미 정해진 것(2026-11-20)**: 매출 그래프는 대표가 권한을 준 계정만. 테스트 계정은 출시 전에 지움(집계 제외 표시 없음). 기본 과목 '전체'(A-09).

**질문** — 답이 오기 전에는 기본안으로 진행한다.

Q1. '별도 권한'의 키
- 기본안: **이미 있는 `reports.view`**(`orders.view` 함께 필요). 받은 직원 0명이라 지금 바뀌는 사람 없음.

Q2. 원·크레딧 숫자를 모두 `reports.view` 로 옮길지
- 기본안: **옮긴다.** 순 충전 매출, 충전 그래프, 요금제별 결제액, 자료 판매 C, 도넛(C), 판매 순위의 C 열.
- `orders.view` 만 있는 직원: 자료 판매 건수·건수 추이, 다운로드, 순위(건수만), 최근 주문 목록.
- 주의: 지금 `orders.view` 직원 1명이 이번 달 충전 결제액을 본다. 옮기면 사라진다. **대표 확인 필요.**

Q3. 기간과 비교 기간 (2판)
- 기본안: 오늘·7일·**30일(기본)**·이번 달·지난달·직접 지정(최대 366일). 정확한 범위는 4-2 표.
- 오늘이 들어간 기간은 **같은 경과 시간끼리** 비교한다. '이번 달'은 '지난달 1일 ~ 같은 날 같은 시각'과 비교한다(대표 확인).

Q4. 그래프 도구
- 기본안: **Recharts 3.x**(React 19.2 와 맞는 판). 설치 때 나온 지 2주 넘은 정확한 판으로 `^` 없이 고정하고, 대시보드에서만 늦게 불러온다. (2판)

Q5. 충전 환불 시각
- 기본안: 23번 정의(RB-10 9-2, `COALESCE(provider_cancelled_at, processed_at)`)로 바꾼다. 지금 대시보드는 `processed_at`.

Q6. 자료 판매 계산
- 기본안: **주문 표 기준**(과목·구매 방식이 있는 기록). 구매 시각 기준 `charged_credits`(뒤에 환불된 것 포함) − 처리 시각 기준 자료 환불 C = 순 사용 C. 카드 **큰 값 = 순 사용 C**(11월 38,000 C), 보조 줄 = '구매 n건 X C · 환불 m건 Y C'(11월 '구매 16건 43,000 C · 환불 2건 5,000 C'). 건수 카드 큰 값 = 구매 건수. (PASS 뒤) 회수 건수는 주문 표에 회수 시각이 없어 이번 판에서 뺀다. (3판)
- 23번 CSV 의 '자료 구매 사용'은 원장 기준이라 다를 수 있다(11월 5,000 C, 23번 12절 1). 카드 말풍선에 이 사실을 적는다. (2판)

Q7. 다운로드 카드
- 기본안: '구매 파일 다운로드'(운영 기록 17건 모두 `asset_kind = 'subproduct_file'`, 샘플은 기록 안 됨).

## 1. 지금 상태(코드·운영 DB 확인, 2026-11-26)
- **화면**: `src/app/(admin)/admin/page.tsx` → `DashboardClient`(331줄). 클라이언트가 마운트 때 `useEffect` 로 `/api/admin/stats` 를 부른다(62~64행). 새로고침 때 화면 전체가 뼈대로 바뀐다(A-07).
- **route** `src/app/api/admin/stats/route.ts`: 가드 `'admin'`. 가입 수를 **세션**으로 센다(13번 8-2 가 서버 키로 바꿈). 기간은 오늘·이번 달 고정.
- **집계** `src/lib/admin-dashboard-server.ts`: `orders.view` 면 이번 달 행을 끝까지 읽어 충전 결제(`approved_at`)·충전 환불(`processed_at`)·마켓 판매(지금 유효한 구매만, `refunded_credits` 뺌)·다운로드를 따로 계산한다(한쪽 실패가 다른 쪽에 번지지 않음). 최근 충전 주문 5건·최근 문의 5건(이메일 포함).
- **처리 대기·알림**: `getAdminWorkSummary`, `useAdminAlerts`, `PaymentSalesPanel`(대표 전용 [충전 판매 중지]).
- **권한**: `reports.view` 받은 직원 0, staff 1명은 `orders.view`·`members.view` 등 보유.
- **DB 사실**: 실결제 11월 5건 60,600원·환불 1건 1,000원(23번 3-4). 자료 주문 16건(`purchase_type` subproduct 15·bundle 1, 모두 국어). `market_refund_requests.workspace_subject` 있음. 상품: 국어 공개 147·숨김 1, 영어 공개 1. `draft·is_active=false` 0개. 18번 자동 업로드 임시 상품은 `draft_source='auto_upload'`(`src/lib/market-item-cleanup.ts` 가 정리).
- **회원 화면의 '공개' 조건**: `status='published' AND is_active AND deleted_at IS NULL`(`src/lib/market-categories-server.ts:53,165`). (2판)
- **시험**: `admin-dashboard-contract`, `admin-dashboard-u2-2-contract`, `admin-work-summary-permissions`.

## 2. 목표
1. 기간·과목을 고르면 카드·그래프·순위가 그 기간으로 바뀌고 주소에 남는다.
2. 원·C 숫자는 `reports.view` 계정에만 간다. **서버가 권한별 허용 필드만 응답에 싣는다.**
3. 같은 기간의 순 충전 매출이 23번 CSV 요약과 원 단위까지 같다.
4. 첫 화면은 서버에서 그린다. 새로고침 중에도 숫자가 남는다.
5. 데이터가 적어도 축·기준선과 빈 상태 문구가 보인다.
6. 처리 대기·판매 상태·슬랙 전송을 한 줄 상태 바로 합친다. 판매 중지 버튼은 그대로.
7. 충전 쪽 오류(예: 환불 금액 빈 행)가 자료 판매·활동 카드에 번지지 않는다. (2판)

## 3. 화면 배치(20번 부품)
- **① 제목줄**(`AdminPageHeader` 도구 칸): [전체·국어·영어], 기간, 새로고침 / 보조 줄 '마지막 갱신 15:12 · 한국 시간 기준'.
- **② 상태 바**: 0이 아닌 처리 대기 칩, 판매 상태, 대표만 [충전 판매 중지], 슬랙 전송. 판매 중지·결제 경보면 빨간 테두리.
- **③ 카드**(`AdminMetricCard`, 누르면 ④가 바뀜, 1~4장): 순 충전 매출(원) · 자료 판매(건 / C) · 신규 가입 · 구매 파일 다운로드.
- **④ 그래프**: 넓게 일별 추이(카드 따라 바뀜), 좁게 도넛(과목 × 구매 방식 C / 탭 '요금제별 결제액').
- **⑤ 상품**: 판매 상위 5개 / 탭 '다운로드 상위 5개', 상품 현황.
- **⑥ 최근 목록**: 탭 [최근 자료 구매 / 최근 충전 주문 / 답변 대기 문의(오래된 순, '대기 n시간')].
- 권한별로 보이는 것은 4-1 표. 볼 카드가 없으면 '볼 수 있는 지표가 없습니다(권한)'.
- 큰 값과 증감은 따로 실패한다: 앞 기간 조회만 실패하면 큰 값은 두고 증감 줄만 '확인 불가'. (2판)

## 4. 데이터
### 4-1. 권한별 출처와 허용 필드 (2판)
| 구역 | 권한 | 출처 | 응답에 싣는 필드 |
|---|---|---|---|
| 순 충전 매출 카드·충전 그래프·요금제별 탭 | `reports.view` | 23번 `report_charge_daily` | 결제·환불 건수·금액·부가세, 요금제별 금액 |
| 자료 판매 건수·건수 추이 | `orders.view` | `report_market_daily` | 날짜·과목별 구매 건수, 환불 건수 |
| 자료 판매 C·도넛·C 추이 | `reports.view` | `report_market_daily` | 위 + charged C, 환불 C, 과목 × 구매 방식 C |
| 신규 가입 | `members.view` | `report_activity_daily` | 가입 수 |
| 다운로드 | `orders.view` | `report_activity_daily` | 다운로드 수·회원 수 |
| 판매·다운로드 순위 | `orders.view`(C 열은 `reports.view`) | `report_market_item_ranking` | 상품 id·제목·과목·상태·건수(+C) |
| 상품 현황 | `products.edit` | 서버 키 한 번 조회 | 과목·상태별 개수, 최근 수정 3개 |
| 최근 자료 구매·충전 주문 | `orders.view` | 지금 조회 + 13번 `attachMemberContacts` | 지금 화면 값(금액 포함 — 주문 화면에서 이미 봄) |
| 답변 대기 문의 | `support.manage` | 지금 조회 + 13번 | 지금 화면 값 |
- `report_charge_daily` 는 `reports.view` 가 있을 때만 부른다. 그래서 `REFUND_AMOUNT_MISSING` 예외는 충전 구역만 '확인 불가'로 만든다.
- 여러 권한이 섞인 함수(`report_market_daily`·`report_activity_daily`·순위)는 서버의 **한 곳**(`pickDashboardFields(access, section, row)`)에서 허용 필드만 남긴 뒤 응답에 싣는다. **jsonb 안쪽까지 내려가** `orders.view` 만 있으면 `purchases`·`refunds` 의 각 칸에 `n` 만 남기고 `c` 를 지운다. (PASS 뒤)

### 4-2. 기간 프리셋과 비교 기간 (2판)
| 프리셋 | 기간 [시작, 끝) | 비교 기간 |
|---|---|---|
| 오늘 | [오늘 00:00, 지금) | [어제 00:00, 어제 같은 시각) |
| 7일·30일 | 오늘 포함 N일: [N−1일 전 00:00, 지금) | 같은 경과 시간: [시작 − N일, 지금 − N일) |
| 이번 달 | [1일 00:00, 지금) | [지난달 1일, 지난달 같은 날 같은 시각) — 지난달에 그 날이 없으면 지난달 끝 |
| 지난달 | 지난달 전체 | 그 앞 달 전체 |
| 직접 지정 | [시작일 00:00, 끝일 다음 날 00:00), 끝일이 오늘이면 지금까지 | 같은 길이 바로 앞(끝이 지금이면 경과 시간 맞춤) |
- 모두 한국 시간. 증감 줄에 비교 범위를 적는다('10-01~10-26 15:12 대비'). 그래프 마지막 날이 오늘이면 '오늘(진행 중)'.

### 4-3. 지표 정의
- **순 충전 매출**: 23번 3-1 결제 − 환불(부가세 포함). 보조 줄 '결제 n건 X원 · 환불 m건 Y원'. 충전에는 과목이 없어 '과목 무관'.
- **자료 판매**: Q6. 과목 필터 적용.
- **신규 가입**: `profiles.created_at` 기간 안, `is_admin` 아님. 탈퇴 회원도 가입 시점에는 셈. **과목 필터와 무관**(회원에 과목이 없음) — 충전처럼 '과목 무관' 표시. (3판)
- **구매 파일 다운로드**: `market_download_events.created_at` 기간 안, 과목 필터. 보조 줄 '다운로드한 회원 n명'.
- **판매 순위**: 기간 안 자료 구매(`completed·refunded·revoked`) 상품별 건수 → C → 상품 id. 숨김·삭제 상품도 상태 배지와 함께.
- **다운로드 순위**: 세는 방식은 홈 인기와 같다(상품별 다운로드한 회원 수). 대상은 판매 순위처럼 숨김·삭제 상품까지 넣고 상태 배지를 붙인다. (3판)
- **상품 현황**(지금 시각, 기간 무관) (2판): 공개 = 회원 화면 조건(`published AND is_active AND deleted_at IS NULL`), 숨김 = `hidden` + `published` 이지만 `is_active=false`, 보관 = `archived`, 임시저장 = `draft AND draft_source IS DISTINCT FROM 'auto_upload'`, **게시 대기 = 임시저장 수**. 삭제 상품 제외.

## 5. DB 변경(마이그레이션 `<버전>_bundle21_dashboard_reports.sql`, 버전은 적용 순서에 맞춰 정함 — 23번 뒤)
- 공통: `STABLE SECURITY INVOKER SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC, anon, authenticated` → `GRANT EXECUTE … TO service_role`, 기간 367일 초과 예외, `p_subject` 는 `english·korean·NULL`. 원(돈)·회원 개인정보를 돌려주지 않는다.
- `report_market_daily(p_from, p_to, p_subject)` (2판·3판)
  - **한국 날짜당 1행**(최대 367행, PostgREST 기본 1,000행 상한 아래). 과목 × 구매 방식 값은 jsonb 한 칸에 담는다.
  - 모양(PASS 뒤): 열 `day`, `purchases` = `{"korean":{"subproduct":{"n":13,"c":33500},"bundle":{"n":1,"c":4500}},"english":{…}}`(이전 방식은 `"legacy"` 키), `refunds` = `{"korean":{"n":2,"c":5000},…}`. `n` = 건수, `c` = 크레딧.
  - 구매: `market_purchase_orders.status IN ('completed','refunded','revoked')`, 구매 시각 `created_at`, 건수·`charged_credits`. 구매 방식은 subproduct·bundle, `legacy_backfill` 은 '이전 방식' 키로 따로(지금 0건).
  - 자료 환불: `market_refund_requests.status = 'approved'` 의 `approved_refund_credits`, 시각 `processed_at`, 과목 `workspace_subject`. 건수·C.
  - 회수 건수는 넣지 않는다(회수 시각 열 없음).
  - 0 채움.
- `report_activity_daily(p_from, p_to, p_subject)`: 한국 날짜별 가입 수, 다운로드 수·회원 수.
- `report_market_item_ranking(p_from, p_to, p_subject, p_metric, p_limit)`: `p_metric IN ('orders','downloads')`, `p_limit` 1~20.
- 23번 `report_charge_daily` 는 그대로 쓴다(요금제별 금액 포함, 23번 4-1).
- VERIFY: 함수 3개 권한·INVOKER. 되돌리기 `supabase/rollback/<버전>_bundle21_dashboard_reports_down.sql`(코드 먼저).
- 리허설(운영, `BEGIN … ROLLBACK`, 반복 가능)

| 경우 | 기대 |
|---|---|
| D1 | 적용 → 되돌리기 → 0 → 재적용 |
| D2 | 11월: 자료 판매 = 주문 표 SELECT(16건 43,000 C), **자료 환불 = 승인 2건 5,000 C**, **도넛 합 = 자료 판매 카드 보조 줄의 구매 C(43,000)**, **카드 큰 값 = 43,000 − 5,000 = 38,000 C**, (PASS 뒤) **요금제별 합 = 순 충전 매출 카드의 결제 금액(60,600원)**, 가입·다운로드 = 같은 시각 SELECT |
| D3 | 한국 시간 경계, 4-2 비교 기간 끝(지금 − N일) |
| D4 | 과목 필터·잘못된 과목·`p_limit`·367일 예외 |
| D5 | anon·authenticated 거절 |
| D6 | 순위 동점 정렬 |
| D7 | 트랜잭션 안 SQL 로 366일·과목 전체 `SELECT count(*) FROM report_market_daily(…)` = 날짜 수(≤367)와 실행 시간. supabase-js `rpc` 행 수 확인은 함수가 트랜잭션 밖에 보이지 않으므로 11절 6(DB 적용 뒤)으로 옮김 (PASS 뒤) |

## 6. 코드 변경
- **`src/lib/admin-dashboard-server.ts` 다시 쓰기**: `getAdminDashboard(access, { from, to, subject, compare })`. 4-1 표대로 구역마다 권한을 보고, 권한 없는 구역의 함수는 부르지 않는다(`report_charge_daily` 는 `reports.view` 만). 응답은 `pickDashboardFields` 를 거친다. 구역·앞 기간마다 따로 실패.
- **기간**: 23번 `src/lib/sales-report.ts` 의 해석 + 새 순수 함수 `src/lib/admin-dashboard-period.ts`(4-2 표).
- **데이터 읽는 길 하나로** (2판)
  - **주소 키**(3판): `period=today|7d|30d|month|lastMonth|custom`, `subject`, 그리고 `custom` 일 때만 `from·to`. 상대 프리셋은 날짜를 싣지 않고 서버가 요청 시각 기준으로 다시 계산한다(북마크한 '30일'은 다음 날 하루 밀림). 날짜만 있고 `period` 가 없는 주소는 `custom`. 잘못된 값이면 기본(`30d`·전체).
  - 첫 화면: `page.tsx` 가 주소를 검사해 서버에서 읽고 넘긴다. 최근 목록의 **첫 탭도 서버에서** 같은 함수로 읽어 넘긴다. 첫 탭 순서: `orders.view` 면 '최근 자료 구매', 아니면 `support.manage` 면 '답변 대기 문의'. (3판)
  - **초기 데이터가 있으면 마운트 때 다시 부르지 않는다**(지금 `useEffect` 호출 없앰).
  - 기간·과목을 바꿀 때: `/api/admin/stats?period&subject(&from&to)` 만 부르고 주소는 `history.replaceState` 로 고친다. 앞 요청은 `AbortController` 로 끊고 **마지막 요청의 응답만** 반영한다. 서버 안의 구역 호출은 `Promise.all` 로 함께 보낸다. (3판)
  - **최근 목록은 기간과 따로**: 다른 탭은 처음 열 때 `/api/admin/stats/recent?tab=` 로 읽는다. **한 번 읽은 탭은 [새로고침] 전까지 다시 읽지 않는다.** 기간을 바꿔도 다시 읽지 않는다. (3판)
  - 상품 현황은 한 번의 조회(과목·상태·`is_active`·`draft_source` 를 읽어 서버에서 묶음, 약 150행). 기간과 무관하므로 기간을 바꿀 때 다시 읽지 않는다(첫 화면·[새로고침]만). (3판)
- **stats route**: 같은 검사·같은 함수, `Cache-Control: no-store`. 가입 수 세션 조회는 서버 키로(13번이 먼저면 그대로).
- **회원 이메일**: 최근 목록에만, 13번 `attachMemberContacts({ screen: 'dashboard', fields: ['email'] })`. 요청 하나(탭 하나)에 기록 1행. **13번 M0 가 운영에 없으면 배포하지 않는다.**
- **`dashboard-client.tsx`**: 20번 부품으로 다시 그림, 새로고침 중 숫자 유지. 그래프는 `next/dynamic`.
- **문구**: 정의 말풍선·빈 상태 문구('판매된 상품 없음 · 공개 상품 n개' 등)는 `system_settings` 키 `admin_dashboard_content`(데이터 스크립트 `supabase/scripts/<날짜>_bundle21_dashboard_content.sql`, INSERT … ON CONFLICT DO NOTHING). 관리자 안내라 편집 화면 없이 스크립트로 고친다. 읽기 실패면 말풍선만 숨기고 빈 상태는 숫자만.

## 7. 그래프·빈 상태 규칙 (2판 보강)
- 기준 축 하나, 날짜마다 0 채움, 합계 0 이면 '이 기간 판매 없음'. 도넛이 모두 0 이면 회색 고리 + '데이터 없음'.
- **주 단위(90일 초과)**: 한국 날짜, 월요일 시작, 앞뒤 잘린 주는 '(일부)' 표시. 클라이언트 순수 함수 `bucketByWeek` + 시험. 주 막대를 누르면 그 주 범위로 주문 화면 필터.
- **순위 빈 상태**: 0개면 `products.edit` 가 있으면 '판매된 상품 없음 · 공개 상품 n개' + [상품 등록], 없으면 '판매된 상품 없음'만(상품 현황 값을 다른 권한에 싣지 않음). 5개 미만이면 있는 만큼만. (3판)
- **자리 고정**: 그래프 자리는 고정 높이(넓은 그래프 280px, 도넛 240px)의 뼈대로 먼저 잡아 늦게 불러와도 화면이 밀리지 않는다.
- 색은 회원 화면 토큰·20번 tone. 증감은 ▲▼ + 초록/빨강(20번 Q6). 색만으로 구분하지 않는다. [표로 보기] 제공.
- **이동 링크는 대상 화면 권한이 있을 때만**(상품 수정 = `products.edit`, 주문 = `orders.view`). 없으면 글자만. (2판)

## 8. 작업 기록·열람 기록
- 작업 기록 새 종류 없음.
- 열람 기록: 최근 목록 요청마다 `dashboard` 1행(탭 하나). 카드·그래프·순위는 대상 아님.

## 9. 시험
- `tests/bundle21-dashboard-period.test.mjs`: 4-2 표 전부(오늘 오전 비교, 월말 31일 → 2월, 연말, 윤년), 주소 값 검사, `bucketByWeek`, **`period=month` 로 다시 읽어도 비교 기간이 같음**, **`period=30d` 주소를 다음 날 열면 기간이 하루 밀림**, `period` 없이 날짜만 → custom. (3판)
- `tests/bundle21-dashboard-contract.test.mjs` (2판)
  - `orders.view` 만: 응답에 원·C 필드(순 충전 매출, 자료 판매 C, 도넛, 순위 C, 요금제별)가 없음, `report_charge_daily` 미호출.
  - `members.view` 없음: 가입 수 없음. `products.edit` 없음: 상품 현황·[상품 등록] 없음.
  - 응답 필드가 4-1 허용 목록 밖에 없음(권한 조합 5가지, `orders.view` 만일 때 순위 빈 상태에 공개 상품 수 없음 포함). (3판)
  - `report_market_daily` 응답 행 수 ≤ 367(날짜당 1행). (3판)
  - `orders.view` 만일 때 `purchases`·`refunds` jsonb **안쪽에도 `c` 키가 없음**. (PASS 뒤)
  - `REFUND_AMOUNT_MISSING` 이어도 자료 판매·활동 카드 정상.
  - 초기 데이터(첫 탭 포함)가 있으면 마운트 때 fetch 없음, 기간 변경 때 최근 목록·상품 현황 재조회 없음, **한 번 연 탭을 다시 열어도 재조회·열람 기록 없음**, 늦게 온 앞 요청 응답은 버림. (3판)
  - 판매 중지 버튼 owner 만, 처리 대기 = 알림 요약 값, `no-store`, 이메일은 `attachMemberContacts` 로만, 권한 없는 이동 링크 없음.
- 기존 `admin-dashboard-contract`·`admin-dashboard-u2-2-contract` 는 기대값을 바꾸고 이유를 주석에.
- 리허설 5절.

## 10. 검증 관점(계획·구현 모두 PASS 까지)
1. **매출 정의·대조**(23번 '결제·환불 정의' 검증자): 23번 정의 그대로인가, D2 대조
2. **권한·개인정보**: 4-1 허용 필드, 함수 호출 조건, 열람 기록 횟수, 시험 staff 계정
3. **마이그레이션**: 함수 권한·INVOKER·되돌리기·리허설
4. **화면**: 4-2 비교 기간, 빈 상태, 375px, 자리 고정, 그래프 접근성

## 11. 배포 순서
1. 계획 검증 PASS → 0절 답(특히 Q2·Q3) 반영
2. 선행: 20번 0단계, 23번 DB·코드 배포, 13번 M0·열람 기록 코드 배포
3. 구현 → 계약 시험 → 구현 검증 PASS
4. 리허설 → **DB 적용**(함수만, 승인) → 문구 스크립트
5. 로컬 확인(나 → 대표, 읽기만, 최근 목록이 열람 기록을 남김을 미리 알림) → push·배포
6. 운영 확인: 대표·시험 staff(`orders.view` 만 / + `reports.view`) 구역 대조, 11월 순 충전 매출 59,600원 = 23번 CSV, 366일·과목 전체로 supabase-js `rpc('report_market_daily')` 받은 행 수 = 날짜 수 (PASS 뒤)
7. 진행 기록
- 되돌리기: 코드 revert → (필요하면) 함수 down. 23번 함수는 남긴다.

## 12. 열린 질문
1. Q2 를 '옮긴다'로 하면 그 직원에게 `reports.view` 를 줄지(권한 부여 화면, 대표).
2. 처리 대기 칩에 '부분취소 처리 전'을 더할지(기본: 다음 판).
3. 방문·검색어 통계는 출시 후.
4. D2·운영 확인의 11월 기대값(43,000 C·60,600원·59,600원)은 2026-11-26 읽기 기준이다. 11월 안에 결제·환불이 더 생기면 리허설 직전에 23번 3-4 표와 함께 다시 뽑는다.
5. 자료 판매 카드(주문 표)와 23번 CSV '자료 구매 사용'(원장)의 차이를 카드에도 경고로 보일지. 기본: 말풍선 설명만, 23번 12절 1 조사 결과를 보고 정한다.

## 13. 범위 밖
- 방문 분석, 상품별 환불률, 검색어 통계, 카드 배치 편집, 이메일 보고서, 매출 CSV(23번).

## 14. 1판 검증 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| 권한·데이터 major, 화면 major | 한 함수가 여러 권한 값을 돌려줌, 건수 카드 출처 없음, 환불 예외가 번짐 | 4-1 권한별 출처·허용 필드 표, `report_charge_daily` 는 `reports.view` 만, `pickDashboardFields`, 9절 시험 |
| 권한·데이터 major, 화면 major | 요금제별·구매 방식별·과목별 환불 값이 없음 | 5절 `report_market_daily`, 23번 `report_charge_daily` 에 요금제별, D2 대조 |
| 화면 major | 덜 찬 오늘과 다 찬 앞 기간 비교 | Q3·4-2 표, 비교 범위 표시, '오늘(진행 중)' |
| minor | 상품 현황 공개 조건·자동 업로드 임시 상품 | 4-3 |
| minor | 앞 기간·덜 찬 기간 | 4-2 |
| minor | 마운트 재조회·두 탭 이메일·기록 2행 | 6절 데이터 길 하나, 최근 목록 분리, 9절 |
| minor | Recharts 판·권한 없는 링크 | Q4, 7절 |
| minor | 데이터 읽는 길 두 개·최근 목록 반복 | 6절 |
| minor | 순위 빈 상태·주 묶기·자리 고정 | 7절 |
| minor | C 필드 시험 범위 | 9절 |

## 15. 2판 검증 반영 (3판)
| 관점 | 지적 | 반영 |
|---|---|---|
| 화면 major | 주소에 프리셋이 없어 새로고침·공유 때 비교 기간이 바뀜 | 6절 `period` 키, 9절 시험 2개 |
| 화면 major | `report_market_daily` 가 1,000행 상한을 넘어 조용히 잘림 | 5절 날짜당 1행 + jsonb, D7 행 수, 9절 |
| 권한·데이터 minor | 행 조건(주문 상태·legacy_backfill·환불 상태·금액 열·회수 시각), D2 환불 C | 5절, Q6·4-1 회수 건수 뺌, D2 |
| 권한·데이터 minor | 다운로드 순위 대상, 가입 수 과목 | 4-3 |
| 화면 minor | 첫 탭을 서버에서, 탭 재조회 | 6절, 9절 |
| 화면 minor | `products.edit` 없을 때 순위 빈 상태 | 7절, 9절 |
| 화면 minor | 늦은 응답·상품 현황 재조회 | 6절 AbortController·Promise.all |

## 16. 3판 검증(PASS) 뒤 minor 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| 화면 minor | jsonb 안쪽 C 가 걸러지지 않을 수 있음 | 5절 jsonb 모양, 4-1 `pickDashboardFields` 안쪽 거르기, 9절 단언 |
| 화면 minor | 카드 큰 값과 D2 도넛 합이 어긋남 | Q6 큰 값 = 순 사용 C·보조 줄 구매 C, D2 |
| 화면 minor | D7 의 rpc 행 수는 리허설에서 못 함 | D7 트랜잭션 안 SQL, 11절 6 으로 이동 |

