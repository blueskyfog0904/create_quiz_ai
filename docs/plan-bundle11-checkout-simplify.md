# 11번 묶음 계획 — 결제 화면 단순화(장바구니 결제 칸, 동의 한 줄로 접기)

작성 2026-11-24 · 10판(2026-11-25, 9판 검증 8회차 반영 — 1판~9판 검증 반영 내역은 15절)

## 0. 대표 결정(2026-11-24)
1. 자료 구매는 **장바구니로만** 한다. 상품 상세의 '구매하기' 버튼을 없애고 '장바구니 담기'만 둔다.
2. 장바구니 결제 수단은 **크레딧만** 쓴다(카드로 바로 결제하는 방식은 하지 않음).
3. 결제 위치는 **A안**: 장바구니 화면 오른쪽에 늘 보이는 결제 칸을 둔다(별도 주문/결제 화면 없음). 샘플 그림은 ChatGPT 대화 '장바구니 UI 목업 생성'에 있다.
4. **충전 결제 화면도 함께** 정리한다.
5. 동의는 솔북처럼 `[필수]` 체크 하나로 접는다. 단, 다음은 솔북과 다르게 한다.
   - 환불 제한 핵심 줄은 접지 않고 늘 보이게 둔다.
   - 체크는 처음에 비워 둔다.
   - 개인(신용)정보 수집·제3자 제공 동의는 넣지 않는다(자료 구매는 크레딧 차감, 충전 결제 동의는 페이앱 결제창이 받음).

6. 4절 문구 초안은 대표가 그대로 승인했다(2026-11-24). 최종 문구는 나중에 클라이언트와 협의해 관리자 화면(9절)에서 직접 고친다. 그래서 관리자 편집 화면은 이번 묶음에 꼭 들어가야 한다.

## 1. 지금 상태(코드·운영 DB 확인, 2026-11-24)
- **상품 상세**(`src/components/market/market-item-actions.tsx`): '장바구니'와 '구매하기' 버튼이 둘 다 있다.
  - 구매하기는 확인창(`MarketCheckoutConfirmDialog`)을 열고 `/api/market/items/[itemId]/purchase` 를 부른다.
  - 비로그인 때는 담기·구매 의도를 sessionStorage(`market-cart-intent:v1`, action `cart|purchase`)에 남겼다가 로그인 뒤 한 번 쓴다.
  - 담기 결과 창에는 이미 '계속 둘러보기' / '장바구니 보기' 버튼이 있다.
- **장바구니**(`src/app/(solvook)/cart/_components/cart-view.tsx`): 여러 건을 골라 같은 확인창으로 `/api/market/cart/checkout` 을 부른다.
  - 두 경로 모두 서버는 `src/lib/market-checkout-server.ts` → DB `checkout_market_selection` 이다.
  - 장바구니도 업그레이드 차액(`upgradeBaseOrderId`)과 부분 보유 전체 패키지(`partiallyOwned`, 정가 확인 체크)를 이미 다룬다. 부분 보유 확인은 결제 요청 기록(`request_payload` 의 줄별 `ack`)에 남는다.
  - 장바구니 화면은 `/api/market/cart` 로 받은 뷰를 **해석하지 않고** 그대로 쓴다(`setView(payload.data)`). 확인창은 열 때 `view.purchaseNotice` 를 복사한다.
  - 확인창 설명 '크레딧으로 아래 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다.'와 부분 보유 확인 문장은 **코드에 박혀 있다**.
  - 충전 링크는 `chargeHref="/pricing"` 과 안내 줄(chargeHint)뿐이다. `returnTo` 처리는 코드 어디에도 없다.
- **확인창 동의**: 고지 본문(`confirmNotice`, 약 300자)이 그대로 펼쳐져 있고, 그 아래에 긴 체크 문장(`checkboxLabel`)이 붙어 있다. 약관·환불정책 링크는 바닥글에서 문서가 꺼져 있으면 조용히 숨는다.
- **자료 구매 동의 기록**: DB `record_purchase_notice_ack(p_user_id, p_idempotency_key, p_notice_sha256)` (운영 md5 `fa6a7edd…`) 가 기록한다.
  - 원문 = `checkboxLabel || LF || confirmNotice`(`{자료환불기간}` 채움). 409 details 는 `checkboxLabel·confirmNotice·noticeSha256·refundDays` 다.
  - 원문은 `market_purchase_notice_acks` 에 남긴다. 이 표에는 정책 문서 지문 칸이 없다.
  - 서버 계산은 `src/lib/market-purchase-policy-server.ts`. 화면용 정책은 `unstable_cache` 60초(키 `market_purchase_policy:v2`)다.
- **충전 화면**(`src/app/checkout/checkout-client.tsx`): 결제 버튼 위에 '결제 전 확인' 항목 5개(번호 목록), 미성년자 안내, 긴 동의 문장(`agreeLabel`)이 펼쳐져 있다. 환불정책 링크는 `/terms/refund` 로 코드에 박혀 있다.
- **충전 동의 기록**: DB `record_point_charge_checkout_ack` 가 정책 `point_charge_policy` 로 원문을 만든다.
  - 원문 = 제목, 항목 5개, 미성년자 안내, 동의 문구를 LF 로 이은 것. 지문을 대조하고 환불정책 문서 지문(`refund_policy_sha256`)을 함께 남긴다.
  - 409 는 route 가 `notice` 로 내려 준다(해석 실패면 정책을 다시 읽어 만든다, `checkoutChangedResponse`).
  - **10번 묶음이 이 함수를 다시 정의한다**(탈퇴 회원 거절, md5 `be4403fd…`). 11번은 10번 정의를 바탕으로 한다. **10번은 DB 만 적용됐다**(2026-11-24 14:38 KST, 지금 md5 `be4403fd…`, 5-5 그대로 목록의 10번 값도 운영에서 다시 읽어 같음을 확인). **10번 코드는 아직 push·배포 전이다.** 로컬 main 이 origin 보다 2개 앞선다(2026-11-25 확인): `51b7373`(10번 코드), `25f01b6`(10번 문서·약관 문구 스크립트). `KAKAO_ADMIN_KEY` 는 2026-11-25 Production 에 등록됐다(`docs/launch-owner-todo.md`). 10번 남은 순서는 `51b7373`·`25f01b6` push·배포 → 같은 작업 창에서 약관·처리방침 문구 스크립트(`supabase/scripts/20261126_bundle10_policy_text.sql`, 대표가 재동의 대상을 확인한 뒤) → 시험 계정 확인 → 스위치(10번 계획대로)다. 11번은 이것을 시작 조건으로 둔다(10절 단계 1).
- **판매 상태(2026-11-25 운영 확인)**: '출시 전·판매 꺼짐'이 아니다. `payment_runtime_config` 의 `master_accepts_new_orders`·`payapp_accepts_new_orders` 가 2026-11-11 부터 켜져 있고(카카오페이만 꺼짐), 11-17~11-22 에 실회원으로 보이는 카카오 가입자 4명이 페이앱으로 충전(9,900원 3건, 29,900원 1건)하고 크레딧으로 자료를 사서 내려받았다. 판매를 계속할지 멈출지는 대표가 따로 정하는 중이다. **이 계획은 두 경우 모두 안전하게 쓰고, 다른 점만 짧게 적는다**(아래 '판매 켜짐/꺼짐' 표시).
- **두 정책의 `version` 뜻이 다르다**
  - 충전: 관리자가 저장할 때마다 +1 되는 **편집 번호**다(`savePointChargePolicyTexts`, 낙관적 잠금).
  - 자료: 저장해도 그대로다. 저장은 `refundDays` 만 대조하고 낙관적 잠금이 없다.
  - 운영 값은 둘 다 1이다.
- **정책 문서 사본**(`policy_document_snapshots`): `refundPolicy`(최신 seq 21)·`serviceTerms`(22)·`privacyPolicy`(14). 바닥글 설정(`site_footer_content.policyDocuments`)에서 세 문서 모두 켜져 있다.
- **관리자 문구 편집**:
  - 자료 구매 문구: 바닥글 설정의 구매 정책 폼(`src/app/(admin)/admin/footer/purchase-policy-form.tsx`·`purchase-policy-actions.ts`)
  - 충전 문구: 요금제 화면의 충전 정책 폼(`src/app/(admin)/admin/pricing/point-charge-policy-form.tsx`·`actions.ts`). 작업 기록에 1판 규칙 지문(`notice_sha256_before/after`)을 남긴다.

## 2. 목표
1. 자료 구매 경로를 하나로 줄인다: 상세에서 담기 → 장바구니 결제 칸에서 결제.
2. 결제 버튼 바로 위 동의를 체크 하나와 짧은 핵심 줄로 줄이고, 자세한 내용은 '보기'로 연다.
3. 회원이 실제로 본 것(요약 줄, 항목 이름, 펼쳐 볼 수 있던 본문)이 지금처럼 동의 기록과 지문에 남게 한다. 회원이 체크한 장바구니 문장(부분 보유 정가 확인 등)과 항목 구조는 기록 칸(`consent_details`)에 남긴다. 연결된 정책 문서 판은 기록 칸에 남긴다(기록하는 때의 최신 사본, 5-4 한계).
4. 문구는 모두 DB 에 두고, 관리자 화면에서 고칠 수 있게 한다.
5. 1판과 2판이 함께 도는 동안(배포 직후, 옛 브라우저 탭, 되돌리기)에도 **화면에 보인 글과 기록된 원문이 어긋나지 않게** 한다. 어긋날 수 있는 곳은 모두 결제가 막히는 쪽으로 닫는다.

## 3. 공통 동의 부품 `CheckoutConsent`(새 파일 `src/components/checkout/checkout-consent.tsx`)
모양(2판, 장바구니 결제 칸과 충전 화면이 같이 씀):
```
☐ [필수] {consentTitle}                [세부 항목]
   {consentSummary 1줄}
   {consentSummary 2줄}
   …

─ [세부 항목]을 누르면 열리는 창 ─
   제목: 세부 항목 — {consentTitle}
   ☐ {항목1 이름}                        보기 ⌄   (본문이 그 아래에 펼쳐짐)
   ☐ {항목2 이름}                        보기 ⌄
   ☐ {항목3 이름}                        보기 ↗   (새 창)
   …
                                         [닫기]
```
- **체크**
  - 처음에는 모두 비어 있다. 체크 값(위·하위)은 부품이 들지 않는 **제어 값**이다. 값과 콜백을 props 로 받고, 주인인 껍데기가 언제든 비울 수 있다(6-0·6-3).
  - 위 체크(전체)를 누르면 하위 항목이 모두 체크된다.
  - 하위 항목이 모두 체크돼야 위 체크가 켜지고, 하나라도 풀면 위 체크도 풀린다. 일부만 켜지면 위 체크는 '일부 선택'(`aria-checked="mixed"`)으로 보인다.
  - 결제 버튼은 위 체크가 켜져야 열린다.
  - 제목 글자를 눌러도 위 체크가 바뀐다(label). 세부 항목은 [세부 항목] 버튼으로만 연다.
- **요약 줄(`consentSummary`)**: 늘 보인다. 환불 기간·환불 제한·유효기간처럼 꼭 알아야 하는 것만 쓰고, "할 수 있어요"부터 말한다. 줄 구성은 4-3 규칙으로 고정한다.
- **세부 항목 창**(3판의 '아래로 펼침'을 바꿈)
  - 하위 항목 목록은 결제 칸 안에서 펼치지 않고 **창(공용 StudioDialog)** 으로 연다. 장바구니 결제 칸의 높이(6-1)를 펼침과 관계없이 일정하게 두기 위해서다. 충전 화면도 같은 부품이라 같은 방식이다.
  - [세부 항목] 버튼: `aria-haspopup="dialog"`. 버튼 폭은 고정(`w-[5.5rem]`)이다. 일부만 체크됐으면 'n/m' 을 버튼 **안** 둘째 줄에 보인다(제목 줄 폭이 바뀌지 않게 — 6-1 높이 예산). 접근 이름은 진행을 담는다: 아무것도 안 했거나 다 했으면 '세부 항목 보기', 일부만이면 '세부 항목 보기, m개 중 n개 동의'.
  - 창 제목은 '세부 항목 — {consentTitle}'(Radix DialogTitle).
  - 창 안 하위 항목 체크와 결제 칸의 위 체크는 같은 상태다. 창 안에서 바꾸면 위 체크가 바로 따라 바뀐다.
  - 창 패널은 `max-h-[calc(100dvh-2rem)]` + `grid-rows-[auto_minmax(0,1fr)_auto]` 다. 본문(항목 목록)만 스크롤하고, 아래 [닫기] 줄은 늘 보인다. [닫기]는 창을 닫기만 한다(동의를 켜지 않음). '확인'은 동의로 읽히므로 쓰지 않는다(`StudioDialogPanel` 의 `showCloseButton={false}` + 버튼 하나).
  - 닫으면 초점은 [세부 항목] 버튼으로 돌아온다.
- **보기**(창 안)
  - 화면에 보이는 항목 이름은 `consentItems.label` 뿐이다. '보기' 글자는 부품의 버튼 이름(고정 UI 글자)이고, 바닥글 문서 이름(예: '취소/환불정책')은 쓰지 않는다. 그래서 화면 글과 기록 원문이 어긋나지 않는다.
  - 접근 가능한 이름은 항목마다 다르게 한다: text 는 `aria-label="{label} 본문 보기"`, link 는 `aria-label="{label} 보기(새 창)"`. 보이는 글은 '보기' 그대로다.
  - 종류 `text`: 같은 창 안에서 그 항목 아래로 본문을 펼친다(`aria-expanded`·`aria-controls`, 창 안에서 다시 창을 열지 않음). 본문이 여럿이면 문단으로 나눠 정의 순서대로, 왼쪽 정렬·줄바꿈 유지로 보인다.
  - 종류 `link`: 정책 문서를 새 탭으로 연다. 바닥글 구매 정책 링크(`market-purchase-info.ts` 의 `termsLink`·`refundPolicyLink`)에서는 주소(href)만 쓴다.
  - 창은 body 아래 포털로 그려져 부모의 변수가 이어지지 않는다. 그래서 창 패널에 부품이 받은 테마 클래스를 다시 붙인다(`--consent-*` 값. 충전 화면은 `--ring`·`--accent` 도 잉크 값으로 덮음). 닫기는 X 대신 [닫기] 하나이고, 색은 `--consent-ink` 를 쓴다.
  - **link 항목의 주소가 없으면**(바닥글에서 문서가 꺼졌거나 본문이 빔) 부품을 그리지 않는다. 그 자리에 고지 없음 경고(6-3·8)를 보이고 결제를 막는다(닫힘). DB 도 같은 경우를 거절한다(4-3 (g)).
- **접근성**
  - 체크 상자 44px 터치 영역, `role="group"` + `aria-labelledby`
  - 위 체크 상자는 `aria-describedby` 로 요약 줄 목록 id 를 가리킨다. 그래서 화면 읽기 사용자도 체크할 때 환불 제한 줄을 듣는다.
  - 창은 바깥을 눌러도 닫히지 않는 기존 규칙을 따른다.
- **디자인**
  - 빨간색과 경고 아이콘은 쓰지 않는다(고지 없음 경고도 `--consent-ink` 글자).
  - 부품은 색을 직접 쓰지 않고 CSS 변수(`--consent-ink`·`--consent-muted`·`--consent-line`·`--consent-ring`)만 쓴다. 장바구니는 studio 값을, 충전 화면은 `--ck-*` 값을 넣는다.
  - 체크 상자는 Radix Checkbox 하나로 통일한다. 충전 화면의 잉크 디자인 계약 시험이 이 파일도 읽게 넓힌다(studio-primary·brand 변형 금지). 세부 항목 창 패널의 className 에 테마 변수 클래스가 있는지도 본다.
  - 일부 선택은 빼기(−) 아이콘으로 그린다. `data-[state=indeterminate]` 의 테두리·색도 켜짐과 다르게 한다. 공용 `src/components/ui/checkbox.tsx` 는 Indicator 가 체크 아이콘 하나뿐이라, 부품 안에서 Indicator 를 직접 그린다(공용 Checkbox 는 고치지 않음).
- **선택 0건**: 장바구니에서 자료를 하나도 고르지 않으면 동의 체크(전체·하위)를 비활성으로 둔다. 안내 '자료를 선택하면 동의할 수 있어요'는 동의 줄 아래가 아니라 **결제 칸 위 영역의 알림 자리**에 보인다(아래 고정 영역 높이를 바꾸지 않게 — 6-1). 결제 버튼 이름도 '자료를 선택하세요'다.

### 3-1. 1판 모드(새 코드 + 1판 정책)
- 1판 지문은 '체크 문구 + 고지 본문 전체를 펼쳐 놓고 보았다'는 증빙이다. 그래서 1판일 때는 접지 않는다.
- **자료(장바구니 결제 칸)**: 부품이 1판 묶음을 받으면 다음만 그린다. 지금 확인창과 글이 같다.
  - `confirmNotice` 본문(펼친 채). 넓은 화면에서는 본문만 높이 96px(`max-h-24`) 상자 안에서 스크롤한다(6-1 높이 예산). 지금 확인창도 본문을 스크롤로 보였다. 상자에는 `tabIndex=0` 과 이름 '자료 환불 안내 본문'을 준다.
  - `[필수] {checkboxLabel}` 체크 하나
  - 약관·환불정책 링크(있으면 보이고, 없으면 숨김 — 1판 지문에는 링크가 들어가지 않으므로 지금 동작 그대로). 링크가 없어도 링크 줄 높이(24px) 자리는 그대로 둔다(6-1 아래 영역 높이 불변).
- **충전**: 1판일 때는 부품을 쓰지 않고 지금 `CheckoutNoticeSection` 과 `agreeLabel` 체크를 그대로 그린다(8절).

## 4. 문구(DB) — 정책 2판
- 1판 검증 지적으로 고친 초안 문구는 **[2판 고침]** 으로 표시했다. 0-6 승인 뒤에 바뀐 부분이라 대표가 다시 확인한다(15절 끝 '대표 확인').

### 4-0. 판 구분: `consentFormat` (version 을 쓰지 않음)
- 두 정책에 정수 키 `consentFormat` 을 둔다.
  - 키가 없거나 1 → 1판 규칙
  - 2 → 2판 규칙
  - 그 밖의 값(글자 "2", 2.5, 3, null 등) → 결제 닫힘(DB `NOTICE_POLICY_UNAVAILABLE`, 서버 null)
  - TS: `value.consentFormat === undefined || value.consentFormat === 1` 이면 1, `=== 2` 이면 2.
  - SQL: `NOT (v_value ? 'consentFormat')` 이면 1. `jsonb_typeof(v_value->'consentFormat') = 'number'` 이고 `(v_value->>'consentFormat')::numeric` 이 1 이면 1, 2 이면 2. 글자 비교는 쓰지 않는다(`2.0` 대비).
- `version` 은 판이 아니다. **두 정책 모두 '저장할 때마다 +1 되는 편집 번호'로 맞춘다.**
  - 충전은 지금 그대로다.
  - 자료도 이번에 관리자 저장이 낙관적 잠금으로 +1 하게 바꾼다(9절).
  - 스크립트(5-6)도 실행할 때 +1 한다. 그래서 충전 폼과 새 코드의 자료 폼은 version 대조로 옛 값 덮어쓰기가 막힌다. **옛 코드의 자료 폼은 version 을 보지 않으므로**(지금 저장은 `refundDays` 만 대조) 스크립트 머리말의 저장 금지(관리자 화면을 닫고 실행)로만 막는다. 상세 문구 `purchaseCompleteNotice` 는 스크립트가 아니라 배포 직후 새 관리자 화면에서 바꾸므로(4-1) 이 덮어쓰기와 겹치지 않는다.
- 관리자 저장은 `consentFormat` 을 입력으로 받지 않는다. 읽은 원본 jsonb 위에 문구 키만 덮으므로 판 값은 그대로 남는다. 판을 바꾸는 일은 5-6 스크립트로만 한다.
- 1판 키는 지우지 않는다(1판 모드, 옛 동의 기록 해석, 되돌리기용).

### 4-1. `market_purchase_policy` 에 더하는 키(문구는 초안, 대표 확인)
- `consentTitle`: 주문 내용·구매 조건 확인 및 동의 **[2판 고침]**
- `consentSummary`(객체. 줄 순서는 4-3 (b) 의 역할 순서)
  - `refundPeriod`: 받지 않은 자료는 구매일 다음 날부터 {자료환불기간}일째 되는 날까지 자료 보관함이나 고객센터로 환불을 신청할 수 있어요. **[2판 고침]**
  - `restriction`: 다운로드한 자료는 단순 변심으로 환불되지 않아요. 자료 안의 파일을 하나라도 받으면 그 자료는 받은 것으로 보고, 문제(HWP)를 받으면 함께 든 문제(PDF)도 받은 것으로 봐요. **[2판 고침]**
  - `note`(선택): 하자가 있거나 소개 내용과 다른 자료는 다운로드한 뒤에도 환불받을 수 있어요. — 넣는다(15절 대표 확인 2).
  - 환불이 결제에 쓴 크레딧으로 돌아온다는 점(철회의 효과)과 '전체 패키지는 받지 않은 자료만큼 정가 비율로 환불'은 요약 줄에 넣지 않는다. 두 내용은 `confirmNotice`(세부 항목 창)와 상품 상세 환불 안내에 있다. 요약 줄은 결제 칸 높이(6-1)를 위해 환불 기간·제한·하자 환불만 둔다(합계 220자 예산, 초안 212자). 넣으려면 자료 요약은 역할이 셋뿐이고(note 는 이미 씀) 합계 220자·높이 검사(9절)의 여유가 크지 않으므로(초안 212자), 기존 줄을 고쳐 써서 한 줄 이상 줄여야 한다. 그래도 안 되면 6-1 높이 예산을 다시 잡는 코드 변경이 필요하다. 이 배치가 충분한지는 13절 질문 1 에 함께 묻는다.
- `consentItems`(배열)
  1. `{key:'purchaseNotice', label:'자료 환불 안내', view:'text', textKeys:['confirmNotice']}`
  2. `{key:'usageScope', label:'자료 이용 범위', view:'text', textKeys:['usageScopeNotice']}`
  3. `{key:'refundPolicy', label:'취소·환불정책', view:'link', link:'refundPolicy'}`
  4. `{key:'terms', label:'서비스 이용약관', view:'link', link:'serviceTerms'}` (링크 이름은 코드의 `serviceTerms` 에 맞춤)
- 결제 칸 문구('장바구니 문구'. 코드에 박혀 있던 것을 옮김. 동의 원문·지문에는 넣지 않고 따로 묶는다 — 5-4·6-2)
  - `cartCheckoutNotice`: 크레딧으로 선택한 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다. (지금 확인창 설명에서 '아래'만 '선택한'으로)
  - `partialOwnedConfirmLabel`: 이미 구매한 개별 자료가 포함된 전체 패키지는 기보유분 차감 없이 정가로 구매됨을 확인했습니다. (지금 문구 그대로)
  - 기록 방법: 회원이 체크하는 문장이므로 **회원이 보고 있던 화면의 문구만** 기록에 남아야 한다.
    - 새 결제 칸은 화면에 보인 문장의 지문(`cartTextsSha256`)을 보낸다. DB 기록 함수가 이 값을 정책 문장의 지문과 대조하고, 같을 때만 동의 기록의 `consent_details.cartTexts` 에 두 문장 전문을 남긴다(5-4·5-5).
    - 다르면 기록하지 않고 거절한다(`NOTICE_CHANGED` + 새 문장). 그래서 결제 없이 남는 기록도 생기지 않는다.
    - 지문을 보내지 않는 호출(옛 코드: 상세 바로 구매, 코드에 박힌 문장을 보인 옛 장바구니 확인창)은 `cartTexts` 를 null 로 기록한다. 그 화면은 DB 문장을 보인 적이 없기 때문이다.
    - `cartTexts` 는 '그때 결제 칸이 쓰던 문구의 판'이다. 부분 보유 확인 문장은 부분 보유 줄이 있을 때만 보이므로, **그 문장이 실제로 보였는지·체크됐는지는 같은 요청 키의 결제 요청 기록(`market_checkout_batches.request_payload`)의 줄별 `ack`(요청의 `acknowledgeNoDiscount`)로 본다.** 그런 줄이 없으면 그 문장은 보이지 않은 것이다. 기록을 보여 주는 곳(8절 결제 내역·관리자 화면)이 생기면 같은 규칙으로 읽는다.
    - 장바구니 문구 지문 = sha256(UTF-8 `cartCheckoutNotice` + LF + `partialOwnedConfirmLabel`), 채우기 없음, 소문자 16진수. 서버(TS)와 DB 가 같은 규칙을 쓴다. TS 는 이 지문을 만들거나 문구를 읽을 때 trim·줄바꿈 정규화를 하지 않는다(5-1 과 같음).
- 상품 상세 문구 `purchaseCompleteNotice` 는 지금 '구매 후 바로 다운로드할 수 있으며, …'라서, 구매하기가 없어지면 '장바구니 담기' 버튼 아래에서 상세에서 바로 사는 것처럼 읽힌다.
  - **단계 5 배포 직후 새 관리자 화면에서** '장바구니에서 구매하면 자료 보관함에서 바로 받을 수 있습니다.'로 바꾼다(데이터, 작업 기록에 전후 값). 스크립트 A 에 넣지 않는 까닭: 스크립트 A 는 배포 전에 돌아야 하는데(새 코드가 장바구니 문구를 읽음), 그 사이 옛 상세의 '구매하기' 아래에 새 문장이 보이면 실회원이 상세에서 살 수 없다고 오해할 수 있기 때문이다(판매 켜짐일 때).
  - 관리자 이름표(`MARKET_PURCHASE_POLICY_TEXT_LABELS`)는 '상품 상세 담기 버튼 아래 안내'로 고친다.
- `checkboxLabel` 은 2판 화면에서 쓰지 않는다(1판 모드·되돌리기용).
- `confirmNotice`·`usageScopeNotice` 본문은 그대로 쓰고, '보기' 창에 보인다.

### 4-2. `point_charge_policy` 에 더하는 키
- `consentTitle`: 주문 내용·충전 조건 확인 및 결제 동의 **[2판 고침]**
- `consentSummary`(객체)
  - `refundPeriod`: 이 충전 건의 크레딧을 하나도 쓰지 않았다면 결제일 다음 날부터 {충전환불기간}일째 되는 날까지 전액 환불을 신청할 수 있어요. **[2판 고침]**
  - `restriction`: 이 충전 건의 크레딧을 하나라도 쓰면 단순 변심으로는 취소할 수 없어요.
  - `validity`: 충전한 크레딧은 결제한 때부터 {충전유효기간}년 동안 쓸 수 있고, 기간이 지나면 남은 크레딧은 사라져요. **[2판 고침]**
  - `minor`: 미성년자가 법정대리인 동의 없이 결제했다면 본인이나 법정대리인이 결제를 취소할 수 있어요(예외 있음). **[2판 고침: 새 줄]**
- `consentItems`
  1. `{key:'product', label:'충전 상품 안내', view:'text', textKeys:['checkoutItems.product','checkoutItems.validity']}`
  2. `{key:'refund', label:'취소·환불 안내', view:'text', textKeys:['checkoutItems.refund','checkoutItems.restriction','checkoutItems.otherCases']}`
  3. `{key:'minor', label:'미성년자 결제 취소 안내', view:'text', textKeys:['minorNotice']}` **[2판 고침: 따로 뗌]**
  4. `{key:'refundPolicy', label:'취소·환불정책', view:'link', link:'refundPolicy'}`
  5. `{key:'terms', label:'서비스 이용약관', view:'link', link:'serviceTerms'}`
- 요약 줄 초안은 정책 본문의 조건 두 가지를 빼고 줄였다. 하나는 '크레딧은 유효기간이 먼저 끝나는 것부터 쓰입니다'(`checkoutItems.restriction`), 다른 하나는 '크레딧 지급이 결제보다 늦어지면 지급일 다음 날부터'(`checkoutItems.refund`)다. 둘 다 세부 항목 창의 본문에 있다. 0-6 기본값(초안 그대로)에 따라 지금은 넣지 않는다. 앞의 것은 '하나라도 쓰면 취소 불가'가 이 충전 건에 걸리는지를 정하므로, 대표·클라이언트가 문구를 정할 때 `restriction` 줄 끝에 '크레딧은 유효기간이 먼저 끝나는 것부터 쓰여요.'를 붙이는 안을 먼저 검토한다(합계 약 64자).
- 미성년자 줄을 요약에 둔 이유: 9번에서 법률 검증을 거쳐 미성년자 안내를 '동의 체크 바로 위'에 두기로 했다. 접힌 곳에만 두면 그 보호에서 물러난다. 변호사 답(13절 2)이 '접어도 된다'로 오면 그때 4-3 규칙과 함께 뺀다.
- `{충전유효기간}` 자리표시: 서버는 `POINT_CHARGE_VALIDITY_YEARS`, DB 는 같은 상수 1로 채운다. 계약 시험이 이 둘과 지급 함수의 `p_approved_at + interval '1 year'` 를 묶는다. 관리자가 요약 줄에 '2년'처럼 숫자를 적으면 저장되지 않는다(4-3 (c)).
- `checkoutTitle`·`agreeLabel` 은 2판 화면에서 쓰지 않는다(1판 모드·되돌리기용).

### 4-3. 검증 규칙(코드·DB 같게)
어기면 관리자 저장은 거절하고, 스크립트는 RAISE 로 멈추고, DB 함수는 `NOTICE_POLICY_UNAVAILABLE`, 서버는 null(결제 막힘 + 경보)이다.

- **(S) 글자 검사** — 2판 원문에 들어가는 모든 문자열(제목·요약 줄·항목 이름·가리킨 본문)에 쓴다.
  - jsonb 글자(string)여야 한다.
  - 채운 뒤(5-1 `fill`) `{` 나 `}` 가 남으면 안 된다.
  - 채운 뒤 공백·탭·LF·CR 이 아닌 글자가 하나 이상 있어야 한다. TS `/[^ \t\n\r]/`, SQL `~ '[^ \t\n\r]'`(CR 하나뿐인 줄이 빈 줄로 보이는 일을 막음, 4-3 (g)와 같은 식).
  - 글자 수는 채우기 전 값의 코드포인트 수로 센다. TS `[...s].length`, SQL `char_length(s)`.
