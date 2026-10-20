# 페이앱 전환 0단계 기준선 (2026-10-19)

[구현 계획](payapp-kakaopay-payment-implementation-plan.md) 10장 단계 0의 결과다. 이후 단계는 "이 기준선 대비 신규 실패 0"으로 검증한다.

## 1. 측정 방법과 결과

- 커밋: `e9cdd88` (작업 트리는 `.claude/settings.local.json`, `.playwright-mcp/`, `결제_페이앱/`만 미커밋)
- 테스트: `node --test --test-reporter=tap tests/*.test.mjs`
  - 1169개: 통과 1111, 실패 48, 건너뜀 10 (환경변수가 필요한 통합·live 테스트)
  - 두 번 실행해 실패 목록이 글자까지 같았다(불안정한 테스트 없음).
- 타입 검사: `npx tsc --noEmit` 오류 0건
- 비교 방법: 각 단계 뒤 같은 명령의 `not ok` 이름 목록(`grep -E '^not ok' | sed 's/^not ok [0-9]* - //' | sort`)을 [`payapp-phase0-baseline-fails.txt`](payapp-phase0-baseline-fails.txt)와 `diff`한다. 아래에 없는 실패가 생기면 그 단계의 회귀다. 아래 목록에서 사라진 실패는 그 단계가 고친 것인지 확인해 기록한다.

## 2. 결제와 관련된 기존 실패 (6건, 페이앱 작업 전부터 실패)

| 테스트 | 실패 이유 | 처리 단계 |
|---|---|---|
| `mypage-payments-page.test.mjs` "excludes zero-won and planless credit records" | 결제내역 페이지에 `.gt('amount', 0)` 쿼리가 없음. 페이지는 이미 `get_my_payment_history` RPC(`page.tsx:28`)를 써서 테스트가 낡았다 | 5단계: `get_my_payment_history` RPC 호출 기준 단언으로 교체(0원·플랜 없는 기록 제외는 RPC 쪽 계약 테스트로 확인) |
| `payment-order-contract.test.mjs` "checkout uses only the prepared server order" | 결제 화면이 `fetch('/api/payments/orders'` 형태가 아님(`checkout-client.tsx:416-418`은 endpoint 변수로 `fetch`) | 5단계: 결제 화면을 다시 쓰면서 페이앱·카카오 주문 API 기준으로 교체 |
| `point-charge-compliance-ui-contract.test.mjs` "checkout shows the restrictions before payment" | 결제 화면에 "자동결제 없음" 문구 없음 | 5단계 결제 화면 교체 때 안내 문구 기준으로 다시 맞춤 |
| `point-charge-compliance-ui-contract.test.mjs` "admin refund view exposes provider completion and retry evidence" | `/Toss 취소 거래키/` 기대(아래 3장 충돌 테스트) | 6단계 |
| `point-charge-operations-contract.test.mjs` "keeps payments fail-closed until external gates pass" | 운영 런북에 `PAYMENTS_ENABLED=false` 문구 없음 | 6단계 토스 문서 정리 때 페이앱 런북 기준으로 교체 |
| `pricing-refund-summary.test.mjs` "highlights current credit refund rules" | 가격 페이지에 "AI 생성" 문구 없음 | 결제 전환과 무관한 문구 테스트. 이번 범위에서 고치지 않음 |

- 5단계(2026-10-20)에서 위 표의 앞 3건(결제내역 RPC 기준 단언, 결제 화면 주문 API 기준, 결제 전 안내 문구)을 새 화면 기준으로 교체해 해결했다. [`payapp-phase0-baseline-fails.txt`](payapp-phase0-baseline-fails.txt)에서 지웠다(남은 실패 45건).
- 6단계(2026-10-20)에서 토스 운영 문서 단언을 페이앱 계획·체크리스트·약관 기본값 기준으로, 관리자 환불 화면의 `Toss 취소 거래키` 단언을 `취소 거래키`로 바꿔 2건을 더 해결했다(남은 실패 43건, 모두 결제와 무관).

## 3. 서로 반대인 테스트 2개 정리 방침

- `point-charge-compliance-ui-contract.test.mjs:89`는 관리자 환불 화면에 `Toss 취소 거래키`가 **있기를**, `provider-refund-processing-contract.test.mjs:105`는 **없기를** 기대한다. 지금 화면(`refunds-client.tsx:305`)은 결제사 구분 없는 "취소 거래키"를 쓰므로 앞쪽이 실패한다.
- 방침: 6단계에서 앞쪽 기대를 `/취소 거래키/`로 바꾸고, 뒤쪽의 `Toss` 부재 확인은 유지한다.
- 뒤쪽 106–107줄의 `/일반결제/` 기대(`refunds-client.tsx:116`의 `'카카오페이' : '일반결제'`)는 6단계에서 결제수단 라벨 표시 기준으로 바꾼다. 관리자 환불 조회가 라벨을 받는 경로는 6단계 구현 때 정한다. 이력 라벨 "일반결제(이전)" 문자열 때문에 우연히 통과하지 않도록, 새 기대는 라벨을 `payment_method_label`(또는 `payment_methods.label`)에서 읽는 코드 형태를 단언한다.

