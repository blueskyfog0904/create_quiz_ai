# 마이페이지 hover 드롭다운 메뉴 계획

- 작성일: 2026-10-01 · 브랜치 feature/market-cart(HEAD d5ee403) · 상태: 사용자 결정 반영본(7절). 코드는 아직 변경하지 않았다.
- 요청: 솔북처럼 헤더의 '마이페이지'에 마우스를 올리면 관련 메뉴가 아래로 열리고, 구현된 기능 링크와 로그아웃이 있어야 한다. 로그아웃은 주황색에 가까운 빨간색으로 눈에 띄어야 한다.

## 1. 요청 분석

**사실(근거)**
- 공유 헤더는 `src/app/preview/solvook-concept/_components/preview-header.tsx`다. `(solvook)/layout.tsx`, `preview/solvook-concept/layout.tsx`, `terms/layout.tsx`가 이를 렌더하므로 홈·검색·카테고리·보관함·장바구니·마이페이지·약관·preview 전체에 적용된다. 데스크톱(`hidden lg:block`)의 로그인 상태에서만 `[크레딧][장바구니][자료 보관함][마이페이지]`가 보이고, 마이페이지는 `/mypage`로 가는 단순 `Link`다(`:374-380`).
- 모바일(`lg:hidden`) 상단에는 마이페이지 진입점이 없다(장바구니·검색 아이콘과 보관함·캐시 충전 링크뿐). 이 계획은 데스크톱만 다룬다.
- `src/components/layout/header-client.tsx`(전역 레거시 헤더)는 이미 Radix `DropdownMenu` **클릭** 드롭다운(결제 내역·크레딧 관리·내정보·히스토리·회원 탈퇴·고객지원)과 관리자 링크, 로그아웃 버튼을 가진다. `path-aware-site-chrome.tsx`가 `/`, `/pricing`, `/library`, `/cart`, `/search`, `/categories`, `/mypage`, `/admin`, `/terms`, `/preview/solvook-concept`에서는 이 헤더를 생략한다.
- 로그아웃 기존 구현은 두 가지다. `MypageLogoutButton`과 `LogoutButton`은 `POST /api/auth/logout`(서버 `supabase.auth.signOut()`) 성공 후 `window.location.href = '/login?logout=success'`로 이동한다. `header-client`는 클라이언트 `signOut()` 후 같은 주소로 이동한다. `src/app/template.tsx`의 `LoginCompleteDialog`가 `logout=success`일 때 '로그아웃 완료' Dialog를 띄우고 확인 시 쿼리를 지운다.
- 기존 헤더 테스트 제약: `solvook-preview-flow-contract:291-307`은 header 소스에 `선생님`·`학생`·`AI 문제생성`·`문제은행`·`라이브러리`가 없어야 한다고 본다. `studio-adoption-contract`는 Solvook 소비처의 Studio core hex(`#f46d5e` 포함) 직접 사용을 금지한다.
- `src/styles/studio-tokens.css`에는 danger/destructive 토큰이 없고, `--studio-highlight: #f46d5e`(코랄 레드)가 있다. Solvook 영역에서 기존 사용처는 배지 `bg-[var(--studio-highlight)] text-[var(--studio-ink)]`(payments·support·credits·library)다. 에러 문구는 `text-red-500` 같은 Tailwind 팔레트를 쓴다(payments·profile·withdraw).
- DESIGN.md: 44px 이상 hit area, 키보드 조작, focus-visible 링, 색만으로 전달 금지, 기존 shadcn/Radix 우선, destructive는 brand와 분리, radius·shadow는 Studio 토큰.