- **(S1) 한 줄 칸에는 LF 가 없어야 한다**: 제목·요약 줄·항목 이름·`cartCheckoutNotice`·`partialOwnedConfirmLabel`. TS `!s.includes('\n')`, SQL `strpos(s, chr(10)) = 0`. LF 는 가리킨 본문(textKeys)에만 허용한다. 원문·장바구니 지문이 LF 로 줄을 나누므로, 한 줄 칸에 LF 가 들어가면 화면 구조가 다른데 지문이 같은 정책이 생기기 때문이다(예: restriction 'X\nY' 와 restriction 'X' + note 'Y'). 관리자 폼은 한 줄 칸에 줄바꿈을 넣을 수 없게 한다(`input`).
- **(a) `consentTitle`**: S, 1~26자. 부품이 앞에 '[필수] '(5자)를 붙이므로 결제 칸 제목 줄은 최대 약 31자이고, 한 줄 약 16자로 2줄을 넘지 않는다(6-1). 초안은 19·22자. `[필수]`·`(필수)` 를 넣지 않는다(부품이 붙임).
- **(b) `consentSummary`**: JSON 객체. 키는 아래 역할만, 필수 역할은 모두 있어야 한다. 값은 S, 1~120자. 선택 역할은 키가 없을 때만 빠진 것으로 보고, 키가 있는데 값이 null·글자 아님이면 거절한다.
  - 자료 역할 순서: `refundPeriod`(필수) → `restriction`(필수) → `note`(선택)
  - 충전 역할 순서: `refundPeriod`(필수) → `restriction`(필수) → `validity`(필수) → `minor`(필수) → `note`(선택)
  - `refundPeriod` 에는 기간 자리표시(자료 `{자료환불기간}`, 충전 `{충전환불기간}`)가 있어야 한다. 충전 `validity` 에는 `{충전유효기간}` 이 있어야 한다.
  - 필수 역할 줄은 관리자 폼에서 지울 수 없다. 그래서 '늘 보이는 환불 제한 줄'(0-5)이 저장으로 빠지지 않는다.
  - 자료 요약 줄은 모두 합쳐 220자 이하다. 장바구니 결제 칸 높이 예산(6-1)의 근거이고, 초안은 212자다.
  - 충전은 합계 제한을 두지 않는다. 충전 주문 요약 칸은 lg 에서 `sticky` 이지만 최대 높이·안쪽 스크롤을 두지 않는다. 그래서 칸이 보기 영역보다 길면 페이지와 함께 스크롤되고 버튼이 잘리지 않는다(8절). 세부 항목은 창으로 열리므로 칸 높이가 펼침으로 늘지 않는다.
- **(c) 숫자 금지**: 제목·요약 줄·항목 이름의 채우기 전 값에서 기간은 자리표시로만 쓴다. 두 식 모두에 걸리지 않아야 한다(TS 와 SQL 이 같은 식).
  - ① 숫자 글자 금지: `[0-9０-９]` 가 아예 없어야 한다(초안에는 숫자가 없음). 단위를 바꿔 적는 '12개월'·'6주'·'24시간'도 함께 막힌다.
  - ② 한글 수 + 기간 단위 금지: `([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)` 과 낱말 `(하루|이틀|사흘|나흘|열흘|보름|한 해)` 가 없어야 한다.
  - 시험 예시(막힘): '30일', '１년', '12개월', '6주', '일 년', '삼십 일', '한 달', '이틀'. (통과): '{자료환불기간}일째', '{충전유효기간}년', '구매일 다음 날', '이 충전 건의'. 초안 문장은 모두 통과한다.
  - 드물게 기간이 아닌 말이 걸리면(예: '이 일', '한 주제') 관리자가 표현을 바꾼다. 저장 오류는 어느 칸인지 짚어 알린다(9절).
  - 한계: 숫자 글자를 모두 막으므로 법정 기간(예: 3개월·30일)이나 '1:1 문의' 같은 표현은 요약 줄·제목·항목 이름에 쓸 수 없다. 이런 내용은 본문(세부 항목 창)에 둔다.
- **(d) `consentItems`**: 배열, 1~6개.
  - 원소는 객체다. `view` 가 `text` 이면 키가 정확히 `key·label·view·textKeys`, `link` 이면 정확히 `key·label·view·link` 다.
  - `key`: `^[a-z][A-Za-z0-9]{0,29}$`, 중복 없음.
  - `label`: S, 1~30자.
  - `textKeys`: 배열 1~6개. 원소는 (e) 허용 목록 글자. 모든 항목을 통틀어 중복 없음.
  - `link`: `refundPolicy` 또는 `serviceTerms`. 모든 항목을 통틀어 각각 한 번까지.
- **(e) 가리킬 수 있는 본문(문자열 잎만)과 읽는 곳** — 이 목록 밖은 거절한다. SQL 은 아래 표를 CASE 로 그대로 쓰고, 일반 경로 풀이(`#>>`)는 쓰지 않는다.
  - 자료: `confirmNotice`·`usageScopeNotice`·`downloadPeriodNotice` → `P->>'키'`
  - 충전: `checkoutItems.product`·`checkoutItems.validity`·`checkoutItems.refund`·`checkoutItems.restriction`·`checkoutItems.otherCases` → `P->'checkoutItems'->>'뒤 이름'`, `minorNotice` → `P->>'minorNotice'`
  - 가리킨 본문도 S 검사를 한다(값이 객체·배열이면 jsonb 글자가 아니므로 거절).
- **(f) 포함 규칙(법정 고지가 빠지지 않게)**
  - 자료: textKeys 전체에 `confirmNotice` 가 있고, link 에 `refundPolicy`·`serviceTerms` 가 모두 있다.
  - 충전: textKeys 전체가 (e)의 6개와 정확히 같다(빠짐·중복 없음). link 에 `refundPolicy`·`serviceTerms` 가 모두 있다.
- **(g) 링크 문서가 보여야 함(결제 때 검사. 관리자 저장 검사에는 넣지 않음)**: link 가 가리키는 바닥글 문서가 켜져 있고 이름·본문이 비어 있지 않아야 한다. 정책 문서 사본도 있어야 한다.
  - 서버와 DB 가 **정규화하지 않은 바닥글 원본**(`site_footer_content` 설정 행의 `value`)에서 같은 세 조건을 본다. `getVisibleFooterPolicyLinks` 는 쓰지 않는다. 이 함수는 `normalizeFooterContent` 결과를 보는데, 정규화가 빈 이름·빈 본문·읽기 실패를 코드 기본값으로 채워 DB 판단과 갈리기 때문이다. 서버는 `footer-policy-raw.ts` 처럼 원본을 직접 보는 작은 검사 함수를 둔다.
    - 문서: `v_doc := value -> 'policyDocuments' -> '<link 키>'`(배열이 아니라 문서 키별 객체). 없거나 객체가 아니면 닫힘.
    - 켜짐: `v_doc -> 'enabled' = 'true'::jsonb`(TS `doc.enabled === true`). 값이 없거나 true 가 아니면 닫힘.
    - 이름·본문: `v_doc ->> 'label'`·`v_doc ->> 'content'` 가 jsonb 글자이고 공백·탭·LF·CR 가 아닌 글자가 있음(TS `/[^ \t\n\r]/`, SQL `~ '[^ \t\n\r]'`).
    - `title`·`slug` 는 보지 않는다.
  - 서버가 바닥글 원본을 읽지 못하면 닫는다.
  - DB 만: `policy_document_snapshots` 에 그 `doc_key` 의 사본이 하나 이상 있다(5-4. 없으면 2판 기록의 문서 지문이 비므로 닫는다).
  - 두 판단은 같은 원본·같은 식이라 갈리지 않는다. 사본 검사만 DB 에 더 있고, 걸리면 결제가 막히는 쪽이다.
  - 화면의 링크 주소(href)는 지금처럼 `buildMarketPurchaseInfo` 에서 읽되, 위 검사가 '닫힘'이면 주소가 있어도 고지 없음으로 본다.
- **장바구니 문구**(`cartCheckoutNotice`·`partialOwnedConfirmLabel`): jsonb 글자, `{`·`}` 없음, LF 없음(S1), 공백·탭·CR 이 아닌 글자가 있음, 1~300자. 없거나 어기면 장바구니 결제 칸을 닫는다(1판·2판 모두).
  - DB 는 두 키가 jsonb 글자이고 위 장바구니 문구 규칙(중괄호 없음, LF 없음(S1), 공백·탭·CR 이 아닌 글자, 1~300자)을 **모두** 지킬 때만 문장과 지문을 만들고, 아니면 둘 다 null 로 본다. TS 와 같은 규칙이다(5-5 규칙 3 의 '정책 문구가 없음'과 같은 뜻). 그래서 SQL 로 직접 LF 를 넣어 두 문장 사이 경계를 옮겨도 지문이 같은 채 기록되는 일이 없다.
  - 장바구니 지문 인자가 null 인 호출(옛 코드)은 이 문구와 관계없이 지금처럼 기록한다(`cartTexts` null). 11번 마이그레이션 뒤·스크립트 A 전에 도는 옛 코드를 막지 않기 위해서다.
  - 인자가 있는데 DB 문장이 null 이면 지문이 다르므로 거절된다(닫힘).

### 4-4. 해석을 나눈다(동의 문구 실수가 환불을 막지 않게)
- `parseMarketPurchasePolicy`·`parsePointChargePolicy` 는 지금 그대로 두고 새 키를 읽지 않는다. 이 두 함수는 환불 신청·관리자 승인·보관함·상품 상세·크레딧 화면이 함께 쓰기 때문이다.
- 새 해석 함수를 따로 둔다.
  - `parseMarketPurchaseConsent(value)`: 판, 2판 묶음 재료, 장바구니 문구 2개
  - `parsePointChargeConsent(value)`: 판, 2판 묶음 재료
- 실패하면 결제(동의 화면·기록)만 막는다.
  - 판이 1이면 2판 키가 깨져 있어도 결제는 1판으로 된다. 관리자 폼은 그 칸의 오류를 보이고, 2판 키를 고치기 전에는 저장을 막는다(9절과 같은 규칙). 2판 키가 아예 없으면(스크립트 A 전) 2판 검사를 하지 않는다.
  - 판이 2인데 2판 키가 깨졌으면 결제만 닫힌다.
- 세 해석은 서로 따로 성공하고 실패한다: 판, 2판 묶음 재료, 장바구니 문구. 그래서 판 1에서 2판 키만 깨져도 장바구니 문구는 그대로 읽힌다.
- 정책을 읽는 함수가 돌려주는 값의 모양은 `{ policy: 1판 해석, consent: 2판 해석 | null, cartTexts: 장바구니 문구 | null, consentFormat: 1 | 2 | null }` 다. 캐시를 쓰는 곳과 쓰지 않는 곳이 같은 모양이다.
  - **1판 해석 실패만 throw** 한다(지금처럼 null 이 캐시되지 않게).
  - 2판 해석·장바구니 문구 실패는 null 로 둔다. 그래서 보관함 환불 칸(`getMarketRefundPolicyCached`)과 상품 상세 안내는 2판 키가 깨져도 그대로다.
- **장바구니 뷰는 정책을 캐시 없이 읽는다**(`/api/market/cart`, 장바구니 페이지 첫 값). 사용자마다 다른 화면이고 결제로 이어지는 값이기 때문이다. 상품 상세·보관함은 지금처럼 60초 캐시를 쓴다. 충전 결제 화면은 지금도 캐시 없이 읽는다.
- DB 도 같다. 환불 판정 함수(`get_point_charge_refund_eligibility`, `point_charge_refund_days`, 자료 환불 경로)는 새 키를 읽지 않는다.

## 5. 동의 기록·지문 2판(DB)
### 5-1. 원문 만들기(2판, 정확한 규칙)
- **입력**
  - 정책 jsonb `P`
  - 기간 `D`: 자료는 `P.refundDays`(1판과 같은 검사), 충전은 `point_charge_refund_days()`
  - 충전만 유효기간 `Y` = 1 (4-2)
- **채우기 `fill(s)`**
  - 자료: `s` 의 `{자료환불기간}` 을 모두 `D` 의 10진 글자로 바꾼다.
  - 충전: 먼저 `{충전환불기간}` → `D`, 다음 `{충전유효기간}` → `Y`.
  - TS 는 `split().join()`, SQL 은 `replace()` 를 같은 순서로 쓴다.
- **줄 목록 L** (위에서부터)
  1. `fill(consentTitle)`
  2. 요약 줄: 4-3 (b) 역할 순서대로, 있는 역할만 `fill(consentSummary[역할])`. 선택 역할(`note`)은 **키가 없을 때만** 빠진 것으로 본다. 키가 있는데 값이 글자가 아니면(null 포함) 4-3 위반으로 거절한다(TS·SQL 같음).
  3. 항목: `consentItems` 배열 순서대로. SQL 은 `consentItems`·`textKeys` 를 `jsonb_array_elements … WITH ORDINALITY` 로 펼쳐 `ORDER BY` 순서로 잇는다(순서에 기대지 않음).
     - `fill(label)`
     - `text` 이면 `textKeys` 순서대로 `fill(본문)`. 본문 안의 줄바꿈은 그대로 둔다.
     - `link` 이면 `링크:` + link 값(예: `링크:refundPolicy`). 콜론 뒤 공백 없음, 표시 이름이 아니라 키.
- **원문** = L 을 LF(`\n`, SQL `chr(10)`)로 잇는다. 끝에 LF 를 붙이지 않는다. 줄 앞뒤 공백은 다듬지 않는다. **TS 는 원문을 만들 때 trim·줄바꿈 정규화를 하지 않는다**(저장 때의 정규화와 따로).
  - 항목 `key`, `view`, 역할 이름, 괄호·들여쓰기·번호는 원문에 넣지 않는다.
- **지문** = sha256(UTF-8 원문)의 소문자 16진수.
- **1판 규칙은 그대로 둔다**(DB·서버 둘 다 지금 코드 그대로). 판 고르기는 4-0.

### 5-2. 시험 벡터(TS 단위 시험과 SQL 리허설이 같은 값을 내야 함)
충전, `D`=7, `Y`=1. 원문 계산만 보는 예시라 본문은 짧게 줄였다.
```
P = {
  consentFormat: 2,
  consentTitle: "주문 내용·충전 조건 확인 및 결제 동의",
  consentSummary: {
    refundPeriod: "{충전환불기간}일째 되는 날까지 신청할 수 있어요.",
    restriction: "하나라도 쓰면 취소할 수 없어요.",
    validity: "{충전유효기간}년 동안 쓸 수 있어요.",
    minor: "미성년자는 취소할 수 있어요."
  },
  checkoutItems: { product: "상품 A", validity: "기간 B", refund: "환불 {충전환불기간}일\n둘째 줄",
                   restriction: "제한 C", otherCases: "기타 D" },
  minorNotice: "미성년 E",
  consentItems: [ 4-2 의 항목 1~5 그대로 ]
}
```
원문(줄마다 LF, 끝 LF 없음):
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
- 지문 = `2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7`
- 계획 작성 때 Python(`hashlib`)과 운영 Postgres(`sha256(convert_to(…,'UTF8'))`, 읽기 조회)로 계산해 둘이 같음을 확인했다.
- 이 벡터는 여러 줄 본문, 자리표시가 든 요약 줄, 본문이 여럿인 항목, 점 경로, 링크 줄을 모두 포함한다.
- 자료 쪽 벡터는 구현 때 같은 방식으로 하나 더 만들어 시험에 넣는다. 갈라지기 쉬운 곳을 일부러 담는다: `note` 줄, **앞뒤에 공백이 있는 요약 줄**, **LF 로 끝나는 본문**, 본문이 둘인 항목. 같은 값을 TS 단위 시험과 SQL 리허설에 함께 쓴다.

### 5-3. 화면으로 보내는 2판 모양(409 details·장바구니 뷰·첫 값)
- **2판 묶음** (DB 와 서버가 같은 값을 만든다)
  ```
  {
    consentFormat: 2,
    consentTitle: string,              // 채운 값
    consentSummary: string[],          // 역할 순서, 채운 값
    consentItems: [
      { key, label, view: 'text', texts: string[] }   // texts = textKeys 순서의 채운 본문
      | { key, label, view: 'link', link: 'refundPolicy' | 'serviceTerms' }
    ],
    noticeSha256: string,
    refundDays: number,
    plan?: { price, credits } | null   // 충전 DB details 에만(지금처럼)
  }
  ```
  - 묶음으로 다시 만든 원문(제목 → 요약 줄 → 항목마다 label 과 texts, 또는 `링크:`+link)의 sha256 은 `noticeSha256` 과 같다.
  - **1판 이름의 키(자료 `checkboxLabel`·`confirmNotice`, 충전 `checkoutTitle`·`checkoutItems`·`minorNotice`·`agreeLabel`)는 2판 묶음에 넣지 않는다.**
- **(가) DB 409 details**(`NOTICE_CHANGED`·`NOTICE_KEY_CONFLICT`, 충전 `PLAN_CHANGED`·`PLAN_UNAVAILABLE`)
  - 1판이면 지금 모양에 `consentFormat: 1` 키 하나만 더한다. 1판 키의 값은 그대로이고, 옛 해석기는 모르는 키를 무시한다. 2판이면 2판 묶음만 담는다.
  - 11번 기록 함수는 **모든 응답**(ok·거절)에 `consentFormat` **키**를 둔다. 값은 다음과 같다.
    - 정책을 읽기 전에 돌려주는 응답(`NOTICE_INPUT_INVALID`, 충전 `MEMBER_WITHDRAWN`)과 판 값이 잘못돼 낸 `NOTICE_POLICY_UNAVAILABLE`: `null`
    - replay(자료는 지금처럼 정책을 읽기 전에 하는 ②단계, 충전은 같은 시도의 기존 기록): 기록 행의 `consent_format`. replay 를 정책 읽기 뒤로 옮기지 않는다(앞 요청이 끝났는데 그사이 2판 키가 깨져도 재시도가 replay 로 끝나게).
    - 그 밖: 그때 정책의 판(1 또는 2)
  - 자료 `NOTICE_CHANGED`·`NOTICE_KEY_CONFLICT` 응답에는 `cartTexts`(정책의 장바구니 문구와 지문, 없으면 null)도 담는다.
- **(나) 서버가 화면에 주는 409**
  - 자료 route 는 `details` 에, 충전 route 는 `notice` 에 넣는다. 1판이면 지금 모양, 2판이면 2판 묶음이다.
  - 서버는 새 해석기(판으로 나눔)로 검사한 값만 넘긴다. 충전 대체 경로(`checkoutChangedResponse` 의 정책 다시 읽기)도 같은 규칙으로 만든다.
  - **새 서버는 기록 함수 응답에 `consentFormat` 키가 없으면 11번 함수가 아닌 것으로 보고 503(`PURCHASE_NOTICE_UNAVAILABLE`·충전은 지금 쓰는 고지 불가 응답)으로 닫는다.** 키가 있는지만 본다(`Object.hasOwn(result, 'consentFormat')`, 값이 null 이어도 11번). 그래서 새 코드인 채로 11번 down 을 하면, 화면이 1판과 2판을 오가지 않고 결제가 닫힌다(10절 되돌리기 ④ 는 ③ 뒤에만). 자료는 down 뒤 4인자 함수가 없어 호출 자체가 실패하므로 역시 503 이다.
  - `MEMBER_WITHDRAWN`·`NOTICE_INPUT_INVALID` 는 표식 검사와 관계없이 지금 분기(탈퇴 403·잘못된 요청 400)를 따른다. 10번의 탈퇴 안내가 503 으로 바뀌지 않는다.
  - **자료 409 응답 모양**: 지금 `marketCartErrorResponse` 모양을 따른다. `{ success: false, error: { code, message }, details: <1판 또는 2판 고지>, cartTexts: { cartCheckoutNotice, partialOwnedConfirmLabel, cartTextsSha256 } | null }`. `cartTexts` 는 `details` 밖의 최상위 키이고, `marketCartErrorResponse` 에 그 자리를 더한다. 장바구니 문구만 달라 DB 가 거절한 경우(6-2)도 같은 모양이다.
  - 옛 화면의 해석기(`parseMarketPurchaseNotice`·`parsePointChargeCheckoutNotice`)는 1판 키가 없어 null 을 낸다. 그러면 옛 장바구니는 확인창을 닫고 다시 읽고, 옛 충전 화면은 결제 버튼이 막힌다. **옛 화면이 1판 글을 보이면서 2판 지문을 보내는 길이 없다.**
- **(다) 해석기를 거치지 않는 값은 칸을 나눈다**
  - 대상: 장바구니 뷰(`/api/market/cart`, 페이지 첫 값), `/checkout` 첫 값(prop)
  - 1판 칸(`purchaseNotice`·`checkoutNotice`)에는 1판 모양만 넣는다. 2판일 때는 null 이다.
  - 2판 묶음은 새 칸(`purchaseConsent`·`checkoutConsent`)에 넣는다. 둘 중 하나만 값이 있다.
  - 이유: 옛 장바구니 탭은 뷰를 해석하지 않고 쓰므로(1절), 1판 칸에 2판 모양이 오면 빈 글을 보이면서 2판 지문을 보낼 수 있다. 칸을 나누면 옛 탭은 `purchaseNotice` 가 null 이라 구매 버튼이 막힌다.
  - 장바구니 문구는 판과 관계없는 칸 `cartTexts: { cartCheckoutNotice, partialOwnedConfirmLabel, cartTextsSha256 } | null` 로 장바구니 뷰·페이지 첫 값에 따로 둔다. 1판 칸이나 2판 묶음에는 넣지 않는다(DB details·서버 묶음 일치 시험을 흔들지 않게). 409 에서는 위 (나)처럼 최상위 `cartTexts` 로 온다. null 이면 결제 칸을 닫는다.
- **(라) 링크 주소는 묶음에 넣지 않는다.** 화면이 가진 `termsLink`·`refundPolicyLink` 의 href 와 link 키로 합친다. 바닥글 문서 이름은 쓰지 않는다(3절). 없으면 3절대로 막는다.
- **(마) 새 화면의 해석기**: `consentFormat` 이 없거나 1이면 1판 해석, 2 이면 2판 해석. 실패하면 null → 결제 칸 잠금 + 다시 불러오기 안내(6-3).
- **캐시 키**: 해석 모양이 바뀌므로 자료 `market_purchase_policy:v3`, 충전 `point_charge_policy:v2` 로 올린다(캐시를 쓰는 상품 상세·보관함·크레딧 화면용).

### 5-4. 정책 문서 판·원문 규칙·동의 구조 기록(칸 추가)
- `market_purchase_notice_acks` 에 더한다.
  - `refund_policy_sha256 text NULL`
  - `terms_policy_sha256 text NULL`
  - `consent_format smallint NOT NULL DEFAULT 1`, CHECK 이름 `market_purchase_notice_acks_consent_format_check` (`consent_format IN (1,2)`)
  - `consent_details jsonb NULL`
- `point_charge_checkout_acks` 에 더한다.
  - `terms_policy_sha256 text NULL`
  - `consent_format smallint NOT NULL DEFAULT 1`, CHECK 이름 `point_charge_checkout_acks_consent_format_check`
  - `consent_details jsonb NULL`
- 칸은 `ADD COLUMN IF NOT EXISTS` 로 더하고, CHECK 는 그 이름이 없을 때만 더한다. 그래서 down 뒤 다시 적용해도 멈추지 않는다. VERIFY 는 `information_schema` 로 7칸의 타입·NULL 여부·기본값과 두 CHECK 를 확인한다.
- **`consent_details`** 에 남기는 것
  - 자료 기록(1판·2판 모두): `cartTexts`
    - 화면이 장바구니 문구 지문을 보냈고(`p_cart_texts_sha256` 이 null 아님) 그 값이 정책 문장의 지문과 같을 때만 `{cartCheckoutNotice, partialOwnedConfirmLabel, cartTextsSha256}` 전문을 남긴다. 이것이 새 결제 칸에서 회원이 본 문장이다.
    - 지문을 보내지 않은 호출(옛 코드)은 `cartTexts: null` 이다. 옛 화면은 코드에 박힌 문장을 보였거나(옛 장바구니 확인창) 이 문장이 없었으므로(상세 바로 구매), DB 문장을 '본 것'으로 남기지 않는다.
    - 그래서 `cartTexts` 가 있는 기록은 모두 '새 결제 칸이 쓰던 문구 = 기록된 문구'가 DB 안에서 대조된 기록이다. 단계 4→5 구간과 되돌리기 ③ 뒤에도 틀린 문장이 남지 않는다.
    - **읽는 법**: `cartTexts` 는 그때 결제 칸 문구의 판이다. `partialOwnedConfirmLabel` 이 실제로 보였는지·체크됐는지는 같은 `idempotency_key` 의 결제 요청 기록 `request_payload` 줄별 `ack` 로 본다(부분 보유 줄이 없으면 그 문장은 보이지 않음). `cartCheckoutNotice` 는 결제 칸에 늘 보인다.
  - 자료·충전 2판 기록: `consent` = DB 가 만든 2판 묶음(5-3)에서 `noticeSha256`·`plan` 을 뺀 것
  - 충전 1판 기록은 NULL 이다.
  - 원문 규칙과 지문(5-1·5-2)은 바꾸지 않는다. `consent` 로 다시 만든 원문의 sha256 은 `notice_sha256` 과 같다(리허설). 그래서 원문만으로는 가릴 수 없던 '어느 줄이 늘 보이는 요약 줄이었고 어디가 항목 경계인지'를 기록으로 되살릴 수 있다.
- 2판 기록은 `consent_format = 2` 다. 두 문서 지문은 `policy_document_snapshots` 에서 `doc_key` 가 `refundPolicy`·`serviceTerms` 인 최신 seq 의 `content_sha256` 이다.
  - **2판에서 사본이 없으면 NULL 로 두지 않고 `NOTICE_POLICY_UNAVAILABLE` 로 닫는다**(4-3 (g)). 문서가 켜져 있고 본문이 있으면 사본 트리거가 사본을 만들므로 정상 운영에서는 생기지 않는다.
- 이용약관 판도 남기는 이유: 매 결제에 '서비스 이용약관' 항목 체크를 받는다. 또 약관 본문은 재동의 판을 올리지 않고도 고칠 수 있어서, 가입 동의 기록(`user_consents`)만으로는 그때 열린 본문을 가리킬 수 없다.
- 한계(지금 충전 기록과 같음): 문서 지문은 화면을 연 때가 아니라 기록하는 때의 최신 사본이다. 회원이 체크한 뒤 문서가 바뀌면 다시 동의받지 않고 새 판이 남는다.
- 한계: 글은 같고 묶음 구조만 다른 정책 변경(예: 요약 줄·항목 경계를 옮김 — note 를 첫 항목 이름으로, 항목 경계를 본문 안 LF 로)은 지문이 같아 DB 가 받아들이고, 기록의 `consent` 는 새 구조로 남는다. 화면은 구조 비교로 동의를 비우므로(6-3) 회원은 새 구조를 보고 다시 동의한다.
- 1판 분기의 원문·지문·details 값은 지금 정의 그대로 둔다. 더하는 것은 `consentFormat` 응답 키, 자료의 장바구니 문구 대조·`consent_details.cartTexts`·거절 응답의 `cartTexts` 뿐이다.
  - 자료의 새 문서 지문 칸은 NULL 이다.
  - 충전 `refund_policy_sha256` 은 지금처럼 채우고, `terms_policy_sha256` 은 NULL 이다.
  - `consent_format` 은 1이다.
- 충전 2판 기록의 `refund_days` 는 1판과 똑같이 `point_charge_refund_days()` 값이다. 환불 판정과 10번 탈퇴 함수가 이 칸을 읽는다.
- 칸 추가는 상수 기본값이라 표를 다시 쓰지 않는다. 추가 전용 보호 트리거(UPDATE·DELETE·TRUNCATE 막음)와 부딪치지 않는다.

### 5-5. 바꾸는 DB 함수(마이그레이션)
| 함수 | 바탕 정의(사전 검사가 받는 값) | 바꾸는 것 |
|---|---|---|
| `build_checkout_consent_v2(p_kind text, p_value jsonb, p_refund_days integer) RETURNS jsonb` (새 내부 함수) | 없음, 또는 바로 앞에 적용한 11번 md5(`to_regprocedure` 로 찾음, 다시 적용 때) | 4-3 검사(링크 문서 포함)와 5-1 원문·5-3 묶음을 만든다. 성공하면 `{text, details}`, 어기면 NULL. `p_kind` 는 `market`·`point_charge`. **`consentFormat` 은 보지 않는다**(판 분기는 두 기록 함수가 함). 그래서 판 1 일 때(스크립트 A VERIFY·B 사전 검사·단계 6)도 부를 수 있고, 묶음의 `consentFormat` 값은 늘 2 다 |
| `build_market_cart_texts(p_value jsonb) RETURNS jsonb` (새 내부 함수) | 없음, 이 파일의 새 md5, 또는 앞에 적용한 판의 md5 | 4-3 장바구니 문구 규칙(S1 포함)을 검사하고 `{cartCheckoutNotice, partialOwnedConfirmLabel, cartTextsSha256}` 을 만든다. 어기면 NULL. 자료 기록 함수(5-5 장바구니 문구 규칙)와 10절 단계 6 이 **같은 이 함수**를 부르므로 단계 6 대조가 기록 함수의 식을 그대로 본다. 권한·VERIFY·down·그대로 목록은 `build_checkout_consent_v2` 와 같다 |
| `record_purchase_notice_ack` — **인자를 하나 더한다**: `(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)` | 3인자 정의의 운영 md5 `fa6a7edd836f21422d52dd184afb079b`, 또는 4인자 11번 새 값 | 판 분기(4-0). 2판은 새 함수로 원문·묶음을 만들고, `consent_format`·두 문서 지문·`consent_details.consent` 를 기록. 장바구니 문구 규칙은 아래. 모든 응답에 `consentFormat` |
| `record_point_charge_checkout_ack` | **10번 적용 뒤** md5 `be4403fd993c45d618950a5908a91591`, 또는 바로 앞에 적용한 11번 md5(다시 적용 때). **`0047854a…`(10번 전)는 받지 않는다** | 판 분기. 탈퇴 회원 거절(10번)은 맨 앞 그대로. 2판은 새 함수 + `plan`, `consent_format`·`terms_policy_sha256`·`consent_details` 기록. 모든 응답에 `consentFormat` |

- **자료 기록 함수의 장바구니 문구 규칙**(1판·2판 같음). 정책 문장과 지문은 `build_market_cart_texts(정책)` 로 만든다(단계 6 과 같은 함수).
  1. `p_cart_texts_sha256` 이 NULL(옛 코드): 지금처럼 기록하고 `cartTexts` 는 null 이다.
  2. 값이 있고 정책 장바구니 문구의 지문과 같음: 기록하고 `consent_details.cartTexts` 에 전문과 지문을 남긴다.
  3. 값이 있는데 다르거나 정책 문구가 없음(4-3): **기록하지 않고** `NOTICE_CHANGED` 를 돌려준다(details + `cartTexts`). 화면은 새 키로 다시 동의받는다.
  - 값이 있으면 `^[0-9a-f]{64}$` 이어야 한다(아니면 `NOTICE_INPUT_INVALID`).
  - replay 판정은 두 곳에서 한다: ②단계(정책을 읽기 전 기존 기록 확인)와 ⑥ `INSERT … ON CONFLICT DO NOTHING` 뒤 다시 읽는 곳. **두 곳 모두** 고지 지문이 같고 `consent_details->'cartTexts'->>'cartTextsSha256' IS NOT DISTINCT FROM p_cart_texts_sha256` 일 때만 replay 다. 다르면 `NOTICE_KEY_CONFLICT`(정책을 읽어 details·`cartTexts` 를 담음). 같은 키로 겹친 두 요청이 서로 다른 장바구니 지문을 가졌을 때 기록되지 않은 문구로 결제가 진행되는 일을 막는다.
