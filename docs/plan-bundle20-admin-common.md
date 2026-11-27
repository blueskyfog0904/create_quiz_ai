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


## 구현 메모 (0단계)
작성일: 2026-11-26. 0단계(공통 부품·토큰, 화면 변경 없음)만 했다. 화면 이전(1~7단계)·`layout.tsx` 의 `min-w-0`(1단계)·DB 변경은 하지 않았다.

**만든·고친 파일**
- 토큰: `src/styles/studio-tokens.css` 에 `--admin-tone-{neutral,info,success,warning,danger}-{text,soft,border}`, `--admin-tone-danger-solid`(#c4271d, 흰 글자 5.75:1), `--admin-tone-danger-solid-hover`. `--studio-*` 값은 그대로.
- 버튼: `button.tsx` 에 `adminTable`(보라 테두리, 그 아래 44px·`md` 이상 32px), `adminDanger`(위험 바탕 토큰 + 흰 글자). `adminAction` 은 그대로 둠(6-1 가).
- `StudioAlertDialog` 선택 속성(주지 않으면 지금 그대로): `destructiveVariant`('destructive' 기본 | 'adminDanger'), `impacts`(영향 목록, 있으면 480px·왼쪽 정렬, `emphasis` 굵게), `reason`(사유 칸, `required` 면 빈 동안 확정 막음), `limitHeight`(`max-h-[calc(100dvh-2rem)]`), `focusCancelOnOpen`(첫 초점 [취소]).
- 순수: `src/lib/admin-format.ts`(`formatWon`·`formatCredits`·`formatSignedCredits`·`formatCount`·`formatKstShort`·`formatKstFull`·`formatKstTime`·`formatDelta`, 세지 못한 값은 `ADMIN_UNAVAILABLE` 로 넘김), `src/lib/admin-status-tone.ts`(5-1 표, `adminStatusTone(kind, value)`, 표에 없는 값은 회색).
- 부품 `src/components/admin/kit/`: `AdminPageHeader`, `AdminStatusBadge`, `AdminNotice`, `AdminDataTable`(+`ADMIN_TABLE_PAGE_WIDTH_LIMIT` 960), `AdminTableState`, `AdminFilterBar`+`useAdminFilterParams`, `AdminMetricCard`+`AdminMetricGrid`, `AdminSaveBar`, `AdminConfirmDialog`+`useAdminConfirm`, `admin-tone-classes.ts`.
- 시험: `tests/admin-kit-format`·`-status-tone`·`-contrast`·`-contract`(.test.mjs, 26건). 화면별 `admin-kit-screen-parity` 와 유형 (가)/(나) 시험은 그 화면을 옮기는 단계에서 만든다(0단계엔 옮긴 화면이 없음).
- 화면 비교 스크립트 `scripts/admin-visual-snapshot.mjs`(뼈대): `login`(막기 없이 사람이 로그인 → storageState 를 `~/admin-visual-snapshots/.auth/` 에 저장, 찍지 않음) / `capture`(GET·HEAD 아닌 요청 모두 abort·1건이라도 있으면 실패, `dialog` dismiss, `[data-admin-pii]` 회색 가림, 1366·1024·375 폭, `~/admin-visual-snapshots/<날짜>/<label>/` 저장, 저장소 안 경로 거부, 로그인 화면으로 넘어가면 실패). 실행하지 않았다(`node --check` 만).

**기본안으로 정한 것(구현 때 판단)**
1. 회원·배너 tone 키 이름: 회원 `active`·`withdrawn`·`suspension_lifted`·`restricted`·`login_blocked`(뒤 둘은 12번 `MemberSuspensionScope` 그대로), 배너 `live`·`scheduled`·`ended`·`off`. 이름(글자)은 화면이 준다. 22번이 상태 값을 정하면 키를 맞춘다.
2. `AdminSaveBar` 의 `fixed` 는 CSS `fixed` 가 아니라 `sticky bottom-0`: 사이드바가 접히면(w-16) 왼쪽 위치를 계산할 수 없어서. 본문 폭을 따라가며 아래에 붙는다. 변경이 없으면 저장 버튼은 막히고, 실패면 같은 버튼이 [다시 시도](같은 저장 함수).
3. `useAdminConfirm()` 은 `{ ask, askReason, dialog }`. `await ask()` → boolean, `await askReason()` → 사유 글 또는 null. 창이 열린 채 다른 `ask` 가 오거나 화면이 사라지면 앞 약속은 취소(false/null)로 풀린다. 확정을 누르면 창은 바로 닫힌다(유형 나의 잠금은 화면이 쥔다).
4. `formatKstFull` 모양은 `2026-11-19 10:44`(짧은 표기와 같은 하이픈). 지금 화면의 `YYYY.MM.DD` 와 다르므로 1단계 화면 비교 때 대표 확인.
5. `formatDelta` 는 `{ direction, text }` 이고 글에는 부호가 없다(▲▼ 는 카드가 그림, 화면 읽기용 '증가/감소' 글 포함). 앞 기간 0 이면 '이전 0 → 신규', 같으면 '변화 없음'.
6. `AdminMetricCard` 말풍선 단추는 375px 에서 44px, `md` 이상 32px. 보조 줄은 누르는 영역 밖.
7. 래칫(6-4)은 **목록에 없는 켜진 화면 파일에 새로 생기면 실패**만 본다(이미 줄어든 항목을 목록에서 안 지워도 통과 — 12·13·14번 등이 같은 파일을 고쳐도 시험이 깨지지 않게). 범위는 `src/app/(admin)`·`src/components/admin`·`src/components/layout/admin-*`, 꺼진 기능은 경로 정규식으로 예외. `toLocaleString(` 은 파일별 실제 건수(줄 수 아님) 상한. 단계마다 목록을 손으로 줄인다.
8. 이탈 경고 훅 단언: 훅을 부르는 파일은 지금 3곳 정확히, 관리자 page 마다(page + 위 layout + import 를 따라간 파일 전체) 합계 ≤ 1.

**확인 결과**
- `node --test tests/*.test.mjs`: 2339건 중 실패 44(작업 전 기준선 44와 이름까지 같음, 새 실패 0). 새 시험 26건 통과.
- `npx tsc --noEmit -p .`: `.next/` 밖 오류 0. 바꾼 파일 eslint 0.

**다음(1단계 시범) 때 볼 것**
- `layout.tsx:30` `max-md:min-w-0` → `min-w-0` 를 시범 커밋에 넣고 표 있는 화면 전부 1024×768 비교.
- 화면 비교 스크립트에 확인 창(유형 가) 열린 상태 찍기(화면별 여는 단추)를 더한다 — 지금 뼈대는 기본·필터 적용(주소에 값)까지.
- 모양 점검표(5-2 끝: 21번 ①·③·4-2·7절, 22번 6절)는 부품 속성으로 그릴 수 있게 넣었다(도구 칸·보조 줄·카드 증감 줄 따로 실패·비교 범위 글·▲▼·말풍선·반영 안내 칸). 실제 모양은 1단계 화면 비교에서 본다.

**0단계 검증 반영(no-regression PASS·minor 1, kit FAIL·major 1·minor 2)**
- major: 표 첫 머리 칸에서 tailwind-merge 가 `xl:sticky` 를 뒤에 온 `xl:static` 으로 지우던 문제. 칸 클래스를 `kit/admin-data-table-classes.ts`(순수)로 떼고 `xl:static` 을 없앴다(첫 열 `sticky left-0` 는 xl 이상에서도 두되 가로 넘침이 없으면 효과 없음, 첫 머리 칸은 `xl:z-20`). 시험은 문자열 대신 실제 `cn`(tailwind-merge) 결과로 첫 th 에 `xl:sticky`·`xl:top-0` 이 남고 static 이 없음을 본다.
- minor: `useAdminConfirm` 약속 처리를 `kit/admin-confirm-queue.ts`(순수)로 떼고 실행 시험(확정 true·사유 trim, 취소 false/null, 연속 ask 때 앞 약속 취소, 화면 사라짐 취소, 열린 것 없을 때 무동작)을 더했다.
- minor: `useAdminFilterParams(keys, { baseQuery })` — 화면이 정규화한 기준 쿼리를 주면 지금 주소 대신 그것으로 읽고 고친다(회원·크레딧 목록처럼 아는 키만으로 주소를 다시 만들던 화면용).
- minor: 화면 비교 스크립트가 `context.routeWebSocket` 으로 WebSocket 을 서버에 잇지 않고 닫는다(닫은 수만 출력, 실패로 보지 않음).
- 확인: 전체 2341건 중 실패 44(기준선과 이름 같음), 부품 시험 28건 통과, tsc(`.next/` 밖) 0, eslint 0.

## 구현 메모 (1단계)
작성일: 2026-11-27. 1단계 시범(`/admin/review-tags`, `/admin/my-password`)과 `layout.tsx` 의 `min-w-0`, 화면별 동작 대조 시험, 래칫 목록 줄이기, 화면 비교 스크립트의 확인 창 찍기만 했다. 2~7단계 화면·홈 진열/홈 배너 관리 화면(`market-main-settings`·`main-ad-settings`, 22번이 따로 고침)·DB 는 건드리지 않았다. 커밋·push 하지 않았다.

**바꾼 파일**
- `src/app/(admin)/admin/layout.tsx`: 본문 감싸기 `max-md:min-w-0` → `min-w-0`(모든 폭). 같은 뜻으로 `tests/admin-alert-center-contract.test.mjs` 단언을 바꿈(클래스 전체 일치).
- `/admin/review-tags`
  - `page.tsx`: 제목줄을 `AdminPageHeader`(제목 = DB 메뉴 이름 `AdminMenuName` + ' · 국어/영어', 설명 문구 그대로). 안쪽 `p-8 pt-6` 이중 여백을 없앰(레이아웃 여백만).
  - `review-tags-client.tsx`: 표 → `AdminDataTable`(열 4개 그대로, `minWidth` 640 이라 1280px 미만·375px 에서는 표 안 가로 스크롤 + 첫 열 고정), 상태 → `AdminStatusBadge`, 불러오는 중·비어 있음·읽기 실패 → `AdminTableState`, 줄 버튼 `adminAction`·`outline` → `adminTable` 둘, [태그 추가] → `brand`, '모두 저장' 줄 → 아래 고정 `AdminSaveBar`(저장 함수 하나 = `saveAllDrafts`, 반영 안내 칸에 지금 안내 문구), `alert(` 5곳 → 같은 문구의 화면 안 오류(추가·줄 저장 = `AdminNotice`, 읽기 = 행이 없으면 표 실패 칸·있으면 오류 띠 + [다시 시도], 모두 저장 = 저장 바의 실패·[다시 시도]). 이탈 경고 훅 호출은 그대로 1개.
- `/admin/my-password`: 제목줄 `AdminPageHeader`, 결과 안내 `AdminNotice`(오류 = 오류 띠 role=alert, 성공 = 정보 띠 role=status), 카드 테두리·둥글기 studio 토큰, [비밀번호 변경] `brand`.
- `src/lib/admin-status-tone.ts`: 5-1 표에 **후기 태그** 줄(활성 = success, 비활성 = neutral)을 더함. 시험 `admin-kit-status-tone` 기대값에 같은 줄.
- 시험
  - 새 `tests/admin-kit-screen-parity.test.mjs`(4건): 6-2 대조 항목(fetch 호출 전체 — 주소·method·body, `*-server`·actions import, `.from`/`.rpc`, 가드 호출, 주소 키, `confirm`/`alert`, 이탈 경고 훅)을 옮기기 전(648e68c) 코드에서 뽑아 기대값으로 적음. 화면 폴더 + import 한 관리자 파일(kit 제외)을 따라감. 같은 열·버튼·막힘 조건, 바뀐 알림 5곳의 문구, 저장 바 하나 = 저장 함수 하나(`saveAllDrafts`, 고정 바)도 본다.
  - `admin-kit-contract`: 래칫 목록에서 `review-tags-client.tsx` 를 `alert(`·`adminAction` 두 목록에서 뺌. 화면 비교 스크립트의 확인 창 찍기 단언을 더함.
  - `admin-unsaved-draft-preservation-contract`: `'모두 저장'` 단언 → 같은 뜻으로 "`AdminSaveBar variant="fixed"` 가 `saveAllDrafts` 를 '모두 저장' 이름으로 부름".
- `scripts/admin-visual-snapshot.mjs`: `--confirm '주소::단추 이름'`(여러 번). 그 주소를 찍은 뒤 이름이 같은 단추 하나만 눌러 창(role=dialog)이 열리면 찍고 Esc 로 닫는다(확정 단추는 누르지 않음, 쓰기 막기는 그대로). `--confirm` 주소가 `--paths` 에 없으면 시작 전에 실패. 이번 두 화면에는 유형 (가) 확인 창이 없어 쓸 곳은 2단계부터다. 실행하지 않았다(`node --check` 만).

**구현 때 판단한 것(대표 확인 대상)**
1. **날짜 표기**: 대표가 `YYYY-MM-DD HH:mm`(`formatKstFull`) 으로 바꾸는 것을 아직 정하지 않았으므로, 옮기는 화면은 **지금 표기를 그대로** 둔다. 이번 두 화면에는 날짜가 없다(저장 바의 'HH:mm 저장됨' 은 새로 생긴 표시). 2단계(주문)부터 해당하므로 화면 비교 때 정해 주면 그때부터 바꾼다.
2. 후기 태그 상태 색: 활성 초록·비활성 회색(5-1 표 새 줄). 비활성 행을 흐리게(`opacity-60`) 하던 것은 표 부품에 행 클래스가 없어 없앴다(배지 글자로 구분).
3. 과목 전환기를 제목줄 도구 칸에 넣지 않았다: 공용 `AdminWorkspaceSwitcher` 는 어두운 색이고 22번 화면과 함께 쓴다. 지금처럼 제목의 ' · 국어/영어' 와 사이드바 과목 묶음으로 전환한다.
4. `/admin/my-password` 는 저장 바를 두지 않았다: 입력값을 남기지 않는 일회성 제출이다. 성공 안내는 초록 글자 → 정보(파랑) 띠(부품에 '성공' 띠가 없음). 다른 기기 로그아웃 실패 안내도 같은 정보 띠다.
5. 제목 크기: 두 화면 모두 공통 제목줄(2xl)로 바뀌어 넓은 화면에서 조금 작아진다(전에는 3xl).
6. '모두 저장' 줄이 표 위에서 아래 고정 저장 바로 옮겨졌다. '저장됨' 시각은 마지막 저장(추가·줄 저장·모두 저장) 때.

**확인 결과**
- `node --test tests/*.test.mjs`: 2384건 중 실패 44. 648e68c 를 저장소 밖에 풀어 돌린 기준선(2380건 중 44)과 실패 이름이 같음(새 실패 0). 새 대조 시험 4건 통과.
- `npx tsc --noEmit -p .`: `.next/` 밖 오류 0. 바꾼 파일 eslint 0.

**대표 화면 비교 순서(내가 실행하지 않음)**
- 준비: '바꾸기 전'은 648e68c 다(origin/main 보다 22커밋 앞이라 운영 배포본은 '전'이 아님). 다른 폴더에 그 커밋을 꺼내 4001 포트로 띄운다.
  1. `git worktree add ../create_quiz_ai-before 648e68c`
  2. 그 폴더에서 `node_modules`·`.env.local` 을 원래 폴더 것으로 링크하고 `npx next dev -p 4001`
  3. 지금 폴더(바뀐 코드)는 평소처럼 `npm run dev`(4000)
- 로그인(사람이 직접, 1회): `node scripts/admin-visual-snapshot.mjs login` — 쿠키는 포트가 달라도 같은 localhost 라 4001 에도 쓰인다. '로그인이 풀렸습니다'로 끝나면 `login --base http://localhost:4001` 로 한 번 더.
- 찍기(세 폭 1366·1024×768·375×667 을 스크립트가 모두 찍음):
  - 전: `node scripts/admin-visual-snapshot.mjs capture --label before --base http://localhost:4001 --paths <아래 주소>`
  - 후: `node scripts/admin-visual-snapshot.mjs capture --label after --paths <아래 주소>`
  - 주소(쉼표로 이어서): `/admin/review-tags?subject=korean,/admin/review-tags?subject=english,/admin/my-password,/admin,/admin/admin-accounts,/admin/audit-log,/admin/audit-log?tab=access,/admin/credits,/admin/footer,/admin/market/products,/admin/market/images,/admin/menu-management,/admin/notices,/admin/faq,/admin/notifications,/admin/orders,/admin/orders?tab=market,/admin/pricing,/admin/refunds,/admin/reports,/admin/reviews,/admin/users`, 그리고 시험 계정 하나의 `/admin/users/<id>`.
  - 사진은 `~/admin-visual-snapshots/<날짜>/before|after/` 에 생긴다. 옛 화면에는 `data-admin-pii` 가 없어 회원 이메일 등이 가려지지 않으니 사진을 밖에 공유하지 않는다. 13번 DB 적용 뒤라면 회원 화면을 여는 것도 열람 기록에 남는다.
- 볼 것
  - `/admin/review-tags`(세 폭): 제목 '후기 태그 관리 · 국어/영어'·설명 그대로, 열 4개(태그 문구·정렬 순서·상태·작업)와 줄 버튼 [저장]·[비활성화/활성화]가 모두 있음, 버튼이 보라 테두리(1024·1366 에서 32px, 375 에서 44px), 상태 배지 활성 초록·비활성 회색, 아래 고정 저장 바('변경 없음' + 안내 문구 + 막힌 [모두 저장]), 375 에서 표가 표 안에서만 옆으로 밀리고 페이지는 안 밀림·첫 열 고정, 잘린 글자 없음.
  - **`/admin/review-tags` 오류 표시 위치**(대표가 직접 해 보기, 사진으로는 안 찍힘): 전에는 실패하면 브라우저 알림 창이 떴고, 후에는 **표 위쪽 빨간 띠**로 보인다(오류가 생기면 띠가 보이는 자리로 화면이 옮겨짐). 모두 저장 실패만 아래 저장 바에 보인다. 빈 문구로 [태그 추가]를 누르면 띠가 뜨는지 본다(요청이 나가지 않는 확인). 이 위치 변경이 괜찮은지 정한다.
  - `/admin/my-password`(세 폭): 제목·설명, 입력칸 3개, 보라 [비밀번호 변경], 카드 둥글기. (오류·성공 띠는 쓰기 요청이 막혀 찍히지 않는다. 필요하면 대표가 직접 바꿔 보며 확인.)
  - 나머지 표 화면 **1024×768**: 전에 페이지 전체가 옆으로 넘치던(가로 스크롤바) 화면이 후에는 표 영역 안 스크롤로 바뀌는 것만 달라야 한다. 빠진 열·버튼·숫자, 사이드바와 본문 겹침(12절 1), 잘린 글자가 없어야 한다.
  - **`/admin/reviews` 800~900px**: 이 표만 가로 넘침 틀(`overflow-x-auto`)이 없다. 그래서 `min-w-0` 뒤에는 넓은 표가 페이지를 넓히지 않고 테두리 카드 밖으로 삐져나올 수 있다. 따로 찍는다.
    - 전: `capture --label before-reviews --base http://localhost:4001 --paths /admin/reviews --viewport 800x768 --viewport 900x768`
    - 후: `capture --label after-reviews --paths /admin/reviews --viewport 800x768 --viewport 900x768`
    - 삐져나오면 `reviews-admin-client.tsx` 를 5단계(그 화면을 옮길 때)에 표 부품으로 바꿀지, 그 전에 감싸기에 `overflow-x-auto` 만 더할지 대표가 정한다. 코드는 이번에 바꾸지 않았다.
  - 같은 화면 **375×667**: 전후가 같아야 한다(모바일은 이미 `min-w-0` 였음).
  - 1366: 전후가 같아야 한다(시범 두 화면 제외).
- 대표가 정할 것: 위 '판단한 것' 1~6(특히 1 날짜 표기, 2 후기 태그 색). 확인 뒤 push 는 대표가 정한다.
- 정리: 비교가 끝나면 `git worktree remove ../create_quiz_ai-before`.

**1단계 검증 반영(PASS·minor 4)**
- `/admin/reviews` 표가 `min-w-0` 영향을 받는다: 코드는 그대로 두고 위 비교 목록에 800~900px 촬영을 더했다. 화면 비교 스크립트에 `--viewport WxH` 를 더했다(여러 번, 주면 기본 세 폭 대신 그 폭만).
- 화면 비교 스크립트
  - 주석을 고쳤다: 막기는 비-GET 만 끊는다. 기록을 남기는 GET(CSV 내려받기 감사 기록 등)은 지나가므로, `--confirm` 에는 유형 (가) 확인 창을 여는 단추만 준다.
  - 단추를 누른 뒤 창이 뜨기 전까지 `/api/` 요청은 모두 끊고(page route), 하나라도 있으면 실패로 끝낸다.
  - 여는 단추는 보이는 것만 고르고(`filter({ visible: true })`), 누르기는 5초 안에 끝나야 한다.
  - `captureConfirm` 이 실패하면 그때까지 막힌 쓰기 요청 목록도 함께 보인다.
- `/admin/review-tags`
  - 모두 저장을 시작하면 앞선 줄 저장·추가 오류 띠를 지운다.
  - 오류 띠가 생기면 그 자리로 옮겨 보인다(`scrollIntoView({ block: 'nearest' })`).
  - 위 비교 목록에 '알림 창 → 위쪽 띠' 확인 항목을 더했다.
- 시험: 대조 시험과 kit 계약 시험에 위 내용 단언을 더했다.

## 구현 메모 (2·3단계)
작성일: 2026-11-27. 2단계(`/admin/orders`, 예외 환불 창 유형 나 포함)·3단계(`/admin/pricing`, `/admin/storefront-menu`, `/admin/admin-accounts`, `/admin/menu-management`)·3-2단계(`/admin/footer` 전체, 공용 `checkout-consent-editor.tsx`·`checkout-consent-admin-preview.tsx`)를 했다. 4단계(홈 진열·홈 배너, 22번이 다시 만듦)와 다른 화면·DB 는 건드리지 않았다. 커밋·push 하지 않았다. 공용 부품 규칙대로 3단계 `/admin/pricing` 커밋에는 동의 편집기를 넣지 않고, 편집기·미리보기는 3-2단계 커밋(footer 와 함께)으로 나눈다.

**바꾼 파일**
- 2단계: `orders/page.tsx`(제목줄·탭 보라), `orders-client.tsx`·`market-orders-client.tsx`(필터 줄 `AdminFilterBar` + '결과 n건', 표 `AdminDataTable` 760·860px, 상태 `AdminStatusBadge`+`adminStatusTone`, 불러오는 중·실패·0건 `AdminTableState`, 오류·주의 띠 `AdminNotice`, [상세] `adminTable`, [예외 환불] `brandOutline`), `market-exception-refund-dialog.tsx`(부족분 `window.confirm` → `await ask()` 유형 나, 같은 try 안에서 `submitting` 을 쥔 채 기다림, 확인 창은 예외 환불 창 안에 그림).
- 3단계
  - `pricing/page.tsx`(제목줄), `pricing-plans-client.tsx`(표·배지·판매 상태 확인 창 → `AdminConfirmDialog`, 판매 중지는 `adminDanger`, 처리 중 닫힘·확정 막힘), `components/pricing-plan-dialog.tsx`(오류 띠·버튼 색), `pricing-page-content-form.tsx`·`point-charge-policy-form.tsx`(저장 버튼 → 인라인 저장 줄, 안내·오류 → `AdminNotice`/tone 글자색).
  - `storefront-menu-client.tsx`: 제목줄(도구 칸 [되돌리기]), 저장 함수 하나 → 아래 고정 저장 바, 빈 목록 `AdminTableState`.
  - `admin-accounts/page.tsx`·`admin-accounts-client.tsx`·`admin-permissions-dialog.tsx`: `confirm(` 2곳 → `await ask()` 유형 가(삭제·권한 해제, 위험 버튼), `alert(` 11곳 → 같은 문구의 화면 안 오류 띠(목록 읽기·새 계정·줄 작업·비밀번호 창) 또는 성공 알림(toast: 비밀번호 변경·권한 저장), 표 `AdminDataTable`(960px).
  - `menu-management-client.tsx`: 제목줄(도구 칸 과목 전환기, 전에도 제목 옆), 인라인 저장 줄 2개(`handleSaveAll`·`handleSaveAdminSidebar`, 이탈 경고 훅은 OR 1개 그대로), 표 4개, 삭제·보관 확인 창 → `AdminConfirmDialog`.
- 3-2단계: `footer-client.tsx`·`site-brand-form.tsx`·`notice-popup-admin.tsx`·`signup-consent-admin.tsx`·`purchase-policy-form.tsx`(저장 함수마다 인라인 저장 줄 6개, 이탈 경고 훅 1개 그대로), `site-logo-settings.tsx`(버튼·오류 띠만), `policy-history/page.tsx`(제목줄·빈 칸). 동의 편집기는 입력 처리 16곳이 HEAD 와 글자까지 같다(시험이 지문으로 봄) — 저장 내용·동의 지문이 바뀌지 않는다.
- 부품(작은 추가): `AdminConfirmDialog` 에 선택 속성 `pending`(창 안에서 처리 기다림), `admin-save-bar.tsx` 에 순수 함수 `countChangedFields`(저장된 값과 다른 칸 수 → 저장 바 'n건'), `admin-status-tone.ts` 에 **충전 요금제** 줄(판매중 = success, 비활성 = neutral).
- 시험
  - `admin-kit-screen-parity`: 화면마다 6-2 대조 항목을 38a1273 에서 뽑아 기대값으로 적음(바뀐 것은 없앤 `confirm`·`alert` 뿐). 유형 (나)는 예외 환불 창의 `submit` 을 떼어 실제로 돌린다 — 409 → 확인 → `confirmedRefundCredits: 60` 재요청, 취소면 재요청 없음, 창이 열린 동안 `submitting` 이 true. 유형 (가)는 `ask` → 취소면 return → 그 뒤 잠금·요청 순서. 저장 바 하나 = 저장 함수 하나(storefront 고정 1, pricing 인라인 2, menu-management 인라인 2, footer 인라인 6).
  - 래칫: `confirm(` 목록에서 admin-accounts·예외 환불 창, `alert(` 목록에서 admin-accounts 2파일, `adminAction` 목록에서 11파일을 뺌. `toLocaleString(` 상한: 예외 환불 창 12 → 4, 충전 주문 8 → 1, 마켓 주문·요금제 목록은 목록에서 뺌(0). 남은 것은 모두 날짜 표기.
  - 같은 뜻으로 바꾼 기존 단언: `admin-orders-contract`·`admin-market-orders-contract`(`<div role="alert"` → `<AdminNotice kind="error"`, 다운로드 배지 글은 `label` 템플릿), `admin-unsaved-draft-preservation-contract:73,75`(`alert('비밀번호 확인이 일치하지 않습니다.')` → 같은 문구 `setPasswordError`·`setCreateError` + 띠 그리기 단언, 9절 예정 항목), `pricing-page-content-contract`(`disabled={saving || readFailed}` → `saveDisabled=`), `site-brand-contract`(저장 버튼 막힘 → 저장 줄 `saveDisabled`·`status`).

**구현 때 판단한 것(대표 확인 대상)**
1. **날짜 표기는 화면마다 지금 모양 그대로**(주문 `toLocaleString('ko-KR')`, 관리자 계정 `YYYY.MM.DD`, 약관 이력·예외 환불 창 문의 판). 정해 주면 `formatKstFull` 로 한 번에 바꾼다.
2. **숫자 표기는 공통 함수로 바뀌었다**: 크레딧 '3,000 크레딧' → '3,000 C', 요금제 가격 '₩9,900' → '9,900원', 빈 값 '-' → '–'(금액만, 날짜는 그대로). 예외 환불 창의 '낸 크레딧 1,000'처럼 단위 없던 곳은 그대로.
3. **상태 색이 5-1 표를 따르며 바뀐 것**: 충전 주문 '수동 확인 필요' 빨강 → 호박, '결제 실패' 회색 → 빨강, 진행 중 상태들 호박 → 파랑, 환불 요청 배지 회색 → 상태별 색. 마켓 주문 '회수됨·구매 실패' 회색 → 빨강, 권한 '환불로 회수' 빨강 → 파랑. 요금제 '판매중' 초록 글자 → 초록 배지.
4. 주문 두 탭의 필터 줄 오른쪽에 '결과 n건'이 생겼다(읽기 실패면 '확인 불가'). [초기화]는 넣지 않았다(전에 없던 동작).
5. **저장 줄은 변경이 없으면 저장 버튼을 막는다.** 전에는 늘 누를 수 있던 곳: 충전 화면 문구, 결제 전 확인 문구, 공지 팝업, 가입 동의 항목·안내 문구. 변경 없는 저장은 서버가 쓰는 것이 없거나 같은 값을 다시 쓰는 것이라 데이터 영향은 없다고 판단했다. 저장 실패는 지금처럼 알림(toast)도 뜨고 저장 줄에도 빨간 글 + [다시 시도].
6. 저장 버튼 위치: 요금제 두 폼은 카드 아래 오른쪽 버튼 → 카드 아래 저장 줄, 상단 메뉴는 제목 오른쪽 [저장] → 화면 아래 고정 저장 바([되돌리기]는 제목 오른쪽에 남음), 메뉴 관리 [일반 메뉴 저장]은 제목 오른쪽 → 제목 아래 저장 줄, [하단 정보 저장]은 머리줄 → '기본 사업자 정보' 카드 바로 위.
7. 반영 안내 문구(저장 줄 아래 작은 글)는 초안이다: '저장하면 충전 화면에 바로 반영됩니다.', '저장한 뒤 결제부터 새 문구로 동의를 받습니다.', 상단 메뉴는 전의 안내 문장을 옮김, 메뉴 관리 2개·footer 3개(각 작업 보고 문구). 바꾸려면 알려 주면 된다.
8. 요금제 판매 상태 확인 창이 공통 창으로 바뀌었다: 영향 목록(요금제·가격·크레딧), 첫 초점 [취소], 판매 중지 확정은 진한 빨강, 처리 중에는 닫히지 않음(전과 같음).
9. 관리자 계정: 알림 창이 뜨던 자리 → 화면 안 빨간 띠(새 계정 칸 아래·표 위·비밀번호 창 안). 성공 두 가지('비밀번호를 변경했습니다.', '권한을 저장했습니다…')는 화면 위 알림(toast). 표 안 [권한 해제]·[삭제]는 빨강 글자 테두리 버튼, 확정 창은 진한 빨강. 배지 색: 내 계정 파랑, 관리자 ID 초록·기존 계정 회색, 대표 호박·일반 회색(전과 같은 계열).
10. 메뉴 관리: 대메뉴 줄 회색 바탕 → 이름 굵게(표 부품에 줄 색 없음), 아이콘 버튼에 한국어 이름표(예: '…위로 이동').
11. 로고 카드(footer)는 고르면 바로 올라가는 동작이라 저장 줄을 두지 않았다(1단계 비밀번호 화면과 같은 판단). 가입 동의 항목 편집 칸의 저장 줄은 '저장됨'을 보이지 않는다(저장되면 칸이 닫힘).

**2·3단계 검증 반영(3관점 PASS·minor 5)**
- `/admin/storefront-menu`: 저장 바 `saveDisabled` 에 `!hasChanges` 를 다시 넣었다(전 저장 버튼 막힘 조건과 글자까지 같음).
- 저장 바(부품): 실패여도 저장 안 된 변경이 0건이면 '변경 없음'으로 보이고 [다시 시도]를 막는다(예: 공지 팝업이 충돌로 다시 읽은 뒤 헛 [다시 시도]). 규칙은 순수 파일 `kit/admin-save-bar-state.ts`(`adminSaveBarView`, `countChangedFields` 도 이리 옮기고 `admin-save-bar.tsx` 가 다시 내보냄)로 떼어 kit 계약 시험이 직접 돌린다. 홈 진열·매출 보고 화면(22·21번)의 저장 바에도 같은 규칙이 적용된다.
- 저장 바에 선택 속성 `saveWhenClean`: `point-charge-policy-form.tsx` 는 변경 0건이어도 예전 칸 검사에 걸리면(`blocked && legacyFieldsInvalid`) 버튼이 켜져, 전처럼 누르면 되돌리기용 칸을 펼치고 초점을 옮긴다.
- `/admin/admin-accounts`: 목록을 다시 읽는 데 성공하면 앞 줄 작업 오류 띠를 지운다.
- '변경이 없으면 저장 막힘'(판단 5, 5곳)은 그대로 두고 대표 확인 항목으로 남긴다.

**확인 결과**
- `node --test tests/*.test.mjs`: 2429건 중 실패 43(검증 반영 뒤). 작업 전(38a1273, 같은 작업 트리에서 먼저 돌림) 2410건 중 43과 실패 이름이 같다(새 실패 0). 대조 시험 22건(1단계 4건 포함) 통과.
- `npx tsc --noEmit -p .`: `.next/` 밖 오류 0.
- 바꾼 src 파일 eslint: 1건 — `pricing-plans-client.tsx:32` `catch (err: any)`(HEAD 부터 있던 줄, 이번에 건드리지 않음).

**대표 화면 비교 순서(내가 실행하지 않음)**
- '바꾸기 전'은 38a1273(지금 HEAD). 1단계 메모의 순서대로 하되 `git worktree add ../create_quiz_ai-before 38a1273` 으로 꺼내 4001 에 띄운다. 지금 폴더(바뀐 코드)는 4000.
- 주소: `/admin/orders,/admin/orders?tab=market,/admin/pricing,/admin/storefront-menu,/admin/admin-accounts,/admin/menu-management?subject=korean,/admin/menu-management?subject=english,/admin/footer,/admin/footer/policy-history`
  - 전: `node scripts/admin-visual-snapshot.mjs capture --label before-s2 --base http://localhost:4001 --paths <위 주소>`
  - 후: `node scripts/admin-visual-snapshot.mjs capture --label after-s2 --paths <위 주소> --confirm '/admin/admin-accounts::권한 해제'`(일반 관리자 계정이 있을 때만. 전 화면은 브라우저 확인 창이라 찍히지 않는다)
  - 필터 적용 사진: `/admin/orders?status=completed`, `/admin/orders?tab=market&orderSubject=english` 를 주소에 더한다.
  - 주문·관리자 계정 화면은 회원 이메일이 보인다. 후 화면은 회원 칸을 가리지만 전 화면은 안 가린다 — 사진을 밖에 공유하지 않는다. 13번 열람 기록이 쌓일 수 있다.
- 볼 것(세 폭 1366·1024×768·375×667)
  - `/admin/orders` 두 탭: 제목·설명 그대로, 탭 밑줄 보라. 필터 줄 한 칸(검색 보라 [검색], 상태·결제사·환경 / 상태·과목, 기간) + 오른쪽 '결과 n건'. 열 7개 그대로, [상세] 보라 테두리(1024·1366 32px, 375 44px). 배지 색은 위 판단 3. 1366 에서 표 머리 고정·페이지 스크롤, 1024·375 에서는 표 안에서만 옆으로 밀리고 첫 열(주문 시각) 고정. 쪽 넘김 그대로. 상세 창(직접 열기): 칸 순서·문구 그대로, 크레딧 'N C'.
  - **예외 환불(직접 해 보기, 쓰기라 사진 없음)**: 시험 계정 완료 주문으로 [금액 확인]까지만 본다. 부족분 창은 실제 환불 요청이 나간 뒤에만 뜨므로 운영 DB 에서는 일부러 띄우지 않는다(시험이 흐름을 돌려 봄). 떴을 때 모양: 제목 '일부만 돌려줄 수 있습니다', 서버 안내 글, 영향 목록 '요청 N C / 돌려줄 수 있음 N C', [취소]·[돌려줄 수 있는 만큼 환불].
  - `/admin/pricing`: 제목·설명, 요금제 표 열 7개(가격 '9,900원'), 판매 상태 스위치 + 배지. 스위치를 누르면 확인 창(사진은 직접): 영향 목록·[취소] 첫 초점·판매 중지 진한 빨강 — 확정은 누르지 않고 Esc. 두 폼 아래 저장 줄 '변경 없음' + 안내 글 + 막힌 [문구 저장]·[결제 고지 문구 저장]. 칸 하나를 고치면 '저장 안 된 변경 1건' + 버튼 켜짐(저장하지 말고 새로고침으로 되돌림). '…추가' 버튼 보라 테두리.
  - `/admin/storefront-menu`: 제목 오른쪽 [되돌리기], 링크 줄마다 칸·스위치·아이콘 버튼(보라 테두리), 아래 고정 저장 바가 화면 아래에 붙어 있음(375 에서 줄바꿈되고 잘리지 않음).
  - `/admin/admin-accounts`: 새 계정 칸, 표 열 6개(1366 에서도 960px 를 넘지 않게 맞춰 표 안 스크롤이 생길 수 있음), 버튼 넷 보라·빨강 테두리. 빈 아이디로 [관리자 ID 추가]를 누르면 칸 아래 빨간 띠(요청 없음). 비밀번호 창에서 확인 칸을 다르게 넣으면 빨간 글.
  - `/admin/menu-management`(국어·영어): 제목 '메뉴관리 · 국어/영어' + 오른쪽 과목 전환기(375 에서는 제목 아래). 제목 아래 저장 줄 [일반 메뉴 저장], 관리자 패널 카드 안 저장 줄 [관리자 패널 순서 저장]. 띠 순서: 상단 메뉴 링크 안내(주의) → 헤더 규칙(정보) → 상위 메뉴 없음(해당할 때) → 가져오기 안내. 표 4개 열 그대로, 표 안 버튼 보라 테두리·삭제/보관만 빨강 글자, 배지 1단계 파랑·2단계 회색. 직접 해 보기: 순서 하나를 바꾸면 그쪽 저장 줄만 'n건', 다른 쪽은 그대로. 삭제·보관 확인 창 첫 초점 [취소]·Esc 로 닫힘(확정은 누르지 않음).
  - `/admin/footer`: 제목·설명 그대로, 머리줄 버튼 없음. 카드마다 저장 줄(사이트 이름, 공지 팝업 — 옆에 [미리보기], 가입 동의 안내 문구, 구매 고지), '기본 사업자 정보' 카드 바로 위에 [하단 정보 저장] + [되돌리기]. 가입 동의 표 열 10개·[수정]·[다시 동의 받기] 32px, 375 에서는 표 안 가로 스크롤·첫 열 고정. 고지 중이면 호박 주의 띠. 공지 팝업 [저장]은 지금처럼 확인 창을 먼저 연다(고지가 끊기는 경우 확정 진한 빨강), 재동의 확인 창 확정도 진한 빨강 — 확정은 누르지 않는다.
  - `/admin/footer/policy-history`: 뒤로 가기 링크·제목(3xl → 2xl)·설명, 사본 목록, 비어 있으면 점선 '사본이 없습니다.' 칸, 날짜 표기 그대로.
  - `/admin/pricing` 아래 동의 편집기: '…추가'·[항목 추가] 주황 → 보라 테두리, 오류 글자 진한 빨강, 지문 힌트 호박색, 칸·순서 그대로.
- 대표가 정할 것: 위 판단 1~11(특히 1 날짜, 2 숫자 표기, 3 상태 색, 5 변경 없으면 저장 막힘). 확인 뒤 push 는 대표가 정한다. 비교가 끝나면 `git worktree remove ../create_quiz_ai-before`.

## 구현 메모 (5단계)
작성일: 2026-11-27. 5단계 회원·고객(`/admin/users`·`/admin/users/[id]`, `/admin/support`, `/admin/refunds`, `/admin/credits`, `/admin/reviews`, `/admin/audit-log`)만 했다. 다른 화면·공용 `payment-sales-panel.tsx`(대시보드와 함께 씀)·DB 는 건드리지 않았다. 커밋·push 하지 않았다.

**바꾼 파일**
- 제목줄 `AdminPageHeader`: users·users/[id]·support·refunds(도구 칸 [새로고침])·credits·reviews(안쪽 `p-8 pt-6` 이중 여백 없앰)·audit-log(탭 밑줄 보라).
- 표 `AdminDataTable`: 회원 목록(카드형 → 표, Q2, 900px), 회원 상세 표 4개(640px), 문의 목록(카드형 → 표, 860px, 행 누르기 = 첫 열 제목 단추), 충전 환불·자료 환불(900px), 수동 확인 주문(760px), 크레딧 거래(760px), 후기(860px — 1단계 메모의 '가로 넘침 틀 없음' 해소), 작업 기록·개인정보 열람(760px).
- 필터 줄 `AdminFilterBar` + '결과 n건': 회원(검색 + '정지 중만 보기'), 문의(검색·상태·카테고리·삭제 포함 + [적용]·[초기화] 그대로), 충전 환불(상태 고르기), 크레딧(검색·유형 + [크레딧 지급]), 후기, 작업 기록 두 탭. 주소 키·주소 고치기 함수는 그대로.
- 지표 카드 `AdminMetricCard`: 크레딧 5장, 문의 4장, 충전 환불 4장(누르면 그 상태로 거름 — 전과 같은 동작, 눌림 표시).
- 확인 창 `confirm(` 9곳 → 공통 확인 창
  - 유형 (가) 7곳: 메모 지우기·가림(users/[id]), 카테고리 숨김·다시 사용, 템플릿 숨김, 템플릿 바꾸기(쓰던 글이 있을 때), 후기 삭제. 문구는 전 확인 창 그대로(제목 + 설명으로 나눔). 다시 사용만 보라 확정, 나머지는 진한 빨강.
  - 유형 (나) 2곳(`market-refunds-client.tsx` `processRefund`·`submitOwnerSettle`): 같은 try 안에서 `processingId` 를 쥔 채 `await ask()`. 창은 각 처리 창 안에 그린다(훅 2개). 대표 정산의 '확인 → 잠금 넘김 → 같은 함수 다시 부름' 흐름은 그대로.
- 알림 창 `alert(` 2곳(후기) → 같은 문구의 화면 안 오류(읽기 = 행이 없으면 표 실패 칸·있으면 오류 띠 + [다시 시도], 삭제 = 위쪽 오류 띠, 1단계와 같은 방식).
- 저장 줄(인라인 3개, 저장 함수 하나씩): 정지 정책 카드(대표), 고객지원 '안내 문구' 탭(대표), 크레딧 기본 한도 카드(편집 칸).
- 배지 `AdminStatusBadge` + `adminStatusTone`, 오류·주의 띠 `AdminNotice`, 표 안 버튼 `adminTable`(위험 동작은 빨강 글자), 위험 확정 `adminDanger`(정지 확정·회수 확정·익명화·자료 환불 거부·충전 환불 거부), 주황 `adminAction`·파랑·검정 버튼 → 보라.
- 개인정보 칸 `data-admin-pii`: 회원 이메일·전화·표시 이름, 관리자 메모(메모 패널·정지 사유·내부 메모·처리 메모·정산 메모), 문의 제목·본문·답변·쓰던 글·이전 답변, 후기 본문(표·삭제 확인 창), 환불 사유, IP, 작업 기록 대상·상세, 보관 연락처, 익명화 확인 이메일 칸, 검색칸.
- `src/lib/admin-status-tone.ts`: 5-1 표에 **크레딧 거래 종류**(충전 초록·관리자 지급 호박·환불 지급/사용 취소 파랑·회수 빨강·사용/탈퇴 소멸 회색)·**문의 카테고리/답변 템플릿 사용·숨김** 줄, 순수 함수 `creditAmountTone`(Q6: 사용 차감은 기본 글자색, 회수만 빨강, 늘어난 것 초록).
- 그대로 둔 것: 13번 열람 기록 호출(`recordMemberAccess`·`attachMemberContacts`)·화면 키·항목·기록 실패 때 가림(시험이 다섯 page 의 18줄을 e3a37d9 지문으로 봄), 12번 정지·메모 요청·권한 조건, 10번 탈퇴 패널 흐름(버튼 변형·가림 표시만), 지급 창의 요청·검사·멱등 키, 모든 fetch·서버 액션·가드·주소 키.

**시험**
- `admin-kit-screen-parity`(+20건, 6화면 반복 6건 포함): 6-2 대조 항목을 e3a37d9 에서 뽑은 6화면 목록, 열람 기록 지문, 유형 (가) 7곳(ask → 취소면 멈춤 → 그 뒤 요청), 유형 (나) 2곳은 함수를 떼어 실제로 돌림(409 → 확인 → `confirmedRefundCredits: 60` 재요청, 취소면 재요청 없음, 창이 열린 동안 `processingId` 유지), 열·버튼·조건·가림 표시·날짜 표기, 저장 줄 3개 = 저장 함수 하나씩.
- 래칫: `confirm(` 목록에서 6파일, `alert(` 목록에서 후기, `adminAction` 목록에서 10파일을 뺌. `toLocaleString(` 상한을 줄임(충전 환불 21 → 0, 회원 상세 15 → 1 등). 남은 것은 날짜 표기·회수 알림 문장·탈퇴 패널 숫자.
- 같은 뜻으로 바꾼 기존 단언: `market-refund-approve-rpc:254`(`window.confirm(` → `await ask({ title: '일부만 돌려줄 수 있습니다', description: shortfall.error`, 9절 예정 항목, 부족분·`send(shortfall.restorable)` 단언 유지), `bundle13-cs-tools-support-contract`(템플릿 바꾸기 `!confirm(` → `!(await ask({`), `admin-member-detail-contract`(배지·오류 띠), `admin-sidebar-permission-contract`(지급 버튼은 '작업' 열을 권한 있을 때만 넣음), `admin-credit-transactions-list`(`valueUnavailable`), `bundle10-member-withdrawal-contract`(보류 주문 안내 글자색), `admin-kit-status-tone`(새 두 줄).

**구현 때 판단한 것(대표 확인 대상)**
1. **날짜 표기는 화면마다 지금 모양 그대로**(`toLocaleString`/`toLocaleDateString` ko-KR, 후기 `YYYY.MM.DD`, 메모·정지 `formatKstDateTime`).
2. **숫자 표기가 공통 함수로**: 충전 환불 금액 '₩9,900' → '9,900원', '1,000 크레딧' → '1,000 C', 거래 증감 '+1,000' → '+1,000 C'(회원 상세·크레딧 관리·지급 확인), 회수 확인 '-1,000' → '−1,000 C', 빈 금액 '-' → '–'. 문의 건수 카드의 세지 못한 값 '-' → '확인 불가'.
3. **색**: 거래 금액 — 사용 차감 빨강 → 기본 글자색(Q6), 회수 빨강, 늘어난 것 초록. 충전 환불 배지 — 대기중 노랑 → 호박, 환불 완료 초록 → 파랑, 재처리 주황 → 호박, 수동 확인 빨강 → 호박(5-1 표). 자료 환불 배지 회색 → 상태별. 관리자 배지 주황 → 파랑. 문의 상태 5-1 표. 약관 '동의' 회색·'동의하지 않음' 빨강.
4. **회원·문의 목록이 표가 됨**(Q2). 회원 열 7개(회원·연락처·소속·역할·가입일·크레딧·작업 — '작업' 열은 지급 권한이 있을 때만). 문의 열 6개, 제목을 눌러 연다(전에는 줄 전체). 회원이 지운 문의의 흐림 → 취소선 + '고객삭제' 배지.
5. '총 n명/검색 결과 n명'(회원)·'총 n건'(후기) → 필터 줄 오른쪽 '결과 n건'. 문의·환불·크레딧·작업 기록에도 새로 생김.
6. **저장 줄을 모두 인라인으로 둠**: 세 곳 모두 그 주소의 저장 함수는 하나지만 접는 카드(정지 정책)·대표 탭(안내 문구)·편집 칸(기본 한도) 안이라, 화면 아래 고정 바가 목록 위를 늘 덮지 않게 했다. 정지 정책은 변경 없이도 전처럼 누를 수 있다(`saveWhenClean`, 서버가 '바뀐 내용이 없습니다'). 안내 문구·기본 한도는 **변경이 없으면 저장이 막힌다**(2·3단계 판단 5와 같음, 전에는 늘 누를 수 있었음).
7. 유형 (나) 확정 버튼 이름(초안): '복구 가능한 만큼 환불', '돌려줄 수 있는 만큼 정산'. 영향 목록 '요청 N C / 복구 가능(돌려줄 수 있음) N C'.
8. 주의 띠(`AdminNotice warning`)는 `role="status"` 다. (검증 반영) 고객지원의 링크 문의 주의 문구('링크의 문의를 찾지 못했습니다'·'탈퇴 회원의 문의…')는 새 선택 속성 `role="alert"` 로 전처럼 바로 읽힌다. 전에 `role="alert"` 였던 주의 문구(정지 기한 경고·익명화 경고·링크 문의 못 찾음·거절 알림 실패·빈칸 남음)는 화면 읽기에서 덜 급하게 읽힌다. 오류 띠는 그대로 `alert`.
9. 후기: 늦게 온 앞 요청의 읽기 실패는 띠로 보이지 않는다(지금 보이는 목록과 맞지 않아서, 전에는 알림 창이 떴을 수 있음). 오류 위치는 1단계처럼 위쪽 띠·표 칸.
10. 문의 구역 전환(문의 목록·카테고리·템플릿·안내 문구) 검정/흰 버튼 → 보라/보라 테두리(`aria-pressed`).
11. 지급 창: 검색 결과 줄·대상 칸 파랑 → 보라 옅은 바탕, [지급 확정] 파랑 → 보라. 지급 금액 입력칸의 'Credit' 꼬리표는 그대로 두었다(확인 단계만 '+N C' — 판단 2와 함께 대표가 정함). 요청·검사 줄은 HEAD 와 같다(`grant-credit-dialog.tsx:134` `catch (error: any)` eslint 1건은 HEAD 부터 있던 줄이라 두었다).

**확인 결과**
- `node --test tests/*.test.mjs`: 2449건 중 실패 43. 작업 전(e3a37d9, 같은 작업 트리에서 먼저 돌림) 2429건 중 43과 실패 이름이 같다(새 실패 0). 대조 시험 42건 통과.
- `npx tsc --noEmit -p .`: `.next/` 밖 오류 0.
- 바꾼 src 파일 eslint: 1건(위 11, HEAD 부터 있던 줄).

**대표 화면 비교 순서(내가 실행하지 않음)**
- '바꾸기 전'은 e3a37d9(지금 HEAD). `git worktree add ../create_quiz_ai-before e3a37d9` → 그 폴더에서 `node_modules`·`.env.local` 을 링크하고 `npx next dev -p 4001`, 지금 폴더(바뀐 코드)는 4000. 로그인은 1단계 메모 순서대로.
- **주의**: 이 화면들은 열기만 해도 13번 열람 기록이 쌓인다(회원 목록·상세·문의·환불·크레딧). 전 화면은 개인정보 칸을 가리지 않으니 사진을 밖에 공유하지 않는다. 쓰기 요청은 스크립트가 막는다.
- 주소: `/admin/users,/admin/users?suspended=1,/admin/users/<시험 계정 id>,/admin/support,/admin/support?status=pending,/admin/refunds,/admin/credits,/admin/credits?type=consume,/admin/reviews?subject=korean,/admin/reviews?subject=english,/admin/audit-log,/admin/audit-log?tab=access`
  - 전: `node scripts/admin-visual-snapshot.mjs capture --label before-s5 --base http://localhost:4001 --paths <위 주소>`
  - 후: `node scripts/admin-visual-snapshot.mjs capture --label after-s5 --paths <위 주소> --confirm '/admin/reviews?subject=korean::삭제'`(후기가 있을 때만. 유형 가라 요청 없이 창만 열림. 전 화면은 브라우저 창이라 찍히지 않는다)
  - 후기 좁은 폭(1단계 메모): `capture --label after-s5-reviews --paths /admin/reviews --viewport 800x768 --viewport 900x768` — 표가 카드 밖으로 삐져나오지 않고 표 안에서만 옆으로 밀려야 한다.
- 볼 것(세 폭 1366·1024×768·375×667)
  - `/admin/users`: 제목·설명, 정지 정책 카드(대표, 접힘 → [펼치기] 보라 테두리, 펼치면 아래 저장 줄 '변경 없음' + 켜진 [저장]), 필터 줄(검색 보라 [검색]·'정지 중만 보기'·'결과 n건'), 표 열 7개, 배지(관리자 파랑·정지 빨강·탈퇴 회색·가입 방식 회색), 크레딧 'N C' 오른쪽 정렬, [크레딧 지급] 보라 테두리(탈퇴 회원 줄엔 없음), 375 에서 표 안 가로 스크롤·첫 열(회원) 고정, 쪽 넘김 그대로. [크레딧 지급] → 지급 창(직접, 지급 확정은 누르지 않음): 칸·순서 그대로, 확인 단계 '+N C' 초록.
  - `/admin/users/<id>`: '← 사용자 관리', 제목·설명, 대표면 제목 아래 '이 회원 열람 기록' 링크(보라). 프로필 카드 배지, 이용 정지(정지 중이면 빨강 테두리 칸·배지, [정지] 진한 빨강 — 창은 열어 보기만, 정지 확정 진한 빨강), 관리자 메모(메모가 있으면 [지우기]·[가림] 빨강 글자 → 확인 창 첫 초점 [취소]·Esc, 확정은 누르지 않음), 크레딧 잔액 'N C'·표 열 6개(회수 권한 있을 때), 충전 결제·마켓 구매·크레딧 거래 표(사용 차감 기본 글자색 '−N C', 회수만 빨강), 환불 요청·문의·약관 동의 목록 배지, 탈퇴 구역(익명화 경고 호박 띠).
  - `/admin/support`: 지표 카드 4장(세지 못하면 '확인 불가'), 구역 전환 보라, 필터 줄(검색·상태·카테고리·삭제 포함·[적용] + '결과 n건'·[초기화]), 표 열 6개, 제목 눌러 상세 창(문의 내용·답변·회원 요약·템플릿 넣기 보라 테두리, [답변 등록] 보라). 카테고리 관리: [수정] 보라 테두리, [숨김 처리] 빨강 글자 → 확인 창(확정 진한 빨강, 누르지 않음), 숨김 줄 [다시 사용] → 확인 창(보라 확정). 답변 템플릿: [숨김] → 확인 창. 안내 문구(대표): 머리 아래 저장 줄(변경 없으면 막힘), 칸 하나를 고치면 '저장 안 된 변경 1건'(저장하지 말고 새로고침).
  - `/admin/refunds`: 제목 오른쪽 [새로고침] 보라 테두리, 판매 패널 그대로, 결제 확인 필요 카드(경보 배지 긴급 빨강·주의 호박, [해소]·[확인 처리] 보라 테두리, 수동 확인 주문 표 열 7개), 지표 카드 4장(누르면 필터가 바뀌고 카드가 보라 테두리), 필터 줄 + '결과 n건', 충전 환불 표 열 9개(금액 'N원', 배지 색 위 3), [승인]·[수동 완료] 보라 테두리·[거부] 빨강 글자, 처리 창(직접 열기만): 안내 띠(승인 파랑·거부 호박), 확정 버튼 보라/진한 빨강. 자료 환불 표 열 9개, [대표 정산]·[승인]·[거부]. **부족분 확인 창(유형 나)은 실제 처리 요청이 나간 뒤에만 뜨므로 운영 DB 에서 띄우지 않는다**(시험이 흐름을 돌려 봄). 떴을 때: 제목 '일부만 돌려줄 수 있습니다', 서버 안내, 영향 목록 두 줄, 처리 창 위에 겹쳐 뜨고 처리 창 버튼은 '처리 중...'으로 막혀 있음.
  - `/admin/credits`: 지표 카드 5장('+N C' 모양), 기본 한도 카드([변경] 보라 테두리 → 칸 + 저장 줄, 변경 없으면 막힘 — 저장하지 않는다), 필터 줄(검색·유형·[크레딧 지급] 보라 + '결과 n건'), 거래 표 열 5개(유형 배지 색 위 3, 금액 색 Q6).
  - `/admin/reviews`(국어·영어): 제목 '후기 관리 · 국어/영어'·설명, 필터 줄(검색·별점 + '결과 n건'), 표 열 7개, [삭제] 빨강 글자 → 확인 창(자료명·본문, 확정 진한 빨강 — 누르지 않음). 800~900px 에서 표가 카드 밖으로 나오지 않음.
  - `/admin/audit-log` 두 탭: 탭 밑줄 보라, 필터 줄(+ '결과 n건'), 표 열 7개씩, [상세] 보라 테두리(상세 창 그대로), 열람 탭 '회원:' 필터 칩의 [필터 해제] 보라 테두리.
- 대표가 정할 것: 위 판단 1~11(특히 2 숫자 표기, 3 색, 4 표로 바뀐 목록, 6 저장 줄 위치·막힘, 8 주의 띠 읽기). 확인 뒤 push 는 대표가 정한다. 비교가 끝나면 `git worktree remove ../create_quiz_ai-before`.

**5단계 검증 반영(3관점 PASS·minor)**
- `data-admin-pii` 보강: 문의 상세 창 제목·연락처 줄, 열람 기록 탭 '회원' 열·회원 필터 칩, 정지 기록의 '알림'(요약)·'해제'(사유) 값, 탈퇴 패널 본인 확인 메모·고지 원문·익명화 사유 칸.
- 부품: `AdminNotice` 에 선택 속성 `role`(주지 않으면 지금처럼 오류 alert·나머지 status). 고객지원 링크 문의 주의 문구만 `role="alert"`.
- 대조 시험: 기본 한도·안내 문구 저장 줄에 `saveWhenClean` 이 없음(변경 없으면 막힘)을 단언으로 고정, 위 가림 표시·role 단언을 더함.

