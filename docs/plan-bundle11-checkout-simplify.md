# 11번 묶음 계획 — 결제 화면 단순화(장바구니 결제 칸, 동의 한 줄로 접기)

작성 2026-11-24 · **13판(검증 PASS, 2026-11-26)** — 11판에서 10판을 줄여 다시 썼다
- 1판~10판은 검증 10회차 동안 화면 높이 예산(px), 개발 전용 화면 모음의 상태 목록, 초점 순서 같은 세부를 계속 더해 수렴하지 않았다. 11판은 15번 계획 6판처럼 **목표·경우·원칙**만 정한다. 정확한 높이·상태별 그리기·리허설 거래 나누기는 구현 때 실제 화면과 시험으로 정하고 구현 검증에서 본다.
- 안전 규칙(보인 것 = 기록된 것, 어긋나면 결제가 막히는 쪽)은 하나도 빼지 않았다. 뺀 세부와 이유는 15절.
- 11판에서 새로 정하거나 바꾼 곳은 `(11판)`, 12판·13판에서 고친 곳은 `(12판)`·`(13판)` 으로 표시했다.

## 0. 대표 결정
**2026-11-24**
1. 자료 구매는 **장바구니로만** 한다. 상품 상세의 '구매하기'를 없애고 '장바구니 담기'만 둔다.
2. 장바구니 결제 수단은 **크레딧만** 쓴다(카드 바로 결제 없음).
3. 결제 위치는 **A안**: 장바구니 오른쪽에 늘 보이는 결제 칸(별도 주문 화면 없음). 샘플은 ChatGPT 대화 '장바구니 UI 목업 생성'.
4. **충전 결제 화면도 함께** 정리한다.
5. 동의는 솔북처럼 `[필수]` 체크 하나로 접는다. 다만 환불 제한 핵심 줄은 접지 않고 늘 보이게, 체크는 처음에 비워 두고, 개인(신용)정보 수집·제3자 제공 동의는 넣지 않는다(자료는 크레딧 차감, 충전 결제 동의는 페이앱 결제창이 받음).
6. 4절 문구 초안은 그대로 승인. 최종 문구는 나중에 클라이언트와 정해 **관리자 화면(9절)에서 고친다**. 그래서 관리자 편집 화면은 이번 묶음에 꼭 들어간다.

**2026-11-24 대표 확인(2판에서 생긴 질문, 기본값으로 진행)**
7. [2판 고침] 표시 문구(두 제목, 요약 줄, 충전 항목 '미성년자 결제 취소 안내')는 초안 그대로.
8. 자료 요약에 하자 환불 줄(`note`)을 넣는다.
9. 선택을 풀어 둔 자료를 다시 담으면 선택으로 바꾼다.
10. 담기 결과 창에 '선택된 다른 자료와 함께 결제돼요' 안내는 넣지 않는다(결제 칸 '선택한 자료' 목록이 같은 일을 함).

**2026-11-26** (11판)
11. **화면 확인은 시험 계정으로 실제 장바구니에서 한다.** localhost(운영 DB)에서 대표가 시험 계정(`@test.com`)으로 로그인하고, 그 계정의 장바구니 담기·빼기·선택만 허용한다. 구매·충전 버튼은 누르지 않는다. 그래서 9~10판의 개발 전용 화면 모음(가짜 껍데기·고정 값·상태 목록)은 **없앤다**. 남는 것은 2판 동의를 localhost 에서 그려 보고, 켜져 있는 동안 서버가 동의 기록 전에 결제를 막는 개발 전용 스위치 하나다(10-1). (12판)
12. **1366×768 첫 화면에서 결제 버튼도 고정 막대도 안 보이던 문제**는 높이 예산이 아니라 원칙으로 푼다: 세부 항목은 창으로 열어 결제 칸 높이를 묶고, sticky 는 칸이 들어갈 때만 켜며, **고정 막대는 결제 칸이 아니라 결제 버튼 줄이 화면 밖일 때 보인다**(6-2).
13. **시행 순서**: 10번 코드는 배포됐고 15번 DB 도 적용됐다. 11번은 고지 기간 잠금 대상을 쓰지 않으므로 고지 기간과 겹쳐도 되고, **2027-01-11 전에 내보낼 수 있다**(3절).

## 1. 지금 상태(코드·운영 DB 읽기 조회, 2026-11-26 다시 확인)
- **10번**: DB 적용 2026-11-24 14:38 KST, 코드 `51b7373` 은 push 됐고 2026-11-26 배포(`7a97416`, 15번과 함께). `origin/main..HEAD` 는 문서 커밋 `536fdc6` 하나뿐이다. 10번 약관·처리방침 문구 스크립트(`supabase/scripts/20261126_bundle10_policy_text.sql`)는 15번이 '게시'·'시행' 방식으로 고쳤고 **시행일 2027-01-11** 에 돈다. 탈퇴 스위치 `selfAnonymizeEnabled` 는 꺼져 있다. (11판)
- **15번**: DB 적용 2026-11-26 09:45 KST(마이그레이션 `20261205100000_site_notice_popup.sql`, 운영 이력의 최신 판), 코드 배포 `7a97416`. 게시 행 `policy_upcoming_documents` 는 **아직 없다**(대표가 2026-12-10 안에 게시를 요청하면 생김). 게시 행이 `upcoming` 인 동안 잠금 트리거 3개가 막는 것은 3절. 장바구니·충전 화면은 이미 `UpcomingPolicyNotice` 를 `upcomingNotice` prop 으로 받는다(`cart/page.tsx`→`CartView`, `checkout/page.tsx`→`checkout-client.tsx`). 게시 뒤에는 이 한 줄이 결제 칸 위 높이를 늘린다. 공지 팝업은 `/cart`·`/checkout`·`/pricing` 에 뜨지 않는다. (11판)
- **판매 상태**: `payment_runtime_config` 의 `master`·`payapp` 새 주문이 켜져 있다(카카오페이만 꺼짐). 11-17~22 실회원 4명이 충전하고 자료를 샀다. 그래서 DB 적용·리허설은 새벽에 짧게 하고, 실회원 화면 영향을 늘 적는다.
- **상품 상세**(`src/components/market/market-item-actions.tsx`): '장바구니'와 '구매하기'가 둘 다 있다. 구매하기는 `MarketCheckoutConfirmDialog` → `/api/market/items/[itemId]/purchase`. 비로그인 의도는 sessionStorage `market-cart-intent:v1`(action `cart|purchase`). 담기 결과 창에는 '계속 둘러보기'/'장바구니 보기'가 있다. 상세를 열면 `POST /api/market/items/{id}/view` 가 운영 DB 에 조회 기록을 쓴다.
- **장바구니**(`src/app/(solvook)/cart/_components/cart-view.tsx`): 여러 건을 골라 같은 확인창으로 `/api/market/cart/checkout`. 두 경로 모두 `src/lib/market-checkout-server.ts` → DB `checkout_market_selection`. 업그레이드 차액(`upgradeBaseOrderId`)과 부분 보유 전체 패키지(`partiallyOwned`, 정가 확인 → `request_payload` 줄별 `ack`)를 이미 다룬다. 뷰는 **해석하지 않고** `setView(payload.data)` 로 쓴다. 확인창 설명('…하나라도 구매할 수 없으면 전체 구매가 취소됩니다.')과 부분 보유 확인 문장은 **코드에 박혀 있다**. 충전 링크는 `/pricing` + chargeHint 뿐(`returnTo` 없음). 영수증 조회 route `GET /api/market/cart/checkouts/[key]`(`getMarketCheckoutReceipt`)가 있다.
- **자료 구매 동의 기록**: `record_purchase_notice_ack(p_user_id, p_idempotency_key, p_notice_sha256)`. 원문 = `checkboxLabel || LF || confirmNotice`(`{자료환불기간}` 채움), 409 details 는 `checkboxLabel·confirmNotice·noticeSha256·refundDays`. 기록 표 `market_purchase_notice_acks` 에는 정책 문서 지문 칸이 없다. 서버 계산 `src/lib/market-purchase-policy-server.ts`, 화면용 캐시 `unstable_cache` 60초 키 `market_purchase_policy:v2`.
- **충전 화면**(`src/app/checkout/checkout-client.tsx`): '결제 전 확인' 5개, 미성년자 안내, 긴 `agreeLabel` 이 펼쳐져 있고 환불정책 링크 `/terms/refund` 가 코드에 박혀 있다. 기록 `record_point_charge_checkout_ack`(6인자) 원문 = 제목·항목 5개·미성년자 안내·동의 문구를 LF 로 이음, 환불정책 문서 지문(`refund_policy_sha256`)도 남김. 409 는 route 가 `notice` 로(해석 실패면 정책을 다시 읽어 만듦, `checkoutChangedResponse`). 캐시 키 `point_charge_policy:v1`(`src/lib/point-charge-policy-server.ts`). (11판: 10판의 '충전 캐시 v1→v2' 근거 확인)
- **두 정책의 `version`**: 충전은 저장마다 +1(낙관적 잠금), 자료는 저장해도 그대로(`refundDays` 만 대조). 운영 값은 둘 다 1, 둘 다 `consentFormat` 없음. 정책 값 md5(`md5(value::text)`): 자료 `2b637c7b…`, 충전 `ae5790d5…`(2026-11-26).
- **정책 문서 사본**(`policy_document_snapshots`): 최신 seq `refundPolicy` 21·`serviceTerms` 22·`privacyPolicy` 14. 바닥글 세 문서 모두 `enabled: true`. 바닥글 원본 판정 도우미 `src/lib/footer-policy-raw.ts`(`inspectRawFooterPolicyDocument`)는 'enabled 가 없으면 켜짐' 규칙이다(4-3 (g) 와 다름, 거기 참고).
- **관리자 문구 편집**: 자료 = `/admin/footer` 의 구매 정책 폼(`purchase-policy-form.tsx`·`purchase-policy-actions.ts`, `market_purchase_policy` 키만 씀), 충전 = `/admin/pricing` 의 충전 정책 폼(`point-charge-policy-form.tsx`·`actions.ts`, 작업 기록에 1판 지문 `notice_sha256_before/after`).
- **함수 md5(2026-11-26 운영, 10판 값과 모두 같음)**: `record_purchase_notice_ack(uuid,uuid,text)` `fa6a7edd836f21422d52dd184afb079b`, `record_point_charge_checkout_ack` `be4403fd993c45d618950a5908a91591`(10번 정의). 그대로여야 할 함수는 5-5.

## 2. 목표
1. 자료 구매 경로를 하나로: 상세에서 담기 → 장바구니 결제 칸에서 결제.
2. 결제 버튼 바로 위 동의를 체크 하나 + 늘 보이는 짧은 핵심 줄로 줄이고, 자세한 내용은 [세부 항목] 창에서 본다.
3. 회원이 실제로 본 것(제목, 요약 줄, 항목 이름, 열어 볼 수 있던 본문)이 동의 원문·지문에 남고, 회원이 체크한 장바구니 문장과 항목 구조, 그때의 정책 문서 판이 기록 칸(`consent_details`, 문서 지문 칸)에 남는다.
4. 문구는 모두 DB 에 있고 관리자 화면에서 고친다.
5. 1판과 2판이 함께 도는 동안(배포 직후, 옛 탭, 되돌리기)에도 **화면에 보인 글 = 기록된 원문**이다. 어긋날 수 있는 곳은 모두 결제가 막히는 쪽으로 닫는다.
6. 장바구니에서는 어느 화면 크기·스크롤 위치에서도 결제 버튼 줄이나 그리로 가는 고정 막대 중 하나가 보인다. 충전 화면은 막대 없이 보통 스크롤이고, 동의·요약 줄·결제 버튼이 한 흐름으로 이어지면 된다(8절). (11판·12판)