- **인자 변경 절차**: 두 정의가 함께 있으면 PostgREST 이름 호출이 모호해지므로 한 거래에서 3인자를 지우고 4인자를 만든다.
  - 사전 검사는 `to_regprocedure` 로 3인자·4인자를 각각 찾는다(`::regprocedure` 를 쓰면 없을 때 그 자리에서 오류). 3인자만 있으면 md5 `fa6a7edd…`, 4인자만 있으면 **이 파일의 새 md5** 또는 (고친 파일이면) 앞에 적용한 판의 md5(적용 기록에 남긴 값)를 받는다. 둘 다 있거나 둘 다 없으면 멈춘다. 그래서 첫 적용 전 리허설 11('down 없이 같은 파일 다시 실행')도 통과한다.
  - 지우기는 `DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid,uuid,text)`. 그래서 down 없이 같은 파일을 다시 적용해도 멈추지 않는다.
  - 옛 코드의 이름 인자 3개 호출은 기본값으로 그대로 맞는다.
  - GRANT 는 지금과 같다(지금 ACL `postgres=X, service_role=X` — 운영 읽기 조회로 확인). 새로 만드는 함수에는 public 스키마 기본 권한으로 anon·authenticated·service_role EXECUTE 가 자동으로 붙으므로, `REVOKE ALL … FROM PUBLIC, anon, authenticated` 후 `service_role` 에만 EXECUTE 를 준다.
  - **VERIFY 에 권한 확인을 넣는다**: 자료 4인자 `record_purchase_notice_ack` 와 충전 `record_point_charge_checkout_ack`(6인자) 의 `proacl` = `{postgres=X/postgres,service_role=X/postgres}`, `build_checkout_consent_v2`·`build_market_cart_texts` 의 `proacl` = `{postgres=X/postgres}`. `has_function_privilege('anon'|'authenticated', …, 'EXECUTE')` = false. down VERIFY 도 3인자에 같은 확인을 한다(md5 만으로는 REVOKE 빠짐을 잡지 못한다. 7번 묶음과 같은 방식).
  - 네 함수(`build_checkout_consent_v2`·`build_market_cart_texts`·자료 4인자 `record_purchase_notice_ack`·충전 `record_point_charge_checkout_ack`)의 사전 검사는 {바탕 값(내부 함수 둘은 '없음'·자료 `fa6a7edd…`·충전 `be4403fd…`), 이 파일의 새 md5, 고친 파일이면 앞에 적용한 판의 md5} 를 받는다. **VERIFY 는 이 파일의 새 md5** 를 본다. **down 의 사전 검사**는 네 함수 md5 가 11번 값(적용 기록 값)일 때만 진행한다(나중 묶음이 함수를 바꾼 뒤 down 이 검사 없이 덮어쓰지 않게). down 은 4인자를 지우고 3인자 바탕 정의를 다시 만든다(GRANT 도 되돌림).
  - 타입(`src/types/supabase.ts`)을 다시 만든다.
- 1판 분기의 원문·지문·details 값은 지금 정의를 글자 그대로 옮긴다(회귀 시험 11절). 더하는 키는 5-4 끝에 적은 것뿐이다.
- 새 내부 함수 둘(`build_checkout_consent_v2`·`build_market_cart_texts`)은 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 로 닫는다. 두 기록 함수(SECURITY DEFINER)와 스크립트 VERIFY 만 부른다. SQL 구현이 하나라서 기록과 스크립트 검사가 갈리지 않는다.
  - 읽기 전용 접속 사용자(`supabase_read_only_user`)에게도 EXECUTE 를 주지 않는다. 그래서 운영 값 대조는 10절 단계 6 의 `DO … RAISE EXCEPTION` 한 문장으로 한다(postgres 접속, `--read-only` 없이. `--read-only` 는 DO 문을 거부한다).
- **파일 이름**: 마이그레이션은 10번보다 뒤여야 한다(`supabase/migrations/20261127100000_checkout_consent_v2.sql`). 10번 정의를 사전 값으로 요구하므로, 앞 날짜로 만들면 새 환경 `db reset` 에서 10번보다 먼저 돌다 멈춘다. down 은 `supabase/rollback/20261127100000_checkout_consent_v2_down.sql`.
- 앞 묶음과 같은 형식으로 한다.
  - `SET LOCAL lock_timeout = '3s'`, `SET LOCAL statement_timeout`(10번과 같은 값)
  - 잠그는 순서: `market_purchase_notice_acks` → `point_charge_checkout_acks`(ACCESS EXCLUSIVE). **이 잠금은 거래가 끝날 때까지 유지되고 읽기도 막는다**(결제 내역 상세·충전 route 의 재사용 경로도 기다림). **실회원 결제가 있으므로**(1절) 적용과 리허설은 사람이 적은 시간(새벽)에 하고, 잠금을 쥔 거래를 짧게 둔다(리허설 항목을 여러 짧은 거래로 나눔). 그동안 결제 내역 상세와 충전 시작이 잠깐 기다린다(lock_timeout 3초, 넘으면 되돌림). lock_timeout 을 넘으면 거래 전체가 되돌려지므로 다시 실행한다.
  - md5 사전 검사(원래·새·그대로여야 함)
  - `-- [11번] 시작/끝` 표식
  - 4인자 기록 함수·충전 기록 함수·새 내부 함수는 모두 `CREATE OR REPLACE` 로 만든다(다시 적용 때 'already exists' 로 멈추지 않게)
  - 파일 끝과 down 끝에 `NOTIFY pgrst, 'reload schema';`(앞 묶음과 같음. 옛 코드가 부르는 함수의 인자가 바뀌므로, 이벤트 트리거가 없는 환경에서도 PostgREST 가 새 정의를 읽게)
  - REVOKE/GRANT, VERIFY 블록
  - 되돌리기(down) 파일
  - 다시 적용: 10번 머리말과 같은 방법(같은 거래에서 `supabase_migrations.schema_migrations` 의 11번 행을 지우고 이 파일 + 이력 INSERT). 칸은 IF NOT EXISTS 라 남아 있어도 된다.
  - BEGIN…ROLLBACK 리허설
- **그대로여야 함**(이름과 md5. 10번 값은 10번 적용 뒤 운영에서 다시 읽어 맞춘다)
  - `checkout_market_selection` `0cda5ff7689d998cc6cf2fd213b0004d` (direct 모드는 부르는 곳이 없어지지만 그대로 둔다)
  - `get_point_charge_refund_eligibility` `60fc28afe44e7be776c189265e87b6ec`
  - `point_charge_refund_days` `7ab4d40c1634ade20de86517fa13cd40`
  - `guard_point_charge_checkout_acks_mutation` `c7ef25308c6c0aa2920991965fb87ab0`
  - `guard_market_purchase_notice_acks_mutation` `3959ac2b8139d0f81365df59ed67ef10` (10번 값)
  - `prepare_payment_order` `93e0bd5e41969f66f296f4353f3feeb9`, `begin_payapp_request` `679b4474c0dc42de11e5e9a14a7d1d4d`, `payapp_fulfill_order_internal` `657bbb07ae4b250a2697f21e2aa805e9` (모두 10번 값)
  - `market_purchase_refund_days` `5d4030e7bedbace6189cefed80c3d27b` (자료 정책을 읽는 환불 함수 — 4-4 대상)
  - `record_policy_document_snapshots` `4ffeca80346467f928c0a6f50b69018d` (새 문서 지문 칸이 읽는 `content_sha256` 을 만드는 트리거 함수)
  - `prevent_policy_document_snapshot_mutation` `b1449554c094a90be7a6c864f367fdf8`
    - 위 세 값(`market_purchase_refund_days`·`record_policy_document_snapshots`·`prevent_policy_document_snapshot_mutation`)은 2026-11-24 운영 읽기 조회로 확인했다. 10번은 이 셋을 바꾸지 않는다.
  - 두 기록 표를 읽는 10번 함수: `member_withdrawal_facts` `a7674770964dac2fe5c9179b8403c3b4`, `get_member_withdrawal_preview` `3a2e2c2f6eb6ecb15defe0879c88e0fc`, `anonymize_member` `1346d870d3623abae580a011b0484339` (2026-11-25 운영 읽기 조회로 확인)
  - 스크립트(5-6) 사전 검사에는 스크립트가 쓰는 `record_admin_audit` `a42b474d9d95753ffba5041acb0c1c77` 도 넣는다.
- **down 파일**은 두 기록 함수를 바탕 정의(자료 3인자 `fa6a7edd…`·충전 `be4403fd…`)로 되돌리고(자료 4인자 정의는 지움) 새 내부 함수를 지운다. **칸은 지우지 않는다**(동의 기록 = 증빙). 옛 함수는 새 칸을 쓰지 않으므로 칸이 남아도 해가 없다(새 기록은 기본값 1·NULL).
- 10번 `_down_b` 는 충전 함수 md5 가 `be4403fd…` 일 때만 돈다. 그래서 **10번을 되돌리려면 11번 down 을 먼저** 한다.

### 5-6. 데이터 스크립트(마이그레이션이 아님)
문구는 데이터라 스크립트로 넣는다. 세 파일 모두 머리말에 **'실행 전부터 끝까지 관리자 구매 고지·충전 문구 저장 금지(관리자 화면을 닫고 실행)'** 를 적는다.

- **스크립트 A** `supabase/scripts/2026xxxx_bundle11_consent_keys.sql` — 2판 키를 넣되 판은 1 그대로
  - 사전 검사
    - 네 함수 md5 가 11번 새 값이다(마이그레이션이 먼저). `record_admin_audit` md5 도 확인한다.
    - 두 정책에 `consentFormat` 이 없다.
    - 두 정책 값 md5 가 실행 전에 읽어 스크립트에 적어 둔 값과 같다.
  - 하는 일
    - 4-1·4-2 키(자료는 장바구니 문구 2개 포함)를 더한다.
    - `consentFormat: 1` 을 적는다.
    - `version` +1 한다.
    - `admin_audit_log` 에 이전 값 전체와 `bundle='bundle11_consent_keys'` 를 남긴다.
  - VERIFY
    - `build_checkout_consent_v2` 가 두 정책 모두 NULL 이 아니다(4-3 을 SQL 로 다시 확인).
    - 1판 키 값(`purchaseCompleteNotice` 포함)이 실행 전과 글자 하나까지 같다.
    - 장바구니 문구 2개가 4-3 규칙을 지킨다.
  - 옛 코드는 모르는 키를 무시하고, 옛 관리자 저장도 원본 위에 덮으므로 키를 지우지 않는다.
- **스크립트 B** `supabase/scripts/2026xxxx_bundle11_consent_format_2.sql` — 2판 켜기
  - 10절 단계 6(운영 값으로 서버 계산 = DB 계산 확인)을 마친 뒤에만 실행한다.
  - 사전 검사
    - 네 함수 md5 가 11번 새 값이다. `record_admin_audit` md5 도 확인한다.
    - 두 정책 `consentFormat` 이 1이다.
    - `build_checkout_consent_v2` 가 NULL 이 아니다(링크 문서·사본 검사 포함).
    - **두 정책 값 md5(`md5(value::text)`, `system_settings` 행)가 10절 단계 6 에서 대조한 값(스크립트에 적어 둠)과 같다.** 단계 6 블록과 같은 식이다. 단계 6 뒤에 누가 문구를 저장했으면 멈추고 단계 6 을 다시 한다.
  - 하는 일: `consentFormat` 2, `version` +1, 작업 기록(`bundle='bundle11_consent_format_2'`).
  - VERIFY: 판이 2다. 2판 키·1판 키가 실행 전과 같다.
- **되돌림 스크립트** `supabase/scripts/2026xxxx_bundle11_consent_format_1.sql`
  - 되돌림이 가장 필요한 때는 2판이 닫힌 때다(링크 문서를 껐거나 2판 키가 깨졌을 때). 그래서 B 와 달리 `build_checkout_consent_v2` 결과는 보지 않는다.
  - 사전 검사
    - 네 함수 md5 가 11번 새 값이다.
    - 두 정책 `consentFormat` 이 2다.
    - 정책 값 md5 가 실행 직전에 읽은 값과 같다.
  - 하는 일: `consentFormat` 을 1로 하고 `version` +1 한다. 2판 키는 남긴다. 작업 기록(`bundle='bundle11_consent_format_1'`).
  - VERIFY: 판이 1이다. 1판 키·2판 키가 실행 전과 같다. (1판 기록이 다시 되는지는 리허설 10 에서 본다.)
- **캐시와 화면 전환**
  - 장바구니 뷰와 충전 결제 화면은 정책을 캐시 없이 읽는다(4-4). 그래서 스크립트 B·되돌림 직후 다음 다시 읽기부터 새 판을 그린다. 그 전에 열린 화면은 결제 때 409 로 새 판을 받는다.
  - 60초 캐시가 남는 곳은 상품 상세·보관함뿐이다. 거기에는 결제와 동의가 없다. 다만 `unstable_cache` 는 만료 뒤 첫 요청에 옛 값을 주고 뒤에서 새로 읽으므로, 상세의 문구(`purchaseCompleteNotice`)는 60초 뒤 두 번째로 열 때 바뀐다.
  - BEGIN…ROLLBACK 리허설은 DB 거절만 확인한다. 화면 전환은 10절 단계 8 의 운영 재확인과 계약 시험(409 details 로 사본 교체)으로 본다.
  - **실회원 화면(판매 켜짐일 때)**: 스크립트 B·되돌림을 돌리는 순간 열려 있는 실회원 장바구니·충전 화면은 다음 다시 읽기나 결제 때 409 로 새 판을 받고, 동의를 다시 받는다(동의가 풀리고 '안내 문구가 바뀌었습니다'). 결제와 기록은 막히는 쪽이라 틀어지지 않지만 회원이 한 번 더 체크해야 하므로, 사람이 적은 시간(새벽)에 돌린다. 판매 꺼짐이면 이 영향이 없다.
  - 11번은 약관·처리방침을 바꾸지 않으므로 가입 약관 재동의는 생기지 않는다. 결제 화면 동의는 결제마다 받으므로, 2판 전환 뒤 첫 결제부터 새 동의 방식으로 받는다(옛 동의 기록은 1판 그대로 남음).
- **다시 적용할 때**(11번 down 뒤 고쳐서 다시): 정책에 `consentFormat` 이 이미 있으면 스크립트 A 는 건너뛴다(사전 검사가 막는 것이 맞음). 판 값은 지금 값을 그대로 두고, 2 라면 새 코드가 배포된 뒤에만 다시 적용한다.

## 6. 장바구니 결제 칸(A안)
### 6-0. 부품 나누기(표시 부품과 껍데기)
- 장바구니 화면과 충전 화면은 둘로 나눈다.
  - **표시 부품**: props 만 받아 그린다. 요청·`fetch`·supabase 를 쓰지 않는다.
    - `CartPageView`: 장바구니 화면 전체(제목, 2단 grid, '결제 칸으로 건너뛰기', 목록 `CartLineListView`, 결제 칸 `CartCheckoutPanelView`, 고정 막대, `html` 의 scroll-padding·lg 바닥 여백·`data-cart-bar` 효과)
    - `CartLineListView`: 전체 선택 줄·과목 묶음·줄(지금 `cart-view.tsx` 의 `renderItem`), '정가 구매'·업그레이드 취소선·'함께 구매할 수 없음' 표시
    - `CartCheckoutPanelView`: 결제 칸 위 영역·아래 고정 영역
    - `ChargeCheckoutView`: 충전 화면 전체(잉크 변수 `--ck-*` 가 붙은 루트, 주문 요약, 결제수단, 동의 영역 `ChargeConsentArea`, 결제 버튼)
    - `CheckoutConsent`(3절), 상세 담기 결과 창, 결제 내역 2판 기록 보기
  - **제어 값(주인은 껍데기)**: 동의(전체·하위), 부분 보유 확인, 줄 선택은 표시 부품이 들지 않는다. 값과 콜백을 props 로 받는 제어 부품이다(예: `consent`·`onConsentChange`, `partialAck`·`onPartialAckChange`, `selectedIds`·`onToggleLine`·`onToggleAll`, `locked`). 그래서 6-3 동의 수명(주문 키·지문·구조·장바구니 문구가 바뀔 때, 성공 뒤, 409 뒤 비우기)과 6-2 잠금을 껍데기가 그대로 할 수 있다.
  - **표시 부품 안에만 두는 상태**: 세부 항목 창 열림, 보기 펼침, 선택 목록 펼치기, 6-1 높이 재기(ResizeObserver), 막대 보임(IntersectionObserver). 고지 사본이 바뀌면 껍데기가 넘기는 `consentResetToken` 이 바뀌어 보기 펼침을 닫는다.
  - **응답 뒤 화면 동작도 props 로 받는다**(표시 부품이 실행):
    - `focusRequest: { target, token }` — target 은 `partialAck`(위 영역 `scrollTop` 계산 + 초점, 6-1)·`consent`·`payButton`·`retry`·`charge`·`reload`·`conflictLine`·`alert`·`panelTitle`. token 이 바뀔 때마다 한 번 실행한다. 막대 '결제 칸으로'의 초점 이동도 이 함수로 한다.
    - `completedQueue: Receipt[]` + `onCompletedClose` — 완료 창 대기열(두 결과가 겹치면 차례로, 6-2).
    - `noticeSwapToken` — 바뀌면 다시 재고, 조건을 넘으면 보통 흐름으로 바꾼 뒤 결제 칸을 화면 안으로 스크롤하고 알림을 보인다(6-1 '판정하는 때').
    - `alerts`(위 영역 알림 자리), `liveReason`(sr-only 이유)
  - **껍데기**: 지금의 `cart-view.tsx`·장바구니 `page.tsx`·`checkout-client.tsx`·`/checkout` `page.tsx` 자리다. 뷰 읽기, 결제 요청, 키·스냅숏(줄별 `acknowledgeNoDiscount` 와 동의 값은 **껍데기 state 에서** 만든다), 줄 선택 저장, 6-3 동의 수명, 토스트를 맡고 표시 부품에 props 를 넘긴다.
  - **순수 함수**(껍데기와 화면 모음이 함께 씀, 요청 없음, 단위 시험으로 고정): 6-1 결제 버튼 이름·버튼 줄 상태, 6-1 높이 판정(`decideCheckoutPanelMode`), 6-1 충돌 판정, 6-2 응답 처리(`reduceCheckoutResponse(state, response)` → 다음 state 와 `focusRequest`·`completedQueue`·`noticeSwapToken`·`alerts`·`liveReason`·키 수명), 6-3 주문 키·지문·구조 비교와 비우기 판정.
- 개발 전용 결제 화면 모음(10-1)은 표시 부품과 순수 함수만 쓰고, 작은 가짜 껍데기(하네스)로 제어 값을 든다. 결제 요청 함수가 연결되지 않으므로 결제 경로 코드에 미리보기 분기가 필요 없다.

### 6-1. 배치
- **넓은 화면(lg 이상)**: 2단. 왼쪽은 지금 목록(전체 선택, 선택 삭제, 자료 줄). 오른쪽 결제 칸은 `sticky top-32`(지금 장바구니 요약 칸과 같은 위치).
  - 오른쪽 열 폭은 400px 로 고정한다(`lg:grid-cols-[minmax(0,1fr)_400px]`). 지금 3단의 1/3(약 368px)보다 넓혀 요약 줄 줄 수를 줄인다.
  - 왼쪽 목록 위에 '결제 칸으로 건너뛰기' 링크를 둔다(목록 줄마다 초점이 3곳이라 50건이면 Tab 이 너무 많다).
  - sticky 와 칸 최대 높이·안쪽 스크롤은 **lg 이고 아래 '고정 칸 조건'을 채울 때만** 켠다. 채우지 못하면 sticky 를 끄고 칸을 보통 흐름으로 둔다(아래 '보통 흐름'). 좁은 화면은 늘 보통 흐름이다.
- **결제 칸 구성**: 칸은 위아래 두 영역이다(flex 세로). 칸은 지금 요약 칸처럼 테두리 1px·`p-5` 이고 `box-sizing: border-box` 다. 두 영역 사이에는 따로 바깥 여백을 두지 않고, 아래 영역의 위 테두리(1px)와 `pt-3`(12px)를 아래 영역 높이에 넣어 잰다.
  - **위 · 스크롤 영역**(`flex-1 min-h-[80px] overflow-y-auto`) — 줄어드는 쪽. 최소 80px 는 늘 남긴다(부분 보유 확인 체크 64px 가 한 번에 들어가는 높이).
    - 제목 '결제 금액'
    - 알림 자리(가격 바뀜·주문 바뀜·고지 바뀜·오류·다시 읽는 중·0건 때 '자료를 선택하면 동의할 수 있어요'·부족 때 '충전을 마쳤다면 [잔액 다시 확인]을 눌러 주세요.'). `role="status"`, 오류는 `role="alert"`. 토스트만 쓰지 않는다. 장바구니에서 토스트를 쓸 때는 고정 막대가 보이는 동안 토스트를 막대 위로 띄운다. 방법은 하나다: 막대가 보이는 동안 `CartPageView` 가 `<html data-cart-bar>` 를 두고, 전역 CSS 가 `html[data-cart-bar] [data-sonner-toaster][data-y-position=bottom]` 의 아래 offset 을 막대 높이 + `env(safe-area-inset-bottom)` 로 덮는다(sonner 인라인 변수보다 앞서게). 알림이 생기면 이 영역을 맨 위로 올린다.
    - 부분 보유 확인 체크(해당할 때만, 문장은 DB `partialOwnedConfirmLabel`). 처음 나타날 때와 결제 버튼이 이 체크 때문에 막혀 있을 때는 이 영역을 그 체크가 다 보이게 스크롤한다(`scrollIntoView({block:'nearest'})`). 아래 고정 영역에 두지 않는 까닭은, 줄을 고를 때마다 고정 영역 높이가 바뀌어 쓰는 도중 칸 모양이 바뀌지 않게 하기 위해서다.
      - 체크 상자의 접근 이름은 보이는 label(DB 문장)로만 정한다. 지금 확인창의 별도 `aria-label="기보유분 차감 없이 정가 구매 확인"` 은 옮기지 않는다(화면 읽기가 기록된 DB 문장과 같은 글을 읽게).
    - '선택한 자료 N건' — 넓은 화면에서는 '선택 N건: 앞 2건 제목 외 N건' 한 줄 + [펼치기]로 시작한다(왼쪽 목록과 겹치므로). 펼친 목록에는 **따로 최대 높이를 두지 않는다**. 위 스크롤 영역이 함께 스크롤한다(스크롤 상자를 겹치지 않음). 좁은 화면에서는 3건 이하면 펼쳐 두고 4건 이상이면 접는다. 예전에 담아 선택해 둔 자료가 함께 결제되는 것을 결제 직전에 보이기 위해서다.
    - 합계 / 보유 크레딧
    - 안내 줄 `cartCheckoutNotice`(DB, 4-1)
    - 평소의 충전 안내: 작은 글 한 줄 '크레딧 충전'(`/pricing`) + 지금 안내(chargeHint '충전 후 장바구니로 돌아오면 담아 둔 자료가 그대로 남아 있습니다.'). `returnTo` 는 만들지 않는다(14절).
  - **아래 · 고정 영역**(`shrink-0`, 스크롤 밖) — 늘 보이는 쪽. **원칙: 이 영역의 높이는 동의 켜짐/꺼짐, 선택 0건/1건 이상, 알림 있음/없음, 부족·retryable·결제 중·다시 읽는 중 어느 상태에서도 같다.** 이 영역에 들어가는 요소는 아래가 전부다.
    1. 구분: 위 테두리 1px + `pt-3`(12px)
    2. **금액 줄** 한 줄(24px): '합계 N · 결제 후 잔액 M'. 합계가 잔액보다 크면 '합계 N · 부족 M'(굵게, 음수를 보이지 않음). 0건이면 '합계 0 · 결제 후 잔액 M'. **함께 살 수 없는 선택이 있으면 '부족'을 보이지 않고** '합계 N · 함께 살 수 없는 선택 있음'으로 둔다(충돌한 두 줄 때문에 부풀어 오른 합계로 충전을 권하지 않게). 금액이 늘 보여 위 영역이 알림으로 차도 합계를 놓치지 않는다.
       - 모양은 `h-6 whitespace-nowrap text-sm tabular-nums` 이고 단위('크레딧')는 붙이지 않는다. 그래도 넘치면 뒤쪽(잔액·부족 쪽)을 `truncate` 한다. 글이 줄바꿈되지 않으므로 자릿수가 늘어도 높이가 그대로다.
    3. `CheckoutConsent`(판에 맞는 모드): 위 체크 줄(제목 + 고정 폭 [세부 항목])과 요약 줄 전부. 1판 모드는 3-1 의 본문 상자·체크 문구·링크 줄.
    4. [버튼 줄] 한 줄, 늘 같은 높이(`h-11` 버튼): 평소 결제 버튼 하나. 부족이면 '크레딧 충전'(brand) + [잔액 다시 확인] 두 버튼. retryable 이면 [같은 요청으로 다시 시도] + [다시 선택] 두 버튼. 결제 중·다시 읽는 중에는 버튼 안 진행 표시. 두 버튼은 `min-w-0 flex-1` 이고 줄바꿈하지 않는다. 좁은 폭(칸 안쪽 폭이 300px 아래, 예: 360px 휴대폰의 약 286px)에서는 보이는 글을 줄인다('같은 요청으로 다시 시도' → '다시 시도'). 접근 이름은 '같은 요청으로 다시 시도'로 두어 보이는 글이 이름 안에 들어 있게 한다.
    5. 상태 알림 영역: **보이지 않는 `sr-only` live 영역(높이 0)**. 막힌 이유를 화면 읽기에 알린다(`aria-live="polite"`). 눈으로 보는 이유는 이미 버튼 이름에 있다. 위 영역 알림 자리가 이미 알리는 상태(결제 중·다시 읽는 중·0건·다시 읽기 실패)에서는 비워 두고, 그 밖의 막힌 이유(함께 살 수 없는 선택·부족·부분 보유 확인 전·동의 전)만 알린다. 같은 글이면 다시 쓰지 않는다. 그래서 한 상태 변화에 live 영역이 하나만 바뀐다.
    - 위 목록 밖의 줄(0건 안내, 부족 안내, 알림, 부분 보유 확인, 다시 읽기 실패 안내와 [다시 불러오기] 등)은 모두 위 영역에 둔다. 이 원칙은 계약 시험과 화면 시험으로 묶는다(11절).
    - **유일한 예외는 고지 없음**(6-3)이다: 동의 자리를 경고 + [다시 불러오기]로 바꾼다. 들어갈 때는 아래 영역이 줄어 안전하고, 나올 때(다시 불러오기로 고지를 받음)는 고지 사본 교체이므로 다시 잰다(아래 '판정하는 때').
- **높이 예산(1366×768 기준, 추정. 11절 화면 시험이 관문)** — 모두 칸의 **content-box**(테두리·안쪽 여백을 뺀 높이) 기준이다.
  - 노트북 브라우저 보기 영역 높이는 약 640px 이다. 칸 최대 높이(border-box) = `calc(100dvh - 9rem)`(위 128px + 아래 여백 16px) ≈ 496px. **칸 content-box 높이** = 496 − 테두리 2 − `p-5` 위아래 40 = **454px**.
  - 칸 안쪽 폭 360px. 요약 줄은 13px·줄 높이 20px, 체크 들여쓰기 32px → 한 줄 약 24자로 잡는다(보수적). 제목 줄은 고정 폭 [세부 항목] 버튼 자리를 빼면 약 16자 → '[필수] ' + 제목 26자(4-3 (a))는 최대 2줄, 44px.
  - **아래 고정 영역** = 구분 13 + 금액 줄 24 + 간격 6 + 위 체크 줄 44 + 요약 줄 + 간격 8 + 버튼 줄 52(`pt-2` 8 + 버튼 44) + 상태 알림 0 = **147px + 요약 줄**
    - 2판 초안(요약 212자: 68·101·43자 → 3·5·2줄 = 10줄, 200px): **347px**
    - 1판 모드: 구분 13 + 금액 줄 24 + 간격 6 + `confirmNotice` 상자 96(`max-h-24`, 3-1) + 간격 6 + 체크 문구(104자, 14px → 약 5줄 120) + 간격 6 + 링크 줄 24 + 간격 8 + 버튼 줄 52 = **355px**
    - 자료 요약 상한(합계 220자 → 역할별 올림 포함 최대 12줄 240px): 387px
    - 5판보다 여유를 늘리려고 구분 여백(16→12)·간격(8·12→6·8)·버튼 줄 여백(12→8)을 줄이고, 1판 본문 상자를 96px 로 낮췄다.
  - **고정 칸 조건**: `아래 고정 영역 높이 + 위 영역 최소 80 ≤ 칸 content-box 높이`.
    - 구현은 칸의 `clientHeight − paddingTop − paddingBottom` 을 content-box 높이로, 아래 영역의 `offsetHeight`(구분 테두리·여백 포함)를 고정 영역 높이로 잰다. 칸 최대 높이는 `calc(100dvh - 9rem)` 으로 계산한 값을 쓴다(sticky 를 켜기 전에도 같은 값).
    - 1366×640(content-box 454): 2판 초안 347 + 80 = 427 ≤ 454 → **고정 칸**(여유 27px, 위 영역 실제 107px). 1판 모드 355 + 80 = 435 ≤ 454 → 고정 칸(여유 19px, 위 영역 99px). 동의·0건·알림·부분 보유 줄·부족·retryable 어느 상태에서도 아래 영역 높이는 같으므로 그대로 고정 칸이다.
    - 1366×640, 자료 요약 상한 387 + 80 = 467 > 454 → 넘침. 이런 문구는 관리자 저장 검사(9절, 16px 여유를 두고 잼)가 막으므로 저장된 문구로는 생기지 않는다. 스크립트로 들어가는 등 그래도 생기면 아래 안전 규칙으로 보통 흐름이 된다.
    - 1366×600(보기 영역 600 → content-box 414): 2판 초안 427 > 414 → 보통 흐름.
    - 1440×900 같은 더 큰 화면(content-box 약 594)은 상한 문구도 고정 칸이다.
  - 위 영역의 위아래 끝에 더 볼 내용이 있으면 옅은 그림자(fade)를 보인다(macOS 처럼 스크롤 막대가 숨는 환경에서도 스크롤됨을 알리게).
  - **판정하는 때**
    - 서버 그림(첫 그리기)은 보통 흐름이다. 붙은 직후(`useLayoutEffect`, 화면에 그리기 전) 한 번 재서 조건을 채우면 sticky 로 바꾼다. 회원이 목록을 내리기 전이므로 칸 위치가 튀지 않는다.
    - 창 크기가 바뀌면(resize, 잠깐 기다렸다가) 다시 판정한다.
    - **쓰는 도중에는 다시 판정하지 않는다.** 아래 영역 높이가 쓰는 도중 바뀌지 않게 짰기 때문이다. 그래서 줄을 고르거나 부분 보유 줄이 생겨도 칸이 sticky 에서 보통 흐름으로 바뀌어 화면에서 사라지는 일이 없다.
    - 예외는 아래 영역의 글이 바뀔 때뿐이다(고지 사본 교체: 관리자 문구 수정·판 바뀜, 6-3). 이때는 다시 잰다. 조건을 넘으면 보통 흐름으로 바꾸고, 결제 칸을 화면 안으로 스크롤한 뒤(`scrollIntoView`) '안내 문구가 바뀌었습니다' 알림을 보인다. 이 순간은 어차피 동의가 풀리고 회원이 결제 칸을 다시 봐야 하는 때다.
  - **안전 규칙**: 어떤 때든 잰 값이 조건을 넘으면 sticky 를 켜 두지 않는다(sticky + 넘침 상태는 없다). 그래서 칸 안에서 결제 버튼 줄이 잘리거나 위 영역이 0 이 되지 않는다. 판정은 순수 함수 하나(`decideCheckoutPanelMode(fixedHeight, panelContentHeight)`)로 두고 계약 시험으로 묶는다(11절).
  - **보통 흐름일 때**: 칸 안에 스크롤이 없고 칸 전체가 페이지와 함께 움직인다. lg 에서도 좁은 화면과 같은 고정 막대(선택 건수·합계 + '결제 칸으로')를 칸이 보기 영역 밖에 있을 때 보인다. 그래서 1366×768 보다 낮은 화면에서도 결제 칸으로 늘 한 번에 갈 수 있다. 아래 영역(최대 387px)은 보기 영역보다 작아 위 체크·요약 줄·결제 버튼이 한 화면에 함께 보인다. 고정 막대가 보일 수 있는 동안에는 lg 에서도 페이지 바닥에 막대 높이 + `env(safe-area-inset-bottom)` 만큼 여백을 둔다(바닥글 끝 줄이 막대에 덮이지 않게. 좁은 화면도 같음).
  - 0-3 '늘 보이는 결제 칸'은 기준 화면(1366×768) 이상에서 저장된 문구로 늘 sticky 칸으로 지켜진다. 그보다 낮은 화면은 고정 막대가 같은 일을 한다.
  - **관문에 실패하면 줄일 대상**은 아래 고정 영역의 요소다: 요약 줄 글꼴·줄 높이, 금액 줄, 구분 여백, 버튼 줄 여백, 1판 본문 상자 높이. 위 영역(선택 목록 등)은 조건식에 들어가지 않으므로 줄여도 소용없다.