**결정**
- D1 **적용 범위**: `PreviewHeader` 데스크톱 로그인 상태만 바꾼다. 비로그인(로그인·회원가입 링크)과 모바일 상단은 그대로다. 레거시 `header-client`는 이미 클릭 드롭다운과 로그아웃이 있고 노출 경로가 다르므로 건드리지 않는다.
- D2 **primitive**: 기존 shadcn `DropdownMenu`(Radix)를 `modal={false}`와 제어 `open`으로 쓴다. roving focus, 방향키·Home/End·typeahead, Esc, `role=menu/menuitem`, `aria-expanded/haspopup`을 직접 만들지 않아도 된다. `HoverCard`는 메뉴 의미(`role=menu`, 키보드 이동)가 없어 쓰지 않는다. 헤더의 다른 팝업(카테고리·검색 과목)은 수제 구현이지만 방향키 이동이 없는 단순 패널이므로 이 메뉴에는 따르지 않는다.
- D3 **새 파일**: `src/app/preview/solvook-concept/_components/mypage-menu.tsx`(client)에 `마이페이지` 링크·메뉴 열기 버튼·항목 상수·로그아웃을 두고, `preview-header.tsx`는 기존 마이페이지 `Link` 블록을 `<MypageMenu libraryHref={libraryHref} />` 한 줄로 바꾼다(`/mypage` 링크는 이 파일로 이동). 헤더에는 `라이브러리` 문자열이 들어가지 않는다. 쓰이지 않게 되는 `UserRound` import는 헤더에서 제거한다. 크레딧·장바구니 배지(`MarketCartIndicator`)·검색·카테고리 코드는 손대지 않는다.
- D4 **트리거 구조(사용자 결정됨, 8절로 갱신)**: 보이는 트리거는 `마이페이지` `Link href="/mypage"` 하나뿐이다(별도 chevron 버튼 없음). 이 Link가 Radix `DropdownMenuTrigger asChild`의 child다. 마우스 클릭과 터치 탭은 `/mypage`로 이동하고, 마우스 hover가 메뉴를 연다. 키보드 진입 방식과 대안 비교는 8절.
- D5 **hover 동작(마우스 포인터만)**: Link를 감싼 `div`와 메뉴 content의 `onPointerEnter`(`pointerType==='mouse'`)에서 열고 닫기 타이머를 취소하며, `onPointerLeave`에서 150ms 지연 후 닫는다(카테고리 메뉴와 같은 지연값). `sideOffset=4`의 틈을 150ms 지연이 메운다. 터치·펜의 hover는 무시하므로 터치 탭은 메뉴 없이 Link 이동만 일어난다. pointerType 판정은 hover enter/leave에만 쓰고 click·pointerdown 열기 판정에는 쓰지 않는다(Safari: 18.2 미만 click의 `pointerType`이 `undefined`, iOS 18.2+는 터치 탭도 `'mouse'`로 보고되는 문제, 8절). **바깥 클릭 판정 보정**: `onInteractOutside`에서 `event.target`이 Link를 감싼 `div`(ref) 안이면 `preventDefault`해 Link 클릭이 먼저 닫지 않게 하고, Link `onClick`·`pathname` 변경 effect가 닫는다(헤더는 layout이라 언마운트되지 않는다). **포커스 훔침 방지**: hover로 연 동안 `onOpenAutoFocus`·`onCloseAutoFocus`와 항목 `onPointerMove`·`onPointerLeave`를 `preventDefault`하고 강조는 `hover:` 배경으로 대신한다. 키보드로 연 경우는 기본 동작을 유지한다.
- D6 **항목**(아래 2절 근거). 하드코딩 규칙(CLAUDE.md 2.5)은 상품·카테고리·ID·문구 목록 같은 **데이터**를 DB에 두라는 규칙이다. 앱 라우트로의 내비게이션 링크는 코드 구조(라우트 표)이며, 마이페이지 홈의 `MENU_ITEMS`와 `header-client`가 이미 코드 상수로 갖고 있어 같은 방식으로 컴포넌트 안 상수에 둔다. DB 메뉴(`header-navigation`의 `HeaderMenuItem`)는 문제마켓 카테고리용이라 쓰지 않는다. 존재하지 않는 라우트는 넣지 않고, 계약 테스트가 모든 href의 `page.tsx` 존재를 검사한다.
- D7 **관리자 링크는 넣지 않는다**: `PreviewHeader`와 세 layout은 `isAdmin`을 전달하지 않는다. 추가하면 모든 페이지의 layout에서 프로필 조회가 늘어난다. 관리자는 지금처럼 `/admin`으로 직접 들어간다.
- D8 **로그아웃**: 메뉴 맨 아래에 구분선과 함께 별도 항목을 둔다. 동작은 기존 `MypageLogoutButton`과 동일하다(`POST /api/auth/logout` → 성공 시 `window.location.href='/login?logout=success'`, 실패 시 `toast.error('로그아웃에 실패했습니다.')`). 기존 3곳은 수정하지 않고 같은 6줄 흐름을 이 파일에 둔다. `onSelect`에서 `preventDefault`로 메뉴를 유지하고 처리 중에는 `로그아웃 중…`·disabled로 중복 호출을 막는다. 이동 후 `LoginCompleteDialog`가 '로그아웃 완료'를 보여 준다.
- D9 **색(사용자 결정됨)**: 새 토큰이나 raw hex 없이 기존 `--studio-highlight`(코랄 레드)를 그대로 쓴다. 로그아웃 항목은 `bg-[var(--studio-highlight)] text-[var(--studio-ink)] font-extrabold`의 **채운 버튼형** 항목이고 `LogOut` 아이콘과 `로그아웃` 텍스트를 함께 둔다(색만으로 전달하지 않음). 흰 글자는 대비가 2.92:1이라 쓰지 않고, ink 글자(`#1c1f2e`)는 5.60:1이다(실측). 호버·포커스는 `data-[highlighted]:brightness-95`와 Studio focus-ring으로 구분한다. `--studio-danger` 같은 새 토큰은 추가하지 않는다.
- D10 스타일: content `w-60 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-2 shadow-[var(--studio-shadow-card)]`, 항목 `min-h-11 gap-3 rounded-[var(--studio-radius-control)] px-3 text-sm font-semibold text-[var(--studio-ink)] data-[highlighted]:bg-[var(--studio-background)]`, 아이콘 `h-5 w-5 text-[var(--studio-muted)]`, 구분선 `bg-[var(--studio-border)]`. 정렬은 `align="end"`(헤더 오른쪽 끝에서 화면 밖으로 안 나감). 임의 radius·hex 금지.

