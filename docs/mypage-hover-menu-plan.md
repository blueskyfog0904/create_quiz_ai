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
- D4 **트리거 구조(사용자 결정됨)**: `마이페이지`는 지금처럼 `Link href="/mypage"`로 둔다. 마우스 클릭은 `/mypage`로 이동하고, 터치 탭도 메뉴 없이 `/mypage`로 바로 이동한다. 메뉴 열기는 **(a) Link 옆의 별도 chevron 버튼**(`aria-label="마이페이지 메뉴 열기"`, `ChevronDown`, 44×44px)이 맡고, 이 버튼만 Radix `DropdownMenuTrigger`(`asChild`)다. 둘은 `div`(flex) 안에 나란히 있는 split-button 구조이고, 메뉴는 chevron 버튼 기준 `align="end"`로 열린다. 근거: ① Radix `DropdownMenuTrigger`는 Enter/Space/ArrowDown을 열기로 가로채고 `preventDefault`하므로 Link 자체를 trigger로 쓰면 키보드 Enter로 `/mypage`에 갈 수 없다. ② (b) '포커스 시 자동 열림'은 Tab만 눌러도 맥락이 바뀌어 WAI-ARIA·WCAG 3.2.1(포커스가 맥락 변경을 일으키지 않아야 함)과 맞지 않고 메뉴 버튼 패턴(Enter/Space/ArrowDown으로 명시적 열기)과도 다르다. ③ 링크와 메뉴 버튼을 분리하면 터치·키보드·마우스 모두에서 각 요소의 역할이 하나라 충돌이 없다. 비용: 헤더 폭이 약 44px 늘어난다(S4 ⑫에서 1024px 확인). Tab 순서는 `마이페이지` Link → chevron 버튼이다.
- D5 **hover 동작(마우스 포인터만)**: `Link`+chevron을 감싼 `div`와 메뉴 content의 `onPointerEnter`(`pointerType==='mouse'`)에서 열고 닫기 타이머를 취소하며, `onPointerLeave`에서 150ms 지연 후 닫는다(카테고리 메뉴와 같은 지연값). `sideOffset=4`의 틈을 150ms 지연이 메운다. **직접 작성하는 열기·토글 동작(hover 진입, chevron `onClick` 열기, 마우스 `pointerdown` 차단)은 모두 마우스 포인터로 한정**한다(`pointerType==='mouse'`, click은 `event.nativeEvent.pointerType`). Link에는 열기 동작이 없으므로 터치 탭은 메뉴 없이 `/mypage` 이동만 일어난다. 터치·펜은 chevron 버튼을 탭할 때만 Radix 기본 토글로 열고 닫는다(키보드도 Radix 기본). 마우스에서는 chevron `pointerdown`을 `preventDefault`해 Radix 토글을 막고 `onClick`은 항상 연다(hover로 열린 상태에서 chevron을 클릭해도 닫히지 않는다). **바깥 클릭 판정 보정(R1 N1)**: 메뉴를 여는 요소(Link·chevron)를 누르면 `DismissableLayer`가 이를 바깥 상호작용으로 보아 먼저 닫아 버리므로, `DropdownMenuContent`의 `onInteractOutside`에서 `event.target`이 Link+chevron을 감싼 `div`(ref) 안이면 `event.preventDefault()`한다. 그래서 chevron 클릭이 닫힘→열림으로 깜박이지 않고 Link 클릭은 닫힘 없이 이동하며 `onClick`이 닫는다. **포커스 훔침 방지(R1 N3)**: Radix 항목은 마우스를 올리면 포커스를 항목으로 옮겨 검색창 입력 중이던 포커스를 빼앗는다. hover로 열린 동안에는 항목의 `onPointerMove`에서 `preventDefault`(Radix가 `defaultPrevented`이면 `focus()`를 생략)하고, 이때 사라지는 `data-[highlighted]` 강조를 `hover:` 배경 클래스로 대신한다. 키보드로 연 경우는 기본 동작을 유지한다. **Link를 클릭하면** `onClick`과 `pathname` 변경 effect가 `open=false`로 만든다(헤더는 layout이라 클라이언트 이동에도 언마운트되지 않으므로 직접 닫아야 한다). 호버로 열린 경우 `onOpenAutoFocus`를 막아 포커스를 훔치지 않고, 호버로 닫힐 때 `onCloseAutoFocus`도 막는다. 키보드로 열고 닫을 때는 기본 포커스 복귀(chevron 버튼)를 유지한다.
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
- 트리거: `Link`는 기존 시각 구성(아이콘 + `마이페이지` 11px, `min-h-11`)·focus-visible 링을 유지한다. chevron 버튼은 `aria-label="마이페이지 메뉴 열기"`, 44×44px, focus-visible 링이고 Radix가 `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`를 제공한다(WAI-ARIA menu button 패턴).
- 키보드: Tab으로 `마이페이지` Link 포커스 → Enter면 `/mypage` 이동. Tab으로 chevron 버튼 → Enter/Space/ArrowDown으로 열림(첫 항목 포커스) → 방향키·Home/End·typeahead 이동 → Enter로 이동 → Esc로 닫고 chevron 버튼에 포커스 복귀. Tab은 메뉴를 닫고 다음 요소로 간다(Radix 기본).
- 포인터: 마우스 hover(Link·chevron 어느 쪽이든)로 열림·지연 닫힘, Link 클릭은 `/mypage` 이동과 동시에 닫힘, 바깥 클릭으로 닫힘, 항목 선택(링크 이동) 시 닫힘. 터치: `마이페이지` 탭은 메뉴 없이 `/mypage` 이동, chevron 탭은 메뉴 토글, 바깥 탭으로 닫힘.
- 항목은 `asChild` + `next/link`(`Link`)로 클라이언트 라우팅하고, 모든 항목과 트리거는 44px 이상이다. 320px 데스크톱 블록은 보이지 않으므로(`lg` 미만은 다른 헤더) 가로 overflow 대상이 아니다. `lg`(1024px)에서 content가 뷰포트 안에 머문다.
- 로그아웃 항목은 `role=menuitem`이고 처리 중 `aria-disabled`, 라벨 `로그아웃 중…`이다.