- **결제 버튼 이름과 열림 조건**(한 함수에서 계산하고, 고정 막대도 같은 값을 쓴다)
  - 선택 0건: '자료를 선택하세요'(비활성), 금액 0. 동의 체크도 비활성(3절).
  - 부족: 결제 버튼 대신 '크레딧 충전'·[잔액 다시 확인]. 402 는 그사이 잔액이 바뀐 경우를 위한 대비 경로로만 남는다.
    - [잔액 다시 확인]은 장바구니를 한 번 다시 읽는다. 뒤로 가기(라우터 캐시·bfcache)로 돌아온 옛 잔액은 이것으로 푼다.
    - 충전 결과 화면의 `credit-balance-updated` 이벤트는 다른 문서(페이앱을 거쳐 돌아온 결과 화면)의 window 에서 생기므로 장바구니에 닿지 않는다. 그래서 이 이벤트에 기대지 않는다(자동 다시 읽기는 14절 범위 밖).
  - 고지 없음·장바구니 문구 없음: 비활성(6-3)
  - 다시 읽기 실패: 비활성, 이름 '장바구니를 다시 불러와 주세요'. 안내와 [다시 불러오기]는 위 영역 알림 자리(`role="alert"`)에 있다(6-3).
  - 함께 살 수 없는 선택: 비활성, '함께 구매할 수 없는 자료가 선택되어 있어요'(아래 '함께 살 수 없는 선택')
  - 부분 보유 확인 전: '정가 구매 확인을 체크해 주세요'(비활성)
  - 동의 전: '필수 동의를 체크해 주세요'(비활성)
  - 목록 저장 중(줄 선택 저장 PATCH 가 도는 동안): 비활성, 이름 '선택을 저장하고 있어요'. sr-only 이유도 같다(위 영역 알림은 쓰지 않음).
  - 다시 읽는 중: 비활성. 위 영역 알림 자리(`role="status"`)에 '장바구니를 새로 불러오고 있습니다'를 보인다. PRICE_CHANGED·402·삭제 뒤 옛 뷰와 옛 금액으로 다시 누르는 일을 막는다.
  - retryable: [같은 요청으로 다시 시도] + [다시 선택] 두 버튼(버튼 줄 안, 같은 높이)
  - 결제 중: 진행 표시(비활성). 위 영역 알림 자리(`role="status"`)에 '구매를 처리하고 있습니다'를 넣는다.
  - 그 밖: 'N 크레딧 결제하기'. 열림 조건은 다음을 모두 채울 때다.
    - 선택 1건 이상, 부족 아님, 고지·장바구니 문구 있음
    - 함께 살 수 없는 선택 없음
    - 동의 켜짐
    - 부분 보유 줄이 있으면 확인 켜짐
    - 결제 중·목록 저장 중·다시 읽는 중 아님
  - **여러 조건이 겹칠 때 보일 이름의 순서**: 결제 중 → 다시 읽는 중 → 목록 저장 중 → 다시 읽기 실패 → retryable → 선택 0건 → 고지 없음 → 함께 살 수 없는 선택 → 부족 → 부분 보유 확인 전 → 동의 전 → 'N 크레딧 결제하기'. 충돌을 부족보다 앞에 두는 까닭은, 충돌한 두 줄이 함께 선택돼 합계가 부풀면 필요 없는 충전(실제 결제)으로 이끌 수 있기 때문이다. 막힌 버튼은 Tab 으로 가지 않으므로 같은 이유 글을 아래 영역의 **보이지 않는** 상태 알림 영역(`sr-only`, `aria-live="polite"`, 높이 0)으로 화면 읽기에 알린다. 눈에 보이는 상태 줄은 두지 않는다(높이 예산이 상태마다 바뀌지 않게).
- **함께 살 수 없는 선택 미리 막기**(상세에서 하던 일을 장바구니로 옮김)
  - 상세는 같은 자료의 '전체 패키지와 그 개별 자료', '문제(PDF)와 PDF 가 든 문제(HWP)'를 함께 고르지 못하게 미리 막았다(`market-item-actions.tsx` 의 `getBlockedReason`). 장바구니는 지금 결제를 눌러야 422 `CONFLICTING_SELECTION` 으로 알 수 있다.
  - **판정 식은 DB `checkout_market_selection` 6단계와 같은 식 하나다**(DB 가 막는 것만 막고, DB 가 허용하는 것은 막지 않는다).
    - 장바구니 뷰는 줄마다 `itemId`·`targetKind`·`categorySlug`·`includesPdf` 를 `evaluate_market_targets` 값 그대로 담는다.
    - 같은 `itemId` 의 두 줄 a·b 가 다음 중 하나면 충돌이다: (a.`targetKind`='bundle' 이고 b.`targetKind`='subproduct'), 또는 (a.`categorySlug`='question_pdf' 이고 b.`categorySlug`='question_hwp' 이고 b.`includesPdf`).
    - **서버의 `includesPdf` 는 'PDF 파일이 하나라도 있음'이다.** question_pdf·workbook 줄도 true 다(운영). 그래서 이 값을 'PDF 포함 HWP'로 쓰지 않는다. 'PDF 포함 HWP'는 위 식처럼 `categorySlug='question_hwp'` 와 함께 볼 때만 생긴다.
    - 공용 함수(예: `findMarketSelectionConflicts(lines)`, `src/lib/` 에 둠)를 장바구니와 상세가 함께 쓴다. 상세는 지금 `getBlockedReason` 이 쓰던 값을 같은 모양(`categorySlug`·`includesPdf`)으로 넘기고, HWP 판정은 함수 안에서 한다.
  - 충돌하는 두 줄에 '함께 구매할 수 없음'과 이유를 보이고, 결제 버튼을 막는다. 422 처리는 대비 경로로 남긴다.
  - 다시 담은 줄은 선택으로 바꾼다(대표 확인 3). 그 줄이 이미 선택된 다른 줄과 충돌하면 어느 쪽 선택도 풀지 않고 두 줄에 표시만 한다. 회원이 하나를 고른다.
- **좁은 화면**
  - 결제 칸이 목록 아래로 내려간다(높이 예산 없음, 칸 전체가 페이지와 함께 스크롤).
  - 화면 아래에 고정 막대(선택 건수·합계 + 버튼 '결제 칸으로')를 둔다.
  - **고정 막대는 결제하지 않는다.** 누르면 결제 칸으로 스크롤하고 아래 순서로 초점을 준다. **막힌 상태를 먼저** 본다. 결제는 결제 칸의 결제 버튼으로만 한다.
    1. 막힌 상태
       - 결제 이름 순서와 같은 순서로 본다: 결제 중·다시 읽는 중 → 위 영역 알림 자리(`tabIndex=-1`), 다시 읽기 실패 → [다시 불러오기](위 영역), retryable → [같은 요청으로 다시 시도], 0건 → 결제 칸 제목(`tabIndex=-1`), 고지 없음 → [다시 불러오기](동의 자리), 함께 살 수 없는 선택 → 첫 충돌 줄의 표시, 부족 → '크레딧 충전'
    2. 막히지 않았으면: 아직 체크하지 않은 부분 보유 확인 → 아직 체크하지 않은 동의 체크 → 열린 결제 버튼
  - 초점은 막대를 숨기기 **전에** 옮긴다. 결제 칸이 화면에 들어오면(IntersectionObserver) 막대를 숨기고, 숨긴 막대는 `hidden`(또는 `inert`)으로 초점·읽기에서 뺀다. 그래서 결제 관련 버튼은 늘 하나만 보이고, 화면 읽기에도 두 번 읽히지 않는다.
  - **문서 스크롤 여백**: 문서 스크롤 상자(`html`)에 늘 sticky 머리글(lg 약 121px, 좁은 화면 112px) 이상의 `scroll-padding-top`(`scroll-pt-36`)을 주고, 고정 막대가 보이는 동안에는 `scroll-padding-bottom: calc(막대 높이 + env(safe-area-inset-bottom))` 을 준다. 그래서 목록을 Tab·Shift+Tab 으로 다닐 때나 막대로 결제 칸에 갈 때 초점 대상이 머리글·막대에 가리지 않는다.
  - 결제 칸 대상마다 주는 `scroll-margin` 은 **두지 않는다.** `scrollIntoView` 는 문서의 `scroll-padding` 과 대상의 `scroll-margin` 을 더하므로, 둘 다 두면 대상이 지나치게 띄워져(위 약 288px) 결제 버튼 줄이 화면 아래 끝에 걸린다. 보통 흐름에서 결제 칸으로 갈 때는 `scrollIntoView({block:'nearest'})` 다음에 `focus({preventScroll:true})` 다(위 `html` 여백만 적용됨).
  - **sticky 칸일 때** 위 영역 안의 대상(부분 보유 확인, 알림 자리)은 `scrollIntoView` 를 쓰지 않는다. 위 영역 상자(약 107px)보다 여백이 큰 `scrollIntoView` 는 아무것도 하지 않거나 대상을 영역 밖에 두기 때문이다. 위 영역의 `scrollTop` 을 직접 계산해(대상이 다 보이게, 위아래 8px 여유) 옮긴 뒤 `focus({preventScroll:true})` 를 한다.
  - 막대의 상태 글(부족·결제 중·다시 시도 필요)은 결제 버튼과 같은 함수에서 나온 값을 글로만 보인다.

### 6-2. 요청 키·스냅숏과 응답별 처리
- **요청에 더하는 값**: `cartTextsSha256`(4-1 장바구니 문구 지문). 화면은 이 값을 **직접 계산하지 않고**, 지금 보이는 문구 사본(뷰 또는 409 의 `cartTexts`)에 든 `cartTextsSha256` 을 그대로 보낸다. 그래서 TS·SQL 계산이 조금이라도 달라 409 가 되풀이되는 일이 없다.
  - 서버는 이 값이 없으면 **먼저 그 요청 키의 영수증을 조회한다**(`getMarketCheckoutReceipt(userId, idempotencyKey)`). 영수증이 있으면 성공 응답을 돌려준다. 모양은 지금 결제 성공 응답과 같다(`data`·`alreadyCompleted: true`·잔액 필드 `buildCreditBalanceResponseFields`). 옛 장바구니 성공 처리가 `payload.balance` 를 쓰기 때문이다. **영수증 조회 자체가 실패하면**(DB 오류) 400 으로 떨어뜨리지 않고 503(`INTERNAL_SERVER_ERROR`, retryable)을 돌려준다. 옛 화면도 5xx 는 같은 키로 다시 시도한다. 배포 직전 옛 장바구니에서 결제하다 응답을 잃은 실회원 탭(retryable)이 배포 뒤 같은 키로 다시 시도한 경우로, 옛 화면이 완료 창을 띄운다(두 번 차감되지 않음). 영수증이 없을 때만 400 `CART_TEXTS_REQUIRED`('화면을 새로 불러온 뒤 다시 결제해 주세요.')로 막는다. 동의 기록 전에 막으므로 옛 탭은 아무것도 기록하지 않고 닫힌다.
  - 서버는 이 값을 동의 기록 함수의 새 인자 `p_cart_texts_sha256` 으로 넘긴다. **대조는 DB 가 기록하기 전에 한다**(5-5 규칙). 다르면 DB 가 기록하지 않고 `NOTICE_CHANGED` 와 새 문장을 돌려주고, 서버는 결제 RPC 를 부르지 않고 409 `PURCHASE_NOTICE_CHANGED`(5-3 (나) 모양)를 낸다.
    - 대조와 기록이 한 함수 안에서 일어나므로, 서버가 읽은 때와 DB 가 기록한 때 사이에 관리자가 저장해도 어긋나지 않는다. 결제 없이 남는 기록도 생기지 않는다.
  - 이 값은 서버 route 와 동의 기록 함수에만 쓴다. `checkout_market_selection` 과 그 `request_payload` 는 바꾸지 않는다(5-5 그대로 목록).
- **스냅숏**: 결제 버튼을 누를 때 보낼 요청 본문 전체를 굳힌다.
  - 줄마다 `cartItemId`·`expectedCredits`·`acknowledgeNoDiscount`, 그리고 `noticeSha256`·`cartTextsSha256` 과 요청 키.
  - 재시도는 이 본문을 그대로 다시 보낸다(서버 `request_payload` 비교와 같아야 함).
  - 진행 중 표식(ref) 하나로 겹친 클릭을 막는다.
- **키 수명**
  - 네트워크 오류·응답 없음·5xx(`V2_PURCHASE_DISABLED`·`RETRY_EXHAUSTED`·`PURCHASE_NOTICE_UNAVAILABLE` 포함)만 **retryable** 이다. 스냅숏과 키를 그대로 둔다.
  - 그 밖의 모든 응답(성공, 400, 401, 402, 403, 404, 409 전부, 422)은 스냅숏을 버린다. 다음 클릭에서 새 키를 만든다. 그래서 고지가 바뀐 뒤 같은 키로 `NOTICE_KEY_CONFLICT` 가 되풀이되지 않는다.
- **잠금**: retryable·결제 중에는 목록의 모든 조작(줄 체크·전체 선택·선택 삭제·줄별 X)과 부분 보유 확인·동의 체크(전체·하위)를 막는다.
  - 세부 항목 창 열기와 '보기'는 읽기라서 열어 둔다(창 안의 하위 체크는 잠금).
  - 빠져나가는 길은 칸 안의 [같은 요청으로 다시 시도]와 [다시 선택] 둘뿐이다.
  - [다시 선택]은 먼저 스냅숏 키로 이미 있는 영수증 조회 route `GET /api/market/cart/checkouts/{key}`(`getMarketCheckoutReceipt`)를 부른다.
    - 200 이면 앞 요청이 성공한 것이다. 성공 처리(구매 완료 창, `alreadyCompleted`)로 간다. 회원이 '줄은 사라지고 잔액만 준' 화면을 보지 않게 하기 위해서다.
    - 404 면 스냅숏을 버리고 잠금을 푼 뒤 다시 읽는다. 앞 요청이 그 뒤에 처리되더라도 새 키 요청은 `CART_CHANGED`·`ALREADY_OWNED` 로 막혀 두 번 차감되지 않는다.
    - 그 밖(네트워크 오류 등)이면 retryable 그대로 두고 안내한다.
  - 앞 요청이 서버에서 아직 처리 중이면(연결만 끊김) 영수증은 404 가 나올 수 있다. 그래서 [다시 선택] 404 뒤에는 **직전 키와 그 스냅숏의 `cartItemId` 묶음을 기억해 둔다.** 다음 중 하나가 생기면 직전 키로 영수증을 한 번 더 조회하고, 200 이면 구매 완료 창(`alreadyCompleted`)을 띄운 뒤 직전 키를 지운다.
    - 그 뒤 어떤 다시 읽기에서든 기억한 묶음의 줄이 하나라도 사라짐(회원이 결제를 누르지 않아도)
    - 그 뒤 첫 결제가 `CART_CHANGED`·`ALREADY_OWNED` 로 끝남
    - 그래서 '완료 창 없이 줄은 사라지고 잔액만 준' 화면이 남지 않는다. 직전 키는 장바구니 화면을 떠나면 버린다.
  - 직전 키 영수증 200 을 받았을 때 완료 창이 이미 떠 있으면(새 결제 성공과 겹침) 덮어쓰지 않는다. 두 결과를 차례로 보이고(하나를 닫으면 다음), 각 결과의 자료 목록과 결제 크레딧을 따로 적는다.
  - 영수증 200 일 때 완료 창 잔액과 `credit-balance-updated`(같은 문서 안의 머리 잔액 표시용)는 **다시 읽은 장바구니 뷰의 잔액**(지금 표시 잔액, `spendableBalance` 기준)을 쓴다. 다시 읽기에 실패했을 때만 영수증의 `data.balanceAfter`(그 결제 때의 값)를 쓴다.
- **응답별 처리**
  - **성공**(`alreadyCompleted` 포함): 지금 구매 완료 창(`market-purchase-complete-dialog`)을 띄우고, 산 줄을 장바구니에서 뺀다(다시 읽기). 동의(전체·하위)·부분 보유 확인을 모두 비운다(6-3). 이때는 '주문 내용이 바뀌었습니다' 안내를 띄우지 않는다.
  - **가격 바뀜(PRICE_CHANGED)**: 다시 읽고 결제 칸 알림에 "가격이 바뀌었습니다. 확인 후 다시 결제해 주세요."와 바뀐 줄 목록('이전 N → 지금 M 크레딧')을 보인다.
    - 이전 가격은 `cartItemId` 별 state(`previousCredits`)로 따로 두고, 다음 결제 클릭이나 선택 변경 때 지운다.
    - 목록 줄의 취소선은 지금처럼 업그레이드 정가에만 쓴다(뜻이 섞이지 않게).
    - 판매 상태가 바뀐 줄은 지금처럼 빠진 줄 수를 알리고 다시 계산한다.
  - **고지 바뀜(PURCHASE_NOTICE_CHANGED)**: `details`(고지)와 최상위 `cartTexts`(장바구니 문구)를 함께 새 해석기로 읽는다.
    - 고지: 지문이 사본과 다르면 고지 사본을 바꾼다. 어느 경우든 동의를 비운다.
    - 장바구니 문구: 응답 `cartTexts.cartTextsSha256` 이 화면 사본의 지문과 다르면 문구 사본(두 문장·지문)을 바꾸고 부분 보유 확인을 비운다. 그래서 장바구니 문구만 바뀐 경우에도 다음 요청은 새 지문을 보낸다.
    - 고지 해석에 실패하거나 `cartTexts` 가 null·규칙 위반(4-3)이면 결제 칸을 잠그고 다시 읽는다.
  - **CART_TEXTS_REQUIRED(400)**: 새 화면에서는 생기지 않는다. 생기면 칸 안에 안내하고 다시 읽는다.
  - **크레딧 부족(402)**: 다시 읽고 부족분을 칸 안에 보인다.
  - **부분 보유 확인 필요(ACK_REQUIRED)**: 다시 읽고 부분 보유 확인을 비운 채 보이며 초점을 준다.
  - **CART_CHANGED·ALREADY_OWNED·BUNDLE_COMPONENTS_EMPTY**: 다시 읽고 칸 안에 안내한다.
  - **CONFLICTING_SELECTION**: 6-1 에서 미리 막으므로 대비 경로다. 응답 `details.itemIds` 는 지금도 있다(`runMarketCheckout` 이 RPC 결과 전체를 details 로 넘김). 이 값은 줄 id(`cartItemId`)가 아니라 **자료 id**(`itemId`)다. 선택된 줄 가운데 `itemId` 가 같은 줄에 '함께 구매할 수 없음'을 표시한다.
  - **IDEMPOTENCY_CONFLICT**: '앞 요청이 이미 처리되었을 수 있습니다' 안내 뒤 다시 읽는다.
  - **403 동의 필요**: `redirectToConsentIfRequired`. **401**: 로그인으로 보낸다.
  - **그 밖의 400·404·422**: 칸 안에 안내하고 다시 읽는다.
- 서버 API(`/api/market/cart/checkout`)의 요청 모양은 `cartTextsSha256` 하나만 더한다. 응답의 고지 모양은 5-3 규칙을 따른다(409 는 최상위 `cartTexts` 포함).

### 6-3. 동의 수명(늘 떠 있는 칸이라 필요한 규칙)
- 결제 칸은 화면에 보인 고지를 **고지 사본**(state)으로 따로 둔다. 첫 값은 뷰에서 가져온다.
- 다시 읽기(선택 저장 실패, 삭제, 402, PRICE_CHANGED 등)로 받은 뷰의 지문이 사본과 다르면 다음을 한다. 판이 1에서 2로 바뀐 경우도 지문이 다르므로 같다.
  - 사본을 새 고지로 바꾼다.
  - 동의(전체·하위)를 비우고, 열려 있던 '보기' 펼침도 닫는다.
  - '안내 문구가 바뀌었습니다. 다시 확인해 주세요.'를 보인다.
  - 부분 보유 확인은 그대로 둔다.
- 지문이 같고 **묶음 구조도 같을 때만**(요약 줄 수, 항목 수, 항목마다 `key`·`view`·`texts` 개수) 사본과 체크를 그대로 둔다. 구조가 다르면 지문이 같아도 사본을 바꾸고 동의를 비운다. 본문에 LF 가 허용되어 항목 경계가 본문 안으로 들어가거나, 선택 요약 줄(note)이 첫 항목 이름으로 옮겨 가는 정책(글은 같고 늘 보이는 줄·하위 체크 구성만 다름)이 생길 수 있기 때문이다. DB 는 같은 지문을 받아들이므로, 이런 변경 뒤의 기록은 새 구조로 남는다(5-4 한계에 한 줄).
- **주문이 바뀌면 동의를 비운다.** 2판 제목이 '주문 내용·구매 조건 확인 및 동의'라서, 체크는 그때 고른 주문을 확인했다는 뜻이다.
  - 주문 키 = 결제에 들어갈 줄의 `cartItemId` 를 정렬한 묶음 + 줄마다 `expectedCredits`
  - 주문 키가 바뀌면 동의(전체·하위)를 비운다.
  - '주문 내용이 바뀌었습니다. 다시 확인해 주세요.'는 **켜져 있던 동의(위 체크나 하위 항목 하나라도)를 실제로 비운 때만** 보인다. 비울 것이 없으면 조용히 주문 키만 바꾼다. 그래서 동의를 켜기 전에 줄을 하나씩 고를 때 안내가 되풀이되거나 칸이 위로 튀지 않는다.
  - 결제 성공 뒤 다시 읽기로 바뀐 주문 키는 안내 없이 비운다(성공 처리가 이미 비움).
  - 바뀌는 때: 선택 변경(줄 체크·전체 선택·삭제), 다시 읽기, PRICE_CHANGED, 판매 상태 변화(빠진 줄), 다른 탭에서 담아 선택된 줄이 늘어난 것을 다시 읽기로 받은 때
  - 선택이 0건이면 동의 체크를 비활성으로 둔다(3절). 그래서 주문을 고르기 전에 켠 체크가 나중 주문의 동의로 남지 않는다.
- **장바구니 문구가 바뀌면**(다시 읽기나 409 로 받은 `cartTextsSha256` 이 화면 사본의 지문과 다르면) 문구 사본을 바꾸고 동의와 부분 보유 확인을 모두 비운다. '안내 문구가 바뀌었습니다. 다시 확인해 주세요.'를 보인다. 판단 기준은 지문 비교 하나다.
- 결제에 성공하면 동의·부분 보유 확인을 모두 비운다. 대표 결정 0-5 '체크는 처음에 비워 둔다'가 두 번째 구매에도 지켜진다.
- 부분 보유 확인은 '선택된 부분 보유 줄의 `cartItemId` 묶음'이 바뀌면 비운다.
- **고지 없음**(뷰의 두 칸이 모두 null, `cartTexts` null, 해석 실패, 링크 문서 없음): 동의 자리에 경고(`role="alert"`, `--consent-ink` 글자) '결제 전 확인 내용을 불러오지 못해 지금은 결제할 수 없습니다. 잠시 후 다시 시도해 주세요.'와 [다시 불러오기] 버튼을 두고, 결제 버튼을 막는다. 충전 화면(8절)과 같은 문장이다.
- **다시 읽기 실패**: 이전 화면은 두고 **위 영역 알림 자리**(`role="alert"`)에 '장바구니를 새로 불러오지 못했습니다'와 [다시 불러오기]를 보인다(아래 영역 높이를 바꾸지 않음). 화면과 서버가 다를 수 있으므로 결제 버튼을 막는다(이름 '장바구니를 다시 불러와 주세요', 6-1).
- 체크가 켜진 채 지문만 바뀌는 길은 없어야 한다(계약 시험).

### 6-4. 1판 모드(새 코드 + 1판 정책)
- 칸 구성은 6-1 과 같다. 동의 자리만 3-1 의 1판 모드다(`confirmNotice` 펼침(넓은 화면은 96px 상자) + `[필수] {checkboxLabel}` 체크 하나 + 링크). 높이는 6-1 예산 안이다.
- 지문은 1판 규칙이고, 6-2·6-3 규칙은 그대로 쓴다.
- 장바구니 문구 2개는 스크립트 A 로 들어가 있으므로 1판에서도 DB 에서 읽는다.

### 6-5. 없애는 것
- `MarketCheckoutConfirmDialog` 파일. 장바구니와 상세 둘 다 쓰지 않게 된다. 1판 본문 표시는 3-1 로 옮긴다. 관련 시험도 정리한다.
- `cart-view.tsx` 에 박혀 있던 확인창 설명과 부분 보유 문장(DB 키로 옮김).
- 장바구니 줄 안의 고정 문장 두 개
  - '이미 구매한 개별 자료가 있어도 기보유분 차감 없이 정가로 구매됩니다.'(지금 401행 부근): **지운다.** 같은 가격 조건을 결제 칸의 확인 문장(DB `partialOwnedConfirmLabel`) 하나로 모은다. 줄에는 '정가 구매' 표시(조건 설명이 없는 UI 고정 글자)만 남긴다. 관리자가 DB 문장을 고쳐도 한 화면에 같은 조건이 두 가지 말로 보이지 않는다.
  - '보유한 자료 가격을 뺀 차액으로 구매합니다.'(지금 404행 부근, 업그레이드 줄): UI 고정 글자로 둔다. 금액 계산 설명이고 동의·기록 대상이 아니다.
  - 11절 '문구 하드코딩 없음' 시험은 '결제 칸 밖에도 정가 구매 조건 문장이 없다'까지 본다.

## 7. 상품 상세
- '구매하기' 버튼을 없앤다. 버튼 줄은 '장바구니 담기' 하나(전체 폭, brand 색)다. 비로그인은 '로그인 후 담기'.
- 담기 결과 창은 지금 모양('계속 둘러보기' / '장바구니 보기')을 그대로 쓴다. 장바구니가 가득 찼다는 안내(`CART_LIMIT`)에도 '장바구니 보기' 버튼을 둔다. 일부만 가득 찬 경우뿐 아니라 **모두 가득 찬 경우도** 토스트(`onFailure` → `toast.error`) 대신 결과 창(안내 종류)으로 보인다.
  - 이미 담긴 줄을 다시 담으면 선택으로 바꾼다(15절 대표 확인 3). 선택 바꾸기는 **담기 route 안에서 같은 요청으로** 하고, 응답에 줄마다 선택 결과를 담는다. 선택으로 바뀐 줄은 'N건은 이미 담겨 있어 결제할 자료로 선택해 두었어요.', 바꾸지 못한 줄은 'N건은 이미 장바구니에 있습니다(선택은 장바구니에서 바꿔 주세요).'로 보인다. 그래서 선택 저장이 실패했는데 '선택해 두었어요'가 보이는 일이 없다.
- 비로그인 의도:
  - 새로 저장하는 의도는 `cart` 만이다.
  - 배포 전에 저장된 `purchase` 의도(30분 안)는 `cart` 로 바꿔 담기만 한다(결제하지 않음).
- **지우는 것**: 상세의 구매 상태·함수, `isCheckingBalance`, 배지 '잔액 확인 중'·'구매 처리 중'. 장바구니 경로가 같은 서버 함수를 쓰므로 살 수 있는 자료는 그대로다.
- **`/api/market/items/[itemId]/purchase` route**: 본문을 지우고 410 `{ success: false, error: { code: 'MARKET_DIRECT_PURCHASE_CLOSED', message: '상품 상세 바로 구매는 종료되었습니다. 장바구니에 담아 구매해 주세요. 이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.' } }` 만 남긴다(`purchases/batch` route 와 같은 모양. 옛 상세 탭이 `payload.error?.message` 를 읽으므로 이 모양이어야 안내가 보인다). 배포 전에 열어 둔 상세 탭이 HTML 404 대신 읽을 수 있는 안내를 받는다. 실회원이 있으므로(1절) 배포 직전에 '구매하기'를 눌러 응답이 끊긴 탭이 배포 뒤 같은 키로 다시 시도할 수 있다. 앞 요청이 이미 커밋됐다면 크레딧은 빠졌으므로 끝 문장으로 자료 보관함 확인을 안내한다(장바구니로 다시 사도 `ALREADY_OWNED` 로 막혀 두 번 차감되지 않음). 파일은 정리 묶음에서 지운다(14절).
- **고칠 문구**
  - 상세 문구 `purchaseCompleteNotice`(DB): 단계 5 배포 직후 새 관리자 화면에서 바꾼다(4-1).
  - '구매하거나 담을 옵션을 선택하세요' → '담을 옵션을 선택하세요'
  - '로그인 후 구매' → '로그인 후 담기'
  - '자료를 선택한 뒤 담기·구매하면…' 같은 '구매' 표현 → '담기'
  - `src/app/api/market/purchases/batch/route.ts` 의 410 문구 '상세페이지에서 구매해주세요' → '장바구니에서 구매해 주세요'
