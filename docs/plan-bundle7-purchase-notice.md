# 7번 묶음 계획: 자료 구매 고지·동의와 상품 정보 표시 (4판)

작성일: 2026-11-23 · 순서표 `docs/prelaunch-work-order.md` 7번 · 사실 조사(코드 근거)는 이 문서 끝 '근거'
4판 변경: 3회차 검증(결제·코드 PASS, 법 FAIL 1건 — 이용 기간 문구) 반영 — 3-5절 추가, downloadPeriodNotice 수정, 5절 운영 규칙 질문.
3판 변경: 2회차 검증(결제 PASS, 법·코드 FAIL) 반영 — 3-4절 추가, 확인창 스크롤·409 상태 전이, 정책 읽기는 서버 키, 환불 경로는 캐시 없이, 저장 검증 강화, 기존 테스트 목록 보강. 법 쪽 결정 2건(하자 환불 경로, 패키지 부분 환불)은 5절.
2판 변경: 1회차 검증(결제·법·코드 3명, 모두 FAIL) 반영 — 환불 판정 경로별 설계(관리자 승인도 기간을 봄), 체크 문구 하자 예외, 이용 기간 문구 첫 값, 거절 사유 문구도 DB 값, 지문 규칙·계산 위치, 멱등 순서, 기록 위치, 권한, 409 계약, 자리표시 이름.

## 0. 결정(이미 정해진 것)
- 다운로드한 자료는 단순 변심 환불 불가, 받지 않았으면 일정 기간 안 환불(대표 결정 30일 — **기간 값 변경은 8번 묶음**. 이번에는 지금 동작 그대로 7일).
- 구매 자료 이용 범위: 본인 수업·학습용 인쇄, 본인이 가르치는 학생에게 인쇄물 배포 허용 / 파일 공유·재판매·온라인 게시 금지(약관 제7조, 6번 적용).
- 하드코딩 금지: 문구·값은 DB.

## 1. 범위
하는 것
- A. **자료 환불 기간 값 한 곳**: `system_settings` 새 키 `market_purchase_policy` 의 `refundDays`(첫 값 7, 양의 정수). 환불 판정·거절 사유 문구·구매 고지 문구가 모두 이 값을 씀. 8번은 값만 30으로 바꾸고 결제 검증.
- B. **구매 확인창 필수 체크**(상품 상세·장바구니 공용 `market-checkout-confirm-dialog.tsx`): 고지 본문(confirmNotice) + 필수 체크(checkboxLabel) + 이용약관·취소/환불정책 링크. 체크해야 구매 버튼 활성. 기존 '기보유분 정가' 체크는 그대로(조건부). 고지 설정을 읽지 못하면 확인창은 열리되 구매 버튼은 막고 "잠시 후 다시 시도" 안내.
- C. **서버 강제와 동의 기록**: 구매 API 2개 body 에 `acknowledgePurchaseNotice: boolean`, `noticeSha256: string` 필수. 기록은 추가 전용 표, 결제 RPC 는 바꾸지 않음(3절).
- D. **상품 상세 "구매 전 확인" 블록**(`market-material-detail.tsx` '자료 상세 정보' 아래): 공급자(하단 정보의 상호·대표자·주소·고객센터·이메일 — enabled 표시 여부와 관계없이, 값이 비면 그 줄 숨김), 파일 형식과 필요 프로그램(파일 형식 표 새 열), 이용 기간·다운로드 안내, 이용 범위 한 줄(+약관 제7조 링크), 환불 고지. 기존 고정 문구 "구매 후 바로 다운로드할 수 있으며…"(market-item-actions.tsx:1349-1351)도 DB 문구로.
- E. 관리자: 사이트 기본 정보 화면에 '구매 고지' 카드(문구 편집, refundDays 는 읽기 전용 표시 — 값 변경은 8번). 권한 `site.manage`, 작업 기록 새 키 `market_purchase_policy_update`. 파일 유형 설정 팝업에 '필요 프로그램' 칸(PATCH 스키마 추가, 권한 기존 `products.edit`, 작업 기록 새 키 `market_file_type_update`).