**불명확점**: 없음(D4·D9는 사용자 결정으로 확정, 7절). 모바일 상단에 마이페이지(로그아웃 포함) 진입점이 없는 점은 기존 공백이며 이 계획 범위 밖이다. 같은 `MypageMenu`를 모바일 아이콘에 재사용하는 후속 작업을 제안만 한다.

## 2. 항목 목록과 route 근거
실제 `page.tsx`가 모두 있다(2026-10-01 확인). `/mypage` 계열과 `/library`는 `src/app/(solvook)` 아래, `/pricing`은 `(solvook)` 밖인 `src/app/pricing/page.tsx`다. 순서는 솔북 배치(홈 → 이용 자료 → 결제 → 계정 → 지원 → 로그아웃)를 따른다.

| 순서 | 라벨 | href | 아이콘(lucide) | 근거 page.tsx |
|---|---|---|---|---|
| 1 | 마이페이지 홈 | `/mypage` | `UserRound` | `(solvook)/mypage/page.tsx` |
| 2 | 자료 보관함 | `libraryHref` prop(`/library` 또는 `?subject=korean`) | `Library` | `(solvook)/library/page.tsx` |
| 3 | 크레딧 관리 | `/mypage/credits` | `Coins` | `mypage/credits/page.tsx` |
| 4 | 크레딧 충전 | `/pricing` | `WalletCards` | `src/app/pricing/page.tsx` |
| 5 | 결제 내역 | `/mypage/payments` | `CreditCard` | `mypage/payments/page.tsx` |
| 6 | 생성/구매 히스토리 | `/mypage/history` | `History` | `mypage/history/page.tsx` |
| 7 | 내정보 관리 | `/mypage/profile` | `Settings`(또는 `UserCog`) | `mypage/profile/page.tsx` |
| 8 | 고객지원(1:1 문의) | `/mypage/support` | `HelpCircle` | `mypage/support/page.tsx` |
| - | 로그아웃 | 없음(동작) | `LogOut` | `/api/auth/logout` |

- 장바구니는 헤더에 별도 아이콘(배지 포함)이 있어 메뉴에 중복하지 않는다. 자료 보관함은 헤더 아이콘과 중복되지만 솔북과 같고 요청("구현된 기능을 드롭다운에")에 맞아 넣는다.
- 제외: `회원 탈퇴`(`/mypage/withdraw`)는 로그아웃 바로 옆 오클릭 위험이 있고 파괴적 행동이라 마이페이지 홈 바로가기에서만 접근한다. 솔북의 쿠폰·이용권·기기 관리·엑스퍼트·주문 내역은 이 저장소에 라우트가 없어 넣지 않는다(`주문 내역`에 해당하는 것이 `결제 내역`·`히스토리`). 리뷰 목록 페이지도 없다.

## 3. 접근성·동작 명세
- 트리거: `마이페이지` `Link`가 trigger다. 기존 시각 구성(아이콘 + `마이페이지` 11px, `min-h-11`)·focus-visible 링을 유지하고, Radix가 `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`를 붙인다. 스크린리더용 `aria-describedby`(sr-only '아래 화살표 키로 마이페이지 메뉴를 열 수 있습니다.')를 더한다(8절).
- 키보드: Tab으로 `마이페이지` Link 포커스 → Enter면 `/mypage` 이동(수정키 포함, 8절). ArrowDown 또는 Space면 메뉴가 열리고 첫 항목에 포커스 → 방향키·Home/End·typeahead 이동 → Enter로 이동 → Esc로 닫고 Link에 포커스 복귀. Tab은 메뉴를 닫고 다음 요소로 간다(Radix 기본).
- 포인터: 마우스 hover로 열림·지연 닫힘, Link 클릭은 `/mypage` 이동과 동시에 닫힘, 바깥 클릭으로 닫힘, 항목 선택(링크 이동) 시 닫힘. 터치: `마이페이지` 탭은 메뉴 없이 `/mypage` 이동(터치로 메뉴를 여는 방법은 없다, 사용자 승인).
- 항목은 `asChild` + `next/link`(`Link`)로 클라이언트 라우팅하고, 모든 항목과 트리거는 44px 이상이다. 320px 데스크톱 블록은 보이지 않으므로(`lg` 미만은 다른 헤더) 가로 overflow 대상이 아니다. `lg`(1024px)에서 content가 뷰포트 안에 머문다.
- 로그아웃 항목은 `role=menuitem`이고 처리 중 `aria-disabled`, 라벨 `로그아웃 중…`이다.