- **구매 진입점 전수 확인**: 구현 때 `rg "items/.*/purchase|openCheckout|구매하기|구매하거나|로그인 후 구매|잔액 확인 중|구매 처리 중"` 로 남은 곳이 없게 한다. 보관함 '업그레이드' 같은 링크는 상세로 가므로 그대로다.
- **구매 route 를 직접 읽는 시험 8개**: `market-workspace-route-guards`, `signup-consent-contract`(돈 API 목록), `market-zip-purchase-entitlement-contract`, `market-refund-credit-snapshot-contract`, `market-v2-rollback-flag-contract`, `credit-mutation-snapshot-contract`, `market-v2-purchase-entitlement-contract`, `market-purchase-notice-contract`.
  - 각 단언은 장바구니 checkout route 로 옮기거나, 그 route 에 같은 단언이 이미 있는지 확인한 뒤 뺀다.
  - 장바구니 route 의 불변식(동의 확인이 차감보다 앞, V2 kill switch, 동의 기록이 결제 RPC 바로 앞)은 꼭 남긴다.
  - `signup-consent-contract` 기대 목록에서는 해당 줄만 뺀다.
  - route 가 410 만 남으므로, 단언을 옮긴 뒤 '410 만 돌려주고 돈 RPC 를 부르지 않음' 계약 시험 하나를 더한다.
- **상세 구매 흐름·공용 확인창을 단언하는 UI 계약 시험 5개**
  - `tests/market-detail-multiselect-contract.test.mjs`(상세 바로 구매·한 요청 키·402 부족 표시)
  - `tests/market-item-detail-ui-contract.test.mjs`(`/구매하기/`)
  - `tests/purchase-section-redesign-contract.test.mjs`(`openCheckout`·`MarketCheckoutConfirmDialog`)
  - `tests/market-purchase-notice-contract.test.mjs`(확인창 고지·체크)
  - `tests/studio-dialog-contract.test.mjs`(공용 확인창 사용)
  - 상세 전용 단언은 '구매 없음'으로 뒤집는다.
  - 장바구니에도 해당하는 단언(같은 키 재시도, retryable 중 ack·동의 잠금, 402·부족 표시, 부분 보유 확인 전송)은 **결제 칸 계약 시험(11절)으로 옮긴 뒤에만** 뺀다.
- **더 깨지는 시험 4개**(3판 검증에서 찾음)
  - `tests/market-purchase-complete-dialog-contract.test.mjs`(53-57행): cart-view 와 market-item-actions 둘 다 `MarketPurchaseCompleteDialog` 를 그린다고 단언 → 상세 쪽은 '그리지 않음'으로 뒤집고, 장바구니 쪽 단언은 그대로 둔다.
  - `tests/signup-consent-contract.test.mjs`(213행): market-item-actions 에 `redirectToConsentIfRequired(response.status, ` 가 있다고 단언(상세 `submitCheckout` 에만 있음) → 상세 쪽은 '없음'으로 뒤집고, 장바구니의 같은 단언은 남긴다. '돈 API 목록' 줄 정리와 따로 한다.
  - `tests/market-v2-detail-library-contract.test.mjs`(53-55행): `grid grid-cols-2 gap-2` 와 brandOutline·brand 두 버튼을 단언 → '장바구니 담기' 하나(전체 폭)로 바꾼다.
  - `tests/market-listboard-no-direct-purchase-contract.test.mjs`(10행): batch route 문구 `/상세페이지에서 구매/` → 새 문구 '장바구니에서 구매해 주세요'로 바꾼다.
  - 이 밖의 상세 구매 route 호출처는 `market-item-actions.tsx` 한 곳뿐이다(3판 검증에서 확인). `credits/purchase` route 를 읽는 시험은 범위가 아니다.
- **충돌 판정을 공용 함수로 뽑으면서 바뀌는 시험**: `tests/market-bundle-savings.test.mjs` 83행은 `market-item-actions.tsx` 안의 `isPdfInclusiveHwp(` 호출이 정확히 2곳이라고 단언한다. 충돌 판정이 공용 함수(6-1)로 가면 상세의 호출 수가 바뀐다. 공용 함수로 옮기는 것은 **충돌 판정**(옛 `getBlockedReason` 안 `includesPdf` 호출)뿐이다. **보유 PDF 숨김**(`hasOwnedPdfInclusiveHwp`: PDF 포함 HWP 를 보유했으면 문제(PDF) 카드를 숨김)의 `isPdfInclusiveHwp` 호출은 상세에 남긴다(지우면 이미 보유한 문제(PDF)가 다시 '담기 가능'으로 보임). 그래서 83행의 호출 수 단언은 2 에서 1 로 바꾸고, import 단언(80행, `purchase-section-redesign-contract.test.mjs` 63행)과 함수를 직접 정의하지 않는다는 단언(81-82행)은 그대로 둔다.
- **의도한 변화**(기능 손실은 아니지만 바뀌는 것)
  1. 상세에서 사면 그 자리에 다운로드 버튼이 뜨던 것이, 구매 완료 창의 '자료 보관함에서 받기'로 바뀐다.
  2. 장바구니가 50개로 가득 차면 상세에서 바로 살 길이 없다. 장바구니에서 빼고 담아야 한다(위 CART_LIMIT 안내).
  3. 선택을 풀어 둔 줄을 다시 담으면 선택으로 바꾼다(`add_market_cart_item` 은 기존 줄의 선택을 바꾸지 않으므로 `set_market_cart_selection` 을 함께 부른다. 15절 대표 확인 3).

## 8. 충전 화면(`/checkout`)
- **2판 모드**
  - `CheckoutNoticeSection`(번호 목록 5개 + 미성년자 안내)과 긴 동의 문장 체크 대신 `CheckoutConsent` 하나를 그린다(잉크 변수).
  - 놓는 곳: 주문 요약 아래, 결제 버튼 바로 위다.
  - 주문 요약 칸은 지금처럼 lg 에서 `sticky` 이지만 최대 높이·안쪽 스크롤을 두지 않는다. 칸이 보기 영역보다 길면 페이지와 함께 스크롤되어 버튼이 잘리지 않는다. 세부 항목은 창으로 열리므로 칸이 펼침으로 길어지지 않는다(3절).
  - 2판 모드에서는 `/terms/refund` 고정값을 쓰지 않는다.
  - '취소·환불정책 전문 보기' 링크는 항목 ④로 들어간다.
  - **9번 배치에서 바뀌는 점**: 9번은 법률 검증을 거쳐 '결제 전 확인·미성년자 안내를 동의 체크 바로 위'에 두고 환불정책 전문 링크를 늘 보이게 했다. 2판은 0-5 결정에 따라 '체크 줄 바로 아래 늘 보이는 요약 줄(미성년자 줄 포함) + `aria-describedby`'로 바뀐다. 환불정책 전문 링크는 항목 ④(세부 항목 창 안)로 옮긴다. 이 배치는 13절 질문 2·3 으로 변호사에게 함께 묻는다.
- **링크 prop**(`termsLink`·`refundPolicyLink`): 서버가 바닥글(`buildMarketPurchaseInfo`)에서 읽어 **판과 관계없이 늘** 내려 준다. 장바구니와 같은 출처다. 1판 화면은 지금처럼 쓰지 않을 뿐이다. 그래서 1판으로 연 화면이 409 로 2판 묶음을 받아도 그 자리에서 2판 동의를 그릴 수 있다. 주소가 없으면 막는다(3절).
- **1판 모드**: 지금 화면 그대로다(`CheckoutNoticeSection`·`AgreeLabel` 을 지우지 않음). 이 부품은 2판이 자리 잡은 뒤 정리 묶음에서 지운다(14절).
- **고지 없음**(`checkoutNotice`·`checkoutConsent` 가 둘 다 null — 해석 실패, 링크 문서 없음): 판과 관계없이 동의 자리에 `role="alert"` '결제 전 확인 내용을 불러오지 못해 지금은 결제할 수 없습니다. 잠시 후 다시 시도해 주세요.' 한 줄과 [다시 불러오기]만 둔다. [다시 불러오기]는 `window.location.reload()` 다. 충전 화면은 첫 값으로 상태를 만들므로(`useState(checkoutNotice)`) `router.refresh` 로는 새 고지가 화면에 반영되지 않기 때문이다. 장바구니(6-3)와 같은 문장이고, 색은 `--consent-ink`(빨강 아님, 지금의 `text-destructive` 를 바꿈)다. 정책 링크(`/terms/refund` 포함)는 그리지 않고, 결제 버튼을 막는다. 1판 부품으로 떨어뜨리지 않는다.
- **결제 내역 상세**(계약내용 교부 화면, `mypage-payment-details-server.ts`·`payments-view.tsx`): 9번은 그 결제에 동의한 원문(`point_charge_checkout_acks.notice_text`)을 그대로 보여 계약내용 교부 수단으로 삼았다. 2판 원문은 `링크:refundPolicy` 같은 기계용 줄이 섞여 읽기 어렵다.
  - `consent_format` 2 기록은 `consent_details.consent` 로 그린다: 제목, 요약 줄, 항목마다 이름과 본문. link 항목은 '취소·환불정책'·'서비스 이용약관' 링크로 바꾼다.
  - 1판 기록은 지금처럼 `notice_text` 를 보인다.
  - 보이는 내용은 기록 원문과 같은 글이다(구조만 되살림).
  - link 항목 옆에는 '결제 당시 판과 다를 수 있어요'를 적는다(링크는 지금 판을 연다. 결제 당시 판의 지문은 기록의 `refund_policy_sha256`·`terms_policy_sha256` 에 있다). 결제 당시 판 본문을 사본에서 찾아 보여 줄지는 변호사 답(13절)과 함께 정한다.
  - 부분 보유 문장(`cartTexts`)을 보여 주게 되면 5-4 '읽는 법'(줄별 `ack`)을 따른다.
- 결제 버튼 열림 조건: 동의(판에 맞는 체크) + 결제수단 + (필요하면) 휴대폰 번호. 지금과 같다.
- 결제 진행 중(`isBusy`: 주문 준비·결제창 여는 중)에는 2판에서도 위 체크와 세부 항목 창 안 하위 체크를 비활성으로 둔다. 세부 항목 창 열기와 보기는 열어 둔다. 지금 1판 동의 체크(`disabled={isBusy}`)·장바구니 6-2 잠금과 같다.
- 페이지 첫 값은 `checkoutNotice`(1판 모양 또는 null) + `checkoutConsent`(2판 묶음 또는 null)다(5-3 (다)).
- 결제 시작 API 의 요청 모양(지문 전달)은 그대로다. 409 응답의 `notice` 는 5-3 (나) 규칙을 따른다.
  - 409 뒤에는 지금처럼 결제 시도를 지우고 동의를 비운다. 2판은 하위 항목도 비운다.

## 9. 관리자 문구 편집
- 구매 정책 폼과 충전 정책 폼 맨 위에 '지금 결제 화면 동의 방식: 펼친 고지(예전 방식) / 접는 동의(새 방식)'를 읽기 전용으로 보인다('1판·2판'은 개발 용어라 화면에 쓰지 않음). 바꾸는 일은 5-6 스크립트로만 한다.
- 2판 키가 정책에 없으면 "2판 문구가 아직 없습니다"를 보이고 편집칸을 숨긴다. 이때는 2판 검사를 하지 않아 1판 문구 저장이 막히지 않는다. 스크립트 A 뒤에는 판이 1이어도 2판 키를 고치고 미리 볼 수 있다(켜기 전에 확인하는 용도).
- **편집칸**
  - `consentTitle`: 한 줄. 'n/30' 을 센다.
  - `consentSummary`: 역할별 고정 줄('환불 기간 줄', '환불 제한 줄', 충전은 '유효기간 줄'·'미성년자 줄'). 필수 줄에는 삭제 버튼이 없다. '덧붙임 줄(선택)'만 더하고 뺄 수 있다.
    - 줄마다 'n/120', 자료는 '합계 n/220' 을 센다. 항목 이름 칸에도 'n/30' 을 둔다. 수는 채우기 전 코드포인트로 세므로, 자리표시는 이름 글자 수(예: `{자료환불기간}` 8자)로 센다고 칸 아래에 적는다.
  - `consentItems`: 이름·보기 종류·대상을 고르는 목록. 최대 6개.
    - 대상은 내부 키가 아니라 한글 이름으로 고른다(`MARKET_PURCHASE_POLICY_TEXT_LABELS`·`POINT_CHARGE_CHECKOUT_ITEM_LABELS` + '미성년자 안내', 링크는 '취소·환불정책'·'서비스 이용약관').
    - text 항목의 대상은 체크 목록으로 여러 개 고르고, 고른 순서(원문 순서)는 위/아래 버튼으로 바꾼다. 다른 항목이 이미 쓴 대상은 비활성으로 보이고 그 항목 이름을 함께 적는다((d) 전체 중복 금지).
    - 항목 `key` 는 코드가 만들고(새 항목은 `item` + 다음 번호, 있던 키는 그대로) 화면에 보이지 않는다. 관리자가 영문 키를 치지 않는다.
    - 순서는 위/아래 버튼으로 바꾼다(키보드 가능).
    - 필수 대상(4-3 (f))이 빠지면 저장을 막고 빠진 이름을 알려 준다.
  - 자료 폼에는 장바구니 문구 2개(`cartCheckoutNotice`·`partialOwnedConfirmLabel`) 칸도 둔다.
  - 제목·요약 줄 칸 아래에 쓸 수 있는 자리표시(자료 `{자료환불기간}`, 충전 `{충전환불기간}`·`{충전유효기간}`)와 '기간은 숫자 대신 자리표시로 써 주세요'를 둔다.
- **힌트**
  - 지문에 들어가는 칸에는 '결제 동의 내용에 들어갑니다. 바꾸면 결제 화면을 열어 둔 회원은 다시 동의해야 합니다.'를 붙인다. 대상은 고정 목록이 아니라 **그때 판과 그때 `consentItems` 가 가리키는 본문**으로 계산한다(예: 항목에 `downloadPeriodNotice` 를 더하면 그 칸에도 붙음). `usageScopeNotice` 힌트에는 상품 상세에도 쓰인다는 말을 함께 둔다.
  - 장바구니 문구 칸에는 '장바구니 결제 칸에 보이고 동의 기록에 남습니다. 바꾸면 결제 칸을 열어 둔 회원은 다시 확인해야 합니다.'를 붙인다.
  - 새 방식일 때 예전 방식 전용 칸(자료 `checkboxLabel`, 충전 `checkoutTitle`·`agreeLabel`)은 '예전 방식 전용(지금 화면에 안 보임, 되돌리기용)'으로 접어 둔다. 되돌리면 다시 쓰이므로 검사는 그대로 한다. 접힌 칸에 오류가 있으면 펼치고 그 칸으로 초점을 옮긴다.
- **저장**
  - 4-3 (S)~(f)와 장바구니 문구 규칙을 확인한다. 2판 키가 정책에 있으면 판과 관계없이 늘 검사한다. 판 1에서 2판 키가 깨져 있으면 그 칸의 오류로 저장을 막고 그 칸을 보여 준다(4-4 와 같은 규칙. 결제는 1판으로 계속된다).
  - (g) 링크 문서 검사는 저장 검사에 넣지 않는다(바닥글 설정 문제라 문구 저장을 막을 까닭이 없음). 결제 때와 미리보기에서만 본다.
  - (c) 숫자 기간 위반은 어느 칸인지 짚어 알린다.
  - `consentFormat` 은 입력에서 빼고, 읽은 원본 jsonb 위에 문구 키만 덮는다.
  - **자료 저장에도 낙관적 잠금**을 더한다. 폼을 열 때의 `version` 을 들고 있다가 `.eq('value->>version', …)` 로 대조하고 +1 한다(충전과 같은 규칙).
  - **작업 기록**
    - 저장 전후 지문(그때 `consentFormat` 의 규칙으로 계산)과 판을 남긴다. 충전의 `notice_sha256_before/after` 계산도 판 규칙을 따르게 고치고, 자료 작업 기록에도 같은 칸을 더한다. 2판 계산이 (g) 링크 검사로 막히면 지문 칸은 null 로 두고 `notice_sha256_unavailable: 'link_document'` 를 함께 남긴다(저장은 진행).
    - 지문에 들지 않는 문구 키(장바구니 문구 2개 포함)는 **바뀐 키의 저장 전후 값을 전문 그대로** 남긴다. 스크립트 A·B·되돌림의 작업 기록과 같은 형식이다. 그래서 동의 기록의 `consent_details.cartTexts` 와 함께 그때 문장을 되살릴 수 있다.
  - 충전 `checkoutItems.validity`(1판 본문이지만 2판 '보기'에도 보임)에 `[0-9]+년` 이 있으면 그 숫자가 `POINT_CHARGE_VALIDITY_YEARS` 와 같아야 저장된다. 지급 함수와 고지가 어긋나지 않게 하기 위해서다. 이 본문은 1판 원문에 들어가므로 자리표시로 바꾸지 않는다.
- 미리보기에 `CheckoutConsent` 를 그대로 그린다(자리표시를 채운 문장, 링크는 지금 바닥글 값). 세부 항목 창도 열어 볼 수 있다.
  - 폭은 실제와 같게 그린다: 자료는 장바구니 결제 칸 안쪽 폭 360px, 충전은 충전 화면 동의 자리 폭(312px).
  - 자료 미리보기는 결제 칸 아래 고정 영역(6-1, 구분 테두리·여백 포함)을 실제 부품으로 그려 높이를 잰다. **판과 관계없이** 1판 부품(3-1: 96px 본문 상자 + '[필수] '+`checkboxLabel` + 링크 줄, 여유 8px)을 늘 재고, 2판 키가 있으면 2판 부품(여유 16px)도 함께 잰다. 판 2 인 동안에도 1판을 재는 까닭은 되돌림 스크립트가 1판 화면을 다시 띄우기 때문이다. 어느 쪽이든 넘으면 그 칸(`checkboxLabel` 또는 제목·요약 줄)의 오류로 저장을 막는다. 6-1 원칙대로 이 높이는 모든 상태에서 같으므로 재는 상태는 하나다(계약 시험이 이 전제를 묶음). 가장 큰 상태(부족·retryable 의 두 버튼 줄)도 같은 높이다.
  - 미리보기는 장바구니와 같은 글꼴·토큰을 쓰도록 `.studio-theme` 으로 감싸 그린다(관리자 레이아웃에는 이 테마가 없음).
  - 운영체제 글꼴(macOS Apple SD Gothic Neo, Windows Malgun Gothic)에 따라 줄바꿈이 조금 다를 수 있으므로 **16px 여유**를 두고 비교한다: `고정 영역 + 80 + 16 ≤ 454`(1366×640 의 칸 content-box). 넘으면 어느 쪽(제목 줄·요약 줄)이 넘쳤는지 짚어 '1366×768 노트북의 결제 칸에 동의와 결제 버튼이 함께 들어가지 않습니다. ○○ 을 줄여 주세요.'를 보이고 **저장을 막는다**.
  - 0-3 '늘 보이는 결제 칸'을 기준 화면에서 지키기 위한 화면 쪽 검사다. 서버 저장 함수는 화면 높이를 다시 확인하지 못하므로(DB 도 마찬가지), 스크립트로 들어간 문구는 6-1 안전 규칙이 받는다.
  - 승인된 초안은 통과한다: 2판 347 + 80 + 16 = 443 ≤ 454. 1판은 과도기 화면이라 여유를 8px 로 둔다: 지금 문구 355 + 80 + 8 = 443 ≤ 454.
  - 구매 고지 카드 설명(`purchase-policy-form.tsx`, 지금 '자료 구매 확인창, 상품 상세 "구매 전 확인"…')은 '장바구니 결제 칸, 상품 상세 "구매 전 확인"…'으로 고친다(UI 고정 글자).
  - 링크 문서가 꺼져 결제가 막히는 상태면 부품 대신 그 이유를 보인다. 예: '바닥글 설정에서 "서비스 이용약관" 문서가 꺼져 있어 결제가 막힙니다.'
- **저장된 값의 지문 보기**(10절 단계 6 용): 폼 초안 미리보기와 따로, **저장된 정책 값**으로 서버가 만든 2판 `noticeSha256`·장바구니 문구 지문과 2판 묶음 JSON 을 접어서 읽기 전용으로 보인다(복사 버튼). 관리자 화면 안이라 관리자만 본다.

## 10. 순서
1. **시작 조건 — 10번이 끝까지 끝나야 한다.** 지금은 10번 **DB 만** 적용됐다(2026-11-24 14:38 KST, 충전 함수 md5 `be4403fd…`, 5-5 그대로 목록의 10번 값도 운영과 같음). 로컬 main 은 origin 보다 2개 앞선다(`51b7373` 10번 코드, `25f01b6` 10번 문서·문구 스크립트). `KAKAO_ADMIN_KEY` 는 2026-11-25 등록 완료다. 11번 단계 3(마이그레이션) 전에 10번의 남은 순서를 마친다.
   - `51b7373`·`25f01b6` push·배포 → 같은 작업 창에서 `supabase/scripts/20261126_bundle10_policy_text.sql`(약관·처리방침 문구, 대표가 재동의 대상을 확인한 뒤) → 시험 계정 확인 → 스위치(`selfAnonymizeEnabled`)는 10번 계획·런북 RB-11 대로
   - 판매 켜짐이면 10번 약관 문구 스크립트 뒤 실회원에게 재동의 화면이 뜰 수 있다(10번 계획의 재동의 판 규칙). 그 대상과 시점은 10번 절차에서 대표가 정한다. 11번은 재동의를 더하지 않는다.
   - 이유: 11번 단계 5 의 push 에 10번 커밋이 섞여 나가면 10번 코드가 선행 조건(약관 12조② 문구를 같은 창에서 적용) 없이 배포된다.
   - 10번 값이 나중에 다시 바뀌면 5-5 값을 고친 뒤 단계 2 리허설을 다시 한다(적용 자리에서 md5 만 고쳐 바로 적용하지 않는다).
2. 리허설(11절)이 PASS 한다. 10번 DB 가 이미 적용됐으므로 10번 뒤 상태에서 한다. 리허설은 DB 거래만 보므로 단계 1 의 10번 코드 배포 전에 해도 된다.
3. 11번 DB 마이그레이션을 적용한다(새 내부 함수 2개, 기록 함수 2개 판 분기(자료는 인자 하나 더함), 칸 7개). 판매 켜짐이면 새벽에 한다. 정책에 `consentFormat` 이 없으므로 화면·기록에 변화가 없다. 옛 코드는 이름 인자 3개로 부르므로 기본값으로 맞고, 응답에 더한 키는 무시한다. `cartTexts` 는 null 로 기록된다.
   - **적용 직후 쓰기 없는 확인**: postgres 접속으로 자료 기록 함수를 이름 인자 3개(`p_user_id`·`p_idempotency_key`·`p_notice_sha256 => 'x'`)로 불러 `NOTICE_INPUT_INVALID` 와 `consentFormat: null` 키가 오는지 본다(입력 검사에서 돌아오므로 기록 없음). 충전 기록 함수도 잘못된 입력으로 같은 확인을 한다. 그 뒤 30분 동안 Vercel 로그에 '구매 고지 동의 기록에 실패했습니다'·'결제 전 확인 동의 기록에 실패했습니다'가 없는지 본다(옛 코드의 PostgREST 이름 호출이 4인자 함수로 맞는지 실호출로 확인). 있으면 바로 11번 down 을 한다(판 1 이고 옛 코드라 순서 문제 없음).
4. 스크립트 A 를 실행한다(2판 키 + 장바구니 문구, 판은 1). 옛 코드에는 보이는 변화가 없다(상세 문구는 여기서 바꾸지 않음, 4-1). 옛 코드가 부른 기록은 장바구니 지문을 보내지 않으므로 `cartTexts` 가 null 이다(5-4). 이 구간(단계 4~5)은 대표 확인 시간만큼 길어질 수 있지만 실회원 화면은 그대로다.
5. 코드(타입 `src/types/supabase.ts` 다시 만들기 포함)를 확인하고 배포한다.
   - localhost 도 운영 DB 를 쓰고 운영 정책은 아직 판 1 이므로, 2판 화면은 **개발 전용 결제 화면 모음**(10-1, `/dev/checkout-gallery`)으로 본다. 운영 정책을 push 전에 판 2 로 바꾸는 방법은 쓰지 않는다(실회원이 있어 그동안 옛 코드 화면이 막히기 때문). 결제 경로 코드에 미리보기 분기를 넣는 방법도 쓰지 않는다.
   - 순서: 내가 1판 모드 화면(미리보기 없는 localhost 실제 화면, 읽기만)과 화면 모음으로 **11절 화면 관문을 항목마다 적힌 상태로 모두 PASS**(Windows 포함) → 계약·단위 시험 PASS(데이터 흐름) → 대표가 localhost 에서 1판 실제 화면과 화면 모음을 확인 → push. 이 단계에서 운영 DB 에 구매·장바구니 쓰기·DB 수정을 하지 않는다.
   - localhost 도 운영 DB 를 쓰므로 결제 버튼은 누르지 않는다.
   - **push 전에 `git log origin/main..HEAD` 에 11번 커밋만 있는지 확인한다.** `51b7373`·`25f01b6`(10번)이 아직 남아 있으면 멈추고 단계 1 을 먼저 마친다.
   - 배포 직후 새 관리자 화면에서 상품 상세 문구 `purchaseCompleteNotice` 를 4-1 의 새 문장으로 바꾼다(작업 기록에 전후 값). 상세는 60초 캐시라 두 번 새로 열어 확인한다.
6. **운영 값으로 서버 계산 = DB 계산을 확인한다.** 이 확인은 BEGIN…ROLLBACK 리허설 안에서는 할 수 없다(서버가 커밋되지 않은 값을 읽지 못함). **이 단계 시작부터 스크립트 B 끝까지 관리자 문구 저장 금지.** 대조한 두 정책 값 md5 를 스크립트 B 에 적어 둔다(5-6).
   - 서버 쪽: 관리자 화면의 '저장된 값의 지문 보기'(9절)가 보이는 2판 `noticeSha256`·장바구니 문구 지문·묶음 JSON
   - DB 쪽: 읽기 전용 접속(`--read-only`, `supabase_read_only_user`)은 새 내부 함수·`point_charge_refund_days()` 의 EXECUTE 권한이 없다. 그래서 postgres 접속(`supabase db query --remote`)으로 **문장 하나**를 돌린다. 이 CLI 는 여러 문장을 보내면 마지막 문장 결과만 돌려주므로(운영에서 확인), `BEGIN…ROLLBACK` 여러 문장 대신 결과를 예외 메시지로 받는 블록 하나로 한다: `DO $v$ DECLARE j jsonb; BEGIN j := jsonb_build_object('market', public.build_checkout_consent_v2('market', <자료 정책>, <refundDays>), 'point_charge', public.build_checkout_consent_v2('point_charge', <충전 정책>, public.point_charge_refund_days()), 'cartTexts', public.build_market_cart_texts(<자료 정책>), 'policyMd5', jsonb_build_object('market', md5(<자료 정책 행>.value::text), 'point_charge', md5(<충전 정책 행>.value::text))); RAISE EXCEPTION 'B11_STEP6 %', j; END $v$;` 예외로 끝나므로 거래는 저절로 되돌려진다(쓰기 없음).
   - 자료·충전 둘 다 지문과 묶음이 같아야 한다. 같지 않으면 스크립트 B 를 하지 않는다.
7. 스크립트 B 를 실행한다(2판 켬). 실행 전부터 끝까지 관리자 문구 저장 금지. 판매 켜짐이면 사람이 적은 시간(새벽)에 돌린다(열려 있던 실회원 화면이 한 번 다시 동의, 5-6). 판매 꺼짐이면 시간 제약이 없다.
8. **운영에서 2판 화면을 다시 확인한다**(내가 먼저 → 대표). 첫 확인은 단계 5 의 화면 모음에서 이미 끝났고, 여기서는 운영 정책·실제 데이터로 같은 화면이 나오는지를 결제 없이 볼 수 있는 범위(첫 화면·세부 항목 창·부족·0건 등)에서 본다. 결제 응답에서만 생기는 상태는 단계 5 화면 모음과 계약·단위 시험으로 갈음한다. 장바구니·충전은 캐시가 없어 바로 바뀐다. 결제 버튼은 누르지 않는다.

**되돌리기(이 순서를 지킨다)**
1. 되돌림 스크립트(판 1, version +1). 2판이 닫힌 상태(링크 문서 꺼짐·2판 키 깨짐)에서도 돈다(5-6).
2. 장바구니·충전 화면이 1판인지 확인
3. 필요하면 코드 되돌리기. **되돌릴 곳은 10번 코드(`51b7373` 기준)다.** 9번 코드로 되돌리는 것은 10번 되돌리기 절차(10번 계획·마이그레이션 머리말)를 따를 때뿐이다. 이때 상세 문구 `purchaseCompleteNotice` 를 관리자 작업 기록의 이전 값으로 돌린다(관리자 화면). 옛 상세의 '구매하기' 아래에 '장바구니에서 구매하면…'이 남지 않게 하기 위해서다. 옛 코드가 부른 동의 기록은 `cartTexts` 가 null 이므로 장바구니 문구 증빙이 틀어지지 않는다.
   - 코드를 되돌리면 `consent_format` 2 충전 기록은 결제 내역 상세에서 원문 그대로(`링크:` 줄 포함) 보인다(내용은 같음). 2판 기록이 생긴 뒤라면 되돌린 기간을 짧게 둔다.
   - 고친 코드를 다시 배포할 때(되돌리기 ③ 뒤 앞으로 가기)는 단계 5 처럼 배포 직후 `purchaseCompleteNotice` 를 새 문장으로 다시 바꾼다.
4. 필요하면 11번 down(함수만, 칸은 남김). **③ 뒤에만** 한다.

- 순서를 어기면 결제가 막히는 쪽으로 간다(잘못 기록되지는 않음).
  - 2판인 채로 코드만 되돌리면: 옛 서버는 1판 지문, DB 는 2판으로 계산한다. 자료 옛 화면은 옛 해석기가 2판 묶음을 읽지 못해 닫힌다. 충전 옛 화면은 닫히지 않고, 옛 route 가 정책을 다시 읽어 1판 고지를 만들어 보내므로 1판 글로 409 가 되풀이된다. 둘 다 기록은 틀어지지 않는다(DB 가 1판 지문을 거절).
  - 새 코드인 채로 down 을 하면(판과 관계없이): 자료는 4인자 함수가 없어 호출이 실패하고, 충전은 옛 함수 응답에 `consentFormat` 키가 없어 새 서버가 503 으로 닫는다(5-3 (나)). 옛 함수의 1판 details 를 받아 화면이 1판·2판을 오가는 일은 없다.