하지 않는 것
- 환불 기간 7→30 변경과 그 결제 검증, 판정에 '구매 당시 값'과 '지금 값' 중 무엇을 쓸지(8번 — 늘리는 방향이라 이번엔 지금 값), 환불정책 본문에 자료 환불 조항 추가(8번), 결제 화면(충전) 고지(9번).

## 2. DB
### 2-1. `system_settings` 'market_purchase_policy'
- 새 키 INSERT(이미 있으면 실패 — 새 키). 값:
  `{ version:1, refundDays:7, checkboxLabel, confirmNotice, usageScopeNotice, downloadPeriodNotice, detailRefundNotice, refundExpiredReason, purchaseCompleteNotice }`
- 자리표시는 `{자료환불기간}` 하나만(충전 화면의 `{환불기간}`=충전 환불 기간과 구분). 관리자 저장 검증: 알 수 없는 `{…}` 거부, 모든 문구 비어 있지 않음, 길이 제한.
- 첫 값(대표 확인 대상, 5절):
  - checkboxLabel: "다운로드한 자료는 단순 변심으로 환불할 수 없고, 받지 않은 자료는 구매 후 {자료환불기간}일 안에 환불 신청할 수 있음을 확인했습니다."
  - confirmNotice: "받지 않은 자료의 환불은 자료 보관함에서 신청하고, 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 고객센터(1:1 문의)로 신청하면 환불해 드립니다. 환불은 결제에 쓴 크레딧으로 돌아오며, 환불되면 그 자료는 더 받을 수 없습니다. HWP로 업그레이드한 PDF 주문은 환불할 수 없습니다." (패키지 문장은 넣지 않음 — 8번 부분 환불)
  - downloadPeriodNotice: "구매한 자료는 기간·횟수 제한 없이 자료 보관함에서 다시 받을 수 있습니다. 다만 권리침해가 확인되거나 약관 위반으로 이용이 제한된 경우에는 받을 수 없고, 서비스를 종료할 때는 안내한 기간까지 받을 수 있습니다." ('판매 종료'·'등' 없음 — 판매 중단은 숨김으로 하고 숨김이어도 산 사람은 받음)
  - usageScopeNotice: "본인 수업·학습용 인쇄와 본인이 가르치는 학생에게 인쇄물 배포는 할 수 있습니다. 파일 공유·재판매·온라인 게시는 고쳐서 만든 자료라도 할 수 없습니다."
  - detailRefundNotice: "다운로드한 자료는 단순 변심으로 환불할 수 없고, 받지 않은 자료는 구매 후 {자료환불기간}일 안에 자료 보관함에서 환불 신청할 수 있습니다. 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 고객센터(1:1 문의)로 신청하면 환불해 드립니다. 환불은 결제에 쓴 크레딧으로 돌아오며, 환불되면 그 자료는 더 받을 수 없습니다."
  - refundExpiredReason: "구매 후 {자료환불기간}일이 지난 자료는 환불할 수 없습니다."(지금 market-refunds.ts:363 상수 대체)
  - purchaseCompleteNotice: 지금 고정 문구 그대로.
- RESTRICTIVE FOR UPDATE 정책(세션 직접 수정 차단, 4번 선례 — 운영 확인: authenticated 는 SELECT·UPDATE 만, owner_update 가 PERMISSIVE). 관리자 저장은 서비스 키.

### 2-2. `market_file_types.required_program text null`
- ADD COLUMN. 첫 값은 **두 과목(국어·영어) × code(pdf·hwp·zip) 6행 모두** UPDATE, VERIFY 에서 6행 확인. 문구는 5절 대표 확인.