## 3. 범위·시행 순서와 고지 기간 (11판)
- **11번이 쓰는 것**: `system_settings` 의 `market_purchase_policy`·`point_charge_policy` 두 키(스크립트 A·B·되돌림, 관리자 저장), 두 동의 기록 표(칸 추가, 새 기록), DB 함수 4개(5-5), 코드.
- **고지 기간 잠금 대상**(15번 4-4, 게시 행이 `upcoming` 일 때): ① `site_footer_content` 의 게시 문서(`serviceTerms`·`refundPolicy`·`privacyPolicy`) `content`·`title`·`slug`·`enabled`, ② `signup_consent_items` 의 `terms`·`privacy`, ③ `member_withdrawal_policy` 의 `lockedWithdrawalPaths` 경로와 스위치 켜기.
- **11번은 셋 중 어느 것도 쓰지 않는다.** 바닥글 원본(링크 검사)과 사본 표(최신 지문)는 읽기만 한다. 자료 정책 폼이 `/admin/footer` 화면에 있지만 `market_purchase_policy` 키만 저장한다(코드 확인). 잠금 트리거는 `NEW.key` 가 `site_footer_content`·`member_withdrawal_policy` 일 때만 돌므로 11번 저장에 걸리지 않는다.
- **예외 하나 — 리허설**: 리허설의 '링크 문서 꺼짐·본문 빔' 경우는 거래 안에서 바닥글 문서의 `enabled`·`content` 를 바꾸므로 게시 뒤에는 `POLICY_UPCOMING_LOCKED` 로 막힌다(`label` 빈 글자 경우는 잠금 대상이 아니라 그대로 됨). 그래서 이 경우는 게시 전에 돌리거나, 게시 뒤라면 **그 경우의 거래 안에서만** `lock_policy_documents_during_notice` 트리거를 끄고 보고 ROLLBACK 한다(사본 트리거를 끄는 경우와 같은 방식, 새벽에 짧게). 롤백 뒤 트리거가 켜져 있고 게시 행·바닥글 값이 그대로인지 읽기 조회로 본다. 게시 행은 거래 안에서도 고치지 않는다.
- **2027-01-11 전에 내보내도 된다.** 10판의 시작 조건('10번 약관 문구 스크립트까지 끝남')은 그 스크립트가 시행일로 밀리면서 맞지 않게 됐고, 그 조건의 이유(11번 push 에 10번 커밋이 섞여 나감)는 10번 코드 배포로 사라졌다. 10번 시행 스크립트는 11번이 바꾸는 함수·정책 키의 md5 를 보지 않는다(확인함). 그래서 11번이 먼저 적용돼도 시행 스크립트는 그대로 돈다.
- **같은 새벽에 겹치지 않게 한다**: 15번 게시 스크립트, 10번 시행 스크립트(2027-01-11), 팝업 켜기, 12·13번 DB 단계와 11번 DB 단계(마이그레이션·A·B·되돌림)는 다른 날 돌린다. 모두 `system_settings` 를 쓰고 잠금을 잡아, 실패하면 원인을 가르기 어렵기 때문이다.
- **시행 뒤**: 환불정책·이용약관 본문이 바뀌면 사본 트리거가 새 사본을 만들고, 2판 기록은 그때부터 새 사본 지문을 남긴다(5-4 한계와 같음). 11번에서 할 일은 없다.
- **마이그레이션 파일 이름**: 운영 이력의 최신 판이 `20261205100000`(15번)이므로 11번은 그보다 뒤 이름으로 한다(예: `supabase/migrations/20261210100000_checkout_consent_v2.sql`, 실제 날짜는 구현 때). 10판의 `20261127…` 는 이력 순서가 거꾸로 된다. 12번(`20261214100000`)·13번(`20261211100000`·`20261211110000`)이 먼저 적용되면 11번 이름은 그 뒤로 하고, 13번 M1 이 다시 정의하는 `member_withdrawal_facts` 처럼 5-5 '그대로' 목록 값이 바뀌었으면 다시 읽어 고친 뒤 리허설한다. (12판)

## 4. 문구(DB)와 판
### 4-1. 판 구분 `consentFormat`(version 을 쓰지 않음)
- 두 정책에 정수 키 `consentFormat`. 없거나 1 → 1판, 2 → 2판, 그 밖(글자 "2", 2.5, 3, null) → 결제 닫힘(DB `NOTICE_POLICY_UNAVAILABLE`, 서버 null). SQL 은 `jsonb_typeof = 'number'` 와 숫자 비교만 쓴다(글자 비교 금지).
- `version` 은 판이 아니라 **편집 번호**다. 자료 관리자 저장도 이번에 낙관적 잠금 + 1 로 바꾼다(9절). 스크립트도 실행 때 +1. 옛 코드의 자료 폼은 version 을 보지 않으므로 스크립트 머리말 '실행 중 관리자 문구 저장 금지'로만 막는다.
- 관리자 저장은 `consentFormat` 을 입력으로 받지 않는다(읽은 원본 위에 문구 키만 덮음). 판 바꾸기는 5-6 스크립트로만. 1판 키는 지우지 않는다(1판 모드, 옛 기록 해석, 되돌리기).

### 4-2. 더하는 키(초안, 0-6·0-7)
- **`market_purchase_policy`**
  - `consentTitle`: 주문 내용·구매 조건 확인 및 동의
  - `consentSummary`: `refundPeriod` 받지 않은 자료는 구매일 다음 날부터 {자료환불기간}일째 되는 날까지 자료 보관함이나 고객센터로 환불을 신청할 수 있어요. / `restriction` 다운로드한 자료는 단순 변심으로 환불되지 않아요. 자료 안의 파일을 하나라도 받으면 그 자료는 받은 것으로 보고, 문제(HWP)를 받으면 함께 든 문제(PDF)도 받은 것으로 봐요. / `note` 하자가 있거나 소개 내용과 다른 자료는 다운로드한 뒤에도 환불받을 수 있어요.
  - `consentItems`: ① `{key:'purchaseNotice', label:'자료 환불 안내', view:'text', textKeys:['confirmNotice']}` ② `{key:'usageScope', label:'자료 이용 범위', view:'text', textKeys:['usageScopeNotice']}` ③ `{key:'refundPolicy', label:'취소·환불정책', view:'link', link:'refundPolicy'}` ④ `{key:'terms', label:'서비스 이용약관', view:'link', link:'serviceTerms'}`
  - 장바구니 문구(코드에서 옮김, 동의 원문에는 넣지 않고 따로 대조 — 5-4): `cartCheckoutNotice` 크레딧으로 선택한 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다. / `partialOwnedConfirmLabel` 이미 구매한 개별 자료가 포함된 전체 패키지는 기보유분 차감 없이 정가로 구매됨을 확인했습니다.
  - 철회의 효과(크레딧 환불)와 패키지 부분 환불은 요약 줄이 아니라 `confirmNotice`(세부 항목 창)·상품 상세에 있다(13절 질문 1).
  - 미성년자 결제 취소는 충전 단위로 다루므로(취소·환불정책 7절) 자료 구매 동의에는 두지 않는다(1판과 같음, 13절 질문 2). (12판)
- **`point_charge_policy`**
  - `consentTitle`: 주문 내용·충전 조건 확인 및 결제 동의
  - `consentSummary`: `refundPeriod` 이 충전 건의 크레딧을 하나도 쓰지 않았다면 결제일 다음 날부터 {충전환불기간}일째 되는 날까지 전액 환불을 신청할 수 있어요. / `restriction` 이 충전 건의 크레딧을 하나라도 쓰면 단순 변심으로는 취소할 수 없어요. / `validity` 충전한 크레딧은 결제한 때부터 {충전유효기간}년 동안 쓸 수 있고, 기간이 지나면 남은 크레딧은 쓸 수 없어요. (12판: '사라져요' → 지금 취소·환불정책·`checkoutItems.validity` 와 같은 '쓸 수 없어요') / `minor` 미성년자가 법정대리인 동의 없이 결제했다면 본인이나 법정대리인이 결제를 취소할 수 있어요(예외 있음).
  - `consentItems`: ① `product` '충전 상품 안내' text `['checkoutItems.product','checkoutItems.validity']` ② `refund` '취소·환불 안내' text `['checkoutItems.refund','checkoutItems.restriction','checkoutItems.otherCases']` ③ `minor` '미성년자 결제 취소 안내' text `['minorNotice']` ④ `{key:'refundPolicy', label:'취소·환불정책', view:'link', link:'refundPolicy'}` ⑤ `{key:'terms', label:'서비스 이용약관', view:'link', link:'serviceTerms'}` (12판: 이름 되살림)
  - 요약 줄은 본문·취소·환불정책보다 강하거나 다른 조건을 말하지 않는다(관리자가 고칠 때도 같은 원칙). (12판)
  - 미성년자 줄을 요약에 두는 것은 9번 법률 검증의 '동의 체크 바로 위' 보호를 지키기 위해서다. '먼저 끝나는 크레딧부터 쓰임'·'지급일 기준'은 본문에만 있고, 문구를 정할 때 `restriction` 끝에 붙이는 안을 먼저 검토한다(13절 질문 2).
  - `{충전유효기간}` = 서버 `POINT_CHARGE_VALIDITY_YEARS` = SQL 상수 1 = 지급 함수 `interval '1 year'`(계약 시험이 셋을 묶음).
- 2판 화면에서 쓰지 않는 키: 자료 `checkboxLabel`, 충전 `checkoutTitle`·`agreeLabel`(1판·되돌리기용).
- 상세 문구 `purchaseCompleteNotice`('구매 후 바로 다운로드…')는 **배포 직후 새 관리자 화면에서** '장바구니에서 구매하면 자료 보관함에서 바로 받을 수 있습니다.'로 바꾼다. 스크립트 A 에 넣지 않는 까닭: A 는 배포 전에 돌므로 옛 상세 '구매하기' 아래에 새 문장이 보이면 실회원이 오해한다. 관리자 이름표는 '상품 상세 담기 버튼 아래 안내'로.

### 4-3. 검증 규칙(TS·SQL 같은 식)
어기면 관리자 저장 거절, 스크립트 RAISE, DB 함수 `NOTICE_POLICY_UNAVAILABLE`, 서버 null(결제 막힘 + 경보. 단 10-1 스위치가 판을 바꾼 값에서는 경보를 남기지 않는다, 13판).
- **(S) 글자**: 2판 원문에 들어가는 모든 문자열은 jsonb 글자, 채운 뒤 `{`·`}` 없음, 공백·탭·LF·CR 이 아닌 글자가 있음(TS `/[^ \t\n\r]/`, SQL `~ '[^ \t\n\r]'`). 글자 수는 채우기 전 코드포인트(TS `[...s].length`, SQL `char_length`).
- **(S1) 한 줄 칸에 LF 금지**: 제목·요약 줄·항목 이름·장바구니 문구 2개. LF 는 가리킨 본문에만 허용한다(줄 구조가 다른데 지문이 같은 정책을 막음). 관리자 폼은 한 줄 칸을 `input` 으로.
- **(a)** `consentTitle` 1~26자, `[필수]` 를 넣지 않음(부품이 붙임).
- **(b)** `consentSummary` 는 객체. 역할 순서 — 자료 `refundPeriod`(필수)·`restriction`(필수)·`note`(선택), 충전 `refundPeriod`·`restriction`·`validity`·`minor`(모두 필수)·`note`(선택). 값 1~120자, 자료는 합계 220자 이하. 선택 역할은 키가 없을 때만 빠진 것으로 보고, 키가 있는데 null·글자 아님이면 거절. `refundPeriod` 에 기간 자리표시, 충전 `validity` 에 `{충전유효기간}` 필수. 필수 줄은 관리자 폼에서 지울 수 없다.
- **(c) 숫자 금지**(제목·요약 줄·항목 이름, 채우기 전): `[0-9０-９]` 없음, 그리고 `([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)` 과 `(하루|이틀|사흘|나흘|열흘|보름|한 해)` 없음. 기간은 자리표시로만 쓴다. 걸린 칸을 짚어 알리고, 숫자가 필요한 표현은 본문에 둔다.
- **(d)** `consentItems` 1~6개. text 면 키가 정확히 `key·label·view·textKeys`, link 면 `key·label·view·link`. `key` `^[a-z][A-Za-z0-9]{0,29}$` 중복 없음, `label` 1~30자, `textKeys` 1~6개·전체에서 중복 없음, `link` 는 `refundPolicy`·`serviceTerms` 각각 한 번까지.
- **(e) 가리킬 수 있는 본문**(문자열 잎만, SQL 은 CASE 로, `#>>` 일반 풀이 금지): 자료 `confirmNotice`·`usageScopeNotice`·`downloadPeriodNotice`, 충전 `checkoutItems.{product,validity,refund,restriction,otherCases}`·`minorNotice`.
- **(f) 포함**: 자료는 `confirmNotice` 와 두 링크가 있어야 하고, 충전은 (e) 6개 전부와 두 링크가 있어야 한다.
- **(g) 링크 문서가 보여야 함**(결제 때만, 관리자 저장 검사에는 넣지 않음): 서버·DB 모두 **정규화하지 않은 바닥글 원본**(`site_footer_content` 의 `value -> 'policyDocuments' -> <키>`)에서 객체임, `enabled` 가 정확히 `true`, `label`·`content` 가 (S) 의 비지 않은 글자임을 본다. DB 는 그 문서의 사본이 하나 이상 있는지도 본다. `getVisibleFooterPolicyLinks`(정규화 결과)는 쓰지 않는다. 기존 `inspectRawFooterPolicyDocument` 는 'enabled 없으면 켜짐'이라 그대로 쓰지 않는다(이 검사가 더 엄격해 막히는 쪽이고, 운영 값은 모두 `true`). 서버가 원본을 못 읽으면 닫는다. 화면 href 는 지금처럼 `buildMarketPurchaseInfo` 에서 읽되, 검사가 닫힘이면 고지 없음으로 본다.
- **장바구니 문구**: jsonb 글자, 중괄호 없음, LF 없음, 비지 않음, 1~300자. 어기면 장바구니 결제 칸을 닫는다(1판·2판 모두). DB 도 이 규칙을 **모두** 지킬 때만 문장·지문을 만든다.

### 4-4. 해석을 나눈다(동의 문구 실수가 환불을 막지 않게)
- `parseMarketPurchasePolicy`·`parsePointChargePolicy` 는 그대로 두고 새 키를 읽지 않는다(환불·보관함·상세·크레딧 화면이 씀). 새 해석 `parseMarketPurchaseConsent`(판, 2판 재료, 장바구니 문구)·`parsePointChargeConsent`(판, 2판 재료)를 둔다.
- 읽는 함수의 값 모양은 `{ policy, consent | null, cartTexts | null, consentFormat: 1 | 2 | null }`. **1판 해석 실패만 throw**(null 이 캐시되지 않게), 나머지 셋은 따로 성공·실패하고 실패면 null. 판 1 에서 2판 키가 깨져도 결제는 1판으로 되고, 판 2 에서 깨지면 결제만 닫힌다. DB 환불 판정 함수도 새 키를 읽지 않는다.
- 장바구니 뷰(`/api/market/cart`, 페이지 첫 값)와 충전 화면은 정책을 **캐시 없이** 읽는다. 상세·보관함은 60초 캐시 그대로. 캐시 키는 `market_purchase_policy:v3`·`point_charge_policy:v2` 로 올린다.