- 10번을 되돌려야 하면 11번 down 을 먼저 한다(5-5).
- 11번을 다시 적용할 때는 5-6 끝 '다시 적용할 때'를 따른다(스크립트 A 건너뜀).

### 10-1. 개발 전용 결제 화면 모음(push 전 2판 화면 확인용)
목적: 운영 정책은 판 1 이고 localhost 도 운영 DB 를 쓰므로, push 전에 2판 화면과 11절 관문 상태를 **운영 DB 에 쓰지 않고, 결제·장바구니·충전 API 를 부르지 않고** 본다. 실회원 결제 경로 코드(결제·충전·장바구니 route, 미들웨어, `/api/market/cart`, 껍데기 4개 파일)에는 **미리보기 분기를 넣지 않는다.** 개발 편의 장치를 결제 경로에 섞지 않기 위해서다(CLAUDE.md '단순하게').

- **페이지 하나**: `src/app/(solvook)/dev/checkout-gallery/page.dev.tsx`
  - `(solvook)` 레이아웃 아래에 둔다. 그래서 실제 장바구니·충전 화면과 같은 `.studio-theme`(글꼴 `--studio-font-sans`, `--studio-*` 토큰), Pretendard 스타일시트, sticky 머리글, 바닥글 안에서 그려진다(`/checkout` 도 이 레이아웃을 다시 씀). 6-1 높이 예산은 이 글꼴 줄바꿈에 기대므로 화면 모음에서 잰 값이 실제와 같다.
  - **운영 빌드에서 빠지는 근거 둘 이상**: ① 파일 이름이 `page.dev.tsx` 이고, `next.config.ts` 의 `pageExtensions` 는 개발 모드(`NODE_ENV=development`)에서만 `dev.tsx` 를 넣는다. 그래서 운영 빌드에는 이 경로와 고정 값이 아예 들어가지 않는다. ② 그래도 페이지는 `process.env.NODE_ENV === 'production'` 이거나 `process.env.VERCEL` 이 있으면 `notFound()` 다.
  - 로그인을 요구하지 않는다. **비로그인 창(시크릿 창)으로 여는 것을 권한다**(머리글이 계정 값을 읽지 않음). 레이아웃·미들웨어의 읽기 조회(사이트 설정, 바닥글, 로그인 확인, 장바구니 배지)는 다른 페이지와 같고 쓰기는 없다. 화면 모음 페이지·하네스·고정 값·표시 부품은 `fetch` 를 쓰지 않고 supabase 를 import 하지 않는다.
- **그리는 것**: 6-0 의 **표시 부품을 실제와 같은 단위로** 그린다. 장바구니는 `CartPageView`(안에 실제 목록 부품 `CartLineListView`·결제 칸·고정 막대), 충전은 `ChargeCheckoutView`(잉크 변수·주문 요약·결제수단·동의 영역·결제 버튼), 그리고 상세 담기 결과 창, 결제 내역 2판 기록 보기다. 화면 모음이 2단 배치나 목록을 따로 다시 만들지 않는다('가짜 목록'이 아니라 **고정 값 줄을 넣은 실제 목록 부품**).
- **하네스(작은 가짜 껍데기)**: 클라이언트 부품 `CheckoutGalleryHarness` 가 동의·부분 보유 확인·줄 선택을 `useState` 로 들고, 비우기는 껍데기와 같은 6-3 순수 함수로 정한다. 버튼 이름·알림·`focusRequest`·`completedQueue`·`noticeSwapToken` 은 고정 응답을 6-2 순수 함수(`reduceCheckoutResponse`)에 넣어 얻은 값을 넘긴다. 결제 버튼의 `onPay` 는 아무것도 하지 않는다(요청 없음).
  - '바뀌는 순간'을 일으키는 하네스 버튼: [고지 교체](같은 높이·넘치는 고지 중 고름), [ACK_REQUIRED 받기], [가격 바뀜 받기], [다시 시도 상태로], [결제 중으로], [다시 읽기 실패로], [다음 결과](완료 창 대기열), [선택 저장 중으로], [토스트 띄우기](sonner `toast()` 직접 호출, 요청 없음). 그래서 '교체 → 다시 재기 → 칸 스크롤 → 알림', ACK_REQUIRED 뒤 위 영역 `scrollTop` 이동·초점, 부분 보유 줄이 처음 생길 때의 이동, 완료 창 차례, 토스트 위치를 첫 상태에서 실제 표시 부품 코드로 본다.
- **상태 고르기**: 탭이나 주소 `?state=…`. 탭은 머리글 아래 보통 흐름에 둔다(fixed·sticky 금지). 높이 관문은 목록을 내려 탭이 보이지 않는 상태에서 잰다.
  - 시작 상태: `v1`(1판 모드), `v2-basic`(2판 3건), `empty`(0건), `partial`(부분 보유 줄), `insufficient`(부족), `seven-digits`(7자리 합계·잔액), `long`(50줄), `upgrade`(업그레이드 차액 줄), `conflict`(함께 살 수 없는 선택), `notice-missing`(고지 없음), `price-changed`, `retryable`, `submitting`, `reload-failed`, `saving-selection`, `bar`(좁은 화면·lg 보통 흐름 막대), 충전 `charge-v1`·`charge-v2`·`charge-notice-missing`·`charge-busy`, 상세 `cart-add-existing`·`cart-limit`(모두 가득 참), 결제 내역 `payment-v2`
- **고정 값**
  - 문구(2판 묶음·장바구니 문구)는 `tests/fixtures/bundle11-gallery/*.json` **한 곳에만** 둔다. 화면 모음 서버 페이지가 `fs` 로 읽어 props 로 넘긴다(정적 import 없음). 이 문구는 스크립트 A 가 넣는 값(4절 초안, 대표 확인 1)과 **같아야 하고**, 계약 시험이 둘을 비교한다. 넘치는 고지는 초안 사본에 덧붙임 줄을 늘린 고정 값이다.
  - 가짜 줄 제목·금액·잔액 같은 시험 값만 `src/dev/checkout-gallery/fixtures.ts` 에 둔다(문구 없음). 이 모듈을 import 하는 파일은 화면 모음 페이지 하나뿐이다.
- **Windows 확인**: Windows VM 의 포트 전달로 Windows 브라우저에서 `http://localhost:4000/dev/checkout-gallery` 를 비로그인으로 연다. 운영 인증 설정은 건드리지 않는다.
- **화면 모음으로 보지 않는 것**: 실제 데이터 흐름(다시 읽기, 409 처리와 사본 교체, 재시도·키 수명, 영수증 조회, 동의 수명이 실제 응답으로 도는 것). 이것은 껍데기·순수 함수의 계약·단위 시험으로 고정하고(11절), 운영 판 2 뒤의 실제 화면은 단계 8 에서 결제 없이 볼 수 있는 범위를 다시 본다.
- 화면 모음은 2판이 자리 잡은 뒤에도 다음 문구·화면 변경 확인용으로 남길 수 있다(14절).

## 11. 시험
- **지문**
  - 5-2 벡터: TS 단위 시험과 SQL(`build_checkout_consent_v2`) 리허설이 둘 다 `2e53f470…` 을 낸다. 자료 벡터도 같다.
  - 스크립트 A 뒤 운영 정책 값으로 서버 2판 계산 = DB 2판 계산(자료·충전). 서버가 만든 2판 묶음 = DB details. 묶음으로 다시 만든 원문의 sha256 = `noticeSha256`. 이것은 리허설이 아니라 10절 단계 6 에서 실제 값으로 한다(관리자 화면 지문 보기 + `DO … RAISE EXCEPTION` 한 문장, postgres 접속·`--read-only` 없이).
  - 장바구니 문구 지문: TS 계산 = SQL 계산(`build_market_cart_texts`, 같은 예시 문장 두 개로 단위 시험과 리허설). 자료 기록 함수와 단계 6 이 같은 함수를 부르는지도 본다. 예시에 앞뒤 공백이 있는 문장을 넣어, TS 가 trim 하지 않는지 본다.
  - 1판 정책일 때 지문과 details 의 1판 키 값이 지금과 글자 하나까지 같다(회귀). 더해진 키는 `consentFormat` 과 자료 거절 응답의 `cartTexts` 뿐이다.
  - 잘못된 2판 정책 모음을 TS 와 SQL 이 같이 거절한다.
    - 필수 본문 빠짐, 허용 밖 textKeys, 객체를 가리키는 textKeys
    - 요약 121자, 필수 요약 줄 빠짐, 숫자 기간, 다른 중괄호
    - `consentFormat` 이 "2"(글자)·3
    - LF 가 든 요약 줄·항목 이름·제목·장바구니 문구(4-3 (S1)). 장바구니 문구는 TS 와 SQL 이 함께 거절하는지 본다(장바구니 지문 인자가 있으면 `NOTICE_CHANGED`, null 이면 지금처럼 기록)
    - `note: null` 처럼 키가 있는데 글자가 아닌 선택 역할
    - 숫자 기간 새 예시('12개월'·'한 달'·'이틀', 4-3 (c))
    - 링크 문서 꺼짐
- **리허설(BEGIN…ROLLBACK, 실제 파일 실행)**
  0. 11번 마이그레이션만 적용한 상태(스크립트 A 전)에서 **충전도 같이 본다**: 옛 충전 호출(6인자, 1판 지문) → 기록 성공, `consent_format` 1·`terms_policy_sha256` NULL·`consent_details` NULL·`refund_policy_sha256` = 최신 사본. 같은 시도로 다시 부르면 replay. 요금제를 바꾼 `PLAN_CHANGED`·지문이 틀린 `NOTICE_CHANGED` 의 details 1판 키가 10번 함수(`be4403fd…`) 결과와 글자 하나까지 같고 더해진 키는 `consentFormat: 1` 뿐이다. 자료는 옛 호출(이름 인자 3개)로 1판 기록 성공. 자료 `consent_details.cartTexts` 는 null(옛 코드를 막지 않음). 3인자 정의는 없고 4인자 정의만 있다.
  1. 실제 스크립트 A 뒤
     - 옛 호출(장바구니 지문 없음) → 1판 기록 성공, `cartTexts` **null**(옛 화면은 DB 문장을 보이지 않았으므로).
     - 새 호출(맞는 장바구니 지문) → 기록 성공, `consent_details.cartTexts` 에 두 문장 전문과 지문. 그 지문 = TS 계산 값.
     - 새 호출(틀린 장바구니 지문) → **기록 없음**, `NOTICE_CHANGED` + `cartTexts`.
     - 새 칸은 `consent_format` 1, 문서 지문 칸 NULL.
     - 충전도 0 과 같은 결과다(2판 키가 있어도 판 1 이면 1판 분기).
     - 판 1 인 채로 `build_checkout_consent_v2` 가 두 정책 모두 NULL 이 아니다(판을 보지 않음, 5-5).
  2. 스크립트 A 뒤 관리자 저장 흉내(문구 수정, version +1) → 여전히 1판, 기록 성공.
  3. 실제 스크립트 B → 1판 지문은 `NOTICE_CHANGED` 이고, details 는 2판 묶음이며 1판 키가 없다.
  4. 2판 지문 → 기록 성공. `consent_format` 2, `refund_policy_sha256`·`terms_policy_sha256` 채움. `consent_details.consent` 로 다시 만든 원문의 sha256 = `notice_sha256`.
     - 사본이 없을 때 닫힘(`NOTICE_POLICY_UNAVAILABLE`)은 따로 BEGIN…ROLLBACK 에서 본다. `policy_document_snapshots` 는 추가 전용 트리거가 DELETE 를 막으므로, 그 거래 안에서 `ALTER TABLE public.policy_document_snapshots DISABLE TRIGGER prevent_policy_document_snapshot_mutation` 뒤 해당 `doc_key` 행을 지우고 2판 기록을 부른 다음 ROLLBACK 한다(트리거·행 모두 되돌아감).
     - `DISABLE TRIGGER` 는 그 표에 SHARE ROW EXCLUSIVE 잠금을 잡는다(그동안 사본을 남기는 바닥글 저장이 기다림). `lock_timeout` 을 두고 사람이 적은 시간(새벽)에 다른 단계와 따로, 짧게 한다(실회원이 있음).
     - 10번 적용 전에 하면 이 거래에 10번·11번·A·B 를 모두 넣어야 해서 짧지 않다(10번은 여러 표를 ACCESS EXCLUSIVE 로 잠금). 그래서 10번 적용 뒤에 한다.
  5. 1판에서 기록한 키를 2판 뒤 같은 지문·같은 장바구니 지문으로 다시 보내면 replay(응답 `consentFormat` = 기록 행 값 1), 다른 지문이면 `NOTICE_KEY_CONFLICT`(details 2판 모양 + `cartTexts`). 장바구니 지문만 다른 같은 키도 `NOTICE_KEY_CONFLICT`. ⑥ 경로(같은 키 두 요청이 겹침)는 한 거래 안에서 먼저 한 기록을 넣은 뒤, 같은 키·같은 고지 지문·다른 장바구니 지문으로 함수를 불러 ② 를 지나 ⑥ 에서 걸리게 흉내 낸다(② 검사 직전 기록을 넣는 방식은 구현 때 정함) → `NOTICE_KEY_CONFLICT`.
  6. 2판 뒤 관리자 저장 흉내(version +1, 요약 줄 수정) → 여전히 2판, 새 문구로 지문 계산.
  7. 2판 키를 깨뜨림 → 결제만 `NOTICE_POLICY_UNAVAILABLE`. 자료 환불 판정과 `get_point_charge_refund_eligibility` 결과는 그대로.
  8. 충전도 3~7 을 한다. 더해서 다음을 본다.
     - 2판 기록의 `refund_days` = `point_charge_refund_days()`, 환불 판정 결과가 1판 기록과 같음
     - 탈퇴 회원 거절(`MEMBER_WITHDRAWN`, 10번 동작) 그대로이고, 응답에 `consentFormat` 키(값 null)가 있다. `NOTICE_INPUT_INVALID` 도 같다.
     - `PLAN_CHANGED` details 는 2판 묶음 + `plan`
  9. 바닥글에서 환불정책 문서를 끔, `label` 을 빈 글자로, `content` 를 빈 글자로 바꿈(세 경우) → 2판은 `NOTICE_POLICY_UNAVAILABLE`, 1판은 영향 없음.
  10. 되돌림 스크립트 → 1판 지문 다시 성공. 2판 키를 깨뜨린 상태와 링크 문서를 끈 상태에서도 되돌림 스크립트가 성공하고, 그 뒤 1판 기록이 성공한다.
  11. down 사전 검사가 11번 값이 아닌 md5(예: 나중 묶음이 바꾼 값을 흉내 냄)에서 멈춘다. down 적용 → 자료는 3인자 정의만 있고 4인자 정의는 없다. 충전 옛 함수 응답에 `consentFormat` 키가 없다(새 서버가 503 으로 닫는 근거). 옛 함수는 2판 지문을 `NOTICE_CHANGED` + 1판 details 로 거절한다. md5 `fa6a7edd…`·`be4403fd…`, 칸은 남음 → **칸이 남은 채로 다시 적용**하면 성공하고 11번 새 md5, `information_schema` VERIFY 통과. 또 **down 없이 같은 파일을 다시 실행**(이력 행만 지움)해도 성공한다(`to_regprocedure` 사전 검사가 네 함수 모두 '바로 앞에 적용한 md5'를 받음, `DROP FUNCTION IF EXISTS`, `CREATE OR REPLACE`).
  12. 그대로여야 함 목록(5-5)의 md5 가 바뀌지 않았다. 권한(`proacl`)이 5-5 VERIFY 값과 같고 anon·authenticated 는 EXECUTE 가 없다(적용 뒤·down 뒤·다시 적용 뒤 모두).
  13. 장바구니 문구를 바꾼 뒤 옛 문구 지문으로 결제하는 흐름: DB 가 기록하지 않고 `NOTICE_CHANGED` + 새 `cartTexts` 를 돌려주며, 서버가 결제 RPC 를 부르지 않는다(route 단위 시험과 함께). 그 키로 남은 동의 기록이 없다.
  14. 10번 전 상태에서 막히는지: 운영은 이미 10번 상태라, **같은 BEGIN 안에서** 충전 함수를 10번 전 정의(10번 `_down_b` 의 3-7 정의, md5 `0047854a…`)로 `CREATE OR REPLACE` 하고 md5 를 확인한 뒤 11번 파일을 실행 → PRECHECK 로 멈춘다 → ROLLBACK. (새 환경 `db reset` 의 순서는 파일 이름 `20261127…` > `20261126…` 이 지킨다.)
  15. 11번 적용 상태에서 10번 `_down_b` → 함수 md5 사전 검사(`… is not the bundle 10 definition`)로 멈춘다. 11번 down 뒤에는 그 함수 md5 검사를 지난다. 그다음 검사(탈퇴 기록·탈퇴 요청이 있으면 멈춤)에서 멈추는 것은 정상이다. 함수 비교만 보려면 `_down_b` 첫 DO 블록의 md5 반복만 따로 돌린다.
  16. 스크립트 거절: A 재실행(`consentFormat` 이 이미 있음), B 재실행(판이 이미 2), 판 1 에서 되돌림 실행, 정책 값 md5 불일치 → 모두 RAISE, 정책 값은 그대로.
- **계약 시험**
  - 상세에 '구매하기'·구매 route 호출이 없다. `purchase` 의도는 담기로 바뀐다.
  - 장바구니 결제 칸
    - 동의 부품·부분 보유 체크·재시도 잠금이 있다.
    - 고정 막대가 checkout API 를 부르지 않는다.
    - 지문이 바뀌면 동의가 풀린다. 성공 뒤 동의·부분 보유 확인이 비워진다.
    - 선택(`cartItemId` 묶음)이나 줄 금액(`expectedCredits`)이 바뀌면 동의가 풀린다. 선택 0건이면 동의 체크가 비활성이다.
    - 동의가 꺼진 채 선택만 바꾸면 '주문 내용이 바뀌었습니다' 안내가 없다. 결제 성공 뒤에도 안내가 없다.
    - 장바구니 문구가 바뀌면 동의·부분 보유 확인이 풀린다. 요청에 `cartTextsSha256` 이 있다. 장바구니 문구만 바뀐 409 뒤 다음 요청의 `cartTextsSha256` 은 새 값이다.
    - 응답 코드별 키 처리(6-2)를 따른다.
    - 7절에서 옮겨 온 단언: 같은 키 재시도, retryable 중 ack·동의 잠금, 402·부족 표시, 부분 보유 확인 전송, 장바구니 완료 창, 장바구니 403 동의 리다이렉트
    - 부족 상태에 [잔액 다시 확인]이 있고, 누르면 장바구니를 다시 읽는다.
    - 다시 읽는 중에는 결제 버튼이 닫힌다.
    - 함께 살 수 없는 선택이면 결제 버튼이 닫히고 두 줄에 표시가 있다.
    - **충돌 판정 = DB 6단계**: 공용 함수가 DB 와 같은 답을 낸다. 예시(같은 `itemId`): 문제(PDF) 한 건 → 충돌 없음, 워크북 + 문제(PDF) → 충돌 없음(워크북 `includesPdf`=true 여도), 문제(PDF) + PDF 든 문제(HWP) → 충돌, 문제(PDF) + PDF 없는 문제(HWP) → 충돌 없음, 전체 패키지 + 개별 자료 → 충돌, 다른 `itemId` 끼리 → 충돌 없음. 같은 예시를 리허설에서 `checkout_market_selection` 결과(CONFLICTING_SELECTION 여부)와 대조한다.
    - **아래 고정 영역 높이 불변**: 0건·1건 이상·동의 전·동의 후·부족·충돌·retryable·결제 중·다시 읽는 중·다시 읽기 실패·알림 있음/없음·7자리 금액에서 아래 영역 `offsetHeight` 가 같다(화면 시험). 구조로도, 아래 영역 안에 조건부로 생기는 보이는 줄이 없다(계약 시험: 0건 안내·다시 읽기 실패 안내·상태 줄은 위 영역 또는 `sr-only`, 금액 줄은 `whitespace-nowrap`). 예외는 고지 없음 하나뿐이고(6-1), 고지 없음에서 나올 때 다시 잰다.
    - 동의가 같은 지문이어도 묶음 구조가 바뀌면 풀린다(6-3). 예시: note 'C' 를 빼고 첫 항목 이름을 'C', 본문을 'L1\nT1' 로 바꾼 정책(요약 줄 수가 3 → 2).
    - 결제 이름: 충돌 + 부족이면 이름은 '함께 구매할 수 없는 자료가 선택되어 있어요'이고, 금액 줄에 '부족'이 없다. 다시 읽기 실패면 '장바구니를 다시 불러와 주세요'.
    - 새 결제 성공과 직전 키 영수증 200 이 겹쳐도 두 결과가 모두 보인다(덮어쓰지 않음).
    - 한 상태 변화에 live 영역 하나만 바뀐다(위 영역 알림이 알리는 상태에서는 sr-only 영역이 비어 있음).
    - sticky 칸에서 위 영역 안 대상으로 갈 때 `scrollIntoView` 를 쓰지 않고 위 영역 `scrollTop` 을 계산한다. 결제 칸 대상마다 주는 `scroll-margin` 은 없고, 문서(`html`)의 `scroll-padding` 만 쓴다(6-1).
    - 결제 진행 중에는 충전 화면 2판 동의(위·하위 체크)가 비활성이다(8절).
    - [다시 선택]은 영수증 조회 route 를 먼저 부르고, 200 이면 완료 창, 404 면 다시 읽는다.
    - 부분 보유 확인 체크에 별도 `aria-label` 이 없다(보이는 DB 문장이 이름).
    - 결제 칸 밖(장바구니 줄)에도 정가 구매 조건 문장이 없다.
  - 서버: `cartTextsSha256` 이 없는 요청은 400 전에 영수증을 조회하고, 영수증이 있으면 지금 성공 응답과 같은 모양(`data`·`alreadyCompleted`·잔액 필드)을 돌려준다(동의 기록·결제 RPC 를 부르지 않음). 조회가 실패하면 503 이다.
  - 서버: 기록 함수 응답에 `consentFormat` 키가 없으면 503(`Object.hasOwn(result, 'consentFormat')` 로 판단, 값이 null 이어도 11번 — 5-3 과 같은 표기). 탈퇴 응답은 지금처럼 403 이다. `cartTextsSha256` 이 없으면 400. DB 가 장바구니 문구 불일치로 거절하면 409 이고 결제 RPC 를 부르지 않는다. 409 응답에 최상위 `cartTexts` 가 있다.
  - 세부 항목 창의 '보기' 버튼 접근 이름이 항목마다 다르다(`{label} 본문 보기`·`{label} 보기(새 창)`). 창에 제목이 있다. 창 버튼은 [닫기] 하나다('확인' 없음).
  - 결제 버튼 이름에 '필수 동의를 체크해 주세요'가 있고, 6-1 순서대로 고른다.
  - **높이 판정**: `decideCheckoutPanelMode(fixedHeight, panelContentHeight)` 가 칸 세로 여백·테두리를 뺀 content-box 높이와 비교한다. 347/454·355/454 → sticky, 387/454·347/414 → 보통 흐름, 경계 374/454 → sticky·375/454 → 보통 흐름. sticky 이면서 넘치는 상태를 만들 수 없다. 쓰는 도중(줄 선택·부분 보유 줄 생김·알림)에는 판정 함수를 다시 부르지 않고, 첫 그리기·창 크기 바뀜·고지 사본 교체 때만 부른다.
  - 자료 관리자 저장은 미리보기 고정 영역이 1366×640 조건을 넘으면 거절한다. 판과 관계없이 1판 부품(여유 8px)을 늘 재고, 2판 키가 있으면 2판 부품(여유 16px)도 잰다.
  - **상태 주인(6-0)**
    - `CartPageView`·`CartLineListView`·`CartCheckoutPanelView`·`ChargeCheckoutView`·`CheckoutConsent` 안에 동의(전체·하위)·부분 보유 확인·줄 선택 `useState` 가 없다(제어 props 만 있음). 안에 있는 상태는 세부 항목 창 열림·보기 펼침·선택 목록 펼치기·높이 재기·막대 보임뿐이다.
    - 껍데기가 스냅숏의 줄별 `acknowledgeNoDiscount` 와 동의 값을 자기 state 에서 만든다.
    - 응답 뒤 화면 동작은 `reduceCheckoutResponse` 출력(`focusRequest`·`completedQueue`·`noticeSwapToken`)으로 표시 부품에 넘어가고, 초점·스크롤·다시 재기는 표시 부품이 한다.
  - **개발 전용 결제 화면 모음(10-1)**
    - 페이지가 `src/app/(solvook)/dev/checkout-gallery/` 아래에 있다(`(solvook)` 레이아웃을 받음).
    - 운영 빌드(`next build`) 산출물(`.next/server`)에 `checkout-gallery` 경로가 없다(`page.dev.tsx` + 개발 모드 전용 `pageExtensions`). 그래도 `NODE_ENV=production` 이거나 `VERCEL` 이 있으면 `notFound()` 다.
    - 화면 모음 페이지·하네스·고정 값 모듈·6-0 표시 부품은 `fetch` 를 쓰지 않고 supabase 클라이언트·서버 모듈을 import 하지 않는다(import 목록 단언. 레이아웃의 읽기는 대상 밖).
    - 화면 모음이 `CartPageView`(그 안의 `CartLineListView`·`CartCheckoutPanelView`)와 `ChargeCheckoutView` 를 import 해 그린다(2단 배치·목록을 따로 만들지 않음).
    - 결제·충전·장바구니 route(`/api/market/cart`, `/api/market/cart/checkout`, `/api/market/cart/items`, `/api/payments/payapp/orders`)와 `src/middleware.ts`, **껍데기 4개 파일**(`cart-view.tsx`·장바구니 `page.tsx`·`checkout-client.tsx`·`/checkout` `page.tsx`)에 `checkout-gallery`·`fixtures`·`bundle11-gallery`·`consentPreview` 같은 글자가 없다.
    - `src/dev/checkout-gallery/fixtures.ts` 를 import 하는 파일은 화면 모음 페이지 하나뿐이다(src 전체 검색). 문구 고정 값은 `tests/fixtures/bundle11-gallery` 에만 있고, 스크립트 A 가 넣는 값과 같다.
    - 화면 모음의 버튼 이름·알림은 껍데기와 같은 순수 함수(6-0)에서 나온다.
  - 충전 [다시 불러오기]는 `window.location.reload()` 다.
  - [다시 선택] 404 뒤, 기억한 줄 묶음이 다시 읽기에서 사라지거나 첫 결제가 `CART_CHANGED`·`ALREADY_OWNED` 면 직전 키로 영수증을 다시 조회한다. 완료 창 잔액은 다시 읽은 뷰의 잔액이고, 다시 읽기에 실패했을 때만 `data.balanceAfter` 다.
  - `CONFLICTING_SELECTION` 표시는 `details.itemIds`(자료 id)와 줄의 `itemId` 로 맞춘다.
  - 화면은 `cartTextsSha256` 을 직접 계산하지 않고 사본 값을 보낸다.
  - 바닥글 링크 검사는 정규화하지 않은 원본으로 한다(`getVisibleFooterPolicyLinks` 를 쓰지 않음).
  - 결제 내역 상세는 2판 기록을 `consent_details.consent` 로 그리고, `링크:` 줄을 그대로 보이지 않는다.
  - 자료 정책 저장 작업 기록 details 에 바뀐 장바구니 문구의 before/after 전문이 있다.
  - 2판 키가 깨져도 `getMarketRefundPolicyCached`·상세 안내는 그대로다(4-4). 장바구니 뷰는 캐시 없는 읽기를 쓴다.
  - 상세 구매 route 는 410 만 돌려주고 돈 RPC 를 부르지 않는다. 본문은 `{ success: false, error: { code, message } }` 이고 `error.message` 가 있으며 끝 문장 '이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.'를 담는다.
  - 1판 모드: 지문 대상 문구(자료 `checkboxLabel`·`confirmNotice`, 충전 제목·항목 5개·미성년자 안내·동의 문구)가 접히지 않고 보인다.
  - 지금 코드의 옛 해석기(`parseMarketPurchaseNotice`·`parsePointChargeCheckoutNotice`)에 2판 묶음을 넣으면 null 이다. 2판일 때 뷰·첫 값의 1판 칸은 null 이다.
  - 충전 화면은 2판에서 `CheckoutConsent` 를 쓴다. 잉크 디자인 시험이 `checkout-consent.tsx` 도 읽고, 세부 항목 창 패널에 테마 변수 클래스가 있는지 본다. 링크 prop 은 판과 관계없이 내려온다. 고지 없음 줄은 `text-destructive` 를 쓰지 않는다.
  - 4-3 (c) 숫자 금지 식이 시험 예시(막힘: '30일'·'１년'·'일 년'·'삼십 일', 통과: 자리표시·'구매일 다음 날')를 TS·SQL 에서 같게 판단한다.
  - 위 체크의 일부 선택 아이콘이 체크 아이콘과 다르다. [세부 항목] 버튼 접근 이름에 진행('m개 중 n개 동의')이 들어간다.
  - 관리자 미리보기는 `.studio-theme` 안에서 그리고, 높이 검사는 16px 여유를 두고 비교한다.
  - 마이그레이션과 down 끝에 `NOTIFY pgrst, 'reload schema'` 가 있다.
  - 문구 하드코딩 없음(동의·고지·전체 취소 안내·부분 보유 문장). 예외는 `tests/fixtures/bundle11-gallery` 하나뿐이다(src 전체를 훑고 `src/dev` 도 빼지 않음).
  - 4-3 검증 규칙(리허설의 잘못된 정책 모음과 같은 예시)
  - `{충전유효기간}` 값: `POINT_CHARGE_VALIDITY_YEARS` = SQL 상수 = 지급 함수 `interval '1 year'`
  - 위 체크의 `aria-describedby`(요약 줄), 일부 선택 `aria-checked="mixed"`
  - 캐시 키 `market_purchase_policy:v3`·`point_charge_policy:v2`