### 2-3. `market_purchase_notice_acks`(추가 전용 동의 기록)
- 열: id, user_id → profiles ON DELETE CASCADE(주문·배치와 같은 규칙), idempotency_key uuid, notice_sha256 text CHECK `^[0-9a-f]{64}$`, notice_text text(체크 문구+고지 본문, 채운 문장), refund_days int CHECK >0, created_at clock_timestamp(). UNIQUE(user_id, idempotency_key).
- 추가 전용 트리거: UPDATE·TRUNCATE 거부, DELETE 는 부모 profiles 가 없을 때만(4번 user_consents 규칙). 시퀀스 권한 회수.
- RLS 켬, 정책 없음(anon·authenticated 접근 없음). service_role SELECT 만.
- 쓰기: DEFINER `record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text) returns jsonb`
  - EXECUTE: PUBLIC·anon·authenticated REVOKE, service_role 만 GRANT. (3a) 검사 유지.
  - 순서: ① 입력 검사 → ② **(user_id, key) 기존 행이 있으면**: 지문이 같으면 `{ok:true, replay:true}`, 다르면 `{ok:false, code:'NOTICE_KEY_CONFLICT'}`(저장 증빙과 다른 화면으로 같은 키 재사용 금지) → ③ 지금 설정을 읽어 지문 재계산(설정 없음·형식 오류는 `{ok:false, code:'NOTICE_POLICY_UNAVAILABLE'}`), 요청 지문과 다르면 `{ok:false, code:'NOTICE_CHANGED'}` → ④ `INSERT … ON CONFLICT (user_id, idempotency_key) DO NOTHING` 뒤 다시 SELECT 해 ②와 같은 판정(동시 같은 키).
  - 오류는 jsonb code 로만 나눔(메시지 정규식 금지, market-checkout-server.ts:90 원칙).

### 2-4. 지문 규칙(서버만 계산)
- 대상 문장 = `fill(checkboxLabel) + "\n" + fill(confirmNotice)`. fill = `{자료환불기간}` 을 **모두** refundDays 정수 텍스트로 바꿈(TS 는 split/join — `fillPricingPagePlaceholders` 선례, SQL 은 replace — 둘 다 전부 치환). refundDays 텍스트: SQL `(value->>'refundDays')::int::text`, TS `String(n)`(저장 검증에서 양의 정수만 허용). 정규화 없음 — 저장 시 CRLF→LF·앞뒤 공백 제거를 미리 해 둠.
- 지문 = `encode(sha256(convert_to(문장,'UTF8')),'hex')`. **서버(TS, node:crypto)가 계산해 문구와 함께 화면에 내려 주고, 브라우저는 그대로 돌려보내기만** 함(브라우저 계산 없음). TS 와 SQL 이 같은 값인지 표 테스트 + 리허설에서 실제 SQL 값 비교.

### 2-5. 공통
- VERIFY·되돌리기·리허설. 결제 RPC(`checkout_market_selection`)·환불 RPC(`approve_market_refund` 등) 정의 md5 그대로 확인.
- 점검 쿼리(배포 뒤): 배포 시각 이후 `market_checkout_batches` 중 같은 (user_id, key) 고지 행이 없는 것 = 0건. 반대 방향(고지 행에 배치 없음)은 RPC 실패(PRICE_CHANGED 등) 때 생길 수 있어 0 또는 1 관계로 둠.

## 3. 결제·환불 안전
### 3-1. 구매 API(`purchase/route.ts`, `cart/checkout/route.ts`)
- 스키마: `acknowledgePurchaseNotice: z.boolean()`, `noticeSha256: z.string().regex(hex64)` (strict). 필드가 아예 없으면 기존처럼 400 INVALID_INPUT, false 면 파싱 뒤 400 `PURCHASE_NOTICE_ACK_REQUIRED`.
- 순서: 인증 → 약관 동의(4번) → 본문 검사 → 판매 중지 스위치 → itemId 검사(상품 상세만) → **고지 기록** → `runMarketCheckout`. 판매가 꺼져 있으면 기록 행이 생기지 않음.
- 기록 결과: replay·ok → 결제 진행. NOTICE_CHANGED → 409 `PURCHASE_NOTICE_CHANGED`, details 에 캐시 없이 읽은 새 checkboxLabel·confirmNotice(채운 문장)·noticeSha256·refundDays. NOTICE_KEY_CONFLICT → 409 같은 코드(details 같음, 화면은 새 키). NOTICE_POLICY_UNAVAILABLE·DB 오류 → 503(화면은 같은 키로 재시도 — 기존 retryable 흐름). 기록 실패면 결제하지 않음(fail closed).
- 402 INSUFFICIENT_CREDITS 뒤 같은 키로 다시 누르면 기존 고지 행으로 통과(replay) — 의도한 동작. 그 사이 문구가 바뀌어 화면이 새 지문을 보내면 NOTICE_KEY_CONFLICT → 새 키.

