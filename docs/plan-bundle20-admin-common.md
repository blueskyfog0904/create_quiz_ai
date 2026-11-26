# 20번 묶음 계획 · 관리자 공통 틀(회원 화면 색·촘촘한 표·숫자와 상태 색·공통 확인 창·저장 바·필터 줄)

작성일: 2026-11-26
판: 4 (검증 PASS, 2026-11-26) — PASS 뒤 minor 3개를 같은 판에서 반영함(17절, 문단 끝 `(PASS 뒤)`)
- 3판은 화면 PASS, refactor FAIL(major 1: 폼이 여럿인 주소에서 이탈 경고 훅이 여러 개 걸림)이었다. 반영은 16절 표, 고친 곳은 `(4판)`.
- 2판은 refactor·화면 두 관점 모두 major 1개(같은 지적: 이탈 경고 훅이 두 번 걸림)로 FAIL 이었다. 반영은 15절 표, 고친 곳은 `(3판)`.
- 1판은 refactor·화면 두 관점 모두 FAIL(major 10, 겹친 것을 합치면 8)이었다. 반영은 14절 표에 있고, 고친 문단 끝에 `(2판)` 을 붙였다.
- 작업 순서표 6단계 20번 '관리자 공통 틀'을 만든다.
- 출처: `docs/admin-ux-improvement-plan.md` 2절 원칙 3~10·12, 1차-나(F-03·F-04·F-05·F-06·F-07·F-09·F-10·F-11·F-12), 8절 대표 결정(2026-11-20). 어긋나면 이 문서가 우선한다.
- 이 묶음은 **고치는 일(리팩터링)** 이다. 동작(부르는 API·쿼리·서버 가드·저장 순서·작업 기록·주소 키)은 바꾸지 않고 보이는 틀만 바꾼다.
  - 예외: 브라우저 기본 확인·알림 창을 공통 창·알림으로 바꾸는 것(Q3). 이탈 경고는 예외의 예외로 기본 창을 남긴다(5-3). (2판)
- 21·22·23번이 이 부품을 쓴다. 0단계(부품)는 그 셋보다 먼저 들어가야 한다.

## 0. 대표 결정과 질문
**이미 정해진 것(2026-11-20)**
1. 사이드바(F-01·F-02)는 B안으로 끝났다(e761d8e). 구조는 건드리지 않는다.
2. 1차-가(상품 공개 실수 막기)는 상품 재정리 때 처리한다.
3. 테스트 계정은 출시 전에 지운다. '집계 제외' 표시는 만들지 않는다.

**질문** — 답이 오기 전에는 기본안으로 진행한다.

Q1. 강조색
- 기본안: **회원 화면 보라(`--studio-primary`) 하나.** 주황(`adminAction`)·남색·파랑 강조는 켜진 화면에서 없앤다.
- 위험 동작(삭제·회수·판매 중지) 버튼만 빨강: 새 버튼 변형 `adminDanger`(바탕 `--admin-tone-danger-solid`, 흰 글자 4.5:1 이상). (2판·4판)

Q2. 표 밀도
- 기본안: 넓은 화면에서 행 40px(조밀 32px)·글자 13px·머리 고정. 카드형 목록(회원·문의)은 표로.
- 375px 에서는 누르기 크기 44px 를 지킨다(행 안 버튼 규칙은 5-2). (2판)

Q3. 브라우저 기본 창
- 기본안: `confirm(`(window 유무 무관)·`alert(` 을 켜진 운영 화면에서 모두 없앤다. 확인은 공통 확인 창, 알림은 화면 알림(`sonner` toast) 또는 `AdminNotice`. (2판)
- **이탈 경고는 기본 창을 남긴다**: 링크 이동을 막는 click 가로채기는 그 자리에서 막을지 정해야 하고, 창 닫기(beforeunload)는 브라우저 창만 띄울 수 있다(5-3). (2판)

Q4. 저장 바·이탈 경고
- 기본안(4판): **저장 상태 표시**는 입력 화면 전부. 나누는 기준은 **저장 함수(저장 버튼) 수**다(PASS 뒤): 저장 함수가 하나인 주소는 아래 고정 저장 바, **둘 이상인 주소(`/admin/footer` 폼 6개, `/admin/pricing` 3개, `/admin/menu-management` 저장 2개 — `handleSaveAll`·`handleSaveAdminSidebar`)는 고정 바 없이 저장 영역마다 인라인 저장 상태 줄**. 저장 함수 둘을 한 버튼으로 묶지 않는다.
- **이탈 경고는 지금 훅이 있는 곳만 유지하고 새로 걸지 않는다**: `footer/purchase-policy-form.tsx`, `menu-management-client.tsx`(OR 1개), `review-tags-client.tsx`. 규칙은 **한 주소에 이탈 경고 훅은 최대 1개**. 저장 바는 훅을 부르지 않고 표시만 한다. 기존 시험 3곳은 그대로 통과한다.
- 다른 입력 화면에 이탈 경고를 새로 거는 것은 동작 변경이라 이 묶음에서 하지 않는다(12절 4).
- 단축키 저장(Ctrl/Cmd+S)은 넣지 않는다(F-03 보류 그대로).