## 4. 토스를 읽는 테스트 목록 (고정)

다음 세 가지 검색 결과를 합친 16개다.
- `grep -il toss tests/*.mjs tests/helpers/* tests/fixtures/*` (14개)
- `grep -rln "토스" tests` (`footer-content.test.mjs`)
- 토스 파일 경로를 직접 읽는 테스트: `api/payments/orders/route`, `api/payments/confirm`, `checkout/success`, `checkout/fail`, `webhooks/toss`, `toss-payments-server`, `tosspayments-` 문서 (`admin-phase1a-contract.test.mjs`)

**교체 시점 규칙:** 단언은 그것이 읽는 파일을 바꾸는 단계에서 교체한다. 그래서 각 단계의 "기준선 대비 신규 실패 0" 검증과 충돌하지 않는다.
- 5단계(결제 화면·결제내역): `checkout-client.tsx`, `checkout/page.tsx`, `payments-view.tsx`·`payment-list.tsx`, `src/lib/payment-history.ts`를 읽는 단언(`payment-history-filter`는 `'toss'`를 입력값으로만 써서 깨지지 않으면 6단계에 입력값만 교체). 대상은 `checkout-payment-methods-contract`(`:24` `/api/payments/orders`, `:31` `TabsList`, `:32` `일반결제`, `:37` `selectedProvider === 'toss'` 등), `point-charge-compliance-ui-contract`의 결제 화면·결제내역 부분, `payment-order-contract`의 "checkout uses only the prepared server order", `payment-history-filter`.
- 6단계(토스 제거): 그 밖의 전부. 토스 파일 삭제, 관리자 환불 라벨, `footer-content.ts` 기본값, 약관 페이지, 토스 문서.
- 1·4단계에서 DB·대사·환불 파일을 바꿀 때 토스 단언이 같이 깨지면, 그 단계에서 토스 분기를 남긴 채 통과하도록 둔다(토스 분기 제거는 6단계).

| 테스트 | 근거 |
|---|---|
| `checkout-payment-methods-contract.test.mjs` | 토스 문자열 + 경로 |
| `credit-mutation-snapshot-contract.test.mjs` | 토스 문자열 + 경로 |
| `credit-source-category.test.mjs` | 토스 문자열 |
| `payment-confirm-contract.test.mjs` | 토스 문자열 + 경로 |
| `payment-history-filter.test.mjs` | 토스 문자열 |
| `payment-order-contract.test.mjs` | 토스 문자열 + 경로 |
| `payment-provider-policy-contract.test.mjs` | 토스 문자열 + 경로 |
| `payment-provider-schema-contract.test.mjs` | 토스 문자열 + 경로 |
| `payment-reconciliation-contract.test.mjs` | 토스 문자열 + 경로 |
| `point-charge-compliance-ui-contract.test.mjs` | 토스 문자열 |
| `point-charge-operations-contract.test.mjs` | 토스 문자열 + 경로 |
| `provider-reconciliation-scheduler-contract.test.mjs` | 토스 문자열 + 경로 |
| `provider-refund-processing-contract.test.mjs` | 토스 문자열 + 경로 |
| `toss-refund-workflow-contract.test.mjs` | 토스 문자열 |
| `footer-content.test.mjs` | 한글 "토스페이먼츠": `:82`(개인정보 처리위탁), `:111`(환불정책). `src/lib/footer-content.ts:178,230,241`의 기본값을 읽는다. 6단계에서 기본값을 페이앱·카카오페이 문구로 바꿀 때 함께 교체 |
| `admin-phase1a-contract.test.mjs` | 경로만: U2 테스트가 `src/app/checkout/success/page.tsx`를 읽는다. 6단계에서 이 파일을 지우면 페이앱 결과 화면(`/checkout/payapp/result`) 기준으로 바꾼다 |

계획서 7장의 예상 목록과 다른 점: 예상 목록에 없던 `footer-content.test.mjs`, `admin-phase1a-contract.test.mjs`가 추가됐다. 나머지 14개는 예상과 같다.

## 5. 전체 기존 실패 목록 (48건, 파일별)