## 5. 동의 기록·지문 2판(DB)
### 5-1. 원문 규칙
- 입력: 정책 `P`, 기간 `D`(자료 `P.refundDays`, 충전 `point_charge_refund_days()`), 충전 유효기간 `Y`=1. 채우기 `fill`: 자료 `{자료환불기간}`→D, 충전 `{충전환불기간}`→D 다음 `{충전유효기간}`→Y(TS `split().join()`, SQL `replace()`).
- 줄 목록: ① `fill(consentTitle)` ② 역할 순서대로 있는 요약 줄 ③ 항목 순서대로 `fill(label)`, 그 뒤 text 면 `textKeys` 순서의 `fill(본문)`(본문 안 줄바꿈 그대로), link 면 `링크:` + link 키. SQL 은 `jsonb_array_elements … WITH ORDINALITY … ORDER BY`.
- 원문 = 줄을 LF 로 이음(끝 LF 없음, trim·정규화 없음, `key`·`view`·역할 이름·번호는 넣지 않음). 지문 = sha256(UTF-8) 소문자 16진수. 1판 규칙은 그대로.
- **시험 벡터**(충전, D=7, Y=1, 원문 계산만 보는 짧은 값) (12판: 11판 안에 다시 적음)
  ```
  P = { consentFormat: 2, consentTitle: "주문 내용·충전 조건 확인 및 결제 동의",
        consentSummary: { refundPeriod: "{충전환불기간}일째 되는 날까지 신청할 수 있어요.", restriction: "하나라도 쓰면 취소할 수 없어요.",
                          validity: "{충전유효기간}년 동안 쓸 수 있어요.", minor: "미성년자는 취소할 수 있어요." },
        checkoutItems: { product: "상품 A", validity: "기간 B", refund: "환불 {충전환불기간}일\n둘째 줄", restriction: "제한 C", otherCases: "기타 D" },
        minorNotice: "미성년 E", consentItems: [ 4-2 충전 항목 ①~⑤ 그대로 ] }
  ```
  기대 원문(줄마다 LF, 끝 LF 없음):
  ```
  주문 내용·충전 조건 확인 및 결제 동의
  7일째 되는 날까지 신청할 수 있어요.
  하나라도 쓰면 취소할 수 없어요.
  1년 동안 쓸 수 있어요.
  미성년자는 취소할 수 있어요.
  충전 상품 안내
  상품 A
  기간 B
  취소·환불 안내
  환불 7일
  둘째 줄
  제한 C
  기타 D
  미성년자 결제 취소 안내
  미성년 E
  취소·환불정책
  링크:refundPolicy
  서비스 이용약관
  링크:serviceTerms
  ```
  지문 `2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7`(Python `hashlib` 과 운영 Postgres `sha256(convert_to(…,'UTF8'))` 로 같음을 확인). 자료 벡터는 구현 때 만들고 `note` 줄, 앞뒤 공백이 있는 요약 줄, LF 로 끝나는 본문, 본문 둘인 항목을 넣는다. TS 단위 시험과 SQL 리허설이 같은 값을 낸다.

### 5-2. 화면으로 보내는 모양
- **2판 묶음**(DB·서버가 같은 값): `{ consentFormat: 2, consentTitle, consentSummary: string[], consentItems: [{key,label,view:'text',texts:string[]} | {key,label,view:'link',link}], noticeSha256, refundDays, plan?(충전 DB details 만) }`. 묶음으로 다시 만든 원문의 sha256 = `noticeSha256`. **1판 키는 2판 묶음에 넣지 않는다.**
- **DB 응답**: 11번 기록 함수는 모든 응답에 `consentFormat` 키를 둔다 — 정책을 읽기 전 응답(`NOTICE_INPUT_INVALID`, 충전 `MEMBER_WITHDRAWN`)·판 값 오류는 null, replay 는 기록 행의 `consent_format`(replay 위치는 지금 그대로), 그 밖은 그때 판. 1판 409 details 는 지금 모양 + `consentFormat: 1`, 2판은 2판 묶음만. 자료 `NOTICE_CHANGED`·`NOTICE_KEY_CONFLICT` 에는 `cartTexts` 도 담는다.
- **서버 409**: 자료 `{ success:false, error:{code,message}, details: <1판|2판 고지>, cartTexts: {cartCheckoutNotice, partialOwnedConfirmLabel, cartTextsSha256} | null }`(`marketCartErrorResponse` 에 최상위 `cartTexts` 자리를 더함), 충전은 `notice` 에. 서버는 새 해석기로 검사한 값만 넘긴다(충전 대체 경로 포함).
- **11번 함수 표식**: 새 서버는 기록 함수 응답에 `consentFormat` 키가 없으면(`Object.hasOwn`, 값 null 이어도 11번) 503 으로 닫는다. 그래서 새 코드인 채 11번 down 을 해도 화면이 1판·2판을 오가지 않는다. 탈퇴 403·잘못된 요청 400 은 지금 분기 그대로.
- **해석기를 거치지 않는 값은 칸을 나눈다**: 장바구니 뷰·`/checkout` 첫 값에서 1판 칸(`purchaseNotice`·`checkoutNotice`)은 1판 모양만, 2판 묶음은 새 칸(`purchaseConsent`·`checkoutConsent`). 둘 중 하나만 값이 있다. 장바구니 문구는 판과 관계없는 칸 `cartTexts`. 그래서 뷰를 해석하지 않는 옛 장바구니 탭은 2판일 때 `purchaseNotice` 가 null 이라 막힌다. 옛 해석기(`parseMarketPurchaseNotice`·`parsePointChargeCheckoutNotice`)는 2판 묶음에 null 을 낸다. **옛 화면이 1판 글을 보이며 2판 지문을 보내는 길이 없다.**
- 링크 주소는 묶음에 넣지 않는다. 화면이 가진 href 와 link 키로 합치고, 바닥글 문서 이름은 쓰지 않는다.

### 5-3. 기록 칸 추가
- `market_purchase_notice_acks`: `refund_policy_sha256`·`terms_policy_sha256` text NULL, `consent_format smallint NOT NULL DEFAULT 1`(CHECK `market_purchase_notice_acks_consent_format_check` IN (1,2)), `consent_details jsonb NULL`. `point_charge_checkout_acks`: `terms_policy_sha256`, `consent_format`(CHECK `point_charge_checkout_acks_consent_format_check`), `consent_details`. `ADD COLUMN IF NOT EXISTS`, CHECK 는 없을 때만. 상수 기본값이라 표를 다시 쓰지 않고 추가 전용 트리거와 부딪치지 않는다.
- `consent_details`: 자료 기록은 `cartTexts`(아래 규칙), 2판 기록은 `consent` = 2판 묶음에서 `noticeSha256`·`plan` 을 뺀 것(구조를 되살림, 다시 만든 원문 sha256 = `notice_sha256`). 충전 1판은 NULL.
- 2판 문서 지문 = `doc_key` 별 최신 seq 의 `content_sha256`. **2판에서 사본이 없으면 NULL 로 두지 않고 닫는다.** 1판 분기는 지금 값 그대로(자료 문서 지문 NULL, 충전 `terms_policy_sha256` NULL, `consent_format` 1). 충전 2판의 `refund_days` 는 1판과 같은 `point_charge_refund_days()` 값(환불 판정·10번 탈퇴 함수가 읽음).
- 한계: 문서 지문은 기록하는 때의 최신 사본이다. 글은 같고 구조만 다른 정책 변경은 DB 가 받아들이고 새 구조로 남는다(화면은 구조 비교로 동의를 비움, 6-4).

### 5-4. 장바구니 문구 대조
- 화면은 보이는 문구 사본에 든 `cartTextsSha256` 을 그대로 보낸다(직접 계산하지 않음). 지문 = sha256(UTF-8 `cartCheckoutNotice` + LF + `partialOwnedConfirmLabel`), trim 없음.
- 자료 기록 함수(1판·2판 같음): ① 인자 NULL(옛 코드) → 지금처럼 기록, `cartTexts` null ② 정책 문구 지문과 같음 → 기록, `cartTexts` 에 두 문장 전문과 지문 ③ 다르거나 정책 문구가 규칙 위반 → **기록하지 않고** `NOTICE_CHANGED`(details + `cartTexts`). 값이 있으면 `^[0-9a-f]{64}$`(아니면 `NOTICE_INPUT_INVALID`).
- replay 판정은 ② 단계(정책 읽기 전)와 ⑥ `ON CONFLICT DO NOTHING` 뒤 **두 곳 모두** 고지 지문과 `cartTextsSha256` 이 같을 때만. 장바구니 지문 비교는 NULL 끼리도 같다(`consent_details->'cartTexts'->>'cartTextsSha256' IS NOT DISTINCT FROM p_cart_texts_sha256`) — 옛 코드의 재시도(인자 NULL, 기록도 null)가 replay 로 끝나게. 다르면 `NOTICE_KEY_CONFLICT`. (12판)
- 읽는 법: `cartTexts` 는 그때 결제 칸 문구의 판이다. 부분 보유 문장이 실제로 보였는지·체크됐는지는 같은 키의 `request_payload` 줄별 `ack` 로 본다.

### 5-5. 바꾸는 DB 함수(마이그레이션, 파일 이름은 3절)
| 함수 | 사전 검사가 받는 바탕 값 | 바꾸는 것 |
|---|---|---|
| `build_checkout_consent_v2(p_kind text, p_value jsonb, p_refund_days integer) RETURNS jsonb`(새 내부) | 없음 | 4-3 검사(링크 문서 포함)와 원문·묶음. 성공 `{text, details}`, 어기면 NULL. **판을 보지 않는다**(판 1 일 때도 스크립트·단계 6 이 부름) |
| `build_market_cart_texts(p_value jsonb) RETURNS jsonb`(새 내부) | 없음 | 장바구니 문구 규칙 검사와 `{cartCheckoutNotice, partialOwnedConfirmLabel, cartTextsSha256}`, 어기면 NULL. 기록 함수와 단계 6 이 같은 함수를 부름 |
| `record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)` | 3인자 `fa6a7edd…` | 판 분기, 2판 기록 칸, 5-4 규칙, 모든 응답에 `consentFormat` |
| `record_point_charge_checkout_ack`(6인자) | 10번 `be4403fd…`(`0047854a…` 는 받지 않음) | 판 분기, 탈퇴 거절은 맨 앞 그대로, 2판은 묶음 + `plan`·기록 칸, 모든 응답에 `consentFormat` |
- **사전 검사**는 네 함수마다 {바탕 값, 이 파일의 새 md5, 고친 파일이면 앞에 적용한 판의 md5} 를 받고(`to_regprocedure` 로 찾음 — 3인자·4인자가 둘 다 있거나 둘 다 없으면 멈춤), **VERIFY** 는 이 파일의 새 md5 를 본다. **down 사전 검사**는 11번 값일 때만 진행한다.
- 인자 변경은 한 거래에서 `DROP FUNCTION IF EXISTS …(uuid,uuid,text)` 뒤 4인자 `CREATE OR REPLACE`(옛 코드의 이름 인자 3개 호출은 기본값으로 맞음). 다른 함수도 모두 `CREATE OR REPLACE`. 그래서 down 없이 다시 실행해도 멈추지 않는다.
- **권한**: 두 기록 함수는 `REVOKE ALL … FROM PUBLIC, anon, authenticated` 후 `service_role` 에만 EXECUTE(지금 ACL `postgres=X, service_role=X`). 새 내부 함수 둘은 `service_role` 까지 REVOKE(SECURITY DEFINER 기록 함수와 스크립트만 부름, 읽기 전용 사용자에게도 주지 않음). VERIFY·down VERIFY 가 `proacl` 과 `has_function_privilege('anon'|'authenticated')` = false 를 본다.
- **형식**: `SET LOCAL lock_timeout = '3s'`·`statement_timeout`(10번과 같은 값), 잠그는 순서 `market_purchase_notice_acks` → `point_charge_checkout_acks`(ACCESS EXCLUSIVE, 거래 끝까지·읽기도 막음 → 새벽에 짧게), `-- [11번] 시작/끝` 표식, 파일 끝·down 끝 `NOTIFY pgrst, 'reload schema'`, `src/types/supabase.ts` 다시 만들기, 다시 적용은 10번 머리말과 같은 방법(같은 거래에서 이력 행을 지우고 파일 + 이력 INSERT).
- **그대로여야 함**(이름과 md5, 2026-11-26 운영 값): `checkout_market_selection` `0cda5ff7689d998cc6cf2fd213b0004d`, `get_point_charge_refund_eligibility` `60fc28afe44e7be776c189265e87b6ec`, `point_charge_refund_days` `7ab4d40c1634ade20de86517fa13cd40`, `guard_point_charge_checkout_acks_mutation` `c7ef25308c6c0aa2920991965fb87ab0`, `guard_market_purchase_notice_acks_mutation` `3959ac2b8139d0f81365df59ed67ef10`, `prepare_payment_order` `93e0bd5e41969f66f296f4353f3feeb9`, `begin_payapp_request` `679b4474c0dc42de11e5e9a14a7d1d4d`, `payapp_fulfill_order_internal` `657bbb07ae4b250a2697f21e2aa805e9`, `market_purchase_refund_days` `5d4030e7bedbace6189cefed80c3d27b`, `record_policy_document_snapshots` `4ffeca80346467f928c0a6f50b69018d`, `prevent_policy_document_snapshot_mutation` `b1449554c094a90be7a6c864f367fdf8`, `member_withdrawal_facts` `a7674770964dac2fe5c9179b8403c3b4`, `get_member_withdrawal_preview` `3a2e2c2f6eb6ecb15defe0879c88e0fc`, `anonymize_member` `1346d870d3623abae580a011b0484339`. 스크립트 사전 검사에는 `record_admin_audit` `a42b474d9d95753ffba5041acb0c1c77` 도. 값이 적용 전에 바뀌면 고친 뒤 리허설을 다시 한다.
- **down**(`supabase/rollback/<같은 이름>_down.sql`): 두 기록 함수를 바탕 정의로(4인자 지우고 3인자·GRANT 되돌림), 새 내부 함수 지움. **칸은 지우지 않는다**(증빙, 옛 함수에 해 없음). 10번 `_down_b` 는 충전 함수가 `be4403fd…` 일 때만 돌므로 **10번을 되돌리려면 11번 down 먼저**.