Q5. 필터 값을 주소에 남김
- 기본안: 남긴다. **주소 키 이름은 화면의 지금 이름 그대로**(q·tab·ticket·page 등). 다른 화면에서 들어오는 링크가 깨지지 않게. (2판)

Q6. 감소 숫자의 색 (2판 새 질문)
- 기본안: 크레딧 장부의 평범한 사용 차감은 **기본 글자색 + '−' 부호**. 빨강은 실패·거부·회수에만.
- 지난 기간 대비 증감(대시보드)은 ▲▼ 기호 + 초록/빨강 글자(21번과 같은 규칙).
- 이유: UX 계획 원칙 5('−빨강')대로 하면 사용 내역이 전부 빨강으로 보여 실패와 구분이 안 된다.

Q7. 화면 비교
- 기본안: 바꾸기 전·후를 같은 크기로 찍어 나란히 본다(6-3). 쓰기 요청을 막은 자동 스크립트로 찍고, 회원 개인정보 칸은 가린다. 사진은 저장소에 넣지 않는다. (2판)

## 1. 지금 상태(코드 확인, 2026-11-26)
- **화면 수**: 관리자 `page.tsx` 46개.
  - 운영 DB `admin_disabled_features` = question_bank, ai_generation, generate, passages, source_configs, labels, signup_roles, landing_pages. 이 묶음은 **켜진 화면만** 다룬다.
  - `/admin/menu-management` 는 **켜져 있다**(대표 전용). (2판)
- **틀**: `src/app/(admin)/admin/layout.tsx` 가 `bg-gray-50`·사이드바·여백(`p-6 md:p-8`)을 정한다. 제목줄은 화면마다 따로 그린다.
- **색**
  - `src/styles/studio-tokens.css`(`:root`)의 상태 관련 변수는 `--studio-success: #63cdb7`(흰 바탕 대비 약 1.9:1), `--studio-bonus: #3d9a6c`(약 3.5:1), `--studio-highlight` 뿐이다. info·warning·danger 토큰이 없다. (2판)
  - 빨강 버튼 `destructive` 는 `globals.css:78` `#EF4444` 위 흰 글자(약 3.8:1). (2판)
  - `button.tsx` 의 `adminAction` 은 주황, `brand`·`brandOutline`·`brandGhost` 는 보라이며 셋 다 `min-h-11 min-w-11` 이라 `size="sm"` 을 줘도 44px 다. 지금 표 안 버튼은 `size="sm" variant="adminAction"`(예: `orders-client.tsx:210`). (2판)
  - `adminAction` 은 꺼진 기능 파일(problem-types·ai-connections·question-bank·generate·passages·landing-pages·questions 등)에서도 쓰인다. (2판)
- **확인·알림 창**
  - `confirm(` 23곳(15파일). `window.` 없이 쓴 곳도 있다(`admin-accounts-client.tsx:123,145`, `support-client.tsx:322`, `reviews-admin-client.tsx:70` 등). (2판)
  - **서버 응답 뒤에 묻는 확인 3곳**(부족분 → 확인 → 다시 보내기): `orders/market-exception-refund-dialog.tsx:127-133`, `refunds/market-refunds-client.tsx:150-160`(`submitOwnerSettle`), `:191-198`(`processRefund`). 모두 try/finally 안에서 동기로 묻고 finally 가 잠금을 푼다. (2판)
  - `alert(` 도 켜진 화면에 있다: `admin-accounts-client.tsx`, `admin-permissions-dialog.tsx:122`, `review-tags-client.tsx`, `reviews-admin-client.tsx`, `market-category-tree-editor.tsx`, `admin-sidebar-client.tsx:62`. (2판)
  - 공통 창 부품이 **이미 있다**: `src/components/design-system/studio-dialog.tsx` 의 `StudioAlertDialog`(브라우저 alert/confirm 대신, X 없음, 취소 → 확정, `pending` 동안 닫힘 막기, `destructive`). 관리자 `footer/notice-popup-admin.tsx:301` 이 쓴다. 폭은 `sm:max-w-[400px]`. (2판)
- **이탈 경고가 이미 있다** (2판)
  - `src/hooks/use-unsaved-changes-guard.ts`: `useUnsavedChangesGuard(hasUnsavedChanges, message)`(beforeunload + 링크 click 가로채기, `window.confirm`)와 전역 카운터 `confirmLeaveIfUnsaved()`.
  - 쓰는 곳: `footer/purchase-policy-form.tsx`, `review-tags/review-tags-client.tsx`, `menu-management/menu-management-client.tsx`, `components/layout/admin-workspace-switcher.tsx`, `components/admin/admin-alert-context.tsx`.
  - 시험 `admin-unsaved-draft-preservation-contract.test.mjs:29,62`, `market-purchase-notice-contract.test.mjs:206` 이 호출 모양을 단언한다.