## 4. 작업 단계와 검증
각 단계는 독립 검증자의 OK 후 다음으로 간다(AGENTS 작업 Loop).
- **S0 기준선**: `git status --porcelain`·`git diff --stat` 기록, `node --test tests/solvook-*.test.mjs tests/studio-adoption-contract.test.mjs tests/market-home-ui-contract.test.mjs 2>&1 | tail -5`와 `npx tsc --noEmit` 결과 기록. `preview-header.tsx`에 미커밋 변경이 있으면 hunk를 기록한다. 검증: 기록 존재.
- **S1 계약 테스트 먼저**: `tests/solvook-mypage-menu-contract.test.mjs` 신규(5절). 검증: 구현 전 새 테스트가 실패한다(레드 확인).
- **S2 메뉴 컴포넌트**: `mypage-menu.tsx` 작성. 검증: `npx tsc --noEmit` exit 0, `npx eslint` 대상 파일 exit 0.
- **S3 헤더 연결**: `preview-header.tsx`에서 `Link` 블록을 교체하고 `UserRound` import 제거. 검증: S1 테스트와 기존 헤더 계약(`solvook-preview-flow-contract`, `solvook-preview-original-visual-contract`, `market-home-ui-contract`, `studio-adoption-contract`) 통과, `git diff --stat`이 두 파일(+신규 테스트·문서) 안에 있고 장바구니 배지·크레딧 코드 hunk가 보존됨.
- **S4 브라우저 검증**(dev 서버, 로그인 계정, 1280px): ① `마이페이지` Link 또는 chevron에 hover하면 메뉴가 열리고 항목 8개와 로그아웃이 보인다 ② 마우스를 트리거에서 메뉴로 대각선으로 옮겨도 닫히지 않는다 ③ 메뉴·트리거 밖으로 나가면 약 150ms 후 닫힌다 ④ hover로 열린 상태에서 chevron 클릭은 메뉴가 닫히지 않고, `마이페이지` Link 클릭은 `/mypage`로 정상 이동하며 이동 후 메뉴가 닫혀 있다 ⑤ 항목 클릭 → 해당 페이지로 이동하고 메뉴가 닫힌다(각 8개 URL 확인) ⑥ 키보드: Tab으로 Link에서 Enter하면 `/mypage`로 이동하고, Tab으로 chevron에서 Enter(또는 Space·ArrowDown) → 방향키 → Esc 시 포커스가 chevron으로 돌아온다 ⑦ `getBoundingClientRect()`로 Link·chevron 버튼·항목 높이와 chevron 너비 ≥ 44 ⑧ 로그아웃 항목의 `getComputedStyle().backgroundColor`가 `--studio-highlight` 값이고 스크린샷에서 가장 눈에 띈다, ink 글자 대비 ≥ 4.5:1(DevTools) ⑨ 로그아웃 클릭 → `/login?logout=success`에서 '로그아웃 완료' Dialog가 뜨고, 새로고침해도 로그인 상태가 아니다(헤더에 로그인·회원가입 표시) ⑩ 로그아웃 실패(DevTools에서 `/api/auth/logout` 차단) 시 toast가 뜨고 메뉴·로그인 상태가 유지된다 ⑪ 비로그인 상태에서는 메뉴 없이 로그인·회원가입 링크만 보인다 ⑫ 장바구니 배지가 그대로 표시되고 1024px(`lg`)에서 chevron 추가 후에도 `document.documentElement.scrollWidth <= innerWidth`이고 헤더 항목이 줄바꿈되지 않으며 content가 뷰포트를 벗어나지 않는다 ⑬ 홈·`/library`·`/cart`·`/mypage`·`/terms/…`·`/preview/solvook-concept/…` 6곳에서 같은 메뉴가 나온다 ⑭ 터치 에뮬레이션(1024px+)에서 `마이페이지` 탭은 메뉴 없이 `/mypage`로 이동하고, chevron 탭은 메뉴를 연다 ⑮ 검색창에 글자를 입력하던 중 마우스로 `마이페이지`→메뉴 항목들 위를 지나가도 `document.activeElement`가 검색 input으로 유지되고 입력이 계속된다(키보드로 연 메뉴에서는 항목 포커스가 정상 이동) ⑯ hover로 열린 메뉴에서 chevron 클릭 시 메뉴가 닫혔다 다시 열리는 깜박임이 없다.
- **S5 통합**: `npm run lint`·`npm run build` 새 실패 0, `node --test` 새 실패 0(S0 대비), 사용자 기존 변경 보존(`git checkout`/`restore` 금지).