### 3-2. 환불 판정(`src/lib/market-refunds.ts`)
- `getMarketRefundEligibility` 는 DB 를 읽지 않고 `refundPolicy: { refundDays, refundExpiredReason } | null` 을 인자로 받음. 부르는 쪽이 요청당 1번 읽음.
- 경로별:
  - **회원 환불 신청**(requestMarketRefund): 읽기 실패(null)면 신청을 막고 "잠시 후 다시 시도"(fail closed).
  - **자료 보관함 목록**(listMarketLibraryRowsForUser): 요청당 1번 읽음. 읽기 실패해도 목록·다운로드는 그대로, 환불 칸만 "지금 확인할 수 없음"(신청 불가).
  - **관리자 승인**(approveMarketRefund): 기간은 **신청 시각(market_refund_requests.created_at) 기준**으로 판정(5절 대표 확인 — 지금은 승인 시각 기준이라 기간 안에 낸 신청도 늦게 승인하면 거절됨). 읽기 실패면 승인 중단하고 "잠시 후 다시 시도"(돈이 움직이는 경로라 fail closed). 다운로드 여부 검사·DB RPC 는 그대로.
- 거절 사유 문구는 `refundExpiredReason` 을 채워 씀 — 코드 안 "7일" 상수 0건(테스트).

### 3-3. 화면(`cart-view.tsx`, `market-item-actions.tsx`)
- 문구 전달: 상품 상세는 page.tsx 병렬 조회에 정책 읽기 추가 → MarketMaterialDetail → MarketItemActions. 장바구니는 getMarketCartView 와 GET /api/market/cart 응답에 정책 필드 추가.
- 새 상태 `noticeAcknowledged`(기존 acknowledged 와 별개), canConfirm 에 `&& noticeAcknowledged && policy !== null` 만 더함. 새 체크박스도 `disabled={submitting || retryable}`.
- 확인창을 열 때 noticeAcknowledged=false. ACK_REQUIRED 는 기존대로 acknowledged 만 해제. PURCHASE_NOTICE_CHANGED 는 details 의 새 문구·지문으로 바꾸고 noticeAcknowledged=false + 새 키.
- 캐시: 정책 읽기는 tag 캐시(revalidate 60)를 쓰되 관리자 저장 때 `revalidateTag(…, expire 0)` 필수. 409 details 는 캐시를 거치지 않음.