- **화면**(결제 버튼은 누르지 않음, **운영 DB 에 구매·장바구니 쓰기·DB 수정으로 상태를 만들지 않음**)
  - 2판 화면 관문은 **push 전에 10-1 화면 모음으로 PASS** 하고(단계 5, 비로그인 창 권장), 단계 8 에서 운영 정책·실제 데이터로 결제 없이 볼 수 있는 범위를 다시 본다. 각 항목 끝의 [ ] 는 화면 모음 상태(`/dev/checkout-gallery?state=…` 의 값)다. '실제 1판'은 미리보기 없는 localhost 실제 화면(운영 판 1, 읽기만)이다.
  - 실제 데이터 흐름(다시 읽기 뒤 사본, 409 처리, 재시도·키 수명, 영수증 조회, 동의 수명, 한 상태 변화에 live 영역 하나)은 화면 모음으로 보지 않고 위 계약·단위 시험으로 고정한다.
  - **1366×768(보기 영역 약 1366×640) 관문**: 아래 상태 모두에서 칸이 sticky 이고, 위 체크·요약 줄 전부·결제 버튼 줄이 칸 테두리 안에 잘리지 않고 함께 보이며, 위 영역이 80px 이상 남는다.
    - 2판·3건 선택 [`v2-basic`]
    - 2판·부분 보유 줄 + 가격 바뀜 알림이 함께 있는 상태 [`partial` 에서 하네스 [가격 바뀜 받기]]
    - 2판·부족 상태 [`insufficient`]
    - 2판·세부 항목 창을 열었다 닫은 상태(칸 높이가 그대로) [`v2-basic`]
    - 1판 모드 [`v1`, 그리고 실제 1판]
    - 목록을 30번째 줄까지 내린 뒤 부분 보유 줄을 체크해도 칸이 sticky 로 남아 화면에 있다 [`long`]
    - 아래 영역 높이 불변: 0건 [`empty`], 목록 저장 중 [`saving-selection`], 동의 켜고 끄기 [`v2-basic`], 7자리 합계·잔액 [`seven-digits`], 부족 굵게 [`insufficient`], 충돌 [`conflict`], 업그레이드 줄 [`upgrade`], retryable [`retryable`], 결제 중 [`submitting`], 다시 읽기 실패 [`reload-failed`]
    - 부분 보유 줄이 처음 생길 때와 ACK_REQUIRED 뒤에, 손으로 스크롤하지 않아도 정가 구매 확인 체크가 위 영역 안에 다 보이고 초점 테두리가 보인다 [`partial` 에서 줄 선택, 하네스 [ACK_REQUIRED 받기]]
    - 가격 바뀜 알림이 위 영역을 차지해도 아래 영역의 '합계 N · 결제 후 잔액 M' 으로 합계가 보인다. 위 영역에 더 볼 내용이 있으면 끝에 옅은 그림자가 보인다 [`price-changed`]
    - 장바구니 문구만 바뀐 뒤 부분 보유 확인이 풀린 화면 [`partial` 에서 하네스 [고지 교체](장바구니 문구만)]
    - 완료 창 두 결과가 차례로 보인다 [`retryable` 에서 하네스 [다음 결과]]
    - 같은 관문을 Windows(Malgun Gothic) 1366×768 에서도 한 번 본다 [10-1 Windows 확인 방법]
    - 실패하면 6-1 '줄일 대상'(아래 고정 영역의 요소)을 줄인다. 선택 목록은 줄여도 소용없다.
  - **낮은 화면·넘치는 문구**: 1366×600 [`v2-basic`], 넘치는 고지 교체 [`v2-basic` sticky 에서 하네스 [고지 교체](넘치는 고지) — 처음부터 넘치게 그리지 않고 교체 순간을 일으킴]
    - 1366×600 은 처음부터 보통 흐름이고, 칸이 화면 밖이면 lg 고정 막대('결제 칸으로')가 보인다. 칸 안 스크롤 없이 페이지를 내려 위 체크·요약 줄·결제 버튼을 한 화면에 함께 볼 수 있다. 결제 버튼 줄이 잘리지 않는다.
    - 고지 사본 교체로 아래 영역이 커져 조건을 넘으면 보통 흐름으로 바뀌면서 결제 칸이 화면 안으로 스크롤되고 알림이 보인다(관리자 저장으로는 이 문구를 만들 수 없으므로 화면 모음으로만 본다).
  - 세부 항목 창: 360×640 휴대폰에서 충전 '취소·환불 안내'(약 340자)를 펼쳐도 본문만 스크롤하고 [닫기]가 늘 보인다 [`charge-v2`]
  - 장바구니: 좁은 폭(390·360. 360 에서는 [`retryable`]·[`insufficient`] 의 두 버튼이 한 줄에 넘치지 않는지 본다), 0건(동의 비활성), 부족(미리 계산·[잔액 다시 확인]·안내 줄), 가격 바뀜, 선택을 바꿔 동의가 풀림(켜져 있던 때만 안내), 함께 살 수 없는 선택, 고지 없음 [위 상태들을 좁은 폭에서, 고지 없음은 `notice-missing`]
  - 좁은 폭에서 막대가 결제하지 않고, 결제 칸이 보이면 막대가 숨는다. 막대가 보이는 동안 토스트가 막대를 덮지 않는다 [`bar` 에서 하네스 [토스트 띄우기]]
  - 충전 화면: 1판 [`charge-v1`, 실제 1판], 2판 [`charge-v2`], 고지 없음(경고 한 줄 + [다시 불러오기], 링크 없음, 빨강 아님) [`charge-notice-missing`], 결제 진행 중 동의 잠금 [`charge-busy`]. 1판으로 연 화면이 409 로 2판으로 바뀌는 흐름은 껍데기 계약 시험과 단계 8 로 본다.
  - 2판 충전 건의 결제 내역 상세(마이페이지) [`payment-v2`]
  - 상세 담기 창(다시 담은 줄 문구, 선택을 바꾸지 못한 줄 문구)·모두 가득 찬 CART_LIMIT 결과 창 [`cart-add-existing`·`cart-limit`]
  - 키보드만으로 '결제 칸으로 건너뛰기'·체크·세부 항목 창·보기·결제 버튼까지 가는지 본다. 부족 상태에서 막대 → 초점이 '크레딧 충전'으로 간다(막힌 상태 먼저, 6-1) [`insufficient`, 좁은 폭]
  - lg 보통 흐름(1366×600)에서 목록을 내린 뒤 막대 → 초점 대상이 머리글에 가리지 않는다. 맨 아래까지 내려도 바닥글 끝 줄이 막대에 덮이지 않는다. 막대가 보이는 동안 목록을 Tab·Shift+Tab 으로 다녀도 초점 줄이 막대·머리글에 가리지 않는다 [`long`, `bar`]
  - 화면 모음에서 결제 버튼을 눌러도 네트워크 요청이 없음(브라우저 네트워크 탭)을 함께 본다.

## 12. 검증
- 계획 검증: 결제 검증 3명(① 구매·차감 흐름과 재시도, ② 동의 기록·지문·1판/2판 호환, ③ 마이그레이션·배포 순서) + 법률 1명 + 화면(UX·접근성) 1명. 모두 PASS 할 때까지 반복한다.
- 구현 검증도 같은 관점으로 PASS 까지 반복한다.

## 13. 변호사 확인 목록에 더할 질문
1. 디지털 자료의 청약철회 제한을 '늘 보이는 요약 줄(받은 것으로 보는 규칙 포함) + 세부 항목 창에서 보는 본문 + 필수 체크'로 표시하면, 전자상거래법 제17조 제6항의 표시 요건을 채우는가. 철회의 효과(크레딧으로 환불)와 전체 패키지 부분 환불 규칙을 요약 줄이 아닌 본문(세부 항목 창·상품 상세)에만 두어도 되는가. (요약 줄에 더 넣어야 한다면 지금 배치로는 다른 요약 줄을 줄여야 한다 — 4-1.)
2. 충전 크레딧의 유효기간·환불 조건·미성년자 취소 가능을 요약 줄로 늘 보이게 하고, 세부(미성년자 취소 안내 전문, '유효기간이 먼저 끝나는 크레딧부터 쓰임' 포함)는 세부 항목 창에서 보게 해도 되는가. 미성년자 줄을 요약에서 빼고 세부 항목에만 두어도 되는가. 9번에서 정한 '동의 체크 바로 위' 대신 요약 줄을 체크 줄 바로 아래에 두는 배치도 괜찮은가.
3. 하위 항목마다 체크를 두고 전체 체크로 한 번에 켜게 하는 방식이 필수 동의로 충분한가. 하위 항목을 결제 화면 안이 아니라 [세부 항목] 버튼으로 여는 창에 두어도 되는가. 취소·환불정책 전문 링크를 늘 보이는 자리가 아니라 그 창 안에 두어도 되는가.
4. 장바구니 화면 결제 칸에서 버튼 한 번으로 크레딧이 차감되면, 별도 확인창 없이도 제7조(조작 실수 방지)·제8조 제2항(결제 전 확인 절차)을 채우는가. 이용 기간(기간·횟수 제한 없이 다시 받음, `downloadPeriodNotice`)은 상품 상세 '구매 전 확인'에만 있고 결제 칸·세부 항목 창에는 없다(이용 범위는 세부 항목 창에도 있음). 이것으로 제8조 제2항의 제공기간 고지가 충분한가.
   - 화면 설명(실제 배치): 선택 목록은 왼쪽이다. 1366×768 이상에서는 오른쪽 결제 칸이 화면에 고정된다. 늘 보이는 아래 영역에는 '합계 N · 결제 후 잔액 M' 한 줄, 필수 동의와 요약 줄, 'N 크레딧 결제하기' 버튼이 있다. 선택 자료 요약·보유 크레딧·전체 취소 안내(`cartCheckoutNotice`)·정가 구매 확인은 그 위의 작은 스크롤 영역(약 100px)에 있다. 그보다 낮은 화면에서는 결제 칸이 페이지와 함께 스크롤되고, 화면 아래 고정 막대로 결제 칸에 간다. 이 설명이 실제 화면과 맞는지는 11절 화면 관문에서 함께 본다.

## 14. 범위 밖
- 카드·간편결제로 장바구니를 바로 결제하는 기능(대표 결정 2).
- 쿠폰·포인트, 장바구니 담기 개수 제한 변경, 상세 화면의 다른 디자인 변경.
- 가입 동의 화면의 체크 구조(4번 묶음 그대로).
- 충전 뒤 장바구니로 돌아오는 기능(`returnTo`). 만들면 결제 시작 route 와 결과 화면, 열린 리다이렉트 검사까지 범위가 커진다.
- 창이 다시 보일 때(visibilitychange·pageshow) 잔액을 자동으로 다시 읽는 기능. 부족으로 막힌 화면은 [잔액 다시 확인]과 그 안내 줄로 푼다(6-1). 충전 결과는 다른 문서에서 끝나므로 `credit-balance-updated` 는 장바구니에 닿지 않는다.
- 1판 화면 부품(`CheckoutNoticeSection`·`AgreeLabel`, 1판 키) 정리. 2판이 자리 잡고 되돌릴 일이 없어진 뒤 따로 한다. 410 만 남긴 상세 구매 route 파일도 이때 지운다.
- DB `checkout_market_selection` 의 direct 모드 삭제.
- 개발 전용 결제 화면 모음(10-1) 정리. 2판이 자리 잡은 뒤 남길지(다음 문구·화면 변경 확인용) 지울지 정한다.

## 15. 검증 반영
관점: 법=법률, 기=동의 기록, 이=마이그레이션, 화=화면, 구=구매 흐름. 같은 문제를 여러 관점이 짚은 것은 한 줄로 합쳤다.

### 15-1. 1판 검증 반영

| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[blocker]** 판을 `version` 으로 가름 — 충전 version 은 편집 번호(법·기·화·이) | 4-0 `consentFormat` 으로 분기, 두 정책 version 을 편집 번호로 맞춤. 5-6 스크립트 판 검사, 9 판 표시, 10 되돌리기, 11 리허설 2·6 |
| [major] 2판 409 details·장바구니 뷰 모양 미정, 옛 탭이 1판 글로 2판 지문 동의(법·기·화·이·구) | 5-3(2판 묶음, 1판 키 넣지 않음, 뷰·첫 값은 칸 나눔, 캐시 키), 11 계약·리허설 3·5 |
| [major] 원문 규칙 모호(기) | 5-1 정확한 규칙, 4-3 (e) 허용 목록, `textKeys` 로 통일, 5-2 시험 벡터 |
| [major] 링크 문서가 꺼져도 '본 것'으로 기록(기, 법·화·이 minor) | 3 보기(닫힘), 4-3 (g) 코드·DB 검사, 8 링크 출처 통일, 11 리허설 9 |
| [major] 2판 키 해석 실패가 환불까지 막음(기, 이 minor) | 4-4 해석 분리, 5-6 스크립트 VERIFY, 11 리허설 7 |
| [major] 되돌리기 순서·down 칸 처리 없음(기·이) | 10 되돌리기 순서, 5-5 down 은 칸을 지우지 않음·10번 down 순서, 11 리허설 11 |
| [major] 새 코드의 1판 화면 미정(이·구) | 3-1, 6-4, 8 1판 모드, 11 계약 |
| [major] 자료 요약에 '받은 것으로 보는 규칙' 빠짐(법) | 4-1 `restriction` 줄. '하자 자료 환불' 줄은 `note` 로 두고 대표 결정 |
| [major] 충전 미성년자 안내가 두 단계 접힘(법) | 4-2 요약 `minor` 줄 + 따로 뗀 항목 3, 4-3 (b) 필수 역할, 13 질문 2 |
| [major] 법정 본문을 동의에서 빼도 저장됨(법) | 4-3 (b) 필수 요약 역할, (f) 포함 규칙, 9 필수 줄 삭제 불가 |
| [major] 좁은 화면 고정 막대에서 바로 결제(법·화, 구 minor) | 6-1 막대는 이동만, 칸이 보이면 숨김, 같은 상태 함수. 11 계약·화면 |
| [major] 결제 칸 동의 체크를 비우는 때 없음(화·구) | 6-3 고지 사본·지문 바뀌면 비움·성공 뒤 비움·부분 보유 묶음 바뀌면 비움 |
| [major] 요약 줄 접근성 연결 없음(화) | 3 `aria-describedby`·`mixed`·펼침 버튼 이름, 11 계약 |
| [major] 요청 키·스냅숏 수명 미정(구) | 6-2 키 수명·스냅숏 정의·잠금 |
| [minor] '하나라도 못 사면 전체 취소' 안내 빠짐, 부분 보유 문장 하드코딩(법·기) | 4-1 `cartCheckoutNotice`·`partialOwnedConfirmLabel`, 6-1 |
| [minor] 요약 줄 숫자 기간 금지 없음, '1년' 고정(법·기) | 4-3 (c), 4-2 `{충전유효기간}`, 9 validity 본문 숫자 검사, 11 계약 |
| [minor] 초안 표현 3곳(환불 신청, 유효기간 지나면 사라짐, 제목에 주문 내용)(법) | 4-1·4-2 [2판 고침]. 대표 다시 확인 |
| [minor] 13절에 확인창 축소 질문 없음(법) | 13 질문 4 |
| [minor] 자료 저장 낙관적 잠금 없음, 폼 안내·작업 기록 지문(기·화·이·구) | 4-0, 9 저장·힌트·작업 기록 |
| [minor] 이용약관 판을 남기지 않는 근거 약함(기·법) | 5-4 `terms_policy_sha256`, 한계 한 줄 |
| [minor] 기록에 원문 규칙(1판/2판) 칸 없음(기) | 5-4 `consent_format` |
| [minor] 없는 `returnTo` 규칙(화·구) | 6-1 지금처럼 `/pricing` + chargeHint, 14 범위 밖 |
| [minor] 부족을 미리 계산하지 않아 잔액 음수(화) | 6-1 '부족한 크레딧 N', 버튼 비활성 |
| [minor] sticky 칸이 768px 높이에서 넘침(화) | 6-1 최대 높이·본문만 스크롤 → 3판에서 높이 예산으로 다시 고침(15-2) |
| [minor] 두 화면 디자인 체계 차이(화) | 3 디자인(CSS 변수, Radix 통일, 잉크 시험 확장) |
| [minor] 재시도 잠금 문장 모순, 가격 바뀜 취소선 겹침(화·구) | 6-2 잠금 범위·빠져나가는 길, `previousCredits`, 취소선은 업그레이드에만 |
| [minor] 확인창이 없어져 품목 확인 단계 사라짐(화) | 6-1 '선택한 자료' 목록. 담기 창 문구 추가는 대표 결정 |
| [minor] 고지 없음·다시 읽기 실패 상태 없음(화) | 6-3 |
| [minor] 담기 결과 창은 이미 버튼 둘, 빠진 '구매' 문구(화) | 7 지금 창 그대로, 고칠 문구·rg 패턴 |
| [minor] 관리자 폼 힌트·대상 고르기(화) | 9 힌트·한글 이름·위/아래 버튼·미리보기 |
| [minor] 스크립트 안전 장치·60초 캐시·캐시 키(이·구) | 5-6 스크립트 A·B·되돌림, 5-3 캐시 키, 10 단계 8 |
| [minor] 10번 미적용 상태 md5, 그대로 목록 구체화(이·구) | 5-5 사전 값(`0047854a` 받지 않음), 이름·md5 목록, 10 단계 1·2 |
| [minor] 리허설 빠진 시험(이) | 11 리허설 1~12 |
| [minor] 작업 기록 지문 규칙, 링크 키 `serviceTerms`, 타입 재생성, 시험 파일 목록(이) | 9, 4-1, 10 단계 5, 7 시험 8개 |
| [minor] 나머지 응답 코드 처리(구) | 6-2 응답별 처리 |
| [minor] 고정 막대 열림 조건·키(구) | 6-1 같은 상태 함수, 막대는 결제하지 않음 |
| [minor] 구매 route 를 읽는 시험 8개, batch route 문구, direct 모드(구) | 7, 5-5 그대로 목록, 14 |
| [minor] 상세 전용 기능 변화 명시(구) | 7 의도한 변화 3가지. 다시 담은 줄의 선택은 대표 결정 |
| [minor] 장바구니가 창이 다시 보일 때 잔액을 다시 읽는지(화) | **자동 다시 읽기는 반영 안 함.** 새 기능이라 범위를 늘린다(14). 부족으로 막힌 화면은 [잔액 다시 확인]으로 푼다(4판에서 이벤트 근거 삭제 — 이벤트는 장바구니에 닿지 않음, 15-4) |

### 15-2. 2판 검증 반영(2회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| [major] 선택·줄 금액이 바뀌어도 동의가 켜진 채 남음, 0건에서 켠 체크가 나중 주문 동의로 남음(법, 구 minor) | 6-3 주문 키가 바뀌면 동의를 비우고 '주문 내용이 바뀌었습니다' 안내. 3절·6-1 0건이면 동의 비활성. 11 계약 |
| [major] DB 로 옮긴 `partialOwnedConfirmLabel`·`cartCheckoutNotice` 를 되살릴 곳이 없음(법, 기 minor) | 5-4 `consent_details.cartTexts`. 4-1·6-2 `cartTextsSha256` 으로 화면 문장과 기록 문장이 같을 때만 결제. 9 작업 기록에 전후 전문. 6-3 문구가 바뀌면 동의·부분 보유 확인을 비움. 11 리허설 1·13, 계약 |
| [major] 1366×768 에서 동의 부품·요약 줄이 sticky 칸 스크롤 아래에 숨음(화) | 6-1 위 스크롤/아래 고정 두 영역, 400px 열, 높이 예산(추정 수치), 낮은 화면은 sticky 끔. 4-3 (b) 자료 요약 합계 220자. 3-1 1판 본문 160px 상자. 11 화면 관문 |
| [minor] 9번 '체크 바로 위' 배치에서 바뀐 근거 없음(법) | 8 '9번 배치에서 바뀌는 점', 13 질문 2·3 |
| [minor] 자료 요약에 '크레딧으로 환불'이라는 효과 없음(법) | **문구는 바꾸지 않음.** 대표 기본값(초안 그대로)과 결제 칸 높이 예산 때문이다. 근거 한 줄을 4-1 에 적었다(보기 창·상품 상세에 있음, 관리자 화면에서 더할 수 있음) |
| [minor] 막대 초점 대상이 비활성일 때 초점이 사라짐, 결제 중 알림, 긴 목록 Tab(화) | 6-1 초점 순서 4단계, 숨기기 전 초점 이동·`hidden`/`inert`, 결제 중 `role="status"`, '결제 칸으로 건너뛰기'. 11 키보드 |
| [minor] 일부 선택이 켜짐처럼 보임(화) | 3 디자인 빼기 아이콘, 11 계약 |
| [minor] 보기 창이 포털이라 잉크 변수가 끊기고 보라 링이 섞임(화) | 3 보기 창 패널에 테마 클래스, [닫기] 버튼. 11 잉크 시험 |
| [minor] 상세의 `purchaseCompleteNotice` 가 바로 사는 것처럼 읽힘, 다시 담기 문구(화) | 4-1·5-6 스크립트 A 가 문구 교체, 관리자 이름표. 7 담기 결과 문구 |
| [minor] 관리자 폼 쓰기 쉬움(미리보기 이유, 항목 key, 자리표시 안내, 접힌 칸 오류, '1판/2판' 용어)(화) | 9 전부 |
| [minor] 충전 고지 없음 때 그릴 것 미정(화) | 8 고지 없음 한 줄, 링크 없음. 11 화면 |
| [minor] 부족 비활성에서 옛 잔액으로 막힘(구) | 6-1 [잔액 다시 확인]. 14·15-1 근거 문장 고침(이벤트 근거는 4판에서 삭제, 15-4) |
| [minor] 장바구니 뷰 60초 캐시로 409 사본과 다시 읽기가 오감(구·이·기) | 4-4 장바구니 뷰는 캐시 없이 읽음. 5-6 캐시 문단, 10 단계 8 |
| [minor] 장바구니 문구를 내려 줄 칸이 없음(구) | 5-3 (다) `cartTexts` 칸, 409 에도 함께 |
| [minor] 상세 구매·공용 확인창 UI 계약 시험 5개 빠짐(구) | 7 시험 5개 목록과 '옮긴 뒤에만 뺀다' 규칙. 11 계약 |
| [minor] 리허설 4 '사본을 지운 거래'를 할 수 없음, 사본 없으면 NULL 은 빈 증빙(이·기) | 5-4·4-3 (g) 2판은 사본이 없으면 닫힘. 11 리허설 4 트리거를 끄는 따로 거래 방법 |
| [minor] 되돌림 스크립트가 B 의 build 검사까지 따라옴(이) | 5-6 되돌림 사전 검사를 따로 적음. 11 리허설 10 |
| [minor] 칸 다시 적용 때 '이미 있음', 잠금·재적용 절차 빠짐(이·기) | 5-4 `ADD COLUMN IF NOT EXISTS`·이름 붙인 CHECK·VERIFY, 5-5 형식 목록. 11 리허설 11 |
| [minor] 2판인 채 down 만 하면 화면이 1판·2판을 오감(이) | 5-3 (나) 응답에 `consentFormat` 이 없으면 503 으로 닫음. 10 되돌리기 ④ 는 ③ 뒤에만. 11 리허설 11 |
| [minor] 60초 캐시를 리허설로 확인할 수 없음, 만료 뒤 첫 요청은 옛 값(이·기) | 5-6 캐시 문단(리허설은 DB 만, 화면은 10 단계 8), 상세는 두 번 열어 확인 |
| [minor] 그대로 목록에 빠진 함수(이) | 5-5 `market_purchase_refund_days`·`record_policy_document_snapshots`·`prevent_policy_document_snapshot_mutation`(운영 md5 확인), 스크립트 사전 검사에 `record_admin_audit` |
| [minor] DB 링크 문서 검사 필드 미정(이) | 4-3 (g) 객체 경로·`enabled`·`label`·`content`. 11 리허설 9 세 경우 |
| [minor] 구매 route 를 지우면 옛 탭이 HTML 404(이) | 7 410 JSON 만 남김, 계약 시험, 14 파일 삭제는 정리 묶음 |
| [minor] 서버 = DB 운영 값 확인을 리허설에서 할 수 없음(이) | 10 단계 6 새로 둠, 5-6 스크립트 B 는 그 뒤에만 |
| [minor] 2판 원문만으로 줄 구조를 되살릴 수 없음(기) | 5-4 `consent_details.consent`, 11 리허설 4 |
| [minor] 목표 3 의 '문서 판이 지문에 남음' 표현(기) | 2 목표 3 문구 고침(기록 칸, 5-4 한계) |
| [minor] 충전 링크 prop 이 2판 모드에만 있음(기) | 8 링크 prop 은 판과 관계없이 늘. 11 화면 |
| [minor] 캐시 값 모양·해석 실패 범위 미정(기) | 4-4 값 모양, 1판 해석 실패만 throw, 세 해석은 따로. 11 계약 |
| [minor] 링크 항목에 보이는 글 미정(기) | 3 보기: 이름은 `consentItems.label` 만, '보기' 는 고정 버튼 글, 바닥글 이름은 쓰지 않음 |
| [minor] 관리자 힌트 대상 고정, 판 1 에서 2판 키가 깨졌을 때 저장, 작업 기록 지문 null(기) | 9 힌트는 그때 `consentItems` 로 계산, 2판 키 검사는 늘 함, (g) 는 저장 검사에서 뺌, 지문 null 과 사유 |

### 15-3. 3판 검증 반영(3회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[major]** 옛 코드가 부를 때도 DB 장바구니 문장이 `cartTexts` 로 남아, 회원이 보지 않은 문장이 기록됨(법, 이 minor) | 5-5 자료 기록 함수에 `p_cart_texts_sha256 DEFAULT NULL` 인자(3인자 DROP·GRANT·down·타입). null 이면 `cartTexts` null, 같으면 전문 기록, 다르면 기록하지 않고 거절. 4-1·5-4·6-2·10 단계 3·4·되돌리기 ③. 11 리허설 0·1·13 기대값 고침 |
| **[major]** 하위 항목 4개를 펼치면 고정 영역이 칸 최대 높이를 넘어 스크롤 영역이 0(화) | 3 세부 항목을 결제 칸 안 펼침 대신 **창**으로 엶(장바구니·충전 같음, 창 안에서 본문 펼침). 6-1 부분 보유 확인을 고정 영역으로, 스크롤 영역 최소 80px, 잰 높이로 '고정 칸 조건'을 판단해 넘으면 보통 흐름, 예산 수치 다시 계산(초안 352/416px, 상한 476px). 4-3 (a) 제목 30자. 11 화면 관문(1366×640·1366×600·상한 문구) |
| [minor] 상세 구매를 없애면 깨지는 시험 4개 더 있음(구) | 7 '더 깨지는 시험 4개'와 처리 방법 |
| [minor] `credit-balance-updated` 근거가 틀림(구·화) | 6-1 근거 정정(다른 문서의 이벤트라 닿지 않음), [잔액 다시 확인] + 안내 줄. 11 계약 시험을 '다시 읽기를 부름'으로 |
| [minor] '주문 내용이 바뀌었습니다' 안내가 동의를 켜지 않았을 때도·성공 뒤에도 뜸(구·화) | 6-3 실제로 비운 때만 안내, 성공 뒤 안내 없음. 6-2 성공. 11 계약 |
| [minor] 장바구니 문구만 바뀐 409 의 화면 처리 없음, 409 응답에서 `cartTexts` 자리 모호(구·기) | 5-3 (나) 응답 모양(최상위 `cartTexts`, `marketCartErrorResponse`), 6-2 고지 바뀜에서 문구 사본·지문 교체, 6-3 판단은 지문 비교. 5-4 두 키가 글자일 때만 문장·지문. 11 계약 |
| [minor] 함께 살 수 없는 선택을 장바구니가 미리 막지 않음(구) | 6-1 '함께 살 수 없는 선택 미리 막기'(상세와 같은 규칙 공유, 다시 담은 충돌 줄은 표시만). 6-2 422 는 대비 경로 |
| [minor] [다시 선택] 때 앞 요청 성공을 알리지 못함(구) | 6-2 영수증 조회 route 먼저 부르기(200 완료 창, 404 다시 읽기). 11 계약 |
| [minor] 부분 보유 체크의 코드 `aria-label`·줄 안 고정 문장(구·화·법) | 6-1 접근 이름은 DB 문장만. 6-5 줄 안 정가 구매 문장 지움('정가 구매' 표시만), 업그레이드 차액 문장은 UI 고정 글로 둠. 11 하드코딩 시험 범위 |
| [minor] 결제 내역 상세(계약내용 교부)에 2판 기계용 원문이 그대로 보임(법) | 8 결제 내역 상세는 `consent_details.consent` 로 그림. 11 화면·계약 |
| [minor] 요약 줄 초안이 정책의 조건 셋(먼저 끝나는 크레딧부터 쓰임, 지급일 기준, 패키지 부분 환불)을 뺌(법) | **초안 문구는 바꾸지 않음.** 0-6 기본값(초안 그대로)과 결제 칸 높이 예산 때문이다. 4-1·4-2 에 근거와 검토 안('유효기간이 먼저 끝나는 것부터 쓰여요' 붙이기)을 적고, 13 질문 1·2 에 함께 묻는다. 대표 확인 항목은 늘리지 않았다 |
| [minor] 숫자 금지 식이 '일 년'·'１년'을 통과(법) | 4-3 (c) 전각·한글 수사까지 막는 식과 시험 예시, 오탐 처리. 11 계약 |
| [minor] 막대 초점 순서가 부족 상태에서 동의로 감, retryable 규칙 겹침(화) | 6-1 막힌 상태 먼저 보는 순서 |
| [minor] 보기 버튼 이름이 모두 같음, 창 제목·정렬·높이 미정(화) | 3 항목별 `aria-label`, 창 제목, 왼쪽 정렬, `max-h`·`grid-rows` 로 본문만 스크롤·[확인] 늘 보임. 11 화면(360×640) |
| [minor] 다시 읽는 중 상태 없음(화) | 6-1 열림 조건과 상태 줄 |
| [minor] 관리자 글자 수 세기·여러 대상 고르기·미리보기 폭(화) | 9 n/30·n/120·합계 n/220(자리표시 세는 법), 체크 목록 + 순서 버튼 + 다른 항목이 쓴 대상 비활성, 미리보기 360/312px 와 높이 경고 |
| [minor] 충전 칸 합계 제한 근거 틀림, 고지 없음 줄 색·다시 시도 없음, 문장 불일치(화) | 4-3 (b) 근거 고침, 8 칸 높이 규칙·고지 없음 줄([다시 불러오기], `--consent-ink`), 6-3 과 같은 문장 |
| [minor] 정책을 읽기 전 응답·replay 의 `consentFormat` 값과 서버 판단 방식 미정, 탈퇴 안내가 503 으로 바뀔 위험(기·이) | 5-3 (가) 값 규칙(null·기록 행 값·정책 판), replay 위치 유지. (나) 키가 있는지로 판단, 탈퇴·잘못된 요청은 지금 분기. 11 리허설 5·8, 계약 |
| [minor] 서버 링크 검사가 정규화된 바닥글을 봐 DB 와 갈림(기) | 4-3 (g) 서버도 정규화하지 않은 원본으로 같은 세 조건, 읽기 실패면 닫음. 11 계약 |
| [minor] 단계 6 서버 쪽 지문을 볼 곳이 없음(기·이) | 9 '저장된 값의 지문 보기', 10 단계 6 |
| [minor] 단계 6 DB 쪽을 읽기 전용 접속으로는 실행할 수 없음(이) | 10 단계 6 postgres `BEGIN READ ONLY … ROLLBACK`, 5-5 읽기 전용 사용자에게 EXECUTE 를 주지 않음 |
| [minor] 리허설 빠진 항목(10번 전 PRECHECK, 10번 down 순서, 스크립트 거절), 10번 md5 가 바뀌면 다시 리허설, 리허설 4 잠금 문장(이) | 11 리허설 14·15·16, 리허설 4 잠금 정정(SHARE ROW EXCLUSIVE)·10번 뒤에. 10 단계 1 |
| [minor] 파일 이름 순서, 다시 적용 때 스크립트 A, 되돌릴 때 상세 문구(이) | 5-5 파일 이름(`20261127100000_…`)·down 위치, 5-6·10 다시 적용 때 A 건너뜀, 10 되돌리기 ③ 에서 `purchaseCompleteNotice` 이전 값으로 |
| [minor] 4-4 와 9 의 판 1 저장 규칙이 다름, 2판 키가 없을 때(이) | 4-4·9 같은 규칙(2판 키가 있으면 늘 검사, 깨지면 저장 거절, 없으면 검사 안 함) |