## 4. 작업 단계와 검증
각 단계는 독립 검증자의 OK 후 다음으로 간다(AGENTS 작업 Loop).
- **S0 기준선**: `git status --porcelain`·`git diff --stat` 기록, `node --test tests/solvook-*.test.mjs tests/studio-adoption-contract.test.mjs tests/market-home-ui-contract.test.mjs 2>&1 | tail -5`와 `npx tsc --noEmit` 결과 기록. `preview-header.tsx`에 미커밋 변경이 있으면 hunk를 기록한다. 검증: 기록 존재.
- **S1 계약 테스트 먼저**: `tests/solvook-mypage-menu-contract.test.mjs` 신규(5절). 검증: 구현 전 새 테스트가 실패한다(레드 확인).
- **S2 메뉴 컴포넌트**: `mypage-menu.tsx` 작성. 검증: `npx tsc --noEmit` exit 0, `npx eslint` 대상 파일 exit 0.
- **S3 헤더 연결**: `preview-header.tsx`에서 `Link` 블록을 교체하고 `UserRound` import 제거. 검증: S1 테스트와 기존 헤더 계약(`solvook-preview-flow-contract`, `solvook-preview-original-visual-contract`, `market-home-ui-contract`, `studio-adoption-contract`) 통과, `git diff --stat`이 두 파일(+신규 테스트·문서) 안에 있고 장바구니 배지·크레딧 코드 hunk가 보존됨.
- **S4 브라우저 검증**(dev 서버, 로그인 계정, 1280px): ① `마이페이지` Link에 hover하면 메뉴가 열리고 항목 8개와 로그아웃이 보인다 ② 마우스를 트리거에서 메뉴로 대각선으로 옮겨도 닫히지 않는다 ③ 메뉴·트리거 밖으로 나가면 약 150ms 후 닫힌다 ④ hover로 열린 상태에서 `마이페이지` Link를 클릭하면 `/mypage`로 정상 이동하고 이동 후 메뉴가 닫혀 있으며 깜박임이 없다 ⑤ 항목 클릭 → 해당 페이지로 이동하고 메뉴가 닫힌다(각 8개 URL 확인) ⑥ 키보드(8절 ⑥-1~⑥-6 상세): Tab으로 Link에서 Enter하면 `/mypage`로 이동하고, ArrowDown(또는 Space)으로 열어 방향키 → Esc 시 포커스가 Link로 돌아온다 ⑦ `getBoundingClientRect()`로 Link·항목 높이 ≥ 44 ⑧ 로그아웃 항목의 `getComputedStyle().backgroundColor`가 `--studio-highlight` 값이고 스크린샷에서 가장 눈에 띈다, ink 글자 대비 ≥ 4.5:1(DevTools) ⑨ 로그아웃 클릭 → `/login?logout=success`에서 '로그아웃 완료' Dialog가 뜨고, 새로고침해도 로그인 상태가 아니다(헤더에 로그인·회원가입 표시) ⑩ 로그아웃 실패(DevTools에서 `/api/auth/logout` 차단) 시 toast가 뜨고 메뉴·로그인 상태가 유지된다 ⑪ 비로그인 상태에서는 메뉴 없이 로그인·회원가입 링크만 보인다 ⑫ 장바구니 배지가 그대로 표시되고 1024px(`lg`)에서 `document.documentElement.scrollWidth <= innerWidth`이고 헤더 항목이 줄바꿈되지 않으며 마이페이지 Link 오른쪽에 chevron 영역(약 44px)이 사라져 폭이 이전 chevron 버전보다 줄었고 content가 뷰포트를 벗어나지 않는다 ⑬ 홈·`/library`·`/cart`·`/mypage`·`/terms/…`·`/preview/solvook-concept/…` 6곳에서 같은 메뉴가 나온다 ⑭ 터치 에뮬레이션(1024px+)에서 `마이페이지` 1탭으로 `/mypage`로 이동한다(판정 기준은 열림 여부가 아니라 1탭 이동이며, 보고된 pointerType에 따라 메뉴가 잠깐 열려도 이동이 막히지 않으면 통과) ⑮ 검색창에 글자를 입력하던 중 마우스로 `마이페이지`→메뉴 항목들 위를 지나가도 `document.activeElement`가 검색 input으로 유지되고 입력이 계속된다(키보드로 연 메뉴에서는 항목 포커스가 정상 이동) ⑯ 헤더 어디에도 chevron·별도 메뉴 버튼이 보이지 않는다(DOM에 `aria-label="마이페이지 메뉴 열기"` 없음).
- **S5 통합**: `npm run lint`·`npm run build` 새 실패 0, `node --test` 새 실패 0(S0 대비), 사용자 기존 변경 보존(`git checkout`/`restore` 금지).