### 3-4. 2회차 검증 반영
- 확인창 배치: 본문(목록·고지·체크)은 확인창 안에서만 `max-h-[calc(100dvh-…)] overflow-y-auto` 로 스크롤, 버튼 줄은 늘 보임(공용 Dialog 는 바꾸지 않음). 로컬 확인 375×667 에서 기보유분 체크·402 알림이 함께 뜬 가장 긴 경우에도 버튼이 보이는지 상품 상세·장바구니 각각.
- PURCHASE_NOTICE_CHANGED 상태 전이: 새 키, retryable=false, submitting=false, noticeAcknowledged=false, 새 문구·지문으로 교체, 기보유분 acknowledged 는 유지. details 가 비었거나 형식이 틀리면 확인창 닫고 새로고침.
- 장바구니: 확인창을 열 때 정책(문구·지문)을 checkout 상태에 복사해 두고, 409 일 때만 바꿈(reload 로 몰래 바뀌지 않게).
- 정책 읽기: 비로그인도 보는 상세 블록 때문에 서버 키(createAdminClient)로 읽음. 읽기 실패는 throw 하지 않고 `policy: null`(캐시 함수 안에서는 throw 해서 null 이 캐시되지 않게). 장바구니 GET 도 실패 시 `policy: null`.
- 환불 신청·관리자 승인은 캐시 없이 매번 DB 를 읽음. 정책 읽기 실패로 막을 때 503 + 새 code `REFUND_POLICY_UNAVAILABLE`. refunds/route.ts:48 의 `message.includes('다운로드')` 판정은 error.name 만으로 바꿈(거절 문구가 DB 값이 되므로). 판정 함수는 `judgeAt`(판정 기준 시각) 인자를 받고, 정책 null 이면 status 'unavailable'·refundDeadline null.
- DB 함수: refundDays 는 jsonb_typeof='number'·정수·>0 을 먼저 검사(아니면 NOTICE_POLICY_UNAVAILABLE), 문구 키가 없거나 null 이면 같은 처리. NOTICE_CHANGED 때 함수가 계산한 문장·지문을 jsonb 로 돌려주고 409 details 는 그 값을 씀(TS 와 어긋나도 한 번에 바로잡힘).
- 관리자 저장 검증: refundDays 는 body 로 받지 않고 DB 값 그대로 보존(값 변경은 8번). checkboxLabel·detailRefundNotice·refundExpiredReason 은 `{자료환불기간}` 필수, '숫자+일' 글자 거부. 약관 링크 주소는 하단 정보의 정책 문서 slug(DB)로 /terms/{slug}, 링크 글자는 DB 문구.
- 1-D 의 고정 문구(market-item-actions.tsx:1349-1351) = purchaseCompleteNotice. '자료 보관함' 굵은 글씨는 일반 글자가 됨.
- 파일 유형: POST·PATCH 스키마와 createMarketFileType·updateMarketFileType(market-items-server.ts:662-667)에 requiredProgram, PATCH 에 작업 기록.
- 배포 순서: DB 먼저 → 코드. 코드 배포 뒤 기록 표 되돌리기 금지(4번 선례).
- 기존 테스트 추가 수정: market-v2-purchase-entitlement-contract.test.mjs:37(스키마 끝), purchase-section-redesign-contract.test.mjs:133(고정 문구 위치). '7일 상수 0건'은 market-refunds.ts 와 마켓 화면에만, `addDays(purchasedAt, 7)` 숫자 상수도 따로 검사.