### 5-6. 데이터 스크립트(마이그레이션이 아님)
세 파일 머리말에 '실행 전부터 끝까지 관리자 구매 고지·충전 문구 저장 금지'. 모두 `version` +1 과 `admin_audit_log`(이전 값 전체, `bundle` 이름)를 남긴다.
- **A** `…_bundle11_consent_keys.sql`: 사전 — 네 함수가 11번 md5, `consentFormat` 없음, 정책 값 md5 가 실행 전에 적어 둔 값. 하는 일 — 4-2 키 + `consentFormat: 1`. VERIFY — `build_checkout_consent_v2` 두 정책 모두 NULL 아님, 1판 키(`purchaseCompleteNotice` 포함) 글자 그대로, 장바구니 문구 규칙 통과. 다시 적용 때 `consentFormat` 이 있으면 건너뛴다.
- **B** `…_bundle11_consent_format_2.sql`: 10절 단계 6 을 마친 뒤에만. 사전 — 네 함수 md5, 판 1, `build_checkout_consent_v2` NULL 아님, **두 정책 값 md5 가 단계 6 에서 대조한 값과 같음**(다르면 멈추고 단계 6 다시). 하는 일 — 판 2. VERIFY — 판 2, 키 그대로.
- **되돌림** `…_bundle11_consent_format_1.sql`: 2판이 닫힌 때(링크 문서 꺼짐·키 깨짐)가 가장 필요한 때라 `build_checkout_consent_v2` 결과를 보지 않는다. 사전 — 네 함수 md5, 판 2, 정책 값 md5. 하는 일 — 판 1(2판 키는 남김).
- **화면 전환**: 장바구니·충전은 캐시가 없어 다음 읽기부터 새 판, 그 전에 열린 화면은 결제 때 409 로 새 판을 받아 다시 동의한다(실회원이 한 번 더 체크 → 새벽에). 11번은 약관을 바꾸지 않으므로 가입 재동의는 없다.

## 6. 장바구니 결제 칸(A안)
### 6-1. 부품 나누기
- **표시 부품**(props 만, 요청·supabase 없음): `CartPageView`(2단·'결제 칸으로 건너뛰기'·목록·결제 칸·고정 막대), `CartLineListView`, `CartCheckoutPanelView`, `ChargeCheckoutView`, 공통 동의 부품 `CheckoutConsent`(`src/components/checkout/checkout-consent.tsx`), 상세 담기 결과 창, 결제 내역 2판 기록 보기.
- **제어 값은 껍데기가 든다**: 동의(전체·하위), 부분 보유 확인, 줄 선택. 표시 부품 안의 상태는 창 열림·보기 펼침·목록 펼치기·높이 재기·막대 보임뿐이다. 응답 뒤 화면 동작(초점 요청, 완료 창 대기열, 고지 교체 표식, 알림)도 props 로 받는다.
- **껍데기**: 지금의 `cart-view.tsx`·장바구니 `page.tsx`·`checkout-client.tsx`·`/checkout` `page.tsx` 자리. 뷰 읽기, 결제 요청, 키·스냅숏, 선택 저장, 동의 수명, 토스트. 15번 `upcomingNotice` prop 은 그대로 받아 지금 자리에 그린다. (11판)
- **순수 함수**(단위 시험으로 고정): 결제 버튼 이름·열림, 칸 모드 판정 `decideCheckoutPanelMode`, 충돌 판정, 응답 처리 `reduceCheckoutResponse(state, response)`, 주문 키·지문·구조 비교와 비우기 판정.

### 6-2. 배치 원칙과 1366×768 기준 (11판)
- **넓은 화면(lg)**: 2단. 왼쪽 목록, 오른쪽 결제 칸(고정 폭, 지금 요약 칸보다 약간 넓게). 좁은 화면은 칸이 목록 아래로 가고 늘 보통 흐름.
- **칸 구성**: 위 영역(제목 '결제 금액', 알림 자리, 부분 보유 확인, '선택한 자료 N건' 접힌 목록, 합계·보유 크레딧, `cartCheckoutNotice`, 충전 안내)과 **아래 묶음**(금액 한 줄 '합계 N · 결제 후 잔액 M' 또는 '· 부족 M', `CheckoutConsent`, 버튼 줄). sticky 일 때 위 영역만 안에서 스크롤하고 아래 묶음은 늘 보인다.
- **원칙 1 — 칸 높이를 묶는다**: 세부 항목은 칸 안에서 펼치지 않고 창으로 연다(6-5). 그래서 칸 높이는 저장된 문구로만 정해진다.
- **원칙 2 — 아래 묶음 높이는 쓰는 도중 변하지 않는다**(lg, sticky 판정에 쓰는 화면): 상태에 따라 생기고 사라지는 보이는 줄을 아래 묶음에 두지 않는다. 알림·0건 안내·부족 안내·다시 읽기 실패와 [다시 불러오기]·부분 보유 확인은 위 영역에, 막힌 이유는 버튼 이름과 sr-only live 영역에 둔다. 두 버튼 상태(부족, retryable)도 같은 높이의 버튼 줄 하나다. 금액 줄은 단위('크레딧')를 붙이지 않고 `tabular-nums` 로 쓰며, lg 에서는 줄바꿈하지 않는다. 좁은 화면(보통 흐름)에서는 줄바꿈을 허용해 큰 금액·부족 금액이 잘리지 않게 한다. 예외는 고지 없음 하나(동의 자리가 경고로 바뀌어 줄어듦). (12판)
- **알림 자리**: 위 영역 맨 위에 **처음 그릴 때부터 늘 두는 두 요소**(안내 `role="status"`, 오류·다시 읽기 실패 `role="alert"`)이고 글만 바꾼다. 한 요소의 role 을 바꾸지 않는다(충전 화면 `checkout-client.tsx` 의 안내 영역과 같은 방식). 토스트만으로 알리지 않는다. 알림이 생기면 '주문 내용이 바뀌었습니다'·'안내 문구가 바뀌었습니다'·'이전 N → 지금 M' 같은 이유가 보이게 한다: sticky 이면 위 영역 `scrollTop` 을 0 으로, 보통 흐름(좁은 화면·낮은 높이)에서는 **결제 칸 안의 조작(결제·다시 시도·다시 선택·잔액 다시 확인 등)과 그 응답으로 생긴 알림만**, 알림 자리가 보기 영역 밖이면 문서 `scroll-padding` 을 지켜 화면 안으로 스크롤한다. 목록에서 줄을 골라 생긴 알림('주문 내용이 바뀌었습니다' 등)은 스크롤하지 않고 `status` 로 읽힌다(목록을 쓰는 중에 화면이 튀지 않게). 어느 쪽이든 초점은 옮기지 않는다(막대 초점 규칙은 그대로). 위 영역이 알리는 상태에서는 sr-only 이유를 비워 한 상태 변화에 하나만 읽힌다. (12판·13판)
- **원칙 3 — sticky 는 들어갈 때만**: `decideCheckoutPanelMode(아래 묶음 높이, 칸 최대 안쪽 높이)` 가 아래 묶음 + 위 영역 최소 높이가 들어가면 sticky, 아니면 보통 흐름을 고른다. sticky 이면서 넘치는 상태는 없다. 판정은 첫 그리기 직후, 글꼴 로드 끝(`document.fonts.ready`, Pretendard 가 늦게 불림), 창 크기 바뀜, 고지 사본 교체 때만 하고 쓰는 도중에는 하지 않는다(원칙 2 덕분). 상태가 아닌 이유로 아래 묶음 높이가 바뀌면 다시 판정한다. 교체로 넘치게 되면 보통 흐름으로 바꾸고 결제 칸을 화면 안으로 스크롤한 뒤 알린다. (12판)
- **원칙 4 — 고정 막대는 결제 버튼 줄을 본다**: 막대(선택 건수·합계 + '결제 칸으로')는 **결제 버튼 줄이 화면 밖일 때** 모든 폭에서 보인다(결제 칸 일부가 보이는지가 아님). 그래서 첫 화면에서 칸이 머리글·제목·15번 한 줄 안내 아래에 걸려 버튼 줄이 접힘선 밖이어도 막대가 보인다. 막대는 결제하지 않는다. 누르면 결제 칸으로 스크롤하고 **첫 번째 막힌 이유의 조작**(없으면 아직 안 켠 부분 보유 확인 → 동의 → 결제 버튼)에 초점을 준다. **비활성 요소에는 초점을 주지 않는다**: 조작이 없거나 비활성인 상태(결제 중·다시 읽는 중·선택 저장 중·0건)는 알림 자리나 결제 칸 제목(`tabIndex=-1`)에, 충돌은 첫 충돌 줄 표시에 준다. 버튼 줄이 보이면 막대를 숨기고(`hidden`/`inert`), 초점이 막대 안에 있으면 숨기기 전에 결제 칸 제목으로 옮긴다. (12판)
- **스크롤 여백**: 문서(`html`)의 `scroll-padding` 으로 sticky 머리글과 막대에 초점 대상이 가리지 않게 한다(대상별 `scroll-margin` 은 겹치므로 쓰지 않음). sticky 칸 안 대상은 위 영역 `scrollTop` 을 직접 옮긴 뒤 `focus({preventScroll:true})`. 막대가 보이는 동안 페이지 바닥 여백을 두고 토스트를 막대 위로 띄운다.
- **수용 기준**(px 예산 대신, 11절 화면 시험이 관문): 1366×768(보기 영역 약 640px)·1366×600·390×844·360×640 에서 2판 초안 문구와 1판 지금 문구로
  1. 스크롤 전 첫 화면과 어느 스크롤 위치에서든 **결제 버튼 줄과 고정 막대 중 하나는 늘 보인다**.
  2. 1366×768 에서는 칸이 sticky 로 붙고, 붙은 뒤 **동의 체크·요약 줄 전부·결제 버튼 줄이 칸 안에서 잘리지 않고 함께 보인다**(줄을 고르거나 알림이 떠도 그대로).
  3. lg 에서 아래 묶음 높이는 0건·선택·동의 켬/끔·부족·충돌·retryable·결제 중·다시 읽는 중·다시 읽기 실패·7자리 금액에서 같다. 좁은 화면에서는 7자리 합계·잔액·부족이 잘리지 않는다. (12판)
  4. 1366×600 처럼 들어가지 않으면 보통 흐름이고, 페이지를 내리면 동의·요약 줄·결제 버튼이 한 화면에 함께 들어온다.
  실패하면 아래 묶음의 여백·1판 본문 상자 높이·요약 줄 밖의 글꼴을 줄인다. **요약 줄 글꼴과 대비는 줄이지 않는다**(6-5). 위 영역은 판정에 들지 않는다. (12판)

