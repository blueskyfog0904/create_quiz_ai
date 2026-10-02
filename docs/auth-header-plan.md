# 로그인·회원가입 화면 최신 헤더 적용 계획

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD df76fb6) · 상태: 계획 초안. 코드는 아직 변경하지 않았다.
- 요청: "로그인 로그아웃 페이지도 헤더가 구형 헤더야. 최신 디자인 헤더로 일치시켜줘"(/login 스크린샷: 구형 헤더 + 로그인 카드).

## 1. 요청 분석

**사실(근거)**
- `src/app/(auth)` 아래 페이지는 `login/page.tsx`, `signup/page.tsx` 둘뿐이다. `(auth)`에는 layout이 없다. 로그아웃은 `/api/auth/logout` 후 `/login?logout=success`로 이동하고 `LoginCompleteDialog`가 '로그아웃 완료'를 띄우므로 '로그아웃 페이지'는 별도 라우트가 아니라 **/login**이다(`mypage-menu.tsx`·`LogoutButton` 모두 같은 주소). 비밀번호 찾기 페이지는 없다. OAuth 오류·callback 실패도 `/login?error=…`로 같은 페이지가 표시한다. `src/app/auth`에는 `callback/route.ts`(리다이렉트 전용)와 페이지 없는 `layout.tsx`뿐이다.
- 지금 /login·/signup은 루트 `template.tsx`의 `PathAwareSiteChrome`이 구형 `Header`·`Footer`를 입힌다. 이 컴포넌트는 `/`, `/pricing`, `/library`, `/cart`, `/search`, `/categories`, `/mypage`, `/admin`, `/terms`, preview 경로를 제외 목록으로 두고 그 외 경로에만 구형 크롬을 붙인다.
- 선례 `6efe9c2`(/terms)는 ① `path-aware-site-chrome.tsx`의 제외 조건에 경로를 추가하고 ② `src/app/terms/layout.tsx`에서 `StudioThemeShell` + `PreviewHeader` + `SolvookFooter`를 렌더했다. 헤더와 푸터를 함께 바꾼다(제외하면 구형 헤더·푸터가 둘 다 빠지기 때문).
- `PreviewHeader`는 비로그인일 때 `로그인`·`회원가입` 링크를 보여 주고, 링크는 `buildAuthRedirectPath(currentLocation, …)`로 현재 위치를 `next`로 넘긴다. 그런데 `normalizeAuthNextPath`는 현재 경로가 `/login`·`/signup`이면 `/`로 돌려 보내므로 **/login에서 헤더의 `로그인`·`회원가입` 링크를 누르면 기존 `next`가 사라진다**(`/login?next=/market/x` → `/signup`).
- 과목은 `?subject=`가 있으면 그 값, 없으면 `initialSubject`(layout 기본 `korean`)다. /terms layout도 기본값을 쓴다. 로그인·회원가입 페이지에는 `subject` 쿼리가 없다.
- 로그인·회원가입 본문은 `min-h-[calc(100vh-150px)]` 중앙 정렬 + `Card`이고 `<main>`을 렌더하지 않는다. `StudioThemeShell`은 홈 외 경로에 흰 배경(`--studio-surface`)을 준다.
- 기존 제약 테스트: `solvook-preview-flow-contract`는 path-aware에 `/preview/solvook-concept` 정확 일치·`${root}/` 경계 확인이 있어야 하고 `pathname.startsWith(식별자)`와 `startsWith('/preview/')`는 금지하며 `<main` 1개를 확인한다. `studio-adoption-contract`는 소비처의 raw hex를 금지한다. `auth-login-complete-dialog-contract`는 `login/page.tsx`·callback·템플릿의 `login=success` 흐름을 고정한다.