- **표기**: `toLocaleString` 109곳, 날짜는 `src/lib/kst-date-format.ts` 와 화면별 표기가 섞여 있다. 목록 주소 고치기는 `src/lib/list-pagination.ts` 의 `updateListQuery`.
- **상태 이름**: `src/lib/admin-orders.ts` 에 표가 모여 있다. 색은 화면마다 따로다(`support-client.tsx:92` `statusConfig` 의 '고객삭제'는 빨강 굵게 등).
- **다른 묶음이 고치는 화면** (2판)
  - 12번: 코드 커밋 cbe27ee(DB 미적용) — 회원 목록·상세, 문의.
  - 13번(계획 확정): `/admin/support`, `/admin/refunds`, `/admin/users`·상세, `/admin/credits`(목록 열람 기록·지급 창 회원 찾기 route), `/admin/orders`, `/admin/reviews`(열람 기록), `/admin/audit-log`('개인정보 열람' 탭), 대시보드.
  - 14번(확정): `/admin/footer`(`signup-consent-admin.tsx` 문구), 새 `/admin/notices`·`/admin/faq`. 16번(확정): 새 `/admin/notifications`.
  - 17번(PASS)·18·19번(2판 작업 중): 상품 화면.

## 2. 목표
1. 켜진 관리자 화면이 회원 화면과 같은 색·둥글기·팝업 틀을 쓰고, 강조색은 보라 하나다.
2. 모든 운영 화면이 같은 뼈대(제목줄 → 안내 띠 → 필터 줄 → 본문 → 저장 바/쪽 넘김)를 쓴다.
3. 금액·크레딧·날짜·증감 표기가 한 함수에서 나온다. 세지 못한 값은 '확인 불가', 값이 없으면 '–'.
4. 같은 상태는 어느 화면에서나 같은 색이다. 대응은 한 파일(5-1 표)에만 있다.
5. 켜진 화면에 `confirm(`·`alert(` 이 0곳이다. **이탈 경고 훅 안의 기본 창은 예외**(사유: 동기 판단 필요). (2판)
6. 입력 화면은 저장 상태를 늘 보인다(폼 하나 = 아래 고정 바, 폼 여럿 = 카드별 인라인 줄). 이탈 경고는 지금 있는 3곳 그대로. (4판)
7. 목록 화면의 필터는 한 줄이고 주소에 남는다(키 이름 그대로).
8. **동작은 그대로다**(6-2 대조 항목 전부 같음).

## 3. 원칙
- **부품은 그리기만 한다.** 부품 안에서 fetch·서버 액션·권한 판정을 하지 않는다. 막는 것은 서버 가드와 RLS 다.
- **한 화면 = 한 커밋.** 부품 교체와 다른 수정을 섞지 않는다.
- **코드에는 규칙만.** 상태 → 색, 표기, 크기는 코드. 화면 제목·메뉴 이름은 지금처럼 DB(`admin_sidebar_navigation`). 새 문구 데이터는 만들지 않는다.
- **운영 DB 한 개.** localhost 확인은 읽기만. 자동 스크립트는 쓰기 요청을 막는다(6-3). (2판)
- **열람 기록(13번).** 13번 배포 뒤 회원 이메일이 보이는 화면을 열면 기록이 쌓인다. 화면 비교로 여는 것도 기록된다. 대표에게 미리 알린다.

## 4. DB 변경
없다.