## 5. 테스트
- 신규 `tests/solvook-mypage-menu-contract.test.mjs`(소스 계약):
  - 항목 href 전부가 실제 `page.tsx`로 해석된다(`/mypage*`·`/library`는 `src/app/(solvook)` 아래, `/pricing`은 `src/app/pricing/page.tsx`로 따로 해석, 보관함 href는 `/library`). `mypage-menu.tsx`에 `<Link href="/mypage"`가 있고 `DropdownMenuTrigger asChild` 바로 안은 `button`이다(Link가 trigger가 아님).
  - `DropdownMenu`에 `modal={false}`가 있다. 로그아웃이 `/api/auth/logout`, `method: 'POST'`, `/login?logout=success`를 쓴다.
  - 로그아웃 항목이 `var(--studio-highlight)`를 쓰고, 이 파일에 raw hex(`#[0-9a-f]{3,8}`)와 Tailwind 색 팔레트(`red-|orange-|slate-|gray-`) 클래스가 없다. `rounded-[`는 `var(--studio-radius-` 형태만 허용한다.
  - chevron 버튼에 `aria-label="마이페이지 메뉴 열기"`와 `min-h-11 min-w-11`, 항목에 `min-h-11`, 로그아웃에 `LogOut`과 `로그아웃` 텍스트가 있다. hover 처리와 chevron `onClick` 열기가 `pointerType === 'mouse'`로 한정되고, 마우스 `pointerdown`에서 `preventDefault`를 호출하며, Link `onClick`에서 메뉴를 닫는다. `DropdownMenuContent`에 `onInteractOutside`가 있고 감싼 `div` ref 안의 대상이면 `preventDefault`한다. 항목에 `onPointerMove`의 `preventDefault`(hover 열림 한정)와 `hover:` 배경 클래스가 있다.
  - `preview-header.tsx`가 `MypageMenu`를 import하고 `href="/mypage"` 직접 Link가 없으며(이동됨) `라이브러리`가 없다. 장바구니 배지(`MarketCartIndicator`)와 크레딧 코드는 그대로 있다.
- 기존 계약 테스트: 위 4개는 수정 없이 통과해야 한다. `solvook-preview-flow-contract:291-307`의 금지어는 새 파일에도 쓰지 않는다(헤더 파일에는 원래 해당 없음). `studio-adoption-contract`는 새 `_components` 파일의 core hex 직접 사용 금지를 자동 검사한다.
- 로그아웃 후 로그인 상태·Dialog는 계약 테스트로 보장되지 않으므로 S4 ⑨⑩ 브라우저 증거가 필요하다.