### 3-5. 3회차 검증 반영
- 상품 상세도 확인창을 열 때 정책(문구·지문)을 checkout 상태에 복사(장바구니와 같은 규칙), 409 일 때만 바꿈.
- 409 details 모양 고정: DB 함수가 채운 `checkboxLabel`·`confirmNotice` 를 **따로**, `noticeSha256`, `refundDays`. NOTICE_KEY_CONFLICT 때도 함수가 지금 정책으로 계산한 같은 값을 돌려줌(정책을 못 읽으면 NOTICE_POLICY_UNAVAILABLE). details 가 비거나 형식이 틀리면 확인창 닫고 새로고침.
- SQL 지문: 줄바꿈은 `chr(10)`. refundDays 는 `jsonb_typeof='number'` 확인 뒤 `::numeric` 으로 정수·양수 검사하고 그다음 `::int`(7.0 이 예외를 내지 않게). 함수에 `SET search_path TO 'public','pg_temp'`. VERIFY 에 첫 값 CRLF·앞뒤 공백 없음.
- 환불 판정 우선순위: 이미 신청됨·다운로드함·완료 안 된 주문 등 정책 없이도 정해지는 상태는 그대로, 기간 판정이 필요할 때만 'unavailable'. 보관함 refundableUntil 소비처(market-items-server.ts:2611 부근)·화면이 null 을 받게. 관리자 승인 route 도 503 `REFUND_POLICY_UNAVAILABLE`.
- 약관 링크: slug 는 코드 기본값(normalizeFooterContent 가 덮어씀)이므로 기존 도우미(getFooterPolicyDocumentBySlug 등)로 href 를 만들고, 문서가 꺼져 있으면 링크 숨김. 링크 글자는 DB 문구.
- 상세 블록 데이터 경로: page.tsx 병렬 조회에 정책 + getSiteFooterContent(), listMarketSubproductPublicSummaries 의 market_file_types select(:1307-1311)와 MarketSubproductPublicFileType 에 required_program. 새 파일 유형은 requiredProgram 필수.
- '문구 코드 상수 0건' 테스트는 새 고지 문구만 대상(기존 기보유분 체크 문구·제목은 범위 밖). 스키마 오류는 한국어 메시지. 새 표·열·함수에 맞춰 src/types/supabase.ts 다시 생성.
- 추가 계약 테스트: 확인창 본문 스크롤·버튼 줄 바깥, 장바구니·상세가 열 때 정책 복사·reload 로 안 바뀜, NOTICE_CHANGED 때 기보유분 ack 유지, 구매 고지 저장 action 의 site.manage·작업 기록·revalidateTag.
- **7번만 배포된 상태로 판매를 켜지 않음**(하자 환불·패키지 부분 환불은 8번에서 생김) — 대표 할 일에 기록.
- 작업 순서: 지금 커밋 안 된 관리자 입력 보존 변경(market-products-client.tsx 등)을 먼저 정리한 뒤 7번 구현.

## 4. 검증
- 계약 테스트(새 파일 + 기존 수정):
  - 구매 API 2개: 스키마, 400 INVALID_INPUT/PURCHASE_NOTICE_ACK_REQUIRED 구분, 409 details, 503, 고지 기록이 판매 중지·itemId 검사 뒤·runMarketCheckout 앞.
  - 두 화면이 body 에 두 필드를 보냄, NOTICE_CHANGED 분기에서 새 키·체크 해제, 고지 체크 retryable 동안 비활성, 정책 없으면 구매 버튼 막힘.
  - 환불: 판정 함수가 DB 를 직접 읽지 않음, 보관함은 정책 읽기 실패에도 렌더, 관리자 승인은 신청 시각 기준·읽기 실패 시 중단, "7일" 상수 0건.
  - 문구는 DB 값(확인창·상세의 코드 상수 0건), 자리표시 `{자료환불기간}` 만 허용, 지문 TS=SQL 표 테스트.
  - 기존 수정: `tests/market-detail-multiselect-contract.test.mjs:147`(canConfirm 줄), `tests/market-refund-api-ui-contract.test.mjs:31`(/구매 후 7일/).
- DB 리허설: authenticated 실행 거부, 추가 전용(UPDATE·TRUNCATE 거부), 멱등(replay·키 충돌·동시), 지문 불일치 거절, 설정 없음, 6행 UPDATE, 결제·환불 RPC md5 그대로, 롤백.
- 결제 검증 3명(구매 흐름·멱등·재시도 / 환불 판정 / DB 권한).
- 로컬 확인은 내가 먼저 브라우저로(구매·저장 버튼은 누르지 않음 — 운영 DB), 그 뒤 대표 확인.