### 6-3. 결제 버튼과 막힌 상태
- 이름은 한 함수에서 고르고 막대도 같은 값을 쓴다. 겹치면 이 순서: 결제 중 → 다시 읽는 중 → 선택 저장 중 → 다시 읽기 실패('장바구니를 다시 불러와 주세요') → retryable([같은 요청으로 다시 시도]·[다시 선택]) → 0건('자료를 선택하세요', 동의 체크도 비활성) → 고지 없음 → 함께 살 수 없는 선택 → 부족('크레딧 충전'·[잔액 다시 확인]) → 부분 보유 확인 전 → 동의 전('필수 동의를 체크해 주세요') → 'N 크레딧 결제하기'. 충돌을 부족보다 앞에 두어 부풀어 오른 합계로 충전(실결제)을 권하지 않는다. 충돌이면 금액 줄에 '부족'을 보이지 않는다.
- [잔액 다시 확인]은 장바구니를 다시 읽는다. 충전 결과 화면의 `credit-balance-updated` 는 다른 문서라 장바구니에 닿지 않으므로 기대지 않는다.
- **함께 살 수 없는 선택 미리 막기**: 장바구니 뷰 줄에 `evaluate_market_targets` 의 `categorySlug`·`includesPdf` 를 그대로 담고, 공용 판정 함수는 이 두 값과 `targetKind`·`itemId` 만 쓴다(지금 뷰 줄에는 두 값이 없음, 상세의 `fileTypes` 판정을 쓰지 않음). (12판) 판정 식은 DB `checkout_market_selection` 6단계와 같다 — 같은 `itemId` 의 두 줄이 (bundle + subproduct) 또는 (`question_pdf` + `question_hwp` 이고 그 HWP 의 `includesPdf`). 서버 `includesPdf` 는 'PDF 파일이 하나라도 있음'이라 그것만으로 'PDF 포함 HWP'로 쓰지 않는다. 공용 함수(`src/lib/`)를 장바구니와 상세가 함께 쓴다. 다시 담은 줄이 충돌하면 선택을 풀지 않고 두 줄에 표시만 한다. 422 는 대비 경로.
- 부분 보유 확인의 접근 이름은 보이는 DB 문장뿐이다. 장바구니 줄 안의 정가 구매 조건 문장은 지우고 '정가 구매' 표시만 남긴다(같은 조건이 두 말로 보이지 않게). 업그레이드 차액 문장은 UI 고정 글로 둔다.

### 6-4. 요청 키·응답·동의 수명
- **요청**: `cartTextsSha256` 하나만 더한다. 스냅숏 = 줄마다 `cartItemId`·`expectedCredits`·`acknowledgeNoDiscount` + `noticeSha256`·`cartTextsSha256` + 요청 키(껍데기 state 에서 만듦), 재시도는 그대로 다시 보냄, 진행 표식으로 겹친 클릭을 막음.
- **서버**: `cartTextsSha256` 이 없으면(옛 탭) 먼저 그 키의 영수증을 조회해 있으면 지금 성공 응답과 같은 모양(`alreadyCompleted`·잔액 필드), 조회 실패면 503 retryable, 없을 때만 400 `CART_TEXTS_REQUIRED`(기록 전에 막음). 있으면 기록 함수에 넘기고, DB 가 거절하면 결제 RPC 를 부르지 않고 409. `checkout_market_selection`·`request_payload` 는 바꾸지 않는다.
- **키 수명**: 네트워크 오류·응답 없음·5xx 만 retryable(스냅숏·키 유지). 그 밖은 모두 스냅숏을 버리고 다음 클릭에 새 키. retryable·결제 중에는 목록 조작·부분 보유 확인·동의 체크를 잠그고(창 열기·보기는 열어 둠), 나가는 길은 [같은 요청으로 다시 시도]·[다시 선택] 둘.
- **[다시 선택]**: 먼저 영수증 조회 → 200 이면 완료 창, 404 면 스냅숏을 버리고 다시 읽기, 그 밖은 retryable 유지. 404 뒤에는 직전 키와 줄 묶음을 기억해, 그 줄이 다시 읽기에서 사라지거나 첫 결제가 `CART_CHANGED`·`ALREADY_OWNED` 면 한 번 더 조회한다(완료 창 없이 잔액만 준 화면이 남지 않게). 완료 창이 겹치면 차례로 보인다. 잔액은 다시 읽은 뷰 값, 실패 때만 `data.balanceAfter`.
- **응답별**: 성공(동의·부분 보유 확인 비움, 산 줄 빼기), `PRICE_CHANGED`(다시 읽고 '이전 N → 지금 M', 이전 가격은 따로 state), `PURCHASE_NOTICE_CHANGED`(`details`·`cartTexts` 를 새 해석기로 읽어 바뀐 사본 교체, 동의 비움, 해석 실패면 잠그고 다시 읽기), 402(다시 읽고 부족 표시), `ACK_REQUIRED`(장바구니를 다시 읽고, `details.lines` 의 줄을 부분 보유로 보이게 한 뒤 확인을 비우고 초점 — 다른 탭에서 사서 뷰가 낡은 경우에도 확인 칸이 생기게, 12판), `CART_CHANGED`·`ALREADY_OWNED`·`BUNDLE_COMPONENTS_EMPTY`·그 밖 400·404·422(안내 + 다시 읽기), `CONFLICTING_SELECTION`(`details.itemIds` 는 자료 id → 같은 `itemId` 줄 표시), `IDEMPOTENCY_CONFLICT`(안내 + 다시 읽기), 403 동의 필요(`redirectToConsentIfRequired`), 401(로그인).
- **동의 수명**(늘 떠 있는 칸이라 필요한 규칙)
  - 결제 칸은 보인 고지를 **사본**으로 둔다. 다시 읽기·409 로 받은 고지의 지문이 다르거나, 지문이 같아도 **구조**(요약 줄 수, 항목 수, 항목마다 `key`·`view`·`texts` 수)가 다르면 사본을 바꾸고 동의를 비우고 '안내 문구가 바뀌었습니다'를 보인다.
  - **주문 키**(선택 줄 `cartItemId` 정렬 묶음 + 줄별 `expectedCredits`)가 바뀌면 동의를 비운다. '주문 내용이 바뀌었습니다'는 켜져 있던 동의를 실제로 비운 때만, 성공 뒤에는 안 보임.
  - 장바구니 문구 지문이 바뀌면 문구 사본을 바꾸고 동의와 부분 보유 확인을 모두 비운다. 부분 보유 확인은 선택된 부분 보유 줄 묶음이 바뀌어도 비운다. 성공하면 모두 비운다.
  - **고지 없음**(두 칸 null, `cartTexts` null, 해석 실패, 링크 문서 닫힘): 동의 자리에 '결제 전 확인 내용을 불러오지 못해 지금은 결제할 수 없습니다. 잠시 후 다시 시도해 주세요.'(`role="alert"`, 빨강 아님) + [다시 불러오기], 결제 막음. **다시 읽기 실패**: 이전 화면을 두고 위 영역에 안내 + [다시 불러오기], 결제 막음.
  - 체크가 켜진 채 지문·구조만 바뀌는 길은 없어야 한다(계약 시험).

### 6-5. 공통 동의 부품 `CheckoutConsent`
- 모양: `☐ [필수] {consentTitle}   [세부 항목]` 아래에 요약 줄 전부. [세부 항목]은 창(공용 StudioDialog, 제목 '세부 항목 — {consentTitle}')을 열고, 창 안에 하위 항목 체크와 '보기'가 있다. 창 버튼은 [닫기] 하나(동의를 켜지 않음, '확인' 쓰지 않음), 본문만 스크롤하고 [닫기]는 늘 보인다, 닫으면 초점은 [세부 항목]으로.
- 체크: 처음에 모두 비움(제어 값). 위 체크 = 하위 전부, 하위 일부면 '일부 선택'(`aria-checked="mixed"`, 빼기 아이콘). 제목 글자를 눌러도 위 체크(label). [세부 항목] 접근 이름에 진행('m개 중 n개 동의').
- 보기: text 는 창 안에서 그 항목 아래로 펼침(`aria-expanded`), link 는 새 탭. 보이는 항목 이름은 `consentItems.label` 뿐이고 '보기' 는 고정 버튼 글, 접근 이름은 항목마다 다름(`{label} 본문 보기`·`{label} 보기(새 창)`). link 주소가 없으면 부품 대신 고지 없음.
- 접근성·디자인: 44px 터치 영역, `role="group"`, 위 체크 `aria-describedby` = 요약 줄 목록. **요약 줄은 결제 칸 본문과 같거나 큰 글자에 `--consent-ink`(대비 4.5:1 이상)로 쓰고, 높이가 넘쳐도 줄이거나 흐리게 하지 않는다**(0-5 '늘 보이게', 제17조 제6항 '명확한 표시'). (12판) 빨강·경고 아이콘 없음. 색은 CSS 변수(`--consent-ink`·`--consent-muted`·`--consent-line`·`--consent-ring`)만, 장바구니는 studio 값·충전은 `--ck-*` 값. 창은 포털이라 패널에 테마 클래스를 다시 붙인다. Radix Checkbox 하나로, 공용 `checkbox.tsx` 는 고치지 않는다. 충전 잉크 디자인 시험이 이 파일도 읽는다.
- **1판 모드**(새 코드 + 1판 정책): 1판 지문은 '펼쳐 놓고 보았다'는 증빙이라 접지 않는다. 자료는 `confirmNotice` 본문(넓은 화면은 낮은 스크롤 상자, `tabIndex=0`·이름) + `[필수] {checkboxLabel}` + 약관·환불정책 링크(없으면 숨기되 자리는 둠). 충전은 부품을 쓰지 않고 지금 `CheckoutNoticeSection`·`agreeLabel` 그대로. 장바구니 문구는 1판에서도 DB 에서 읽는다.
- **없애는 것**: `MarketCheckoutConfirmDialog` 파일과 그 시험, `cart-view.tsx` 에 박힌 설명·부분 보유 문장.

## 7. 상품 상세
- '구매하기'를 없애고 '장바구니 담기' 하나(전체 폭, brand), 비로그인은 '로그인 후 담기'. 담기 결과 창은 지금 모양 그대로, `CART_LIMIT` 은 모두 가득 찬 경우도 결과 창(안내 + '장바구니 보기'). 다시 담은 줄은 **담기 route 같은 요청 안에서** 선택으로 바꾸고, 바뀐 줄·못 바꾼 줄을 다른 문구로 보인다.
- 비로그인 의도는 `cart` 만 새로 저장하고, 배포 전 `purchase` 의도(30분 안)는 담기로 바꾼다(결제하지 않음). 상세의 구매 상태·`isCheckingBalance`·'잔액 확인 중'·'구매 처리 중' 배지를 지운다.
- `/api/market/items/[itemId]/purchase` 는 410 `{ success:false, error:{ code:'MARKET_DIRECT_PURCHASE_CLOSED', message:'상품 상세 바로 구매는 종료되었습니다. 장바구니에 담아 구매해 주세요. 이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.' } }` 만 남긴다(옛 탭이 `error.message` 를 읽음, 돈 RPC 를 부르지 않음). 파일은 정리 묶음에서 지운다.
- 고칠 문구: '담을 옵션을 선택하세요', '로그인 후 담기', '담기·구매' → '담기', batch route 410 '장바구니에서 구매해 주세요'. 구현 때 `rg "items/.*/purchase|openCheckout|구매하기|구매하거나|로그인 후 구매|잔액 확인 중|구매 처리 중"` 로 남은 곳을 없앤다.
- **바뀌는 시험**(원칙: 상세 전용 단언은 '없음'으로 뒤집고, 장바구니에도 해당하는 단언은 결제 칸 계약 시험으로 **옮긴 뒤에만** 뺀다. 장바구니 route 불변식 — 동의 확인이 차감보다 앞, V2 kill switch, 동의 기록이 결제 RPC 바로 앞 — 은 꼭 남긴다): 구매 route 를 읽는 `market-workspace-route-guards`·`signup-consent-contract`·`market-zip-purchase-entitlement-contract`·`market-refund-credit-snapshot-contract`·`market-v2-rollback-flag-contract`·`credit-mutation-snapshot-contract`·`market-v2-purchase-entitlement-contract`·`market-purchase-notice-contract`, 상세 UI 의 `market-detail-multiselect-contract`·`market-item-detail-ui-contract`·`purchase-section-redesign-contract`·`studio-dialog-contract`·`market-purchase-complete-dialog-contract`·`market-v2-detail-library-contract`·`market-listboard-no-direct-purchase-contract`, 그리고 `market-bundle-savings`(충돌 판정만 공용 함수로 옮기고 보유 PDF 숨김의 `isPdfInclusiveHwp` 호출은 상세에 남김 → 호출 수 단언 2→1).
- 의도한 변화: 상세에서 사면 그 자리 다운로드 → 완료 창 '자료 보관함에서 받기', 장바구니 50개 가득이면 빼고 담아야 함, 풀어 둔 줄을 다시 담으면 선택으로.

## 8. 충전 화면(`/checkout`)과 결제 내역
- **2판**: 주문 요약 아래·결제 버튼 바로 위에 `CheckoutConsent`(잉크 변수). `/terms/refund` 고정값을 쓰지 않고 환불정책 전문 링크는 항목 ④로. 주문 요약 칸은 lg sticky 이지만 최대 높이·안쪽 스크롤이 없어 길면 페이지와 함께 스크롤된다. 충전 화면에는 고정 막대를 두지 않는다(상품 하나·결제 한 번이라 동의·요약 줄·결제 버튼이 한 칸 안에 이어져 있으면 됨, 목표 6). (12판) 9번 배치('동의 체크 바로 위')에서 '체크 줄 아래 늘 보이는 요약 줄 + `aria-describedby`'로 바뀌는 점은 13절 질문 2·3.
- **링크 prop**(`termsLink`·`refundPolicyLink`)은 판과 관계없이 늘 내려 준다(1판으로 연 화면이 409 로 2판을 받아도 그 자리에서 그림). 첫 값은 `checkoutNotice` + `checkoutConsent`(5-2).
- **1판**: 지금 화면 그대로. **고지 없음**: 동의 자리에 6-4 와 같은 문장 + [다시 불러오기](`window.location.reload()` — 첫 값으로 state 를 만들어 `router.refresh` 로는 안 바뀜), 링크 없음, 빨강 아님(`text-destructive` 를 바꿈), 1판 부품으로 떨어뜨리지 않음.
- 결제 버튼 열림은 지금과 같고(동의 + 결제수단 + 필요 시 휴대폰), `isBusy` 동안 2판 위·하위 체크를 잠근다. 409 뒤 지금처럼 시도를 지우고 동의(2판은 하위까지)를 비운다.
- **결제 내역 상세**(`mypage-payment-details-server.ts`·`payments-view.tsx`, 계약내용 교부): `consent_format` 2 기록은 `consent_details.consent` 로 제목·요약 줄·항목 이름·본문을 그리고 link 항목은 링크로(옆에 '결제 당시 판과 다를 수 있어요'). 1판 기록은 지금처럼 `notice_text`. `cartTexts` 를 보여 주게 되면 5-4 '읽는 법'을 따른다.