- `admin-problem-type-sort-order-contract.test.mjs` (파일 단위 실패로 집계)
- `admin-product-year-options-contract.test.mjs` (1)
  - admin market product price fields display comma-formatted credit values and save numeric values
- `ai-question-generation-review-flow-contract.test.mjs` (1)
  - questions generate route delegates generation to bounded review loop and keeps public trace hidden
- `exam-paper-browser-pdf-viewer.test.mjs` (1)
  - two-column PDF preview divider fills page body above the page footer in Chromium
- `exam-paper-exam-with-answers-separated.test.mjs` (1)
  - measured two-column exam-with-answers final HTML renders answer section after all questions
- `exam-paper-two-column-line-measurement.test.mjs` (6)
  - measurement body renders as multiple visual lines in Chromium before pagination splitting
  - buildMeasuredTwoColumnPreviewPages splits measured body into line chunks in Chromium runtime
  - production measured preview groups adjacent body line chunks into one visual flow block per column segment
  - production measured preview preserves authored line breaks and underline spans when regrouping measured body lines
  - measured supplemental body dividers continue across column breaks without duplicated full separators
  - measured two-column pagination does not leave a weak body word alone at a column break
- `exam-paper-two-column-parity.test.mjs` (2)
  - buildExamPaperPrintHtml routes 2-column preview through chunk-based question markup
  - buildExamPaperPrintHtml reserves chunk-aware pagination for 2-column preview pages
- `exam-paper-two-column-reproduction.test.mjs` (8)
  - answer-only double preview should not over-fragment a single long explanation
  - answer-only double preview should not leave large non-terminal blank areas for the underfill fixture
  - exam-only double preview should keep segmentation bounded for the segmentation fixture
  - answer-only double preview should not leave a large final-page bottom gap
  - exam-with-answers double preview should not leave a screenshot-like first-page bottom gap
  - exam-with-answers double preview places realistic answers after all question chunks without overflow
  - exam-with-answers double preview keeps the screenshot-like real fixture pair separated without overflow
  - measured two-column preview should use rendered DOM heights before final pagination
- `exam-paper-two-column-underfill.test.mjs` (1)
  - realistic exam-with-answers two-column pages stay dense instead of orphaning a short answer on a sparse next page
- `generate-listboard-board-ui-contract.test.mjs` (1)
  - generate listboard pagination follows market listboard pagination layout
- `main-ad-carousel-contract.test.mjs` (1)
  - preview page always renders one subject-aware carousel shell and all lower sections
- `market-home-browser.test.mjs` (1)
  - english and korean share one subject-aware preview composition
- `market-home-ui-contract.test.mjs` (1)
  - preview renders database category board navigation beside the ad carousel
- `market-sample-preview-sticky-header-contract.test.mjs` (1)
  - market sample preview keeps the header fixed while sample pages scroll
- `mypage-payments-page.test.mjs` (1)
  - mypage payments query excludes zero-won and planless credit records
- `payment-order-contract.test.mjs` (1)
  - checkout uses only the prepared server order
- `point-charge-compliance-ui-contract.test.mjs` (2)
  - checkout shows the restrictions before payment
  - admin refund view exposes provider completion and retry evidence
- `point-charge-operations-contract.test.mjs` (1)
  - operations runbook keeps payments fail-closed until external gates pass
- `pricing-refund-summary.test.mjs` (1)
  - pricing page refund summary highlights current credit refund rules
- `question-bank-admin-question-list-contract.test.mjs` (5)
  - admin questions API delegates list retrieval to admin_list_bank_questions RPC
  - admin questions API forwards bank filters, type, subject, and pagination args
  - admin questions API recovers total_count for empty out-of-range RPC pages via minimal fallback RPC
  - questions client renders year/book filters, sends params, and resets pagination on filter changes
  - questions client search submit only resets page and lets effect fetch with fresh state
- `question-bank-is-admin-prerequisite-contract.test.mjs` (1)
  - all public.is_admin admin policies are either authenticated or remediated
- `solvook-preview-flow-contract.test.mjs` (4)
  - the preview layout and shared preview header and footer exist
  - the shared preview chrome opts into the reference gutter without changing board content gutters
  - preview source has no direct Supabase, purchase, credit, or route API dependency
  - normal and preview shells each have exactly one main owner
- `solvook-preview-original-visual-contract.test.mjs` (2)
  - preview keeps the original chrome and section visual grammar
  - preview injects real subject market data without sample home imports
- `solvook-real-market-board-ui-contract.test.mjs` (1)
  - board category sidebar delegates the same transparent menu used by the home page
- `studio-adoption-contract.test.mjs` (2)
  - the preview-token RED baseline is locked to the planned sixteen-file scope
  - the Solvook layout uses the Studio theme without inline preview tokens