## 5. 테스트
- 신규 `tests/solvook-mypage-menu-contract.test.mjs`(소스 계약):
  - 항목 href 전부가 실제 `page.tsx`로 해석된다(`/mypage*`·`/library`는 `src/app/(solvook)` 아래, `/pricing`은 `src/app/pricing/page.tsx`로 따로 해석, 보관함 href는 `/library`). `mypage-menu.tsx`에 `<Link href="/mypage"`가 있고 `DropdownMenuTrigger asChild` 바로 안이 그 Link다(8절에서 갱신).
  - `DropdownMenu`에 `modal={false}`가 있다. 로그아웃이 `/api/auth/logout`, `method: 'POST'`, `/login?logout=success`를 쓴다.
  - 로그아웃 항목이 `var(--studio-highlight)`를 쓰고, 이 파일에 raw hex(`#[0-9a-f]{3,8}`)와 Tailwind 색 팔레트(`red-|orange-|slate-|gray-`) 클래스가 없다. `rounded-[`는 `var(--studio-radius-` 형태만 허용한다.
  - 항목에 `min-h-11`, 로그아웃에 `LogOut`과 `로그아웃` 텍스트가 있다. hover enter/leave 처리가 `pointerType === 'mouse'`로 한정되고, Link `onClick`에서 메뉴를 닫는다. `DropdownMenuContent`에 `onInteractOutside`가 있고 감싼 `div` ref 안의 대상이면 `preventDefault`한다. 항목에 `onPointerMove`의 `preventDefault`(hover 열림 한정)와 `hover:` 배경 클래스가 있다. chevron 관련·pointerdown pointerType 관련 assert는 8절 기준으로 교체한다.
  - `preview-header.tsx`가 `MypageMenu`를 import하고 `href="/mypage"` 직접 Link가 없으며(이동됨) `라이브러리`가 없다. 장바구니 배지(`MarketCartIndicator`)와 크레딧 코드는 그대로 있다.
- 기존 계약 테스트: 위 4개는 수정 없이 통과해야 한다. `solvook-preview-flow-contract:291-307`의 금지어는 새 파일에도 쓰지 않는다(헤더 파일에는 원래 해당 없음). `studio-adoption-contract`는 새 `_components` 파일의 core hex 직접 사용 금지를 자동 검사한다.
- 로그아웃 후 로그인 상태·Dialog는 계약 테스트로 보장되지 않으므로 S4 ⑨⑩ 브라우저 증거가 필요하다.

## 6. 위험과 대응
| 위험 | 대응 |
|---|---|
| Radix 메뉴가 hover로 열릴 때 포커스를 가져가거나 닫힐 때 포커스가 트리거로 튄다 | `onOpenAutoFocus`·`onCloseAutoFocus`를 hover 경로에서만 `preventDefault`(D5), S4 ④⑥으로 확인 |
| 메뉴를 여는 Link 클릭이 `DismissableLayer` 바깥 클릭으로 판정되어 먼저 닫히거나 깜박인다(R1 N1) | `onInteractOutside`에서 감싼 `div` 안 대상이면 `preventDefault`(D5), S4 ④(클릭 이동·깜박임 없음) |
| 마우스를 항목에 올리면 Radix가 포커스를 항목으로 옮겨 검색창 입력 중 포커스를 빼앗는다(R1 N3) | hover 열림에서만 항목 `onPointerMove`·`onPointerLeave`(Radix `onItemLeave`가 content에 포커스) `preventDefault` + `hover:` 배경으로 강조 대체(D5), S4 ⑮로 확인 |
| 트리거→메뉴 이동 중 틈에서 닫힌다 | 150ms 지연과 `sideOffset=4`, 트리거·content 양쪽 `pointerenter`로 타이머 취소(S4 ②) |
| `modal={false}`에서도 바깥 pointerdown·Esc로 닫혀야 하는데 hover 제어와 충돌한다 | 제어 `onOpenChange`가 닫기 요청을 항상 받아들이고 hover 타이머는 별도로 취소한다(S4 ③⑥) |
| 터치 태블릿에서 hover 이벤트가 합성되어 열림·닫힘이 꼬인다 | hover 처리는 `pointerType==='mouse'`만(D5), S4 ⑭ |
| 링크와 메뉴 trigger를 한 요소에 합쳐 Enter·수정키·Space가 충돌한다 | 사용자 결정으로 chevron을 없앴으므로 Link가 trigger다. Enter는 직접 이동 처리, ArrowDown·Space는 열기로 정해 8절 표와 계약 테스트·S4 ⑥으로 고정 |
| (해소) chevron 제거로 헤더 폭이 줄어든다 | S4 ⑫에서 1024px 넘침·줄바꿈 없음 확인 |
| 로그아웃 오클릭 | 구분선으로 분리하고 항목 높이를 44px로 하되 '회원 탈퇴'는 메뉴에 두지 않는다 |
| 사용자 기존 변경(장바구니 배지 등)이 덮어써진다 | S0 hunk 기록, S3에서 보존 확인, `Link` 블록 한 곳만 교체 |
| 로그아웃 로직이 4번째 복제본이 된다 | 기존 3곳은 비범위로 두고 같은 흐름을 한 곳에만 둔다. 공통화는 요청 시 후속 |