## 5. 대표 확인 필요
남은 법 쪽 결정(2회차): 7. 다운로드한 하자 자료 환불 — 지금은 시스템에 처리 경로가 없음(다운로드하면 관리자 승인·DB 함수 모두 거절, 관리자 크레딧 지급은 무상분이라 회원에게 불리). 8. 패키지 부분 환불 — 법(제17조 제2항 제5호 단서)상 받지 않은 자료만큼 환불해야 할 여지.
결정됨(2026-11-23): 7 → 8번에서 관리자 예외 승인(다운로드된 주문도 사유를 적고 원래 크레딧으로 환불) 추가, 7번 고지는 '고객센터로 신청'. 8 → 8번에서 패키지 부분 환불, 7번 고지에 패키지 문장 없음. 2 → 신청 시각 기준. 4 → 고지 본문에 "HWP로 업그레이드한 PDF 주문은 환불할 수 없습니다" 한 줄 추가. 5 → 샘플 없는 상품도 공개 허용(공개 검사 넣지 않음). 1 → 2-1 문구 첫 값과 필요 프로그램(PDF 'PDF 뷰어(Adobe Acrobat Reader 등)', HWP '한글(한컴오피스) 또는 한컴 뷰어', ZIP '압축 해제 프로그램과 안에 든 파일 형식(HWP·PDF)에 맞는 프로그램') 그대로 사용. 9 → 동의(숨김 규칙). 남은 대표 확인 없음. 3은 결정 8로 정리, 6은 하단 정보 값이 모두 채워져 있음을 확인(3회차).
9. 운영 규칙: 구매자가 있는 상품·서브상품은 판매를 멈출 때 '숨김'으로 하고, 보관·임시저장·삭제는 권리침해·법령 사유일 때만 한다(이용 기간 '제한 없음' 표시가 사실이 되려면 필요).

1. 문구 첫 값(2-1의 체크 문구·고지 본문·이용 기간·이용 범위), 필요 프로그램 문구(pdf/hwp/zip).
2. 관리자 승인 기간 기준: 신청 시각(권장) / 지금처럼 승인 시각.
3. 전체 구매(패키지)는 하나라도 받으면 단순 변심 환불 불가 — 고지에 명시(지금 동작 그대로).
4. 업그레이드(HWP 차액)의 기준이 된 PDF 주문은 받지 않았어도 환불 불가(market-refunds.ts:364) — 고지에 넣을지, 그대로 둘지.
5. 샘플 페이지가 없는 상품은 공개하지 못하게 막을지(환불 제한 고지가 유효하려면 맛보기 제공이 필요 — 지금 공개 상품 149개는 모두 샘플 있음). 이번에 넣지 않으면 대표 할 일에 남김.
6. 하단 정보의 주소·고객센터·이메일이 비어 있지 않은지(상세 블록에 그대로 나감).

## 근거(사실 조사, 2026-11-23)
- 구매 API body: purchase/route.ts:11-23, cart/checkout/route.ts:11-18. 판매 중지 purchase:62-67·cart:42-44, itemId 검사 purchase:69-74. RPC `checkout_market_selection(p_user_id, p_mode, p_item_id, p_lines, p_idempotency_key)` market-checkout-server.ts:109-115. 멱등 키는 `market_checkout_batches.idempotency_key`(unique(user_id, key)).
- 확인창 활성 조건 market-checkout-confirm-dialog.tsx:69, 체크 문구 코드 상수 :124-139. 상품 상세 고정 문구 market-item-actions.tsx:1349-1351.
- 다운로드: 기한·횟수 제한 없음. 상품 삭제·비활성, 파일 비활성이면 받을 수 없음(market-items-server.ts:1487-1533).
- 파일 형식 `market_file_types` 과목별 6행(english/korean × pdf·hwp·zip) — 필요 프로그램 열 없음.
- 자료 환불 7일: market-refunds.ts:348-363. 관리자 승인 approveMarketRefund(:529-555)도 같은 판정 함수(ignoreRequestStatus)로 기간을 봄. 보관함 목록 market-items-server.ts:2593·2618 이 주문마다 판정 함수를 부름. DB RPC approve_market_refund 는 기간을 보지 않음.
- 법: 전자상거래법 제17조 제2항 제5호·단서(디지털콘텐츠 철회 제한, 가분적이면 제공 안 된 부분은 철회 가능), 제6항(제한 사실 표시 + 시험 사용 상품 제공), 제3항(표시·계약과 다르면 3개월/30일 철회), 제13조(공급자·이용 조건·기간 표시), 제35조(불리한 특약 무효). 최종 문구 전 law.go.kr 원문 대조.