**결정**
- D1 **대상**: `/login`, `/signup`. 관리자 로그인 `/admin/login`은 이미 `/admin/` 접두 제외 목록에 있고 자체 화면(`admin-login-view`)을 쓰는 관리자 전용 UI라 제외한다.
- D2 **구현 방식**: /terms 선례와 같다. (a) `src/app/(auth)/layout.tsx` 신규(route group이라 /login·/signup에만 적용, URL 불변) (b) `path-aware-site-chrome.tsx` 제외 조건에 `pathname === '/login' || pathname === '/signup'`(리터럴 정확 일치만, `startsWith` 없음) 추가. 두 변경이 쌍이므로 한쪽만 들어가면 헤더가 둘이거나 없다(검증 1·2).
- D3 **layout 구성**: terms layout과 같은 `StudioThemeShell` > `PreviewHeader`(`Suspense`) > `<main className="flex-1">` > `SolvookFooter`. 두 페이지가 `<main>`을 렌더하지 않으므로 landmark는 layout의 `<main>` 하나로 둔다. `getRequestAuthUserId`로 `isLoggedIn`·`userId`·`cartCount`를 넘긴다(비로그인이 기본, 이미 로그인한 사용자가 접근해도 정상 표시).
- D4 **헤더 변형**: 비로그인 기본 표시 그대로 둔다(로고·검색·카테고리·과목 탭·캐시 충전·`로그인`·`회원가입`). 로그인 페이지에서도 `로그인`·`회원가입` 링크를 숨기지 않는다(다른 페이지와 같은 헤더, 솔북도 동일). 단 위 사실의 `next` 유실을 막기 위해 `preview-header.tsx`의 `loginHref`·`signupHref` 계산에서 현재 경로가 `/login` 또는 `/signup`이면 `searchParams.get('next')`를 `next`로 쓴다(그 외 경로는 지금과 동일). 크레딧·장바구니·마이페이지는 로그인 상태에서만 보이는 기존 동작을 따른다.
- D5 **과목**: `/terms`와 같이 기본 `korean`. 쿠키(`preferred_workspace`)를 읽는 변경은 하지 않는다(선례와의 일관성, 요청 범위 밖). 헤더 과목 탭을 누르면 홈(`/?subject=…`)으로 이동하는 기존 동작은 그대로다.
- D6 **푸터는 함께 바꾼다**: 제외 목록에 넣으면 구형 푸터도 같이 빠지므로 구형 푸터만 남기려면 별도 코드가 필요하고, /terms 선례와 같은 `SolvookFooter`가 일관된다. 푸터 내용은 구형·신형이 같은 `site_footer_content` 설정을 읽는다. **사용자 확인 필요(낮음)**: 사용자가 헤더만 언급했으므로 푸터까지 바뀌는 것이 괜찮은지 알린다.
- D7 로그인·회원가입 카드 본문은 바꾸지 않는다. 본문의 `min-h-[calc(100vh-150px)]`는 구형 헤더·푸터 높이를 가정한 값이라 신형 헤더(데스크톱 약 120px)에서는 여백이 달라질 수 있어 4단계에서 확인만 하고 조정은 하지 않는다.

**불명확점**: D6(푸터 동반 변경)만 사용자 확인이 필요하다. 나머지는 선례와 코드로 결정했다.

## 2. 대상 경로와 비대상
- 대상: `/login`(`?next`, `?logout=success`, `?error` 포함), `/signup`(OAuth·가입 단계 화면 전부 같은 라우트).
- 비대상: `/admin/login`(관리자 전용), `/auth/callback`(리다이렉트 전용), 그 외 모든 경로(제외 조건은 두 경로 정확 일치만 추가하므로 영향 없음).

## 3. 단계별 작업과 검증
각 단계는 독립 검증자의 OK를 받은 뒤 다음으로 간다(AGENTS 작업 Loop).
- **S0 기준선**: `git status --porcelain`·`git diff --stat` 기록, `node --test tests/solvook-*.test.mjs tests/studio-adoption-contract.test.mjs tests/auth-login-complete-dialog-contract.test.mjs 2>&1 | tail -5`, `npx tsc --noEmit` 결과 기록. 현재 /login HTML에서 구형 헤더 표지를 기록한다(`curl -s localhost:4000/login`, 로컬 dev 포트는 실행 중인 서버 기준).
- **S1 테스트 먼저**: `tests/auth-chrome-contract.test.mjs` 신규(4절). 검증: 구현 전 새 assert가 실패한다.
- **S2 layout + 제외 조건**: `src/app/(auth)/layout.tsx`, `path-aware-site-chrome.tsx`. 검증: `npx tsc --noEmit`, `npx eslint` 대상 파일 exit 0, `curl -s localhost:4000/login`·`/signup`의 HTML에서 `<header`가 정확히 1개이면서 신형 표지(`studio-reference-gutter`, `nav aria-label="상단 메뉴"`)가 있고 구형 헤더 class(`border-b bg-white sticky`)와 구형 푸터 class(`mt-auto border-t bg-white py-8`)가 없으며 `<main`이 1개다. `curl -s localhost:4000/admin/login`·`/terms`·`/mypage`의 크롬이 이전과 같다.
- **S3 next 보존**: `preview-header.tsx` `loginHref`·`signupHref`만 수정. 검증: 테스트 통과, 브라우저 `/login?next=%2Fmarket%2Fx%3Fsubject%3Dkorean`에서 헤더 `회원가입` 링크의 `href`가 `/signup?next=%2Fmarket%2Fx%3Fsubject%3Dkorean`이고 `로그인` 링크는 `/login?next=…`이다. `/signup?next=…`에서도 같다. 다른 페이지(예: `/search`)에서는 기존처럼 현재 위치가 `next`다.
- **S4 브라우저 회귀**(dev, 1280px·768px·320px): ① /login·/signup에 신형 헤더(로고 `써머썬 연구소`, 검색, 카테고리, 국어/영어, `캐시 충전`, `로그인`, `회원가입`)와 솔북 푸터가 보이고 구형 요소가 없다 ② 헤더와 카드 사이 여백이 어색하지 않고(과도한 공백·잘림 없음) 320px에서 `document.documentElement.scrollWidth <= innerWidth` ③ 이메일 로그인 → `next`로 복귀 + '로그인 완료' Dialog ④ 카카오 버튼의 `redirectTo`에 `next`가 실린다(계정이 있으면 실로그인) ⑤ 마이페이지 드롭다운에서 로그아웃 → `/login?logout=success`에 신형 헤더와 '로그아웃 완료' Dialog, 확인 후 쿼리만 제거 ⑥ 상세에서 [로그인 후 담기] → /login → 로그인 → 상세 복귀 후 담기 완료 Dialog(12·13절 흐름 회귀) ⑦ 로그인 상태로 /login에 접근해도 오류 없이 표시 ⑧ 헤더 `로그인`·`회원가입` 링크 이동 시 `next` 유지 ⑨ 모바일 헤더(`lg` 미만)가 정상 표시.
- **S5 통합**: `npm run lint`·`npm run build` 새 실패 0, `node --test` 새 실패 0(S0 대비), 사용자 기존 변경 보존(`git checkout`/`restore` 금지).