## 7. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 계획 초안 91줄(abd556b0…) | 독립 검증(팀 리드 전달) | OK(차단 없음) | 비차단 N1(바깥 클릭 판정 `onInteractOutside`)·N2(열기 동작 마우스 한정)·N3(포커스 훔침)과 대비 실측·2절 `/pricing` 경로 문구를 'R1 반영' 행에서 반영 |
| 사용자 결정 | D4·D9 확정(2026-10-01) | 사용자(팀 리드 전달) | 반영 | ① `마이페이지` 클릭은 `/mypage` 이동 유지, 터치 탭도 메뉴 없이 즉시 이동 → Link와 chevron 버튼(메뉴 열기·키보드 진입)을 분리한 split-button(D4·D5·3절·계약 테스트·S4 갱신). ② 로그아웃 색은 기존 `--studio-highlight` 그대로, 새 토큰 없음(D9) |
| R1 반영 | 이 문서 수정본 | 팀 리드 전달(R1 OK, 비차단 N1~N3) | 반영 | 대비 실측(ink 5.60:1, 흰 글자 2.92:1), 2절 `/pricing` 경로 문구, N1 `onInteractOutside`, N2 열기 동작 마우스 한정, N3 포커스 훔침(위험·S4 ⑮) |
| 구현 | mypage-menu.tsx·preview-header.tsx·계약 테스트 | 독립 검증 | 1차 FAIL(B1 Safari chevron: click pointerType 판정) → pointerdown(mouse) 열기로 수정, Radix dist 가드 테스트 추가 → 재검증 OK | tsc·eslint·build 통과, node 975건 fail 39(새 실패 0). 로그인 상태 브라우저 S4·Safari 실기기는 미실행(사용자 확인) |
| 사용자 결정 2 | chevron 제거(2026-10-01) | 사용자(팀 리드 전달) | 반영 | "이 드랍다운 버튼은 없어야돼. 그냥 마이페이지에 hover하면 메뉴가 나오면 돼" → chevron 버튼 완전 제거, `마이페이지` Link를 Radix trigger로 전환(8절). D4·D5·3절·4절 S4·5절·6절을 8절 기준으로 갱신 |
| R3 | 8절(chevron 제거·Link trigger) | 독립 검증(팀 리드 전달) | OK | 비차단 N1(Enter는 repeat와 무관하게 항상 `preventDefault`, `.click()`은 `!repeat`일 때만)·N2(iOS 판정 기준을 '1탭 이동'으로 통일, S4 ⑭·C3·위험 문구 정합)·N3(6절 낡은 참조·`onPointerLeave`·7절 R1 결과) 반영 |

## 8. 추가 요청(chevron 제거, 2026-10-01)
요청: '마이페이지' 옆 chevron(^) 버튼을 없애고, 마우스를 올리면 메뉴가 열리는 것만 남긴다. 구현(`f822fd8`)은 `mypage-menu.tsx`에 Link + chevron split-button으로 들어가 있다. 변경 파일은 `mypage-menu.tsx`와 `tests/solvook-mypage-menu-contract.test.mjs`뿐이다. 항목·로그아웃·색·hover 지연·포커스 훔침 방지(R1 N1·N3)·바깥 클릭 보정은 그대로다.

**분석(사실)**
- Radix `DropdownMenuTrigger`의 기본 처리(`@radix-ui/react-dropdown-menu`): `onPointerDown`(button 0, ctrl 아님)에서 열림 토글, `onKeyDown`에서 Enter/Space는 토글·ArrowDown은 열기이며 **세 키 모두 `preventDefault`**한다. 모두 `composeEventHandlers(props.handler, radixHandler)`라 우리 핸들러가 먼저 돌고, 우리가 `event.defaultPrevented`로 만들면 Radix 처리는 건너뛴다.
- 그러므로 Link를 trigger로 쓰면 Enter의 기본 동작(링크 활성화)은 Radix 때문에 막힌다. `preventDefault` 하나로 'Radix만 건너뛰고 링크 기본 동작은 살리기'가 불가능해서 Enter 이동은 직접 호출해야 한다. 마우스 click은 `pointerdown`을 막아도 그대로 발생하므로 Link 이동은 유지된다.
- Safari: 18.2 미만의 click `pointerType`은 `undefined`, iOS 18.2+는 터치 탭도 `'mouse'`로 보고된다(B1에서 chevron으로 이미 겪음). click·pointerdown의 pointerType으로 열기를 판정하면 터치에서 오동작한다.
- WAI-ARIA 1.2에서 `link` 역할은 `aria-haspopup`·`aria-expanded`를 지원한다. 다만 APG의 표준 패턴은 menu button(button trigger)이거나 링크와 분리된 disclosure 버튼이다. '링크이면서 메뉴 trigger'는 표준 패턴이 아니라 사용자 결정에 따른 의도된 변형이고, 스크린리더 사용자에게는 '링크, 메뉴 팝업, 접힘'으로 읽히며 ArrowDown으로 여는 방법을 알 수 없다.