## 5. 부품(0단계, `src/components/admin/kit/`)
### 5-1. 색·표기 규칙
- **tone 토큰** (2판): `studio-tokens.css` 에 `--admin-tone-{neutral,info,success,warning,danger}-{text,soft,border}` 를 더한다.
  - 각 `text` 는 자기 `soft` 바탕과 흰 바탕 모두에서 4.5:1 이상.
  - 위험 버튼 바탕 전용 `--admin-tone-danger-solid` 를 따로 둔다. 흰 글자(#fff) 대 이 값이 4.5:1 이상. (4판)
  - 회원 화면의 `--studio-*` 값은 바꾸지 않는다. 부품·`formatSignedCredits` 는 이 토큰만 쓴다.
- **표기 `src/lib/admin-format.ts`(순수)**: `formatWon`("9,900원"), `formatCredits`("3,000 C"), `formatSignedCredits`, `formatKstShort`("11-19 10:44"), `formatKstFull`, `formatCount`, `formatDelta`(앞 기간 0 이면 "이전 0 → 신규"). 시간대 `Asia/Seoul` 고정.
- **상태 색 `src/lib/admin-status-tone.ts`(순수)** — 첫 표(대표 확인 대상) (2판)

| 종류 | neutral(회색) | info(파랑) | success(초록) | warning(호박) | danger(빨강) |
|---|---|---|---|---|---|
| 충전 주문 | 만료 | 결제 준비 중·결제창 확인 중·결제 대기·승인 확인 중·지급 대기·취소 처리 중, **환불 완료** | 결제 완료 | 수동 확인 필요 | 결제 실패 |
| 충전 환불 요청 | — | 처리중, **환불 완료** | — | 대기중·재처리 필요·수동 확인 필요 | 거부 |
| 크레딧 출처 | 환불됨 | 환불 진행 중 | 사용 가능 | — | — |
| 자료 구매 주문 | — | **환불 완료** | 구매 완료 | — | 회수됨·구매 실패 |
| 자료 환불 요청 | 요청 취소 | — | 승인 | 대기중 | 거부·처리 실패 |
| 자료 권한 | — | 환불로 회수 | 사용 가능 | — | 회수됨 |
| 상품 | 임시저장·보관 | — | 공개 | 숨김 | — |
| 문의 | 종료 | 처리 중 | 해결됨 | 대기 중 | 고객삭제 |
| 회원(12번) | 탈퇴·정지 해제됨 | — | 정상 | — | 이용 정지(범위 이름은 12번 표시 그대로) |
| 배너(22번) | 꺼짐·종료 | 예약 | 노출 중 | — | — |

  - '환불 완료'는 어느 표에서나 info 하나다. 회원 정지 표시는 12번 코드(`src/lib/member-suspension.ts`·회원 목록 배지)가 쓰는 값·이름을 그대로 받아 이 표에 대응만 시킨다(구현 때 값 목록을 맞춤).
  - 표에 없는 값이 생기면 시험이 실패한다(9절).

### 5-2. 그리기 부품 (21·22번 요구를 0단계에 넣음, 2판)
- `AdminPageHeader`: 제목(DB 메뉴 이름)·한 줄 설명·**오른쪽 도구 칸(여러 개: 과목 전환·기간·새로고침·주요 버튼 1개)**·아래 보조 줄(갱신 시각·'한국 시간 기준'). 과목 전용 화면은 도구 칸에 **과목 전환기**, 공통 화면은 과목 표시 없음(대시보드의 [전체·국어·영어]는 필터).
- `AdminStatusBadge`: 이름(지금 `labelOf`) + tone. 글자 항상 있음.
- `AdminNotice`: 정보·주의·오류 띠. 오류는 무엇을 못 읽었는지 + [다시 시도]. alert 를 대신할 때도 쓴다.
- `AdminDataTable`: 숫자 열 오른쪽 정렬·`tabular-nums`. 쪽 나눔·정렬은 화면 방식 그대로 받는다.
  - **넓이 규칙**(4판): `xl`(1280px) 이상은 페이지 스크롤 + 머리 고정(가로 넘침 틀 없음 — 기존 `ui/table.tsx` 의 `overflow-auto` 틀 안에서는 sticky 가 페이지 기준으로 붙지 않음). `xl` 미만(사이드바 w-64 + 여백을 빼면 본문이 좁음)은 표 영역 안에서만 가로 스크롤, 머리 고정 없음, 첫 열 고정. 본문 감싸기 = `layout.tsx:30` 의 `max-md:min-w-0` 를 `min-w-0` 로 바꾼다(사이드바와 같은 flex 줄이라 이것이 없으면 부품 안 스크롤이 먹지 않음). 이 한 줄은 **1단계 시범 커밋**에 넣고, 그 커밋에서 표가 있는 화면 전부를 1024×768 로 비교한다(넘치던 화면이 표 안 스크롤로 바뀌는 것만 달라져야 함).
  - `xl` 이상 대비: 표의 최소 폭은 960px(1280 − 사이드바 256 − 여백 64) 이하로 정한다. 그보다 넓은 표는 `xl` 이상에서도 표 안 가로 스크롤(머리 고정 없음). (PASS 뒤)
  - **선택·일괄 줄은 0단계에 넣지 않는다**(쓰는 화면이 없음, 일괄 작업 C-06 묶음에서 더함). (3판)
- **표 안 버튼**: 새 버튼 변형 `adminTable`(보라 테두리, `md:` 이상 높이 32px, 그 아래 44px). 켜진 화면의 `adminAction` 은 이것 또는 `brandOutline` 으로 바꾼다.
- `AdminTableState`: 불러오는 중·비어 있음(이유 + 다음 행동)·실패(빨강 + 다시 시도). 모양이 서로 달라야 한다.
- `AdminFilterBar` + `useAdminFilterParams`: 검색 → 선택 필터 → 기간, 오른쪽 '결과 n건'·[초기화]. **키 이름은 화면이 주는 목록 그대로, 주소 고치기는 `updateListQuery` 규칙 그대로**, 값 정규화는 화면의 지금 함수.
- `AdminMetricCard`: 누를 수 있는 형태(`button` + `aria-pressed`, 선택 표시), 1~4장 반응형 격자(권한 없는 카드는 빠짐).
  - 속성(3판): 제목, 큰 값(따로 '확인 불가' 가능), 증감 줄(`formatDelta` 결과 + ▲▼ + tone, 비교 범위 글, **큰 값과 따로 '확인 불가'**), 보조 줄, 설명 말풍선(선택, 키보드로 열림).
  - 구조(4판): 카드 바깥은 `div`. 누르는 영역(제목·큰 값·증감 줄)만 `button aria-pressed`. 말풍선 단추는 그 button 의 **형제**로 둔다(button 안에 button·a 없음).
- `AdminSaveBar`: "저장 안 된 변경 n건 / 저장 중 / 14:02 저장됨 / 실패·다시 시도" + **반영 안내 칸**(예: '즉시 반영', '최대 1분 안에 회원 홈에 반영' — 화면이 문구를 줌). 저장 함수는 화면 것을 그대로 받는다. 단축키 없음. 변형 둘(4판): `fixed`(아래 고정, 저장 함수가 하나인 주소), `inline`(저장 영역 안 한 줄, 저장 함수가 둘 이상인 주소). 저장 바 하나는 저장 함수 하나만 받는다. (PASS 뒤) 어느 쪽도 이탈 경고 훅을 부르지 않는다.
- 버튼 변형(3판): `adminTable`(표 안, 보라 테두리, `md` 이상 32px·그 아래 44px), `adminDanger`(위험 확정, 바탕 `--admin-tone-danger-solid` + 흰 글자). (4판)
- 모양 점검표: 21번 3절 ①·③(카드 증감 줄 따로 실패), 4-2(비교 범위 글), 7절(▲▼·말풍선), 22번 6절(도구 칸·과목 전환·반영 안내)이 이 부품으로 그려지는지 0단계 검증에서 본다. (3판)

### 5-3. 확인 창·이탈 경고 (2판)
- `AdminConfirmDialog` = **`StudioAlertDialog` 를 넓힌 것**(새로 만들지 않음). `StudioAlertDialog` 에 선택 속성을 더한다: 영향 목록(금액 굵게), 사유 칸, 높이 제한(`max-h-[calc(100dvh-2rem)]`), 영향 목록이 있으면 폭 480px·본문 왼쪽 정렬. 회원 화면에서 쓰는 곳은 속성을 안 주므로 그대로.
- 쓰는 법은 `const ok = await ask({...})`(Promise). 두 가지 유형이 있다.
  - **(가) 먼저 묻기**: 확인 전에는 요청이 나가지 않는다.
  - **(나) 응답 뒤 묻기(부족분)**: 첫 요청 → 409 `MARKET_REFUND_SHORTFALL` → `await ask()` → 확인이면 `confirmedRefundCredits` 로 다시 요청, 취소면 다시 요청 없음. **같은 try 안에서 잠금(`submitting`·`processingId`)을 쥔 채 기다린다**(finally 가 먼저 풀지 않게). 창이 열린 동안 실행 버튼은 잠겨 있다. 대상은 1절의 3곳.
- `StudioAlertDialog` 에 위험 버튼 변형을 고르는 선택 속성을 더한다. `AdminConfirmDialog` 는 `adminDanger` 를 고르고, 회원 화면은 속성을 주지 않아 지금 `destructive` 그대로. (3판)
- **이탈 경고**(3판·4판): 지금 훅이 있는 세 파일만 지금 호출 그대로 유지하고, 그 dirty 값을 저장 바(`fixed` 또는 `inline`)에 넘긴다. **저장 바 안에서는 훅을 부르지 않는다.** 다른 화면에는 훅을 새로 걸지 않는다. 한 주소(같은 page 가 그리는 파일 전체)에 훅은 최대 1개. 저장 영역이 둘인 `menu-management` 는 지금처럼 OR 로 묶은 훅 1개, 저장 줄은 영역마다 `inline` 2개. (PASS 뒤) 버튼 + `router.push` 이동은 지금처럼 `confirmLeaveIfUnsaved()`. 이 훅 안의 `window.confirm` 두 곳은 래칫 예외(사유: click 가로채기는 동기로 막을지 정해야 하고, beforeunload 는 기본 창만 가능).

### 5-4. 접근성 (2판)
- 행 누르기는 행 안 첫 열의 링크·버튼(키보드 초점 가능)으로 한다. `tr` 에 onClick 만 두지 않는다.
- 정렬 열은 `aria-sort`, '⋯' 메뉴 버튼은 한국어 이름. (선택 체크박스 규칙은 일괄 작업 묶음에서.) (3판)
- 확인 창 첫 초점 [취소], Esc 로 닫힘(처리 중 제외), 표 머리 `th scope="col"`.

## 6. 이행 전략(점진, 화면 단위, 동작 불변)
### 6-1. 단계 (2판)
| 단계 | 대상 | 먼저 끝나야 하는 것 |
|---|---|---|
| 0 | 5절 부품·토큰 + 시험. 화면 변경 없음 | — |
| 1 시범 | `/admin/review-tags`(이탈 경고 훅 사용), `/admin/my-password` — 다른 묶음이 건드리지 않는 화면 | 0 |
| 2 조회 | `/admin/orders`(예외 환불 창 = 유형 나 포함) | 1, 13번 배포 |
| 3 설정·입력 | `/admin/pricing`, `/admin/storefront-menu`, `/admin/admin-accounts`, `/admin/menu-management` | 1 |
| 3-2 | `/admin/footer`, 공용 `src/components/admin/checkout-consent-editor.tsx`(pricing·footer 가 함께 씀) | 14번 배포 |
| 4 홈 | `/admin/main-ad-settings`, `/admin/market-main-settings` | 22번이 함께 |
| 5 회원·고객 | `/admin/users`·상세, `/admin/support`, `/admin/refunds`(유형 나 2곳), `/admin/credits`(지급 창 — 돈이 오가는 화면), `/admin/reviews`, `/admin/audit-log` | 12·13번 배포 |
| 6 상품 | `/admin/market/**`, `/admin/market-categories` | 17·18·19번 끝난 뒤 |
| 7 마무리 | 사이드바 활성색, `layout.tsx` 바탕. 대시보드는 21번 | 1~6 |
- **공용 부품 규칙**(3판): 여러 화면이 쓰는 부품은 그것을 쓰는 화면 가운데 **가장 늦은 단계**에서 바꾼다. 그 전 단계 화면은 바깥 감싸기만 바꾼다. 공용 부품을 바꾸는 커밋은 6-2 대조를 그 부품을 쓰는 화면 모두에 대해 한다.
- 14·16번 새 화면은 0단계가 먼저면 처음부터 부품으로 만든다. 늦으면 그 묶음 배포 뒤 5단계에 넣는다.
- **7단계의 `adminAction`**: 변형을 **지우지 않는다**(가). 래칫이 꺼진 기능 파일만 쓰게 막는다. 완료 조건 = 켜진 화면 0곳. 꺼진 기능을 다시 켤 때 옮긴다.

### 6-2. 화면 하나를 옮길 때(동작 대조) (2판)
- **대조 단위**: 화면 폴더 + 그 폴더가 import 하는 파일(부품으로 나눠 옮긴 코드도 따라간다).
- **대조 항목**: fetch URL 템플릿(`withAdminWorkspaceSubject` 같은 helper 로 감싼 것 포함), 서버 액션 import, `*-server` 로더 import, `.from('표')`·`.rpc('함수')` 이름(브라우저 직접 조회 포함, 예: `grant-credit-dialog.tsx:46,70`), 가드 호출, searchParams 키 이름, `confirm`·`alert` 위치와 유형(가/나).
1. 바꾸기 전 위 항목 목록을 뽑아 시험 파일에 기대값으로 적는다.
2. 부품으로 바꾼다. 읽기·저장·가드 줄은 옮기기만 한다.
3. 바꾼 뒤 같은 목록이어야 한다(9절 시험). 같은 열·버튼·숨김 조건.
4. 기존 계약 시험 전부(9절 '바뀌는 기존 단언'은 같은 뜻으로 바꾼 뒤) + `npm run lint`. (PASS 뒤)
5. 화면 비교(6-3) → 대표 확인 → push.
- 유형 (나)가 있는 커밋(2단계 주문, 5단계 환불)은 **결제 경로 검증자 1명**을 더한다.

### 6-3. 화면 비교(시각 회귀) (2판)
- 도구: 개발 전용 `scripts/admin-visual-snapshot.mjs`(Playwright). 저장소에는 스크립트만.
- **두 번 실행**(3판): ① `login` 모드 — 막기 없이 사람이 로그인만 하고 storageState 를 저장소 밖에 저장한다. 찍지도, 다른 화면으로 가지도 않는다. ② `capture` 모드 — storageState 를 불러온 뒤 아래 막기를 켜고 찍는다. 토큰 갱신 POST 도 열지 않는다. 로그인이 풀리면(로그인 화면으로 넘어가면) 실패로 끝내고 ①부터 다시 한다.
- **쓰기 막기**(capture 모드): `page.route('**/*')` 에서 GET·HEAD 가 아닌 요청(서버 액션 `Next-Action` POST 포함)을 모두 abort 하고, 막힌 요청이 하나라도 있으면 실패로 끝낸다. `page.on('dialog')` 은 dismiss.
- **로그인**: ① 에서 사람이 직접. **서비스 키·`scripts/studio-browser-fixture.mjs` 의 계정 만들기는 쓰지 않는다.**
- 찍는 것: 1366×768·**1024×768**(4판)·375×667 × 기본·필터 적용·확인 창(유형 가) 열림. **유형 (나) 확인 창은 찍지 않는다**(첫 요청이 쓰기라).
- **가리기**: 부품의 열 정의·입력칸에 `data-admin-pii` 표시를 두고, 스크립트가 그 칸을 회색으로 덮는다. 대상: 이메일·전화·관리자 메모·문의·답변·후기 본문·IP·계좌 입력칸.
- 사진 경로는 `~/admin-visual-snapshots/<날짜>/` 로 고정(저장소 밖). 커밋하지 않는다.
- 판정: 사람이 나란히 본다(빠진 열·버튼·숫자, 잘린 글자, 가로 넘침, 375px, 창 높이). 나 → 대표.

### 6-4. 래칫(줄어들기만 하는 목록) (2판)
- `\bconfirm\(`, `\balert\(` 이 남은 파일(예외: `use-unsaved-changes-guard.ts`, 꺼진 기능 파일 — 사유와 함께)
- `adminAction` 을 쓰는 파일(예외: 꺼진 기능 파일)
- 화면별 `toLocaleString(` 수
- 목록에 없는 파일에 새로 생기면 실패. 단계마다 줄인다. 7단계 끝에 켜진 화면 0.

## 7. 화면 규칙(요약)
- 뼈대·여백은 2절 2. 숫자 표기는 5-1. 감소 색은 Q6.
- 개발 용어(권한 키 원문, legacy, 원본 JSON, 내부 이메일 도메인)를 새로 보이지 않는다. 이미 있는 것은 적어 두고 따로 고친다.

## 8. 작업 기록 종류
새 종류 없음. 확인 창으로 바꾼 동작은 지금 종류를 그대로 남긴다.

## 9. 시험
- `tests/admin-kit-format.test.mjs`: 원·크레딧·증감, 한국 시간 경계, null·확인 불가.
- `tests/admin-kit-status-tone.test.mjs`: 5-1 표가 `admin-orders.ts` 모든 상태 표·문의·회원 정지(12번)·배너(22번) 값을 빠짐없이 덮음, '환불 완료'는 모두 info.
- `tests/admin-kit-contrast.test.mjs`: tone `text` 대 `soft`·`text` 대 흰 바탕, **#fff 대 `--admin-tone-danger-solid`** 가 4.5:1 이상(토큰 값을 읽어 계산). (4판)
- `tests/admin-kit-contract.test.mjs`: 부품에 fetch·`'use server'`·`createClient`·권한 함수 없음, `AdminConfirmDialog` 가 `StudioAlertDialog` 를 씀, **저장 바 부품 안에 `useUnsavedChangesGuard` 호출 없음**, **주소마다(같은 page 가 그리는 파일 합산) 그 훅 호출이 ≤1**, 훅을 부르는 파일은 지금 3곳뿐(새로 생기면 실패), `AdminMetricCard` 의 button 안에 button·a 없음, (4판) 단축키 없음, `AdminConfirmDialog` 의 위험 확정 버튼이 `adminDanger`, 6-4 래칫. (3판)
- 화면별 `tests/admin-kit-screen-parity.test.mjs`: 6-2 대조 항목 기대값.
- 유형 (나) 3곳: 첫 요청 → 409 → 확인 → `confirmedRefundCredits` 로 재요청 / 취소면 재요청 없음 / 창이 열린 동안 실행 버튼 잠김(잠금 상태가 finally 전에 풀리지 않음).
- 유형 (가): 확인 결과 전에 fetch 없음.
- 기존: `admin-guard-coverage-contract`, `admin-sidebar-*`, `admin-unsaved-draft-preservation-contract`, `market-purchase-notice-contract`, `admin-dashboard-*`.
- **바뀌는 기존 단언**(PASS 뒤): 그 화면 커밋에서 **같은 뜻의 단언으로 바꾼다. 지우기만 하는 것은 금지.**
  - `admin-unsaved-draft-preservation-contract.test.mjs:71,73`(admin-accounts 의 `alert('비밀번호 확인이 일치하지 않습니다.')`, 3단계) → 같은 문구의 toast/`AdminNotice` 단언.
  - `market-refund-approve-rpc.test.mjs:254`(market-refunds 의 `window.confirm(`, 5단계 유형 나) → `await ask(` 단언 + 기존 부족분·`send(shortfall.restorable)` 단언 유지.
  - `market-category-tree-contract.test.mjs:64`(category-tree 의 `window.confirm('이 칸을 삭제할까요?')`, 6단계) → 같은 문구의 `await ask(` 단언.
- parity 항목에 '저장 바 하나에 저장 함수 하나, 저장 함수 둘을 한 버튼으로 묶지 않음'. (PASS 뒤)

## 10. 검증 관점(계획·구현 모두 PASS 까지)
1. **동작 불변**: 6-2 대조 항목, 유형 (가)/(나) 순서·잠금, 이탈 경고 훅 재사용, 주소 키
2. **화면·접근성**: tone·위험 버튼 대비, 375px 누르기 크기, 표 키보드, 창 초점, 비어 있음/실패
3. **다른 묶음과 충돌**: 12·13·14·17~19 화면을 그 묶음보다 먼저 고치지 않았는가, 21·22 가 쓸 부품 모양
- 결제 검증 3명은 두지 않는다. 유형 (나) 커밋만 결제 경로 1명(6-2).

## 11. 배포 순서
1. 계획 검증 PASS → 0절 답(특히 Q6, 5-1 표) 반영
2. 0단계 커밋 → 검증 → push(화면 변화 없음)
3. 1단계 시범 → 화면 비교 → 대표 확인 → push → 부품 고칠 점 반영
4. 2·3·4단계(선행 조건 확인) → 묶어서 대표 확인 → push
5. 5단계(12·13번 배포 뒤), 6단계(17~19번 뒤)
6. 7단계 → 래칫 확인 → 진행 기록
- DB 단계 없음. 되돌리기는 화면 커밋 revert.

## 12. 열린 질문
1. 1024px 근처에서 사이드바와 여백이 겹치는 화면(6-3 의 1024×768 촬영으로 확인). (4판)
2. 관리자에도 회원 화면 글꼴을 쓸지(구현 때 확인, 다르면 사진으로 묻기).
3. 요금제 '변경 전→후'(E-02), 법정 표시 잠금 화면(E-09), 작업 기록 '변경 전→후'(E-07)는 범위 밖. 따로 묶음으로 할지 대표가 정한다.

4. 이탈 경고를 다른 입력 화면(요금제·사이트 기본 정보의 나머지 폼·상단 메뉴·관리자 계정 등)에도 걸지. 동작 변경이라 이 묶음에서는 하지 않는다. 한다면 폼이 여럿인 주소는 상위에서 OR 1개로 묶고, 깨지는 기존 단언(`market-purchase-notice-contract.test.mjs:207`)을 바꾸는 계획을 따로 세운다. (4판)

## 13. 범위 밖
- 1차-가, 상품 업로드 개선(18번), 대시보드(21번), 홈 진열 기능(22번), CS 흐름 기능(D-01~D-12), 일괄 작업(C-06), 단축키 저장, 꺼진 기능 화면.

## 14. 1판 검증 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| refactor major | 부족분 확인은 응답 뒤에 묻고 finally 가 잠금을 풂 | 5-3 유형 (나)·`await ask()`·잠금 유지, 9절 시험, 6-2 결제 경로 검증자(2단계 포함), 6-3 찍지 않음 |
| refactor·화면 major | 이탈 경고 훅이 이미 있음, 기본 창과 충돌 | 1절 사실, Q3·Q4, 5-3 기존 훅 재사용·래칫 예외 |
| refactor major | 시범·2·3단계 화면이 13·14번과 겹침 | 6-1 시범을 review-tags·my-password 로, audit-log·credits·reviews 는 13번 뒤, footer 는 14번 뒤. 1절 목록 갱신, 12번 cbe27ee |
| refactor major | 7단계 완료 불가(menu-management 켜짐, 꺼진 기능 adminAction) | menu-management 3단계, 6-1 (가) 변형 유지·완료 조건 |
| refactor major | 동작 대조가 fetch·파일 단위뿐 | 6-2 폴더 + import 단위, 대조 항목 확장, 주소 키 유지(Q5·5-2) |
| refactor major | 화면 비교 스크립트가 쓰기 요청을 막지 않음 | 6-3 비-GET abort·dialog dismiss·직접 로그인·고정 장치 금지 |
| 화면 major | 상태 색 토큰 없음·대비 부족 | 5-1 tone 토큰·대비 조건, 9절 대비 시험, Q6 감소 색 |
| 화면 major | brand 버튼 44px 와 표 밀도 충돌 | 5-2 `adminTable` 변형(md 32px, 모바일 44px), Q2 |
| 화면 major | 부품 모양이 21·22번과 안 맞음 | 5-2 도구 칸·보조 줄·누르는 카드·반영 안내 칸, 모양 점검표 |
| minor | 가리는 대상·사진 경로 | 6-3 `data-admin-pii`, 고정 경로 |
| minor | alert 범위 | Q3·6-4 래칫에 포함 |
| minor | `StudioAlertDialog` 가 이미 있음 | 5-3 그것을 넓힘 |
| minor | tone 대응 일부·어긋남 | 5-1 전체 표, '환불 완료' = info |
| minor | 래칫 검사식·'확인 전 요청 없음' 모순 | 6-4 `\bconfirm\(`, 9절 유형별 단언 |
| minor | 표 키보드·화면 읽기 | 5-4 |

## 15. 2판 검증 반영 (3판)
| 관점 | 지적 | 반영 |
|---|---|---|
| refactor·화면 major | 저장 바와 화면이 훅을 둘 다 불러 링크 확인 창이 두 번 뜸 | Q4·5-3: 화면이 1회 부르고 저장 바는 표시만, 9절 '부품 안 호출 없음·화면당 1회' |
| 화면 minor | 위험 버튼 대비가 토큰에만 걸림 | 5-2 `adminDanger`, 5-3 `StudioAlertDialog` 선택 속성, 9절 단언 |
| 화면 minor | 카드 증감 줄·말풍선 모양 없음 | 5-2 `AdminMetricCard` 속성, 점검표에 21번 4-2·7절 |
| 화면 minor | 머리 고정과 375px 충돌 | 5-2 넓이 규칙 |
| 화면 minor | 쓰이지 않는 선택·일괄 줄 | 5-2·5-4 에서 뺌 |
| refactor minor | 공용 부품(`checkout-consent-editor`) 단계 | 6-1 공용 부품 규칙, 3-2 단계에 둠 |
| refactor minor | 로그인 요청도 막힘 | 6-3 login·capture 두 번 실행 |

## 16. 3판 검증 반영 (4판)
| 관점 | 지적 | 반영 |
|---|---|---|
| refactor major | 폼이 여럿인 주소(footer·pricing)에서 훅이 여러 개 걸림·새 가드는 동작 변경 | Q4·목표 6·5-3: 주소당 훅 ≤1, 폼 여럿은 인라인 저장 상태 줄, 이탈 경고는 지금 3곳만, 9절 주소 합산 단언, 12절 4 |
| 화면 minor | md~xl 에서 표가 페이지를 밀음 | 5-2 넓이 경계 xl·`min-w-0`, 6-3 1024×768 |
| 화면 minor | 카드 button 안 말풍선 단추 | 5-2 카드 구조, 9절 단언 |
| 화면 minor | `adminDanger` 토큰 불명확 | 5-1 `--admin-tone-danger-solid`, 9절 대비 쌍 |

## 17. 4판 검증(PASS) 뒤 minor 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| refactor minor | 고정 바/인라인 기준이 폼 수라 menu-management 가 어긋남 | Q4·5-2·5-3 기준을 저장 함수 수로, menu-management 인라인 2줄·OR 훅 1개, 9절 parity |
| refactor minor | Q3 로 깨지는 기존 단언 3개 | 9절 '바뀌는 기존 단언'(같은 뜻으로 바꾸기, 지우기 금지), 6-2 4 |
| refactor minor | `min-w-0` 대상·단계, xl 이상 넓은 표 | 5-2 `layout.tsx:30`·1단계 커밋·960px 대비 |