## 4. 테스트
- 신규 `tests/auth-chrome-contract.test.mjs`(소스 계약): `(auth)/layout.tsx`가 `StudioThemeShell`·`PreviewHeader`·`SolvookFooter`를 렌더하고 `<main` 1개 · path-aware가 `pathname === '/login'`·`pathname === '/signup'` 리터럴을 갖고 `startsWith('/login')`·`startsWith('/signup')`는 없다 · `/admin/login`용 `/admin/` 제외는 그대로 · `preview-header.tsx`가 `/login`·`/signup`일 때 `searchParams.get('next')`를 `loginHref`·`signupHref`에 쓰고 그 외에는 `currentLocation`을 쓴다 · 새 파일에 raw hex가 없다.
- 기존 테스트 영향: `solvook-preview-flow-contract`(path-aware 정확 일치·경계·`<main` 개수)는 리터럴 두 개 추가만으로 통과해야 한다. `studio-adoption-contract`·`auth-login-complete-dialog-contract`는 수정 없이 통과해야 한다. `main-owner` 테스트는 path-aware·preview layout만 세므로 새 layout의 `<main>`은 영향이 없다.
- 브라우저로만 확인되는 항목: 3절 S4 ③~⑨(로그인·OAuth·로그아웃·복귀·담기 의도).

## 5. 위험
| 위험 | 대응 |
|---|---|
| 제외 조건과 layout이 한쪽만 적용되어 헤더가 중복되거나 없다 | 두 변경을 같은 단계 S2에 묶고 curl로 `<header` 1개와 신형·구형 표지 확인 |
| 헤더 링크가 `next`를 잃어 로그인 후 복귀가 깨진다 | D4 수정과 S3 검증, 기존 `auth-login-complete-dialog-contract` 유지 |
| `min-h-[calc(100vh-150px)]` 본문과 신형 헤더·푸터 높이가 맞지 않아 여백이 어색하다 | S4 ②에서 육안 확인, 문제면 본문 조정은 별도 요청으로 분리(이번 범위 밖) |
| 미들웨어가 `/login`에서 `x-auth-user-id`를 주지 않아 로그인 상태가 헤더에 틀리게 보인다 | S4 ⑦에서 로그인 상태 접근 확인(헤더는 서버 값이 없으면 비로그인으로 표시되므로 안전한 방향) |
| 푸터까지 바뀌는 데 대한 의도 차이 | D6을 사용자 확인으로 표시, layout에서 푸터 한 줄 제거로 쉽게 되돌릴 수 있음 |
| 로그인 후 담기 의도·`login=success` 흐름 회귀 | S4 ③⑤⑥ 회귀 확인(코드 변경은 헤더 링크 계산뿐) |
| 영어 사용자가 로그인 화면에서 국어 탭이 활성으로 보인다 | D5로 선례(/terms)와 같게 수용, 필요 시 후속에서 쿠키 반영 |

## 6. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 계획 초안 | (대기) | | |
| 구현 | (auth)/layout.tsx·path-aware-site-chrome·preview-header·계약 테스트 | 독립 검증 | OK | /login·/signup·logout 화면 신형 헤더·푸터 1개, 구형 DOM 0, next 유지, 회귀 없음. tsc·build 통과, node 980건 fail 39(새 실패 0). 브라우저 시각·로그인 흐름은 사용자 확인 |