## 6. 위험과 대응
| 위험 | 대응 |
|---|---|
| Radix 메뉴가 hover로 열릴 때 포커스를 가져가거나 닫힐 때 포커스가 트리거로 튄다 | `onOpenAutoFocus`·`onCloseAutoFocus`를 hover 경로에서만 `preventDefault`(D5), S4 ④⑥으로 확인 |
| 메뉴를 여는 Link·chevron 클릭이 `DismissableLayer` 바깥 클릭으로 판정되어 먼저 닫히거나 깜박인다(R1 N1) | `onInteractOutside`에서 감싼 `div` 안 대상이면 `preventDefault`(D5), S4 ④⑯ |
| 마우스를 항목에 올리면 Radix가 포커스를 항목으로 옮겨 검색창 입력 중 포커스를 빼앗는다(R1 N3) | hover 열림에서만 항목 `onPointerMove` `preventDefault` + `hover:` 배경으로 강조 대체(D5), S4 ⑮로 확인 |
| 트리거→메뉴 이동 중 틈에서 닫힌다 | 150ms 지연과 `sideOffset=4`, 트리거·content 양쪽 `pointerenter`로 타이머 취소(S4 ②) |
| `modal={false}`에서도 바깥 pointerdown·Esc로 닫혀야 하는데 hover 제어와 충돌한다 | 제어 `onOpenChange`가 닫기 요청을 항상 받아들이고 hover 타이머는 별도로 취소한다(S4 ③⑥) |
| 터치 태블릿에서 hover 이벤트가 합성되어 열림·닫힘이 꼬인다 | hover 처리는 `pointerType==='mouse'`만(D5), S4 ⑭ |
| 링크 클릭 직행 + 메뉴 열기를 한 요소에 합치면 키보드·터치가 충돌한다 | 사용자 결정(링크 유지)에 따라 Link와 chevron 버튼을 분리한다(D4). Link가 Radix trigger가 되지 않게 계약 테스트로 고정 |
| 헤더 폭이 chevron(44px)만큼 늘어 `lg`에서 줄바꿈·넘침이 생긴다 | S4 ⑫에서 1024px 확인. 문제면 chevron 너비를 줄이는 대신 검색창 폭(`w-[320px]`)이 아닌 gap 조정으로 먼저 해결(44px hit area는 유지) |
| 로그아웃 오클릭 | 구분선으로 분리하고 항목 높이를 44px로 하되 '회원 탈퇴'는 메뉴에 두지 않는다 |
| 사용자 기존 변경(장바구니 배지 등)이 덮어써진다 | S0 hunk 기록, S3에서 보존 확인, `Link` 블록 한 곳만 교체 |
| 로그아웃 로직이 4번째 복제본이 된다 | 기존 3곳은 비범위로 두고 같은 흐름을 한 곳에만 둔다. 공통화는 요청 시 후속 |

## 7. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 계획 초안 | (대기) | | |
| 사용자 결정 | D4·D9 확정(2026-10-01) | 사용자(팀 리드 전달) | 반영 | ① `마이페이지` 클릭은 `/mypage` 이동 유지, 터치 탭도 메뉴 없이 즉시 이동 → Link와 chevron 버튼(메뉴 열기·키보드 진입)을 분리한 split-button(D4·D5·3절·계약 테스트·S4 갱신). ② 로그아웃 색은 기존 `--studio-highlight` 그대로, 새 토큰 없음(D9) |
| R1 반영 | 이 문서 수정본 | 팀 리드 전달(R1 OK, 비차단 N1~N3) | 반영 | 대비 실측(ink 5.60:1, 흰 글자 2.92:1), 2절 `/pricing` 경로 문구, N1 `onInteractOutside`, N2 열기 동작 마우스 한정, N3 포커스 훔침(위험·S4 ⑮) |
| 구현 | mypage-menu.tsx·preview-header.tsx·계약 테스트 | 독립 검증 | 1차 FAIL(B1 Safari chevron: click pointerType 판정) → pointerdown(mouse) 열기로 수정, Radix dist 가드 테스트 추가 → 재검증 OK | tsc·eslint·build 통과, node 975건 fail 39(새 실패 0). 로그인 상태 브라우저 S4·Safari 실기기는 미실행(사용자 확인) |