**대안 비교와 결정**
| 기준 | (a) Radix `DropdownMenuTrigger asChild` + Link(기본안) | (b) Radix 없이 CSS `group-hover`/`focus-within` + `nav` 링크 목록 |
|---|---|---|
| 단순성 | 핸들러 3개(pointerdown·keydown·click)를 Link에 추가, 기존 코드 약 25줄 변경 | 구현 전체 재작성(타이머·ref·로그아웃 포함 약 150줄 대체), Esc 닫기는 JS가 따로 필요 |
| 접근성 | `role=menu` 방향키·Home/End·typeahead·Esc 복귀가 Radix로 유지, 메뉴는 Tab 정지점 1개 | Tab 한 번에 항목 9개를 모두 지나야 다음 헤더 요소로 간다. 링크 의미는 단순하고 Enter·수정키는 네이티브 |
| 기존 구현 재사용 | 독립 검증을 통과한 hover 지연·바깥 클릭 보정·포커스 방지·로그아웃·계약 테스트를 그대로 사용 | 위 항목 전부 폐기 후 재검증 |
| 회귀 위험 | Link에서 Enter·Space 키 처리를 직접 해야 하는 위험(아래 표 + 테스트로 고정) | 포커스·hover 지연을 CSS `transition-delay`로 흉내 내야 하고, 새 코드 전체가 검증 대상 |
- **결정: (a)**. 단순성·기존 primitive 우선(DESIGN.md)·재사용·회귀 위험에서 앞서고, 약점(링크 + 메뉴 trigger 의미)은 키 처리와 `aria-describedby` 안내로 보완한다. S4 ⑥ 키보드 검증이 실패하면 (b)로 전환을 재검토한다.

**결정(키·포인터 처리)**: trigger는 `<DropdownMenuTrigger asChild><Link href="/mypage" …>`이고 chevron·`ChevronDown` import는 삭제한다. Link 폭은 원래대로(`px-2`)다.
| 입력 | 처리 |
|---|---|
| 모든 pointerType의 `pointerdown` | `event.preventDefault()`(pointerType 판정 없음)로 Radix 토글을 건너뛴다. click은 그대로 발생해 Link가 이동하고 `onClick`이 메뉴를 닫는다 |
| 마우스 hover | 기존 `pointerenter`/`pointerleave`(`pointerType==='mouse'`) 150ms 지연, 열 때 hover 모드. 터치는 열지 않는다 |
| Enter | **repeat와 상관없이 항상** `preventDefault`(Radix 건너뜀·키 반복 시 Radix 토글 방지). `!event.repeat`일 때만 이동을 실행한다: 수정키 없으면 `event.currentTarget.click()`(Next `Link`의 클라이언트 이동과 `onClick` 닫기를 재사용). `metaKey`/`ctrlKey`/`shiftKey`이면 `window.open(href, '_blank', 'noopener')`로 새 탭·창(키 입력 중이라 팝업 차단 대상이 아님). Alt는 일반 Enter와 같다 |
| ArrowDown / Space | 닫힘: Radix 기본(키보드 모드로 열고 첫 항목 포커스, Space도 스크롤 방지). 이미 열림(hover 포함): `preventDefault`, 키보드 모드로 전환하고 첫 항목으로 포커스(기존 `focusFirstItem` 재사용, Radix의 Space 토글 닫힘을 피함) |
| Esc | Radix 기본으로 닫고 포커스를 trigger인 Link로 복귀(hover 모드에서는 포커스 이동 없음) |
| 수정키·가운데 클릭 | pointerdown만 막으므로 Cmd/Ctrl+click·가운데 클릭은 브라우저/Next 기본(새 탭)이다 |
- 접근성: Radix가 Link에 `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`를 붙인다. 추가로 `aria-describedby`로 sr-only 문구 '아래 화살표 키로 마이페이지 메뉴를 열 수 있습니다.'를 연결한다(`useId`). Radix가 Link에 붙이는 `type="button"`은 `<a>`에서 무시되는 속성이라 동작에 영향이 없고 S4에서 DOM으로 확인만 한다.

**작업 단계와 검증**
- **C1 테스트 먼저**: 아래 테스트 변경을 반영한다. 검증: 현재 구현(chevron 버전)에서 새 assert가 실패한다(레드).
- **C2 구현**: `mypage-menu.tsx`에서 chevron 버튼·`ChevronDown`·`openByMouse` pointerdown 분기를 지우고 trigger를 Link로 옮기며 위 표를 구현한다. 검증: `npx tsc --noEmit`, `npx eslint 'src/app/preview/solvook-concept/_components/mypage-menu.tsx'` exit 0, `node --test tests/solvook-*.test.mjs tests/studio-adoption-contract.test.mjs tests/market-home-ui-contract.test.mjs` 새 실패 0.
- **C3 브라우저**(4절 S4 ①~⑯에 더해): ⑥-1 Tab으로 Link 포커스 시 DOM `aria-haspopup="menu"`·`aria-expanded="false"`·`aria-describedby` 대상 문구 확인 ⑥-2 Enter → URL `/mypage`이고 메뉴가 열려 있지 않다 ⑥-3 Cmd/Ctrl+Enter → 새 탭에 `/mypage`, 현재 탭 유지(Shift+Enter 결과는 브라우저별로 기록) ⑥-4 ArrowDown(및 Space) → 메뉴가 열리고 `document.activeElement`가 '마이페이지 홈' ⑥-5 Esc → 닫히고 `activeElement`가 Link ⑥-6 hover로 연 상태에서 ArrowDown → 첫 항목 포커스 ⑥-7 Cmd+click·가운데 클릭 → 새 탭, 현재 탭의 메뉴 닫힘. 마우스·터치(S4 ④⑭⑯)는 그대로, 헤더에 chevron이 없다. **B1 재발 방지**: macOS Safari에서 hover 열림·Link 클릭 이동을 확인하고, iOS Safari(실기기 또는 시뮬레이터)에서 `마이페이지`를 **1탭**으로 눌렀을 때 `/mypage`로 이동하는지 확인한다(두 번 눌러야 하거나 이동이 막히면 실패). 탭이 `'mouse'`로 보고되면 hover로 메뉴가 잠깐 열릴 수 있으나 판정 기준은 '열림 여부'가 아니라 '1탭 이동'이다. 어느 쪽이든 검증하지 못하면 '미검증'으로 기록한다.
- **C4 통합**: `npm run lint`·`npm run build` 새 실패 0, 사용자 기존 변경 보존.