## 9. 관리자 문구 편집(꼭 넣음, 0-6)
- 두 폼 맨 위에 '지금 결제 화면 동의 방식: 펼친 고지(예전 방식) / 접는 동의(새 방식)'를 읽기 전용으로('1판·2판'은 화면에 쓰지 않음). 2판 키가 없으면 '새 방식 문구가 아직 없습니다'(2판 검사도 안 함). 스크립트 A 뒤에는 판 1 이어도 2판 키를 고치고 미리 본다.
- **편집칸**: 제목(한 줄, n/26 — 4-3 (a), 12판), 요약 줄(역할별 고정 줄, 필수 줄은 삭제 버튼 없음, '덧붙임 줄(선택)'만 더하고 뺌, n/120·자료 합계 n/220), 항목 목록(최대 6개, 대상은 한글 이름으로 고르고 여러 대상은 체크 + 위/아래 순서, 다른 항목이 쓴 대상은 비활성, `key` 는 코드가 만듦, 필수 대상이 빠지면 저장 막음), 자료 폼의 장바구니 문구 2칸, 쓸 수 있는 자리표시와 '기간은 숫자 대신 자리표시로' 안내.
- **힌트**: 지문에 들어가는 칸(그때 판과 `consentItems` 로 계산)에는 '결제 동의 내용에 들어갑니다. 바꾸면 결제 화면을 열어 둔 회원은 다시 동의해야 합니다.', 장바구니 문구 칸에는 같은 취지 문장. 새 방식일 때 예전 방식 전용 칸은 '되돌리기용'으로 접되 검사는 그대로(오류면 펼치고 초점).
- **저장**: 4-3 (S)~(f)·장바구니 문구 규칙. 2판 키가 있으면 판과 관계없이 늘 검사(깨지면 그 칸 오류로 저장 막음). (g) 는 저장 검사에 넣지 않는다. `consentFormat` 은 입력에서 뺀다. **자료 저장에도 낙관적 잠금**(`version` 대조 + 1). 충전 `checkoutItems.validity` 의 `[0-9]+년` 은 `POINT_CHARGE_VALIDITY_YEARS` 와 같아야 저장.
- **작업 기록**: 저장 전후 지문(그때 판 규칙, 2판이 링크 검사로 막히면 null + `notice_sha256_unavailable: 'link_document'`)과 판. 지문에 들지 않는 문구 키(장바구니 문구 포함)는 바뀐 키의 전후 값을 **전문 그대로**(스크립트 기록과 같은 형식).
- **미리보기**: 실제 `CheckoutConsent` 를 실제 폭과 `.studio-theme`(자료)·잉크(충전) 안에서 그린다(자리표시 채움, 세부 항목 창 열림). 자료 미리보기는 결제 칸 아래 묶음을 실제 부품으로 그려 6-2 와 **같은 판정 함수**로 1366×768 기준에 들어가는지 본다. 판과 관계없이 1판 묶음을 늘 재고(되돌림이 1판을 다시 띄움), 2판 키가 있으면 2판도 잰다. 글꼴 차이(macOS·Windows)를 위해 여유를 두고 비교하고(값은 구현 때 실측으로 정함), 넘으면 넘친 칸을 짚어 '1366×768 노트북 결제 칸에 동의와 결제 버튼이 함께 들어가지 않습니다'로 **저장을 막는다**. 승인 초안과 지금 1판 문구는 통과해야 한다. 스크립트로 들어간 문구는 6-2 원칙 3(보통 흐름 + 막대)이 받는다. (11판: px 예산 대신 같은 함수)
- 링크 문서가 꺼져 결제가 막히는 상태면 미리보기에 그 이유를 보인다. 구매 고지 카드 설명은 '장바구니 결제 칸, 상품 상세 "구매 전 확인"…'으로.
- **저장된 값의 지문 보기**(단계 6 용): 저장된 정책으로 서버가 만든 2판 `noticeSha256`·장바구니 문구 지문·묶음 JSON 을 접어서 읽기 전용(복사 버튼).

## 10. 순서
1. **시작 조건**: 10번 DB·코드, 15번 DB·코드가 운영에 있다(2026-11-26 충족). 10번 시행(2027-01-11)·15번 게시는 기다리지 않는다(3절). (11판)
2. 리허설(11-2) PASS(새벽). 5-5 그대로 목록 md5 를 다시 읽어 맞춘다.
3. 11번 마이그레이션 적용(새벽, 게시·시행과 다른 날). 정책에 `consentFormat` 이 없어 화면·기록 변화 없음, 옛 코드 호출은 기본값으로 맞고 `cartTexts` null. **적용 직후 쓰기 없는 확인**: postgres 접속으로 자료 기록 함수를 옛 코드와 같은 **이름 인자 3개**(`p_user_id`·`p_idempotency_key`·`p_notice_sha256 => 'x'`)로, 충전 기록 함수를 **이름 인자 6개**(잘못된 지문)로 불러 `NOTICE_INPUT_INVALID` 와 `consentFormat: null` 키를 본다(입력 검사에서 돌아와 기록 없음). 그 뒤 Vercel 로그에 '구매 고지 동의 기록에 실패했습니다'·'결제 전 확인 동의 기록에 실패했습니다'가 없는지 30분, 그 안에 실제 결제가 없었으면 첫 실제 결제까지 본다. 있으면 바로 down(옛 코드·판 1 이라 순서 문제 없음). (12판)
4. 스크립트 A(2판 키 + 장바구니 문구, 판 1). 옛 코드에 보이는 변화 없음.
5. **localhost 확인 → push**(10-1). 내가 먼저 11-3 화면 시험을 모두 보고, 계약·단위 시험 PASS, 대표가 localhost 에서 확인한 뒤 push. push 전에 `git log origin/main..HEAD` 에 11번 커밋(과 문서 커밋)만 있는지 본다. 배포 직후 관리자 화면에서 `purchaseCompleteNotice` 를 새 문장으로 바꾼다(상세는 60초 캐시라 두 번 열어 확인).
6. **운영 값으로 서버 계산 = DB 계산**(리허설로는 못 함 — 서버가 커밋 안 된 값을 못 읽음). 이 단계부터 스크립트 B 끝까지 관리자 문구 저장 금지. 서버 쪽은 9절 '저장된 값의 지문 보기', DB 쪽은 postgres 접속(`--read-only` 없이, 읽기 전용 사용자는 새 함수 EXECUTE 가 없고 `--read-only` 는 DO 를 거부)으로 한 문장 `DO $v$ … RAISE EXCEPTION 'B11_STEP6 %', jsonb_build_object('market', build_checkout_consent_v2(…), 'point_charge', build_checkout_consent_v2(…, point_charge_refund_days()), 'cartTexts', build_market_cart_texts(…), 'policyMd5', …) END $v$`(예외로 끝나 쓰기 없음). 자료·충전 지문과 묶음이 같아야 하고, 대조한 정책 값 md5 를 스크립트 B 에 적는다.
7. 스크립트 B(판 2, 새벽). 열린 실회원 화면은 한 번 다시 동의.
8. 운영에서 2판 화면을 결제 없이 다시 본다(내가 먼저 → 대표, 시험 계정).

**되돌리기(이 순서를 지킨다)**
1. 되돌림 스크립트(판 1). 2판이 닫힌 상태에서도 돈다. 2. 장바구니·충전이 1판인지 확인. 3. 필요하면 코드 되돌리기: **11번 커밋만 revert 한다**(10번·15번 코드와 11번 전후에 나간 다른 묶음 코드는 남김). `7a97416` 배포로 바로 돌아가는 Vercel 즉시 되돌리기는 11번 뒤에 나간 다른 묶음 코드가 없을 때만 쓴다(13판). `51b7373` 으로 가지 않는다(15번 고지 화면 — 팝업·`/terms/upcoming`·한 줄 안내 — 이 빠지고 15번 DB 만 남음, 고지 기간이면 30일 전 고지가 화면에서 끊김). 그보다 앞(10번·9번)까지 되돌려야 하면 15번 고지 기간인지 먼저 확인하고 그 묶음의 되돌리기 절차를 따른다. 이때 `purchaseCompleteNotice` 를 작업 기록의 이전 값으로(다시 배포하면 다시 새 문장으로). (12판) 코드를 되돌리면 2판 충전 기록이 결제 내역에 원문 그대로 보이므로 짧게 둔다. 4. 필요하면 11번 down(**③ 뒤에만**, 칸은 남김).
- 순서를 어겨도 막히는 쪽이다: 2판인 채 코드만 되돌리면 DB 가 1판 지문을 거절(자료 옛 화면은 닫힘, 충전 옛 화면은 1판 글로 409 되풀이 — 기록은 틀어지지 않음). 새 코드인 채 down 하면 자료는 4인자 함수가 없어, 충전은 `consentFormat` 키가 없어 503.
- 10번을 되돌려야 하면 11번 down 먼저. 11번을 다시 적용할 때는 A 를 건너뛴다(5-6). 다시 적용 전 두 정책의 `consentFormat` 을 읽는다. 2 인데 운영이 옛 코드면(down 상태의 옛 함수는 판을 보지 않아 지금은 결제가 된다), 같은 새벽에 마이그레이션을 다시 적용한 바로 뒤 되돌림 스크립트를 돌리거나(그 사이 잠깐 결제가 막힘), 새 코드를 배포한 바로 뒤 적용한다(그 사이 503). 되돌림 스크립트는 down 상태에서는 사전 검사(네 함수 md5)로 멈추므로 다시 적용 전에는 돌릴 수 없다. (12판·13판)

### 10-1. localhost 확인(시험 계정 + 개발 전용 2판 표시 스위치) (11판)
- **허용하는 쓰기**: 대표가 로그인한 시험 계정(`@test.com`)의 장바구니 담기·빼기·선택 저장만. 담으려고 상품 상세를 열면 조회 기록(`/api/market/items/{id}/view`)도 운영 DB 에 남는다(대표 확인 필요, 15절 끝 질문). 구매·충전 버튼, 관리자 저장, 실회원 계정 사용은 하지 않는다. 관리자 미리보기는 대표 관리자 계정으로 보되 저장하지 않는다.
- **1판 화면**: 운영 정책이 판 1 이므로 시험 계정의 실제 장바구니·충전 화면이 곧 새 코드의 1판 모드다.
- **2판 화면 — 개발 전용 스위치 하나**: 판정 함수 `isCheckoutConsentPreview()`(새 파일 하나, 환경 변수 이름은 이 파일에만)는 `process.env.NODE_ENV === 'development'` 이고 `process.env.VERCEL` 이 없고 `CHECKOUT_CONSENT_PREVIEW === '2'` 일 때만 참이다(대표가 터미널에서 `CHECKOUT_CONSENT_PREVIEW=2 npm run dev` 로 띄움, `.env` 는 고치지 않음, 15번 10-1 과 같은 방식). 이 함수를 부르는 곳은 **두 종류**뿐이다 — 자료·충전 읽는 함수(화면용 값)와 두 기록 감싸개. (13판)
  1. 4-4 의 읽는 함수: **화면용 값**(장바구니 뷰·페이지 첫 값·`/checkout` 첫 값)에서 판을 2 로 보고, 스크립트 A 로 저장된 2판 키로 만든 묶음을 `purchaseConsent`·`checkoutConsent` 에 담는다. 첫 값과 `/api/market/cart` 다시 읽기가 같은 함수를 쓰므로 다시 읽어도 2판이다. '개발 미리보기 — 결제되지 않음' 띠는 머리글 위 보통 흐름에 두어 스크롤하면 사라지게 하고 fixed·sticky 로 만들지 않는다(첫 화면 기준 1 은 띠 높이만큼 여유를 두고 본다). **스위치가 판을 2 로 바꾼 값에서 2판 해석·링크 검사가 실패하거나 2판 키가 없으면(스크립트 A 전) 고지 없음으로만 그리고 경보(`record_payment_alert`, 예: `recordPointChargePolicyUnavailableAlert`)는 부르지 않는다.** 2판 검사 실패 경보는 DB 의 실제 판 값이 2 일 때만 남긴다. 1판 정책 읽기 실패의 기존 경보(`getPointChargeCheckoutNotice`)는 판·스위치와 관계없이 그대로다. 키가 없으면 띠에 '2판 키 없음'을 보인다. (13판)
  2. 서버의 동의 기록 감싸개 두 곳(`market-purchase-policy-server.ts` 의 `recordPurchaseNoticeAck`, `point-charge-policy-server.ts` 의 `recordPointChargeCheckoutAck`): 참이면 **RPC 를 부르기 전에** 'unavailable' 을 돌려준다. 그래서 새 결제 시도에서 route 는 지금 경로대로 503(고지 불가)을 내고 동의 기록·`checkout_market_selection`·`prepare_payment_order`·페이앱 요청을 부르지 않는다. 두 감싸개 모두 맨 앞에서 판정한다. (12판·13판)
  - 결제·충전 route, 미들웨어, 껍데기에는 분기를 넣지 않는다. 서버 분기는 위 감싸개 두 곳의 맨 앞 한 줄뿐이다. (12판)
  - **닫힘 근거**(12판: 11판의 'DB 거절만으로 닫힘'은 첫 클릭에만 맞았다 — 409 로 받은 1판 고지로 사본이 바뀐 뒤 다시 누르면 1판 지문이 맞아 실제 결제가 됨): 스위치가 켜진 서버에서는 새 결제 시도라면 어떤 화면·몇 번째 클릭이든 감싸개가 RPC 전에 거절하므로 기록·차감·주문이 생기지 않는다. 충전 시도에 이미 주문이 있으면 route 는 감싸개를 거치지 않고 `prepare_payment_order` 가 기존 주문을 돌려주며(`existingOrderResponse`) 새 기록·주문은 생기지 않는다. 화면의 시도 키는 보인 고지 지문으로 갈리므로 2판 미리보기 화면은 이 분기에 닿지 않는다(13판). DB 쪽도 판 1 이라 2판 지문은 따로 거절된다(R10). 그래도 누르지 않는다.
  - **15번 한 줄 안내가 있는 경우**(게시 전이라 운영에 게시 행이 없음)는 15번 10-1 미리보기(`NOTICE_POPUP_PREVIEW=1` + `NOTICE_POPUP_PREVIEW_UPCOMING_FILE`)를 함께 켜서 본다. DB 에는 쓰지 않는다. (12판)
  - 9~10판의 화면 모음을 없앤 이유: 가짜 껍데기·고정 값·상태 목록이 실제 화면(레이아웃·데이터 흐름)과 계속 갈라져 검증마다 세부가 늘었다. 실제 장바구니에 실제 2판 키를 그리면 그 차이가 없다.