### 15-4. 4판 검증 반영(4회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[major]** 고정 칸 조건에 칸 세로 여백·테두리(42px)와 두 영역 사이 간격이 빠져, 조건을 채운다고 본 상태에서 결제 버튼 줄이 잘림(화) | 6-1 content-box 기준(칸 content-box 454px, 아래 영역은 구분 17px 포함해 `offsetHeight` 로 잼)으로 다시 정하고 예시 다시 계산(2판 361→441≤454, 1판 345→425≤454, 상한 401·1366×600 은 보통 흐름). 부분 보유 확인을 위 영역으로 옮겨 아래 영역 높이를 쓰는 도중 일정하게 함, 버튼 줄 56px, 1판 본문 상자 112px. 안전 규칙(sticky + 넘침 없음)과 판정 순수 함수, 줄일 대상은 아래 고정 영역 요소. 9 관리자 저장 검사(넘치면 저장 막음). 11 계약(판정 함수 경계값)·화면 관문 |
| [minor] 쓰는 도중 sticky↔보통 흐름이 바뀌어 칸이 사라짐, 겹친 스크롤 상자, 첫 그리기 기본 상태, 'n/m' 이 제목 폭을 바꿈(화) | 6-1 판정은 첫 그리기(서버는 보통 흐름, `useLayoutEffect` 에서 sticky)·창 크기 바뀜·고지 사본 교체 때만. 고지 교체로 넘치면 결제 칸을 화면 안으로 스크롤. 보통 흐름일 때 lg 고정 막대. 선택 목록 자체 최대 높이 없앰. 3 'n/m' 은 고정 폭 버튼 안 |
| [minor] 1절·10절 단계 1·리허설 14 가 10번 미적용으로 적힘(이·기·구·법) | 1 '10번은 2026-11-24 운영에 적용됨', 10 단계 1 완료·단계 2 '한 거래' 선택지 지움, 11 리허설 14 는 같은 거래에서 10번 전 정의로 되돌린 뒤 실행(운영 md5 `be4403fd…` 다시 확인) |
| [minor] 14절·15-1 의 `credit-balance-updated` 옛 문장(법·구·화) | 14·15-1 문장 고침 |
| [minor] [다시 선택] 404 뒤 앞 요청이 늦게 끝나면 완료 창 없음, 영수증 잔액 필드(구) | 6-2 직전 키를 기억해 `CART_CHANGED`·`ALREADY_OWNED` 뒤 영수증 다시 조회, 잔액은 `data.balanceAfter`. 11 계약 |
| [minor] `CONFLICTING_SELECTION` 의 `itemIds` 가 자료 id 이고 이미 details 에 있음(구) | 6-2 문장 고침(자료 id 로 줄 맞춤). 11 계약 |
| [minor] `cartTexts` 에 보이지 않은 부분 보유 문장도 남음 — 읽는 법 없음(기) | 4-1·5-4 '읽는 법': 보였는지·체크했는지는 같은 키 `request_payload` 줄별 `ack`. 8 결제 내역도 같은 규칙 |
| [minor] 한 줄 칸에 LF 가 들어가 지문 구조가 모호(기) | 4-3 (S1) LF 금지(TS·SQL 식), 관리자 한 줄 입력. 11 잘못된 정책 모음 |
| [minor] ⑥ 충돌 뒤 replay 에 장바구니 지문 대조 빠짐(기) | 5-5 두 곳 모두 대조. 11 리허설 5 |
| [minor] 409 모양·`hasOwn` 표기·지문을 누가 계산하는지 어긋남(기) | 5-3 `error:{code,message}`, 11 `Object.hasOwn` 로 통일, 6-2 화면은 사본 값을 그대로 보냄 |
| [minor] 숫자 금지가 '12개월'·'한 달'·'이틀'을 통과(법·기) | 4-3 (c) 숫자 글자 전체 금지 + 한글 수·단위·낱말 금지, 시험 예시. 초안은 통과 |
| [minor] 결제 칸에 이용 기간(`downloadPeriodNotice`)이 없음(법) | 13 질문 4 에 한 문장 더함. 항목에 넣는 안은 0-6 기본값(초안 그대로)에 따라 지금 넣지 않고, 대표 확인 항목도 늘리지 않음 |
| [minor] 다시 적용 때 3인자 DROP·사전 검사가 멈춤(이) | 5-5 `to_regprocedure` 사전 검사, `DROP FUNCTION IF EXISTS`. 11 리허설 11 'down 없이 다시 실행' |
| [minor] 새 함수 기본 권한(anon·authenticated)이 VERIFY 로 확인되지 않음(이) | 5-5 VERIFY·down VERIFY 에 `proacl`·`has_function_privilege` 확인. 11 리허설 12 |
| [minor] 리허설 15 가 탈퇴 기록 검사에서 실패로 보일 수 있음(이) | 11 리허설 15 기대값을 '함수 md5 검사를 지남'으로, 뒤 검사에서 멈추는 것은 정상 |
| [minor] 단계 4~5 가 길어짐, 되돌린 뒤 다시 배포할 때 상세 문구(이) | 10 단계 4 허용 근거(출시 전), 되돌리기 ③ 에 다시 배포 때 `purchaseCompleteNotice` 다시 바꿈 |
| [minor] 코드를 되돌리면 2판 기록이 결제 내역 상세에 원문 그대로 보임(이) | 10 되돌리기 ③ 한 줄 |
| [minor] ACCESS EXCLUSIVE 가 '칸 추가 동안만'이라는 틀린 표현(이) | 5-5 거래 끝까지 유지·읽기도 막음, 짧게 둠 |
| [minor] 순서를 어겼을 때 충전 옛 화면은 닫히지 않고 409 가 되풀이됨(기) | 10 되돌리기 문장 고침 |
| [minor] 결제 내역의 link 항목이 지금 판 문서를 엶(기) | 8 '결제 당시 판과 다를 수 있어요' 표시. 당시 판 본문을 보일지는 변호사 답과 함께 정함 |
| [minor] 충전 [다시 불러오기]를 `router.refresh` 로 하면 첫 값 상태가 안 바뀜(화) | 8 `window.location.reload()`. 11 화면 '회복' |
| [minor] 세부 항목 창 [확인] 이름이 동의로 읽힘, '동의 전' 버튼 이름 없음(화) | 3 [닫기], 6-1 '필수 동의를 체크해 주세요'와 이름 순서, 상태 줄에도 이유. 11 계약 |
| [minor] 관리자 높이 경고 상태 미정·항목 이름 글자 수·카드 설명(화) | 9 재는 상태는 하나(부분 보유는 위 영역), 넘치면 저장 막음, 항목 이름 n/30, 카드 설명 고침 |


### 15-5. 5판 검증 반영(5회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[major]** 버튼 위 상태 줄·0건 안내가 아래 고정 영역 예산에 빠져, 첫 그리기부터 보통 흐름이 되고 관리자 저장도 늘 막힘(화·구) | (가)안. 6-1 아래 영역 요소를 다섯 가지로 못박고 '어느 상태에서도 높이 같음' 원칙. 상태 알림은 `sr-only` live 영역(높이 0), 0건 안내는 위 영역 알림 자리(3절도 고침), retryable·부족은 버튼 줄 안 두 버튼, 1판 링크 줄을 예산에 넣음. 여유를 늘리려고 구분·간격·버튼 줄 여백을 줄이고 1판 본문 상자를 96px 로: 2판 347+80=427(여유 27px), 1판 355+80=435(여유 19px). 9 관리자 검사는 16px 여유를 두고도 승인 초안 443≤454 로 통과. 11 계약(높이 불변·구조)·화면 관문 |
| **[major]** 서버 `includesPdf` 를 'PDF 포함 HWP'로 써서 DB 가 허용하는 조합을 막음(구) | 6-1 판정 식을 DB 6단계 식 하나로(같은 `itemId` 안 bundle+subproduct, 또는 question_pdf + question_hwp·`includesPdf`), 서버 값을 그대로 담고 'PDF 포함 HWP'로 쓰지 않음, 공용 함수. 11 DB 대조 예시 6개. 7 `market-bundle-savings.test.mjs` 83행 처리 |
| **[major]** 10번은 DB 만 적용됐는데 '완료'로 적힘, push 때 `51b7373` 이 섞여 나갈 위험(이) | 1·10 단계 1 을 사실대로(코드 `51b7373` push·배포 전), 10번 남은 순서(카카오 키 → 10번만 배포 → 같은 창 문구 스크립트 → 시험 계정)를 11번 단계 3 전 시작 조건으로. 단계 5 push 전 `git log origin/main..HEAD` 확인. 되돌리기 ③ 은 10번 코드 기준 |
| [minor] 요약 줄에 더 넣는 길이 사실상 막혀 있는데 설명이 다름, 숫자 금지의 한계(법) | 4-1 설명 고침(기존 줄을 줄이거나 높이 예산 코드 변경), 4-3 (c) 한계 한 줄, 13 질문 1 한 줄 |
| [minor] 13절 질문 4 의 화면 설명이 실제 배치와 다름(법) | 13 질문 4 를 실제 배치로(늘 보이는 아래 영역과 약 100px 위 영역, 낮은 화면은 보통 흐름 + 막대) |
| [minor] lg 보통 흐름에서 초점 대상이 머리글에 가림, 바닥글이 막대에 덮임(화) | 6-1 `scroll-mt-36`, `scrollIntoView` → `focus({preventScroll:true})`, 막대가 보일 수 있으면 바닥 여백. 11 화면 |
| [minor] 위 영역이 작아 합계가 가려짐, 스크롤 표시 없음(화) | 6-1 아래 영역 금액 줄을 '합계 N · 결제 후 잔액 M'으로, 위 영역 끝 옅은 그림자. 11 화면 |
| [minor] 관리자 미리보기 글꼴이 장바구니와 다름, OS 글꼴 차이(화) | 9 `.studio-theme` 으로 감쌈, 16px 여유, 넘친 쪽을 짚음. 11 Windows 에서도 관문 |
| [minor] [세부 항목] 버튼 이름에 진행이 없음, 제목 30자 근거('[필수]' 미포함)(화) | 3 접근 이름에 'm개 중 n개 동의', 4-3 (a) 제목 26자로 근거 고침 |
| [minor] 충전 결제 진행 중 2판 동의가 잠기지 않음(화) | 8 `isBusy` 동안 위·하위 체크 비활성. 11 계약 |
| [minor] [다시 선택] 뒤 결제를 누르지 않으면 영수증을 조회하지 않음, 잔액 기준 다름(구) | 6-2 기억한 줄 묶음이 다시 읽기에서 사라져도 조회, 잔액은 다시 읽은 뷰 값 우선(실패 때만 `balanceAfter`). 11 계약 |
| [minor] 410 본문 모양이 batch route 와 다름(구) | 7 `{success:false, error:{code,message}}`. 11 계약 |
| [minor] DB 의 장바구니 문구 검사가 형식만 봄(기) | 4-3 DB 도 장바구니 문구 규칙 전체(S1 포함)를 지킬 때만 문장·지문. 11 TS·SQL 함께 거절 |
| [minor] 지문은 같고 구조만 다른 정책 변경(기) | 6-3 지문 + 묶음 구조 비교로 동의 비움, 5-4 한계 한 줄 |
| [minor] SQL 배열 순서·trim·`note: null` 처리가 갈리기 쉬움(기) | 5-1 `WITH ORDINALITY … ORDER BY`, TS 는 원문에 trim 안 함, 4-3 (b)·5-1 키가 있는데 null 이면 거절. 5-2 자료 벡터에 앞뒤 공백·LF 로 끝나는 본문·note |
| [minor] 단계 6 여러 문장은 CLI 가 마지막 결과만 돌려줌(이) | 10 단계 6 을 `DO … RAISE EXCEPTION` 한 문장으로 |
| [minor] 다시 적용 때 충전 함수·내부 함수 사전 검사 값과 CREATE(이) | 5-5 표 바탕 값에 '바로 앞에 적용한 11번 md5', 사전 검사·VERIFY 역할 구분, 세 함수 `CREATE OR REPLACE`. 11 리허설 11 |
| [minor] 단계 6 뒤 문구가 바뀌어도 스크립트 B 가 통과(이) | 5-6 B 사전 검사를 단계 6 대조 값과 비교, 10 단계 6 부터 B 끝까지 저장 금지 |
| [minor] 옛 자료 폼은 version 대조가 없음(이) | 4-0 머리말 저장 금지로만 막음을 명시, 10 단계 5 배포 직후 상세 문구 다시 확인 |
| [minor] `NOTIFY pgrst`, 그대로 목록에 10번 탈퇴 함수 3개 빠짐(이) | 5-5 형식 목록·down 에 `NOTIFY pgrst, 'reload schema'`, 그대로 목록에 3개 함수 md5(2026-11-25 운영 값). 11 계약 |


### 15-6. 6판 검증 반영(6회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[major]** 2판 장바구니·충전 화면을 push 전에 localhost 에서 볼 수 없음(이) | (가)안. 10-1 개발 전용 2판 미리보기(`NODE_ENV≠production` + 관리자 + `?consentPreview=2`, 저장된 2판 키 또는 4절 초안 고정 값 파일로 서버 TS 가 묶음을 만듦, 결제 버튼과 checkout·충전 API 를 화면·서버 두 겹으로 막음). 10 단계 5 에 '미리보기로 11절 2판 관문 PASS(Windows 포함) → 대표 localhost 확인 → push', 단계 8 은 운영 재확인. 11 계약(운영 빌드에서 꺼짐, 미리보기 중 결제 API 를 부르지 않음·서버 403). (나)안(push 전 운영 판 전환)은 실회원이 있어 쓰지 않음 |
| **(전제 정정)** '출시 전·판매 꺼짐'이 아님 — 판매 스위치가 11-11 부터 켜져 있고 실회원 결제·구매가 있음(코디네이터 확인, 운영 읽기 조회로 다시 확인) | 1 '판매 상태' 항목. 상세 문구 `purchaseCompleteNotice` 를 스크립트 A 에서 빼고 배포 직후 관리자 화면에서 바꿈(4-1·5-6·7·10). 5-6 스크립트 B·되돌림 때 열린 실회원 화면 영향과 새벽 실행, 재동의 영향(11번은 재동의 없음, 10번 문구 스크립트는 대표가 재동의 대상 확인 뒤). 5-5·11 잠금 시간대(새벽, 짧게). 7 410 옛 탭 안내. 판매 켜짐/꺼짐에서 다른 점만 짧게 적음 |
| [minor] 결제 이름에서 부족이 충돌보다 앞(구) | 6-1 순서를 충돌 → 부족으로, 충돌이면 금액 줄에 '부족' 없음, 막대 초점 순서도 같게. 11 계약 |
| [minor] bundle-savings 시험 문장이 보유 PDF 숨김 호출까지 없앰(구) | 7 충돌 판정만 공용 함수로, `hasOwnedPdfInclusiveHwp` 호출은 남김, 83행 호출 수 2→1, import 단언 유지 |
| [minor] 새 결제 완료 창과 직전 키 영수증 200 이 겹침(구) | 6-2 덮어쓰지 않고 차례로 보임. 11 계약 |
| [minor] 다시 읽기 실패의 버튼 이름·[다시 불러오기] 위치(구) | 6-1 이름 '장바구니를 다시 불러와 주세요'·순서, 6-3 안내와 버튼은 위 영역 알림 자리. 11 높이 불변 상태에 더함 |
| [minor] 판 1 일 때 관리자 높이 검사 없음(구·화) | 9 그때 판의 모드로 잼(판 1 은 1판 부품, 여유 8px, 지문 문구 355+80+8=443 통과), 2판 키가 있으면 2판도 잼. 11 계약 |
| [minor] 410 옛 탭이 앞 요청 성공을 모름(구) | 7 message 끝 '이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.' 11 계약 |
| [minor] 동의 구조 비교에 요약 줄 수 없음(기) | 6-3 요약 줄 수 포함, 5-4 한계 문장 넓힘. 11 계약 예시(note 를 항목 이름으로) |
| [minor] 장바구니 문구 지문 trim 규칙·CR 공백(기) | 4-1 TS 는 trim 하지 않음, 4-3 (S)·장바구니 문구 공백 식에 CR. 11 앞뒤 공백 예시 |
| [minor] sticky 칸에서 `scrollIntoView` 가 위 영역 대상을 못 보임(화) | 6-1 scroll-margin 은 보통 흐름에서만, sticky 는 위 영역 `scrollTop` 직접 계산 + `focus({preventScroll:true})`. 11 화면 |
| [minor] lg 막대가 Tab 초점 줄을 가림(화) | 6-1 `html` 에 `scroll-pt-36`, 막대가 보이는 동안 `scroll-padding-bottom`. 11 키보드 |
| [minor] 금액 줄이 큰 수에서 두 줄로 접힘, 고지 없음 예외 미기재(화) | 6-1 금액 줄 `h-6 whitespace-nowrap text-sm tabular-nums`·단위 없음·`truncate`, 고지 없음 유일한 예외. 11 높이 불변(7자리) |
| [minor] sr-only 와 위 영역 알림이 같은 상태를 두 번 읽음(화) | 6-1 ⑤ 위 영역이 알리는 상태에서는 sr-only 비움. 11 계약 |
| [minor] 10번 상태 낡음(ahead 2, 카카오 키 등록 완료)(이) | 1·10 단계 1 고침(`51b7373`·`25f01b6`, 키 등록 완료), 단계 5 push 검사에 두 커밋 |
| [minor] build 가 판을 보는지 미정(이) | 5-5 build 는 `consentFormat` 을 보지 않음. 11 리허설 1 단언 |
| [minor] 첫 적용 전 리허설 11 의 사전 검사 값, down 사전 검사(이) | 5-5 사전 검사가 {바탕 값, 이 파일 새 md5, 앞 판 md5} 를 받음, down 은 11번 값일 때만. 11 리허설 11 |
| [minor] 5-5·11 에 옛 `BEGIN READ ONLY` 방식이 남음, `--read-only` 는 DO 를 거부(이) | 5-5·11 문장을 단계 6 의 `DO … RAISE EXCEPTION`(postgres, `--read-only` 없이)으로 |
| [minor] 그대로 목록 문장 위치, 충전 함수 인자 표기(이) | 5-5 문장을 세 함수 줄 아래로 옮김, '자료 4인자·충전 6인자'로 고침 |


### 15-7. 7판 검증 반영(7회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[major]** 미리보기가 첫 다시 읽기에서 1판으로 돌아가고, 결제 차단이 화면 상태·헤더에 기댐(화·구·이) | 10-1 표식은 `src/middleware.ts` 가 넣는 개발 전용 HttpOnly 쿠키. 페이지 첫 값과 `/api/market/cart` GET 이 같은 미리보기 뷰를 돌려줌(다시 읽어도 2판), `isConsentPreview` 는 페이지 수명 동안 고정. 서버 403 은 쿠키로 판정하고 본문 검사·`checkout_attempts` 조회·기존 주문 재사용·동의 기록보다 앞, 장바구니 쓰기 route 도 막음. 운영에서 꺼지는 근거를 `NODE_ENV` 와 `CONSENT_PREVIEW_ENABLED`(`.env.local` 전용)·`VERCEL` 없음으로 둘 더함, `allowDevelopmentBuild` 금지 |
| **[major]** 결제 응답·보유 상태가 있어야 생기는 관문을 미리보기로 만들 수 없음, 버튼 이름을 덮어씀(화·구·이) | 10-1 시험 뷰(`basic3`·`partial`·`insufficient`·`sevenDigits`·`long50`·`upgrade`·`conflict`·`empty`·`noticeMissing`, 메모리 고정 값·DB 쓰기 없음)와 응답 흉내(`priceChanged`·`ackRequired`·`insufficient402`·`retryable`·`submitting`·`reloadFailed`·`noticeChanged`·`noticeChangedTall`·`cartTextsChanged`·`conflicting422`·`receiptAfterReselect`, 충전 `v1to2`, 상세 `cartAddExisting`·`cartLimit`)를 fetch 없이 6-2 처리 함수에 넣음. 버튼 이름·버튼 줄은 6-1 그대로, 결제 실행만 막음. 11 화면 관문 항목마다 만드는 방법을 짝지음, '운영 DB 에 구매·DB 수정으로 상태를 만들지 않는다' 명시. 고정 값은 개발 분기에서 `fs` 로만 읽음(정적 import 금지). 11 계약: production 산출물에 분기 없음, 결제 route fetch 0회. 10 단계 5·8 고침 |
| [minor] 고정 값 대체가 계약과 부딪치고 깨진 키를 가림(화·이·구) | 10-1 자동 대체 없앰: 2판 키가 깨지면 고지 없음 + 띠 안내. 초안은 `&draft=1` 로만, 관문 PASS 아님 |
| [minor] 미리보기 띠 위치가 높이 예산을 흔듦(화) | 10-1 띠는 페이지 맨 위 보통 흐름, 관문은 목록을 내린 뒤 잼 |
| [minor] 문서 `scroll-padding` 과 대상 `scroll-margin` 이 겹침(화) | 6-1 대상별 `scroll-margin` 을 없애고 `html` 의 `scroll-padding` 만. 11 계약 문장 고침 |
| [minor] Windows 확인 때 LAN 주소 로그인이 운영 인증 설정에 걸림(화) | 10-1 VM 포트 전달로 `localhost:4000`, 또는 이메일 관리자 계정. 운영 Supabase 인증 설정은 바꾸지 않음 |
| [minor] lg 막대를 토스트가 덮음(화) | 6-1 장바구니에서 막대가 보이는 동안 토스트를 막대 위로. 11 화면 |
| [minor] 판 2 인 동안 1판 높이를 재지 않음(이) | 9 판과 관계없이 1판(여유 8px)을 늘 재고 2판 키가 있으면 2판(16px)도. 11 계약 |
| [minor] 단계 6 의 장바구니 지문이 기록 함수 식과 다름, 정책 md5 식 미정(이) | 5-5 새 내부 함수 `build_market_cart_texts` 를 기록 함수와 단계 6 이 함께 부름(권한·VERIFY·down 포함), 정책 md5 는 `md5(value::text)` 로 단계 6·스크립트 B 같게 |
| [minor] 옛 장바구니 retryable 탭이 배포 뒤 `CART_TEXTS_REQUIRED` 400 을 받아 완료를 모름(구) | 6-2 (가)안: 400 전에 영수증을 조회해 있으면 `alreadyCompleted` 성공. 11 계약 |


### 15-8. 8판 → 9판 단순화
| 바꾼 것 | 반영 위치 / 이유 |
|---|---|
| 8판의 개발 전용 미리보기(미들웨어 쿠키, 결제·충전·장바구니 쓰기 route 의 403 분기, `/api/market/cart` 미리보기 분기, 응답 흉내 주입, `.env.local` 플래그, 초안 `draft` 그리기)를 지우고 **개발 전용 결제 화면 모음 페이지 하나**로 바꿈 | 10-1 `src/app/dev/checkout-gallery/page.tsx`(production·`VERCEL` 이면 `notFound()`, 로그인 없음, 실데이터·운영 DB·API 를 부르지 않음), 상태별 고정 값으로 표시 부품을 그림. 이유: 실회원이 있는 지금 결제 경로 코드에 개발 편의 분기를 섞지 않는 쪽이 안전하고 단순하다 |
| 결제 칸·충전 동의 영역을 표시 부품과 껍데기로 나눔 | 6-0. 화면 모음은 표시 부품과 순수 함수만 써서 결제 요청 함수가 연결되지 않음 |
| 11절 화면 관문을 화면 모음 상태와 짝지음, 데이터 흐름은 계약·단위 시험으로 | 11 화면·계약(production notFound, `fetch`·supabase import 없음, 결제 route·미들웨어에 분기 없음, 고정 값 = 스크립트 A 값) |
| 단계 5·8 문장 | 10 단계 5(화면 모음으로 관문 PASS → 시험 PASS → 대표 확인 → push), 단계 8(운영 재확인) |
| 7회차 minor 반영분 | 그대로 유지(영수증 먼저 조회, `scroll-padding` 만, 토스트 위치, 관리자 1판·2판 높이 검사, `build_market_cart_texts`, `md5(value::text)`). Windows 확인은 로그인이 없어 포트 전달만으로 됨 |


### 15-9. 9판 검증 반영(8회차)
| 지적(관점) | 반영 위치 / 반영 안 함과 이유 |
|---|---|
| **[major]** 동의·부분 보유·줄 선택의 주인이 3절(부모)과 6-0·10-1(표시 부품 로컬)에서 어긋남(화·구) | 6-0 세 값은 제어 값(props), 주인은 껍데기. 표시 부품 안에는 창 열림·보기 펼침·선택 목록 펼치기·높이 재기·막대 보임만. 응답 뒤 화면 동작(`focusRequest`·`completedQueue`·`noticeSwapToken`·`consentResetToken`)을 props 로 정의하고 6-2 순수 함수 `reduceCheckoutResponse` 출력으로 넘김. 3절 문장 맞춤. 10-1 하네스가 state 를 들고 6-3 순수 함수로 비움. 11 계약(표시 부품에 해당 `useState` 없음, 스냅숏 ack 는 껍데기 state) |
| **[major]** 화면 모음이 `(solvook)` 레이아웃 밖이라 글꼴·머리글·바닥글이 실제와 다르고, 목록이 가짜(화·구·이) | 10-1 `src/app/(solvook)/dev/checkout-gallery/page.dev.tsx`(`.studio-theme`·Pretendard·머리글·바닥글을 받음), 레이아웃 읽기는 허용·화면 모음 쪽은 `fetch`·supabase 없음, 비로그인 창 권장, '운영 DB 에 쓰지 않고 결제·장바구니·충전 API 를 부르지 않음'으로 문장 고침. 6-0 `CartPageView`·`CartLineListView`·`ChargeCheckoutView` 를 껍데기와 화면 모음이 함께 씀('고정 값 줄을 넣은 실제 목록 부품'). 11 관문 짝짓기 다시, 계약(두 표시 부품 import, `(solvook)` 아래) |
| [minor] 껍데기에 개발 분기가 새는 것을 막는 계약 없음(구) | 11 껍데기 4개 파일에 `checkout-gallery`·`fixtures`·`bundle11-gallery` 글자 금지, `fixtures.ts` import 는 화면 모음 하나뿐 |
| [minor] 영수증 조회 실패·성공 모양 미정(구) | 6-2 조회 실패는 503 retryable, 성공은 지금 응답과 같은 모양(`data`·`alreadyCompleted`·잔액 필드). 11 계약 |
| [minor] '바뀌는 순간'(고지 교체·ACK_REQUIRED·완료 창 차례·토스트)을 화면 모음이 못 만듦, 토스트 위치 방법(화·구) | 10-1 하네스 버튼([고지 교체]·[ACK_REQUIRED 받기]·[다음 결과]·[토스트 띄우기] 등), 6-1 토스트는 `<html data-cart-bar>` + 전역 CSS 한 가지 방법. 11 짝짓기 |
| [minor] 목록 저장 중 이름 없음(화) | 6-1 '선택을 저장하고 있어요'와 이름 순서, 10-1 `saving-selection`, 11 높이 불변 |
| [minor] 360px 에서 retryable 두 버튼이 넘칠 수 있음(화) | 6-1 `min-w-0 flex-1`, 좁은 폭은 보이는 글 '다시 시도'(접근 이름은 전체). 11 좁은 폭 360 |
| [minor] 모두 가득 찬 CART_LIMIT 은 토스트로 끝남, 다시 담은 줄 선택 실패 문구(화) | 7 모두 가득 차도 결과 창, 선택 바꾸기는 담기 route 같은 요청 안에서 하고 실패한 줄은 다른 문구 |
| [minor] 문구 고정 값이 src 에 있어 하드코딩 시험과 부딪침(화·이) | 10-1 문구는 `tests/fixtures/bundle11-gallery` JSON 에만(`fs` 로 읽음), `fixtures.ts` 에는 가짜 값만. 11 하드코딩 시험 예외는 그 폴더 하나 |
| [minor] 운영 빌드에 화면 모음·고정 값이 들어감(이) | 10-1 `page.dev.tsx` + 개발 모드 전용 `pageExtensions`, `notFound()` 도 유지. 11 계약(산출물에 경로 없음) |
| [minor] '세 함수' 표현이 남음(이) | 5-5·5-6·11 을 '네 함수'로 |
| [minor] 리허설 0·1 에 충전 1판 분기가 없음(이) | 11 리허설 0·1 에 충전 1판 기록·replay·`PLAN_CHANGED`·`NOTICE_CHANGED` details |
| [minor] 단계 3 뒤 PostgREST 이름 호출 확인 없음(이) | 10 단계 3 쓰기 없는 확인(잘못된 입력 호출 → `NOTICE_INPUT_INVALID`+`consentFormat` null)과 30분 로그 확인, 문제면 바로 down |

**대표 확인**(2판에서 새로 생긴 것) — 2026-11-24 아래 기본값으로 진행한다. 문구는 대표가 '초안으로 넣고 나중에 클라이언트와 정해 관리자 화면에서 고친다'고 정했으므로(0-6) 따로 묻지 않는다. 나머지도 바꾸고 싶으면 구현 전에 알려 주면 된다.
- 1 → 초안 그대로 넣는다.
- 2 → 넣는다(`note`). 회원에게 유리한 정보이고 지금 정책 본문과 같다.
- 3 → 다시 담으면 선택으로 바꾼다.
- 4 → 넣지 않는다. 장바구니 결제 칸의 '선택한 자료' 목록이 결제 직전에 같은 것을 보여 준다.

1. [2판 고침] 표시 문구: 두 제목, 요약 줄(환불 기간·환불 제한·유효기간·미성년자), 충전 항목 3 '미성년자 결제 취소 안내'
2. 자료 요약에 '하자가 있거나 소개 내용과 다른 자료는 다운로드한 뒤에도 환불받을 수 있어요.' 줄(`note`)을 넣을지
3. 선택을 풀어 둔 자료를 다시 담으면 선택으로 바꿀지(제안: 바꾼다)
4. 담기 결과 창에 '장바구니에서 선택된 다른 자료와 함께 결제돼요' 같은 안내를 넣을지