**테스트 변경**(`tests/solvook-mypage-menu-contract.test.mjs`)
- 삭제·교체: 'separate chevron button is the menu trigger'(`마이페이지 메뉴 열기`, `min-w-11`, trigger 안 `button`)와 'hover and mouse click open the menu only for mouse pointers' 중 chevron `onClick`·pointerdown의 `pointerType==='mouse'` 분기 assert.
- 신규: ① `<DropdownMenuTrigger asChild>` 바로 안이 `<Link href="/mypage"`이고, 파일에 `<button`·`ChevronDown`·`마이페이지 메뉴 열기`가 없다 ② trigger의 `onPointerDown`이 `event.preventDefault()`를 호출하고 그 핸들러에 `pointerType`이 없다. `pointerType`은 hover enter/leave 핸들러에만 있고(`nativeEvent.pointerType`·click 판정 없음, Safari 문제 고정) ③ `onKeyDown`에 Enter 분기(`event.repeat`와 무관하게 `preventDefault`를 항상 호출하고 `.click()`·`window.open(`은 `!event.repeat` 안에서만 호출, 수정키 `metaKey`·`ctrlKey`·`shiftKey` → `window.open(`)와 ArrowDown·Space 분기(열림 상태에서 `preventDefault` + `focusFirstItem`)가 있다 ④ `aria-describedby`와 sr-only 문구 '아래 화살표'가 있다 ⑤ Link `onClick`이 메뉴를 닫는다.
- 유지: 항목 href 실존, `modal={false}`, `onInteractOutside` 보정, hover 모드 `onPointerMove`·`onPointerLeave`·`onOpenAutoFocus`·`onCloseAutoFocus` 가드, Radix 런타임 `onOpenAutoFocus` 합성 가드(node_modules dist 검사), 로그아웃·토큰 assert, 헤더 계약.
- 추가 가드: `node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs`의 trigger가 `composeEventHandlers(props.onPointerDown`·`props.onKeyDown` 순서이고 Enter/Space/ArrowDown에서 `preventDefault`하는 문자열이 있음을 확인해, '우리 핸들러가 먼저 돌고 `preventDefault`로 Radix를 건너뛴다'는 전제를 Radix 업그레이드 시 깨지면 알 수 있게 고정한다(기존 `onOpenAutoFocus` 가드와 같은 방식).

**위험**
| 위험 | 대응 |
|---|---|
| Link에서 Enter·Space·수정키 처리를 직접 해 키보드 동작이 어긋난다(링크 + 메뉴 trigger는 비표준 패턴) | 위 입력 표와 계약 테스트, C3 ⑥-1~⑥-7. 실패하면 (b) 재검토 |
| `pointerdown` `preventDefault`로 클릭 시 Link에 포커스가 가지 않는다 | click·이동은 정상이다. 이동 후 페이지가 바뀌므로 영향이 작고 C3에서 이동·포커스 링을 확인한다 |
| iOS Safari에서 터치 탭의 pointerType 보고 차이로 hover가 열린다 | hover 판정은 enter/leave에만 쓴다. 탭이 `'mouse'`로 보고되면 메뉴가 열릴 수 있으나 click은 막지 않으므로 1탭으로 `/mypage`에 이동하고 경로 변경 effect가 닫는다. 통과 기준은 '1탭 이동'(S4 ⑭·C3), 메뉴 깜박임은 기록만 한다 |
| 터치 사용자에게 메뉴 접근 수단이 없다 | 사용자 승인 사항(탭 = `/mypage` 이동). `/mypage` 홈의 바로가기와 `자료 보관함`·`크레딧` 헤더 링크가 대체 경로 |
| 스크린리더 사용자가 ArrowDown으로 여는 방법을 모른다 | `aria-describedby` sr-only 안내와 `aria-haspopup`·`aria-expanded` |
| 8절 구현 | mypage-menu.tsx·계약 테스트(10) | 독립 검증 | OK | chevron 제거, Link trigger, Enter 항상 preventDefault·!repeat 이동, ArrowDown/Space 진입, dist 가드 4종. tsc·eslint·build 통과, node 977건 fail 39(새 실패 0). 로그인 브라우저·Safari 실기기 미실행(사용자 확인) |