- **볼 수 없는 상태**(시험 계정 보유·잔액으로 만들 수 없는 부분 보유·7자리 금액, 결제 응답에서만 생기는 409·retryable·결제 중·완료 창 차례 등)는 순수 함수·껍데기 단위·계약 시험으로 고정한다. 운영 DB 를 고쳐 상태를 만들지 않는다.
- Windows 글꼴 확인은 VM 포트 전달로 `http://localhost:4000` 을 열어 같은 시험 계정으로 본다(운영 인증 설정은 바꾸지 않음).

## 11. 시험
### 11-1. 계약·단위 시험(원칙: 안전 규칙마다 시험 하나)
- **지문**: 5-1 벡터(P·기대 원문·`2e53f470…`)를 TS·SQL 이 같게, 자료 벡터도. 장바구니 문구 지문 TS = `build_market_cart_texts`(앞뒤 공백 예시, trim 안 함). 1판 정책일 때 지문·details 1판 키가 지금과 글자 그대로(더해진 키는 `consentFormat`·자료 거절의 `cartTexts` 뿐). 잘못된 2판 정책 모음(필수 본문·요약 줄 빠짐, 허용 밖·객체 textKeys, 121자, 숫자 기간 — '30일'·'１년'·'12개월'·'일 년'·'한 달'·'이틀', 중괄호, `consentFormat` "2"·3, 한 줄 칸 LF, `note: null`, 링크 문서 닫힘)을 TS·SQL 이 같이 거절한다.
- **서버**: `consentFormat` 키 없음 → 503(`Object.hasOwn`), 탈퇴 403 그대로, `cartTextsSha256` 없음 → 영수증 먼저(있으면 성공 모양, 조회 실패 503, 없으면 400), 장바구니 문구 불일치 → 409(최상위 `cartTexts`)·결제 RPC 안 부름. 바닥글 링크 검사는 원본으로. 2판 키가 깨져도 `getMarketRefundPolicyCached`·상세 안내 그대로, 장바구니 뷰는 캐시 없이. 캐시 키 v3·v2. 상세 구매 route 410 모양·끝 문장·돈 RPC 없음. 옛 해석기에 2판 묶음 → null, 2판일 때 1판 칸 null. `{충전유효기간}` 세 값 일치. 마이그레이션·down 끝 `NOTIFY pgrst`.
- **장바구니 껍데기·순수 함수**: 동의 수명 규칙 전부(지문·구조·주문 키·장바구니 문구 바뀜, 성공 뒤 비움, 켜져 있던 때만 안내, 0건 비활성), 키 수명·잠금·[다시 선택] 영수증 흐름·직전 키 재조회·완료 창 차례, 응답별 처리(`reduceCheckoutResponse`, 낡은 뷰에서 `ACK_REQUIRED` → `details.lines` 줄이 부분 보유로 바뀌고 확인 칸이 생김 포함), 버튼 이름 순서(충돌 + 부족 → 충돌 이름, '부족' 없음), 화면은 `cartTextsSha256` 을 계산하지 않고 사본 값을 보냄, 고정 막대는 checkout API 를 부르지 않음, 7절에서 옮겨 온 단언.
- **충돌 판정 = DB 6단계**(같은 `itemId`): 문제(PDF) 하나 → 없음, 워크북 + 문제(PDF) → 없음, 문제(PDF) + PDF 든 HWP → 충돌, 문제(PDF) + PDF 없는 HWP → 없음, 패키지 + 개별 → 충돌, 다른 `itemId` → 없음. 같은 예시를 리허설에서 `checkout_market_selection` 결과와 대조.
- **배치**: `decideCheckoutPanelMode` 경계값(들어감 → sticky, 넘침 → 보통 흐름, sticky + 넘침 없음), 쓰는 도중에는 부르지 않고 글꼴 로드 끝에 부름. 아래 묶음 안에 조건부로 생기는 보이는 줄이 없다(구조 단언), 금액 줄에 단위 없음·`tabular-nums`. 알림 자리의 두 요소(`role="status"`·`role="alert"`)가 처음 그릴 때부터 있고 role 이 바뀌지 않음, 알림이 생기면 sticky 는 위 영역 `scrollTop` 0·보통 흐름은 알림 자리가 화면 안으로(초점 이동 없음, 409·가격 바뀜 응답 포함 껍데기 단위 시험), 위 영역이 알리면 sr-only 이유가 빔. 막대 보임은 결제 버튼 줄을 관찰하고, 막대 초점 대상이 비활성 요소가 아님. 대상별 `scroll-margin` 없음. (12판)
- **부품·화면 규칙**: 표시 부품 안에 동의·부분 보유·줄 선택 `useState` 없음, 위 체크 `aria-describedby`·`mixed`, 보기 접근 이름이 항목마다 다름, 창 버튼 [닫기] 하나, 부분 보유 체크에 별도 `aria-label` 없음, 장바구니 줄에 정가 구매 조건 문장 없음, 충전 고지 없음 줄 `text-destructive` 없음·[다시 불러오기] `window.location.reload()`, 충전 `isBusy` 동안 2판 체크 잠금, 결제 내역은 `consent_details.consent` 로 그리고 `링크:` 줄을 보이지 않음, 작업 기록에 장바구니 문구 전후 전문, 관리자 미리보기가 같은 판정 함수를 씀, 1판 모드에서 지문 대상 문구가 접히지 않음.
- **문구 하드코딩 없음**(동의·고지·전체 취소 안내·부분 보유 문장, `src` 전체).
- **개발 전용 스위치**(10-1): 켜지는 조건 셋, 환경 변수 이름이 `src` 에서 한 파일에만 있음, `isCheckoutConsentPreview` 를 부르는 곳은 읽는 함수와 두 기록 감싸개뿐(두 감싸개 모두 맨 앞에서 판정 — 하나라도 빠지면 실패), 참이면 기존 주문이 없는 시도에서 두 감싸개가 RPC 를 부르지 않고 'unavailable'(route 503, 결제 RPC·주문 준비 호출 0회), 기존 주문이 있는 충전 시도에서는 새 주문·기록이 생기지 않음, 스위치 참 + 2판 키 없음·깨짐·링크 검사 실패 → 경보 RPC 호출 0회·고지 없음, 판 1 + 1판 정책 읽기 실패 → 기존 경보 1회 그대로(스위치와 관계없이), 결제·충전 route·미들웨어·껍데기에 없음, `next.config` 에 `allowDevelopmentBuild` 없음. (11판·12판)

### 11-2. 리허설(운영 DB, postgres, BEGIN…ROLLBACK, 새벽) — 목표·경우·원칙 (11판)
**목표**: 11번 마이그레이션·스크립트 A·B·되돌림이 운영 DB 에서 그대로 돌고, 판 분기·장바구니 문구 대조·replay·닫힘이 정해진 대로이며, 되돌린 뒤 다시 적용되고, 건드리지 않을 함수·권한이 그대로다.

| 경우 | 기대 결과 |
|---|---|
| R0 마이그레이션만 | 옛 호출(자료 이름 인자 3개, 충전 6인자) → 1판 기록 성공, 새 칸 기본값(`consent_format` 1, 문서 지문 NULL, 충전 `refund_policy_sha256` = 최신 사본), `cartTexts` null, 옛 호출(인자 NULL)을 같은 키로 다시 부르면 replay, `PLAN_CHANGED`·`NOTICE_CHANGED` 1판 details 가 10번 함수 결과와 글자 그대로 + `consentFormat: 1`. 3인자 없음·4인자만 |
| R1 A 뒤 | 옛 호출 → `cartTexts` null, 맞는 장바구니 지문 → 전문 기록(지문 = TS 값), 틀린 지문 → 기록 없음 + `NOTICE_CHANGED` + `cartTexts`. 판 1 인 채 `build_checkout_consent_v2` 두 정책 NULL 아님. 관리자 저장 흉내 뒤에도 1판 |
| R2 B 뒤 | 1판 지문 → `NOTICE_CHANGED`(2판 묶음, 1판 키 없음), 2판 지문 → `consent_format` 2·두 문서 지문·`consent` 로 다시 만든 원문 sha256 = `notice_sha256`. 충전도 같고 `refund_days` = `point_charge_refund_days()`, `PLAN_CHANGED` 는 2판 + `plan`, `MEMBER_WITHDRAWN`·`NOTICE_INPUT_INVALID` 에 `consentFormat: null`. 관리자 저장 흉내(문구 수정, version +1) 뒤에도 판 2, 새 문구로 지문 |
| R3 replay·충돌 | 1판 기록 키를 2판 뒤 같은 지문으로 → replay(`consentFormat` 1), 다른 고지·장바구니 지문 → `NOTICE_KEY_CONFLICT`. ⑥ 경로(겹친 같은 키, 다른 장바구니 지문)도 `NOTICE_KEY_CONFLICT` |
| R4 닫힘 | 2판 키 깨짐 → 결제만 `NOTICE_POLICY_UNAVAILABLE`(환불 판정 그대로). 링크 문서 꺼짐·`label` 빈 글자·`content` 빈 글자·사본 없음 → 2판 닫힘, 1판 영향 없음 |
| R5 되돌림 | 되돌림 스크립트 → 1판 기록 다시 성공(2판 키 깨짐·링크 꺼짐 상태에서도) |
| R6 down·다시 적용 | down 사전 검사는 11번 값이 아니면 멈춤. down 뒤 3인자만, 충전 응답에 `consentFormat` 없음, 옛 함수는 2판 지문을 `NOTICE_CHANGED` + 1판 details 로 거절, md5 바탕 값, 칸 남음 → 칸이 남은 채 다시 적용 성공. down 없이 같은 파일 다시 실행도 성공 |
| R7 그대로·권한 | 5-5 목록 md5 그대로, `proacl`·anon/authenticated EXECUTE 없음(적용·down·다시 적용 뒤 모두) |
| R8 10번과의 순서 | 같은 거래에서 충전 함수를 10번 전 정의(`0047854a…`)로 바꾼 뒤 11번 → PRECHECK 로 멈춤. 11번 적용 상태에서 10번 `_down_b` → 함수 md5 검사로 멈춤(11번 down 뒤에는 그 검사를 지남) |
| R9 스크립트 거절 | A 재실행, B 재실행, 판 1 에서 되돌림, 정책 값 md5 불일치 → 모두 RAISE, 값 그대로 |
| R10 미리보기 닫힘 | 판 1 정책에서 2판 지문(10-1 스위치 화면이 보낼 값)으로 자료·충전 기록 → `NOTICE_CHANGED`, 기록 없음. 두 번째 클릭(그 409 의 1판 details 로 만든 1판 지문)은 DB 만으로는 기록이 성공함을 확인한다 — 그래서 막는 것은 스위치가 켜진 감싸개이고, 그것은 11-1 단위 시험(RPC 호출 0회)으로 본다 (12판) |

**원칙**
1. **경우마다 격리한다.** 각 경우는 자기 블록 안에서 사전 상태를 만들고, 확인 값은 변수·로그에 남긴 뒤 표지 예외로 되돌린다. 결과는 `ON COMMIT DROP` 임시 표와 마지막 SELECT 로 받는다(10번·15번 리허설과 같은 방식, 오류 메시지는 900자 안 요약).
2. **실제 파일을 실행한다.** 마이그레이션·스크립트를 손으로 고친 사본으로 돌리지 않는다. 사본이 필요하면 생성기로 만들고 다른 줄을 계약 시험으로 고정한다.
3. **표 잠금은 짧은 거래에만**: ACCESS EXCLUSIVE(칸 추가)·트리거 끄기(사본 트리거, 게시 뒤의 `lock_policy_documents_during_notice` — 3절)는 그 경우의 짧은 거래에만 두고 `lock_timeout = '3s'` 를 건다. 롤백 뒤 트리거가 켜져 있고 남은 것이 없는지 읽기 조회로 본다.
4. 거래 나누기·실행 순서·도우미 모양은 구현 때 실제로 돌려 정하고 구현 검증에서 본다. 실패하거나 상수를 고치면 다시 돈다.

### 11-3. 화면 시험(Claude in Chrome, 내가 먼저 → 대표, 10-1 범위 안에서)
- **6-2 수용 기준 1~4** 를 1366×768·1366×600·390×844·360×640 에서, 1판(실제)과 2판(스위치)으로 본다. 15번 한 줄 안내가 있을 때(15번 미리보기를 함께 켬, 10-1)와 없을 때 모두 기준 1 을 지켜야 한다. Windows(Malgun Gothic) 1366×768 도 한 번. (12판)
- 목록을 내린 뒤 선택을 바꿔 동의가 비워질 때 '주문 내용이 바뀌었습니다'가 보이고 화면 읽기로 한 번 읽힌다: 1366×768(sticky, 위 영역 맨 위)과 360×640(보통 흐름, 목록에서 줄을 골라 생긴 알림은 스크롤하지 않고 화면 읽기로 한 번 읽힘). 360×640 에서 결제 버튼 줄까지 내린 상태로 [잔액 다시 확인]처럼 결제 칸 안 조작으로 알림이 생기면 알림 자리가 화면 안으로 들어온다(초점은 그대로). 409·가격 바뀜 알림은 시험 계정으로 만들 수 없어 11-1 로 본다. (12판·13판)
- 시험 계정으로 만들 수 있는 상태: 0건, 여러 건 선택·해제(동의가 켜져 있던 때만 안내), 동의 켬/끔, 세부 항목 창 열고 닫기(칸 높이 그대로, 360×640 에서 긴 본문도 [닫기] 늘 보임), 잔액에 따라 부족 또는 결제 가능, 함께 살 수 없는 선택, 많은 줄(내린 뒤에도 sticky 유지·막대), 좁은 폭의 막대(결제하지 않음, 버튼 줄이 보이면 숨음, 토스트를 덮지 않음).
- 키보드만으로 '결제 칸으로 건너뛰기' → 체크 → 세부 항목 창 → 보기 → 결제 버튼까지 가고, 막대 → 첫 막힌 조작으로 초점이 간다. 초점 줄이 머리글·막대에 가리지 않는다.
- 충전 1판·2판, 상세(구매하기 없음, 담기 결과 창 문구), 관리자 미리보기(저장 안 함), 결제 내역 2판 기록 보기(운영 2판 뒤 단계 8).
- 결제·충전 버튼은 누르지 않는다. 시험 계정으로 만들 수 없는 상태는 11-1 로 갈음한다.

## 12. 검증
- 계획: 결제 검증 3명(① 구매·차감·재시도, ② 동의 기록·지문·1판/2판 호환, ③ 마이그레이션·배포 순서) + 법률 1명 + 화면(UX·접근성) 1명, 모두 PASS 까지. 11판부터는 원칙·수용 기준이 지켜지는지를 보고, px·상태 목록 같은 세부는 구현 검증에서 본다.
- 구현 검증도 같은 관점으로 PASS 까지.

## 13. 변호사 확인 목록에 더할 질문
1. 디지털 자료의 청약철회 제한을 '늘 보이는 요약 줄(받은 것으로 보는 규칙 포함) + 세부 항목 창 본문 + 필수 체크'로 표시하면 전자상거래법 제17조 제6항 표시 요건을 채우는가. 철회의 효과(크레딧 환불)와 패키지 부분 환불을 본문(세부 항목 창·상품 상세)에만 두어도 되는가.
2. 충전의 유효기간·환불 조건·미성년자 취소를 요약 줄로 늘 보이게 하고 세부('유효기간이 먼저 끝나는 크레딧부터 쓰임' 포함)는 창에 두어도 되는가. 미성년자 줄을 요약에서 빼도 되는가. 9번의 '동의 체크 바로 위' 대신 체크 줄 아래 요약 줄 배치도 괜찮은가. 크레딧으로 자료를 살 때(충전 단위로 취소를 다룸) 따로 미성년자 고지가 필요한가. (12판)
3. 하위 항목 체크 + 전체 체크 방식이 필수 동의로 충분한가. 하위 항목과 취소·환불정책 전문 링크를 [세부 항목] 창 안에 두어도 되는가.
4. 장바구니 결제 칸에서 버튼 한 번으로 크레딧이 차감되면(별도 확인창 없음) 제7조·제8조 제2항을 채우는가. 이용 기간(`downloadPeriodNotice`)이 상품 상세에만 있어도 제공기간 고지로 충분한가. 화면 설명: 왼쪽 선택 목록, 오른쪽 결제 칸의 늘 보이는 아래 묶음(합계·잔액 한 줄, 필수 동의와 요약 줄, 결제 버튼)과 그 위 작은 스크롤 영역(선택 자료, 전체 취소 안내, 정가 구매 확인). 낮은 화면에서는 칸이 페이지와 함께 스크롤되고 고정 막대로 간다.

## 14. 범위 밖
- 카드·간편결제로 장바구니 바로 결제(0-2). 쿠폰·포인트, 담기 개수 제한 변경, 상세의 다른 디자인. 가입 동의 화면 구조(4번 그대로).
- 충전 뒤 장바구니로 돌아오기(`returnTo` — 결제 시작 route·결과 화면·열린 리다이렉트 검사까지 커짐). 창이 다시 보일 때 잔액 자동 다시 읽기.
- 1판 부품(`CheckoutNoticeSection`·`AgreeLabel`, 1판 키)과 410 만 남긴 상세 구매 route 파일 정리, DB `checkout_market_selection` direct 모드 삭제, 개발 전용 스위치(10-1) 정리 — 2판이 자리 잡은 뒤 정리 묶음에서.

## 15. 이전 판에서 정리한 것(1판~10판 검증 10회차 요약) (11판)
- **그대로 둔 안전 규칙**: `consentFormat` 판 구분(version 은 편집 번호), 1판 키 보존, 해석 분리, 원문·지문 규칙과 벡터, 2판 묶음에 1판 키 없음, 뷰 칸 나눔, 모든 응답의 `consentFormat` 키와 없으면 503, 장바구니 문구 DB 대조(기록 전, replay 두 곳), 사본 없으면 닫힘, 링크 문서 원본 검사, 4인자 변경 절차·권한 VERIFY·`NOTIFY pgrst`·그대로 목록, down 은 칸을 남기고 10번 down 보다 먼저, 스크립트 md5 관문과 단계 6 대조, 되돌리기 순서, 키 수명·잠금·영수증 먼저 조회, 동의 수명(지문·구조·주문 키·장바구니 문구), 충돌 판정 = DB 식, 410 JSON, 관리자 편집 화면과 낙관적 잠금·작업 기록 전문, 결제 내역의 2판 기록 보기.
- **원칙으로 바꾼 것**
  - 결제 칸 px 높이 예산(content-box 454px, 347/355/387px, 여유 27/19/16/8px, 1366×640·600 계산) → 6-2 원칙 1~4 와 수용 기준. 같은 판정 함수를 화면과 관리자 미리보기가 함께 쓴다.
  - 고정 막대 열림 조건(칸이 보기 영역 밖) → 결제 버튼 줄이 화면 밖일 때. 10판에 남은 major('1366×768 첫 화면에 버튼도 막대도 없음')를 이것으로 푼다.
  - 막대 초점 순서 9단계 목록 → '첫 번째 막힌 이유의 조작, 없으면 부분 보유 → 동의 → 결제'.
  - 토스트 offset CSS 선택자, 버튼 줄 폭별 글 줄이기, 금액 줄 클래스 같은 구현 세부 → 원칙 한 줄(겹치지 않게·줄바꿈 없음).
  - 리허설 0~16 번 서술 → 11-2 경우 표 R0~R10 과 원칙 4개(15번 6판 방식).
  - 계약 시험 70여 줄 → 11-1 묶음별 원칙과 예시.
- **없앤 것**: 7~10판의 개발 전용 미리보기 장치(미들웨어 쿠키·route 403 분기 → 화면 모음 페이지 `page.dev.tsx`·`pageExtensions`·하네스·고정 값 JSON·상태 23개·응답 흉내). 0-11 결정으로 시험 계정의 실제 장바구니 + 개발 전용 스위치 하나(10-1)로 바꿨다. 스위치가 켜진 서버는 기록 감싸개가 RPC 전에 거절하므로 몇 번을 눌러도 결제가 닫힌다(12판).
- **사실 고침**: 10번 코드 push·배포 완료(`51b7373`·`7a97416`), 10번 문구 스크립트는 2027-01-11 시행으로 밀림, 15번 DB 적용(마이그레이션 `20261205100000`)과 장바구니·충전 화면의 `upcomingNotice`, 11번 마이그레이션 이름은 그보다 뒤, 10번 시작 조건 없앰, 함수 md5·정책 판·사본 seq 는 2026-11-26 운영 값과 같음.

- **11판 검증 반영**(12판, 법률 PASS·기록·이전·구매·화면 FAIL)
  - major: 충전 항목 ④⑤ 이름과 5-1 벡터 P·기대 원문을 계획 안에 되살림(10판 참조 삭제) / 되돌리기 ③ 을 '11번 커밋만 revert, 15번 코드 포함 상태 유지'로 / 스위치가 켜지면 기록 감싸개가 RPC 전에 거절(두 번째 클릭이 실제 결제가 되던 구멍), R10 에 두 번째 클릭 / 알림 자리 live 역할·맨 위로 올리기·sr-only 하나만.
  - minor 반영: 요약 줄 글꼴·대비는 줄이지 않음, `validity` 초안 '쓸 수 없어요'와 '요약 줄은 본문보다 강하게 말하지 않음', 자료 동의에 미성년자 줄이 없는 이유와 13절 질문, replay `IS NOT DISTINCT FROM`, 단계 3 이름 인자 3개·6개 확인과 첫 실제 결제까지 로그, 다시 적용 전 `consentFormat` 확인, R2 판 2 관리자 저장·R6 옛 함수 거절, 12·13번 순서, `ACK_REQUIRED` 다시 읽기·`details.lines`, 뷰 줄 `categorySlug`·`includesPdf`, 막대 초점 대상(비활성 금지), 금액 줄 단위 없음·좁은 화면 줄바꿈 허용, 15번 미리보기와 함께 보기, 제목 n/26, 목표 6 을 장바구니로 한정, 글꼴 로드 끝에 다시 판정.
  - 반영하지 않은 지적: 없음.
- **13판 재검증**: 5관점 모두 PASS. minor 2개 반영(1판 읽기 실패 기존 경보는 그대로, 보통 흐름 알림 스크롤은 결제 칸 안 조작·응답으로 생긴 알림만).
- **12판 재검증 반영**(13판, 기록·이전 PASS, 구매·화면 FAIL)
  - major: 스위치가 판을 2 로 바꾼 값에서 2판 키 없음·깨짐이면 경보(`record_payment_alert`)를 남기지 않고 고지 없음으로만(운영 DB 쓰기 방지), 11-1 에 경보 0회 / 보통 흐름에서 알림 자리가 화면 밖이면 화면 안으로 스크롤(초점 이동 없음), 11-3 에 360×640.
  - minor 반영: 스위치 호출처 '두 종류'와 두 감싸개 모두 판정 단언, 되돌리기 ③ 을 커밋 revert 로(다른 묶음 코드는 남김, 즉시 되돌리기는 조건부), 다시 적용 경로 정정(down 상태에서 되돌림 스크립트는 멈춤), 충전 기존 주문 분기 서술 정정, 알림 자리는 늘 있는 두 요소·role 고정, 개발 띠는 보통 흐름.
  - 반영하지 않은 지적: 없음.

**대표에게 물을 것** (11판)
1. 시험 계정으로 상품 상세를 열어 담을 때 남는 조회 기록(운영 DB 쓰기)도 허용 범위에 넣어도 되는가. 안 되면 담기는 대표가 미리 해 둔 장바구니로만 보고, 상세 화면 확인은 스위치 없이 1판 그대로 보는 것으로 줄인다.
2. 10-1 개발 전용 스위치(개발 모드·`VERCEL` 없음·환경 변수 셋 다일 때만, 화면용 값을 2판으로 그리고 기록 감싸개 두 곳이 결제를 막음)를 두는 것에 동의하는가. 두지 않으면 2판 화면은 스크립트 B 뒤 운영에서 처음 보게 되고, 문제가 있으면 되돌림 스크립트로 판 1 로 돌린다.
3. 4-2 충전 `validity` 초안을 '사라져요'에서 '쓸 수 없어요'로 바꿨다(지금 취소·환불정책과 같은 말). 승인한 초안과 달라졌으니 확인해 달라. (12판)
