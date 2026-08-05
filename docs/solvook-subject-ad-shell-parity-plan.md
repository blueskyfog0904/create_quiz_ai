# Solvook 컨셉 영어·국어 광고 영역 구조 동등화 계획

- 작성일: 2026-07-30
- 대상: `/preview/solvook-concept?subject=english`, `/preview/solvook-concept?subject=korean`
- 상태: 구현·Docker 미사용 검증·독립 검토 PASS
- 구현 범위: 프리뷰 첫 광고 영역의 영어·국어 구조 동등화
- 제외 범위: 루트 페이지 이전, 운영 문제마켓 메인 교체, 광고 데이터 복제, DB 스키마 변경

## 최신 실행 제약

2026-07-30 사용자 지시에 따라 Docker와 로컬 Supabase 스택은 사용하지 않는다.

- 로컬 DB에 0/1/복수 광고 fixture를 쓰는 검증과 관리자 저장 round-trip은 이번 실행에서 제외한다.
- `tests/main-ad-carousel-browser.test.mjs`의 로컬 fixture 모드는 안전장치가 있는 opt-in 테스트로 유지하되 실행하지 않는다.
- 현재 연결된 데이터에 대한 읽기 전용 검증으로 영어 `multiple`, 국어 `empty` 상태의 공통 셸, 진행 음영, 슬라이드, 반응형, 접근성을 확인한다.
- `single` 상태와 관리자 과목 격리는 컴포넌트·API 계약 테스트로 검증한다.
- 실제 관리자 저장 및 Storage 수명주기와 로컬 DB 기반 0/1/복수 브라우저 전환을 실행하지 않았다는 사실은 최종 보고에 명시한다.

이 실행 제약은 아래 Phase 1, 4, 5의 로컬 Supabase 필수 문구보다 우선한다.

## 1. 목표

영어와 국어의 광고 등록 건수가 달라도 프리뷰 첫 영역은 항상 같은 광고 캐러셀 골격과 크기를 사용한다.

- 영어·국어 모두 같은 외곽 컨테이너, 왼쪽 목록 영역, 오른쪽 콘텐츠 영역을 사용한다.
- 광고가 없다고 해서 국어에 별도의 대형 보라색 `CampaignHero`를 표시하지 않는다.
- 광고가 0개이면 같은 캐러셀 골격 안에서 사실에 맞는 빈 상태를 표시한다.
- 광고가 1개이면 정적인 제목과 이미지를 표시한다.
- 광고가 2개 이상이면 현재 구현된 진행 음영, 자동 전환, 이미지 슬라이드, 수동 탐색을 유지한다.
- 국어 광고는 관리자에서 국어를 선택해 등록한 데이터만 사용하며 영어 광고를 복제하지 않는다.

이 계획은 아래 두 문서의 “광고 0건이면 전체 `CampaignHero` fallback” 계약을 대체한다.

- `docs/solvook-korean-parity-plan.md`
- `docs/main-ad-carousel-plan.md`의 0개 fallback 항목

그 밖의 과목 분리, 실제 데이터 조회, 관리자 과목 격리, 복수 광고 동작 계약은 유지한다. 구현 Phase 0에서 두 기존 문서에 이 계획서의 대체 관계를 짧게 명시해 서로 충돌하는 활성 계약을 남기지 않는다.

## 2. 현재 상태와 원인

### 2.1 실제 화면 비교

동일한 데스크톱 뷰포트에서 확인한 현재 상태는 다음과 같다.

| 구분 | 영어 | 국어 |
| --- | --- | --- |
| 활성 광고 | 3개 | 0개 |
| 첫 영역 컴포넌트 | `MainAdCarousel` | `CampaignHero` |
| 첫 영역 측정 높이 | 약 365px | 약 535px |
| 왼쪽 영역 | 광고 제목 목록 | 기능 안내 카드 4개 |
| 오른쪽 영역 | 업로드 광고 이미지 | 보라색 검색 히어로와 대표 자료 카드 |

최근 등록 자료 수나 출처 설정 수처럼 본문 데이터의 차이는 정상이다. 이번 문제는 데이터 차이가 아니라 첫 영역에서 서로 다른 컴포넌트를 선택하는 구조 차이다.

### 2.2 코드 원인

`src/app/preview/solvook-concept/page.tsx`가 활성 광고 존재 여부에 따라 다음과 같이 다른 컴포넌트를 선택한다.

```tsx
mainAdItems.length > 0
  ? <MainAdCarousel items={mainAdItems} />
  : <CampaignHero ... />
```

또한 `MainAdCarousel`은 항목이 0개이면 `null`을 반환한다. 따라서 페이지 분기만 제거하면 영역 전체가 사라지므로, 캐러셀 내부에 0개 상태를 함께 구현해야 한다.

### 2.3 기존 검증의 누락

기존 테스트는 다음 항목을 충분히 검증하지 못했다.

- 영어와 국어 첫 영역의 실제 bounding rectangle 동등성
- 광고 0개와 복수 광고 상태가 동일한 외곽 골격을 사용하는지
- 0개 상태에서 캐러셀 자체가 사라지지 않는지
- 과목 전환 전후의 레이아웃 이동과 가로 overflow

일부 계약 테스트는 오히려 `CampaignHero` fallback을 필수로 고정하고 있으므로 새 요구에 맞게 갱신해야 한다.

## 3. 확정 구현 계약

### 3.1 공통 외곽 골격

`MainAdCarousel`을 영어·국어의 유일한 첫 광고 슬롯으로 사용한다.

- 페이지는 광고 개수와 관계없이 `MainAdCarousel`을 렌더링한다.
- 컴포넌트에 `subject`를 전달해 빈 상태 문구와 링크만 과목별로 바꾼다.
- `StudioContainer`, 테두리, radius, 왼쪽 rail 너비, 오른쪽 pane 높이와 반응형 breakpoint는 기존 영어 캐러셀 값을 그대로 사용한다.
- 테스트가 안정적으로 영역을 찾도록 프리뷰 전용 의미 표식인 `data-slot="main-ad-carousel"`과 `data-state="empty|single|multiple"`을 둔다.
- 임의의 새 컨테이너 너비, raw hex, 새 공통 abstraction, 새 UI 의존성은 추가하지 않는다.

### 3.2 광고 0개

같은 캐러셀 프레임 안에서 빈 상태를 표시한다.

- 가짜 광고 제목, 가짜 이미지, 영어 광고 복사본을 만들지 않는다.
- 왼쪽 rail에는 선택 가능한 광고 버튼 대신 “등록된 국어 광고가 없습니다”와 같은 상태 문구를 표시한다.
- 오른쪽 pane에는 과목별 문제마켓 안내와 44px 이상의 명확한 CTA를 표시할 수 있다.
- `aria-current`, 광고 이미지 링크, 카운터, 이전·다음 버튼, 자동 재생, 진행 음영, 슬라이드 상태는 렌더링하지 않는다.
- 기존 `CampaignHero`의 4개 안내 카드, 420/442px 최소 높이, 별도 외곽 컨테이너는 빈 상태 내부로 가져오지 않는다.

### 3.3 광고 1개

- 현재 광고 제목과 이미지 전체 링크를 표시한다.
- 카운터는 필요하면 `1 / 1`로 표시할 수 있으나 이전·다음 버튼은 표시하지 않는다.
- 자동 재생, 진행 음영, 슬라이드 전환은 동작시키지 않는다.
- 링크와 제목은 동일한 광고를 가리켜야 한다.

### 3.4 광고 2개 이상

현재 승인된 동작을 유지한다.

- 각 광고별 설정 시간은 기본 5초이며 관리자에서 1~60초로 설정한다.
- 선택 제목 행은 0%에서 100%까지 왼쪽에서 오른쪽으로 회색 진행 음영이 찬다.
- 설정 시간이 끝나면 다음 이미지가 오른쪽에서 들어오고 현재 이미지는 왼쪽으로 나간다.
- 제목, 이미지 링크, 카운터, `aria-current`는 전환 완료 시 동일 index로 일치한다.
- 현재 승인 동작과 동일하게 pointer hover와 keyboard focus 중에도 진행한다.
- `document.hidden`에서만 남은 시간을 보존한 채 타이머와 진행 음영을 일시 정지한다.
- `prefers-reduced-motion`에서는 자동 재생과 애니메이션을 중단하지만 수동 이전·다음 조작은 유지한다.
- 이전·다음은 모든 뷰포트에서 최소 44×44px, focus-visible, Enter·Space 조작을 보장한다.

### 3.5 관리자와 과목 데이터

이번 수정에서 관리자 UI, API, DB 스키마는 변경하지 않는다.

- 기존 `(임시)메인광고설정`의 영어·국어 전환과 과목별 저장 구조를 그대로 사용한다.
- 국어 광고가 관리자에서 등록되면 별도 코드 분기 없이 같은 캐러셀의 `single` 또는 `multiple` 상태로 바뀌어야 한다.
- 국어 광고 0건은 오류가 아니라 정상 `empty` 상태이다.
- 임시 검증 데이터가 필요할 경우 영어·국어 JSON과 Storage 참조를 정확히 백업한 뒤, 명시적으로 허용된 로컬 또는 비운영 환경에서만 사용하고 `finally`로 원복한다.

## 4. 최소 변경 파일

구현 단계에서 먼저 아래 허용 목록을 현재 `git status`, `git diff`, 오케스트레이션 `filesModified`와 대조한다.

### 필수 수정 후보

- `src/app/preview/solvook-concept/page.tsx`
- `src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx`
- `tests/main-ad-carousel-contract.test.mjs`
- `tests/market-home-browser.test.mjs`
- `tests/market-home-empty-state-contract.test.mjs`
- `tests/market-home-ui-contract.test.mjs`
- `tests/solvook-preview-original-visual-contract.test.mjs`
- 신규 `tests/main-ad-carousel-browser.test.mjs`

### 계약 문서 후보

- `docs/solvook-korean-parity-plan.md`
- `docs/main-ad-carousel-plan.md`
- 이 계획서

### 수정 금지

- 루트 `/`와 운영 `/english/market`, `/korean/market`
- 광고 관리자 페이지와 API
- Supabase migration, RLS, Storage bucket
- 문제마켓 상품·출처·다운로드 집계 서버 코드

`campaign-hero.tsx`는 프리뷰 첫 슬롯에서 연결만 제거한다. 현재 작업 트리에 사용자 또는 다른 작업자의 변경이 있을 수 있으므로 삭제하거나 HEAD로 복원하지 않는다.

## 5. 단계별 구현·검증 loop

모든 Phase는 아래 공통 loop를 따른다.

1. 해당 Phase의 계획과 통과 기준을 다시 읽는다.
2. 변경 전 실패 증거 또는 현재 상태를 기록한다.
3. 허용 파일만 최소 수정한다.
4. 해당 Phase의 목표 테스트를 실행한다.
5. 실패하면 fixture, hydration, 상태 전환, CSS, 데이터 격리 중 어느 원인인지 분류한다.
6. 원인과 직접 관련된 최소 코드만 수정한다.
7. 실패했던 단일 검증을 먼저 다시 실행한다.
8. 통과하면 이전 Phase까지의 누적 검증을 다시 실행한다.
9. 단일 검증과 누적 검증이 모두 PASS일 때만 다음 Phase로 이동한다.

검증이 실패한 상태에서는 Phase 또는 전체 작업을 완료로 처리하지 않는다.

### Phase 0. 변경 보호와 기준선 고정

#### 구현 전 확인

- `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, 관련 계획서를 다시 확인한다.
- `git status --short`와 대상 파일별 `git diff`를 기록한다.
- 오케스트레이션 작업자의 `filesModified`와 실제 diff를 대조한다.
- 허용 목록 밖 기존 변경은 수정, 복원, 삭제하지 않는다.
- broad `git restore`, `git checkout`, `git reset`, untracked 파일 삭제를 사용하지 않는다.
- 동일 파일을 다른 작업자가 수정 중이면 병합 안전성을 확인하고, 보존할 수 없으면 구현을 중단해 보고한다.

#### 통과 기준

- 변경 전 소유권과 기존 diff가 기록되어 있다.
- 이번 작업의 허용 파일 목록이 확정되어 있다.

### Phase 1. 회귀 테스트를 먼저 실패시키기

#### 계약 테스트

다음 새 계약이 현재 코드에서 실패하는 것을 확인한다.

- 페이지가 광고 유무와 관계없이 하나의 `MainAdCarousel`을 렌더링한다.
- `CampaignHero` fallback 분기가 존재하지 않는다.
- 캐러셀은 `empty`, `single`, `multiple` 상태를 명시한다.
- 0개 상태가 `null`을 반환하지 않는다.
- 0개 상태에 광고 전용 컨트롤과 가짜 광고가 없다.
- 1개 상태에는 자동 재생과 이전·다음이 없다.
- 복수 상태에는 기존 진행 음영과 슬라이드 계약이 유지된다.

#### 브라우저 재현

동일 서버, 동일 viewport, 동일 zoom에서 영어와 국어를 비교한다.

- 대상 viewport: 320, 390, 640, 768, 1079, 1200, 1280px
- `data-slot="main-ad-carousel"`의 `x`, `y`, `width`, `height`, `top`, `bottom`을 측정한다.
- 현재 실제 데이터인 영어 `multiple`과 국어 `empty`에서 공통 외곽 슬롯의 폭과 높이를 비교한다.
- 페이지 첫 hydration 전후 영역 이동, 콘솔 hydration warning, 문서 가로 overflow를 기록한다.

이를 수동 관찰로 끝내지 않고 신규 `tests/main-ad-carousel-browser.test.mjs`의 Playwright assertion으로 고정한다.

#### 결정적 0/1/복수 fixture 경계

브라우저 테스트는 운영 DB를 사용하지 않고 로컬 Supabase에만 다음 과목 조합을 순서대로 구성한다.

1. 영어 0개 / 국어 0개
2. 영어 1개 / 국어 1개
3. 영어 복수 / 국어 복수
4. 현재 운영형 비교인 영어 복수 / 국어 0개

fixture는 기존 `system_settings.main_ad_carousel` v2 JSON을 사용한다. 이미지 원본은 저장소의 기존 `public/icons/file-types/pdf-icon.png`를 로컬 `main-ad-images` bucket의 테스트 전용 prefix에 업로드해 재사용한다. 테스트는 시작 전에 설정 JSON과 테스트 prefix 목록을 백업하고, 성공·실패와 관계없이 `after`/`finally`에서 원래 JSON을 복원하고 자신이 만든 객체만 삭제한 뒤 재조회해 복원을 확인한다.

- `NEXT_PUBLIC_SUPABASE_URL`의 hostname이 `127.0.0.1` 또는 `localhost`가 아니면 쓰기 전에 테스트를 실패시킨다.
- 원격 쓰기를 허용하는 우회 환경변수는 만들지 않는다.
- fixture 항목은 고정 UUID, 고정 제목, 1초 duration, 고정 링크를 사용해 결과를 결정적으로 만든다.
- 각 조합에서 두 과목 페이지를 새 browser context로 열어 SSR과 hydration을 모두 거친다.
- 같은 fixture를 JavaScript 비활성 context와 활성 context에서 각각 열어 SSR rect와 hydration 후 rect의 차이를 1px 이하로 확인한다.
- 같은 상태의 영어·국어는 rect 전 필드가 각각 1px 이하여야 한다.
- 영어 복수/국어 0개는 공통 외곽 슬롯의 `width`와 `height`가 각각 1px 이하여야 한다.
- 0개에는 광고 컨트롤이 없고, 1개에는 진행·이전·다음이 없으며, 복수에는 진행·전환 컨트롤이 있어야 한다.

로컬 Supabase를 사용할 수 없으면 이 검증을 SKIP으로 통과시키지 않는다. 환경 미준비로 기록하고 해당 Phase와 전체 완료를 보류한다.

#### 통과 기준

- 새 계약 테스트가 구현 전 의도한 이유로 FAIL한다.
- 영어와 국어의 현재 구조 차이가 수치와 스크린샷으로 재현된다.

### Phase 2. 공통 광고 슬롯 최소 구현

#### 구현

- `page.tsx`의 광고 존재 여부 분기를 제거한다.
- `MainAdCarousel`에 `subject`를 전달한다.
- `MainAdCarousel`의 0개 `null` 반환을 공통 프레임 빈 상태로 교체한다.
- `CampaignHero`의 사용되지 않는 import만 정리한다.
- 기존 영어 `multiple` DOM과 스타일은 필요한 상태 분기 외에 리팩터링하지 않는다.

#### 검증

- Phase 1 계약 테스트를 재실행한다.
- 영어와 국어 모두 `data-slot="main-ad-carousel"`이 한 번만 존재하는지 확인한다.
- 영어 `multiple`의 진행 음영, 슬라이드, 버튼이 유지되는지 확인한다.
- 국어 `empty`에 카운터, 화살표, 광고 링크, timer가 없는지 확인한다.

#### 통과 기준

- 두 과목 모두 동일 외곽 광고 슬롯을 사용한다.
- 기존 영어 복수 광고 동작에 회귀가 없다.

### Phase 3. 상태별 동작과 접근성 검증

#### 0개

- 빈 상태 문구와 CTA가 과목에 맞다.
- 가짜 광고와 빈 링크가 없다.
- 키보드 포커스가 보이지 않는 컨트롤로 이동하지 않는다.

#### 1개

- 제목, 이미지, 링크가 같은 항목이다.
- 진행 음영, 자동 전환, 이전·다음이 없다.

#### 2개 이상

- 진행 음영의 0%, 중간, 100%를 시간 기준으로 확인한다.
- 100% 후 다음 이미지의 좌측 이동 슬라이드와 settle을 확인한다.
- 다음, 이전, 첫 항목에서 이전, 마지막 항목에서 다음 wrap을 확인한다.
- 빠른 연속 입력 동안 index, 제목, 링크, 카운터가 어긋나지 않는다.
- 수동 이동 뒤 새 광고의 설정 시간으로 timer가 재시작한다.
- pointer hover와 keyboard focus 중에도 진행 음영과 timer가 계속 진행한다.
- document hidden 뒤 resume할 때 전체 시간이 아니라 남은 시간부터 진행한다.
- reduced-motion에서 자동 재생은 멈추고 수동 버튼은 동작한다.
- Tab 순서, Enter·Space, focus-visible, 44×44px target을 확인한다.

#### 통과 기준

- 0/1/복수 상태 계약이 모두 PASS한다.
- 상태와 관계없이 hydration warning과 가로 overflow가 없다.

### Phase 4. 영어·국어 관리자 연결 검증

기존 관리자 구현을 변경하지 않고 연결만 검증한다.

- `tests/main-ad-carousel-browser.test.mjs`의 관리자 round-trip 구간은 `.env.test.local`의 로컬 테스트 관리자 계정으로 로그인해 실제 `(임시)메인광고설정` UI를 조작한다.
- 영어와 국어를 각각 선택했을 때 저장된 광고 목록이 서로 섞이지 않는다.
- 국어 0개에서 빈 슬롯, 1개에서 정적 슬롯, 복수에서 자동 캐러셀로 전환된다.
- 국어 저장 후 영어 설정 JSON이 byte-equivalent하게 보존되는지 확인한다.
- 이미지 교체·삭제 시 반대 과목 Storage 참조가 보존되고 orphan이 생기지 않는지 확인한다.
- 임시 데이터를 사용했다면 원래 JSON과 파일 참조를 `finally`에서 복원하고 복원 결과를 다시 읽어 확인한다.

브라우저 테스트는 관리자 UI에서 제목, 링크, 1초 노출시간, PC 이미지, 활성 상태를 저장한 뒤 국어 프리뷰를 새로 열어 `empty → single → multiple → empty` 변화를 검증한다. 각 저장 직후 관리자 페이지를 새로 열어 persisted 값과 순서를 재확인한다.

로컬 테스트 관리자 계정이나 안전한 로컬 검증 환경이 없으면 데이터 쓰기를 하지 않는다. 이 경우 코드·fixture 검증까지만 통과로 기록하고, 실제 관리자 round-trip은 미검증 항목으로 숨기지 말고 전체 완료를 보류한다.

#### 통과 기준

- 과목 격리와 0/1/복수 전환이 확인된다.
- 임시 데이터와 Storage 변경이 남지 않는다.

### Phase 5. 통합 검증과 독립 재검토

#### 자동 검증

아래 순서로 실행한다.

1. 관련 Node 계약 테스트

   ```bash
   node --test \
     tests/main-ad-carousel-contract.test.mjs \
     tests/market-home-browser.test.mjs \
     tests/market-home-empty-state-contract.test.mjs \
     tests/market-home-ui-contract.test.mjs \
     tests/solvook-preview-original-visual-contract.test.mjs
   ```

2. 로컬 Supabase와 로컬 프리뷰 서버가 연결된 상태에서 Playwright fixture 테스트

   ```bash
   MARKET_HOME_BASE_URL=http://127.0.0.1:4000 \
   MAIN_AD_BROWSER_FIXTURE_MODE=local \
   DOTENV_CONFIG_PATH=.env.test.local \
   node --import dotenv/config --test tests/main-ad-carousel-browser.test.mjs
   ```

3. 변경 파일 대상 ESLint

   ```bash
   npx eslint \
     src/app/preview/solvook-concept/page.tsx \
     src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx \
     tests/main-ad-carousel-contract.test.mjs \
     tests/main-ad-carousel-browser.test.mjs \
     tests/market-home-browser.test.mjs \
     tests/market-home-empty-state-contract.test.mjs \
     tests/market-home-ui-contract.test.mjs \
     tests/solvook-preview-original-visual-contract.test.mjs
   ```

4. TypeScript

   ```bash
   npx tsc --noEmit --pretty false
   ```

5. diff whitespace와 허용 범위

   ```bash
   git diff --check
   git status --short
   ```

6. production build

   ```bash
   npm run build
   ```

전체 `npm run lint`가 저장소 기존 오류로 실패하면 이번 변경 파일의 결과와 기존 unrelated 오류를 분리해 보고한다.

#### 실브라우저 검증

320, 390, 640, 768, 1079, 1200, 1280px에서 다음을 확인한다.

- 영어·국어 공통 광고 슬롯의 rect
- 0/1/복수 상태의 레이아웃
- 진행 음영과 이미지 슬라이드
- 제목, 이미지 링크, 카운터 동기화
- 44px target, focus-visible, 키보드 조작
- 모바일 이미지 fallback
- 가로 overflow와 hydration warning 부재
- 각 viewport와 상태 조합의 스크린샷을 테스트 artifact로 남긴다.

같은 상태의 영어·국어는 광고 슬롯 `x`, `y`, `width`, `height`, `top`, `bottom` 차이가 각각 1px 이하여야 한다. 현재 실제 데이터처럼 상태가 다른 영어 `multiple`과 국어 `empty`도 외곽 슬롯의 `width`와 `height` 차이가 1px 이하여야 한다.

#### 독립 검증

구현하지 않은 별도 검증자가 요구사항, 계획서, diff, 테스트 결과, 브라우저 측정값을 읽기 전용으로 대조해 `PASS` 또는 `FAIL`을 판정한다.

- `FAIL`이면 누락 항목과 재현 조건을 기록한다.
- 구현자는 해당 원인만 최소 수정한다.
- 실패했던 검증을 먼저 재실행한 뒤 Phase 1~5 누적 검증을 다시 실행한다.
- 독립 검증자가 `PASS`를 줄 때까지 작업을 완료로 보고하지 않는다.

## 6. 최종 완료 기준

- 영어와 국어의 첫 영역이 광고 개수와 무관하게 동일한 캐러셀 외곽 구조를 사용한다.
- 국어 광고 0개 상태가 같은 크기의 정직한 빈 상태로 보인다.
- 국어 광고 등록 후 1개와 복수 상태가 영어와 같은 코드 경로로 동작한다.
- 영어 복수 광고의 진행 음영, 5초 기본 시간, 관리자 설정 시간, 이미지 슬라이드가 유지된다.
- 관리자 과목별 설정과 Storage 참조가 서로 격리된다.
- 7개 viewport에서 레이아웃, 접근성, overflow 검증을 통과한다.
- 관련 테스트, 대상 ESLint, TypeScript, diff-check, build가 통과한다.
- 기존 사용자 변경을 복원하거나 삭제하지 않는다.
- 독립 검증 결과가 `PASS`이다.

## 7. 예상 위험과 대응

### CSS 생성 순서와 실제 높이

class 문자열만 보고 높이를 판단하지 않는다. 반응형 utility 생성 순서에 따라 예상과 실제 computed style이 달라질 수 있으므로 실제 bounding rectangle을 완료 기준으로 사용한다.

### 빈 상태 콘텐츠 overflow

기존 `CampaignHero`의 많은 정보를 고정 캐러셀 프레임에 넣지 않는다. 짧은 상태 문구와 단일 CTA로 제한하고 320px에서 overflow를 확인한다.

### 오래된 테스트 계약

`CampaignHero` fallback을 고정한 테스트는 삭제해 검증을 약화하지 않고, 공통 광고 슬롯과 0개 상태를 고정하는 새 assertion으로 교체한다.

### 실제 데이터 검증의 안전성

운영으로 연결된 Supabase에 테스트 광고를 임의로 쓰지 않는다. 실제 1개 상태의 관리자 round-trip이 필요하면 환경과 복원 권한을 먼저 확인하며, 정확한 백업과 `finally` 원복 없이는 실행하지 않는다.

## 8. 구현 시 보고 형식

각 Phase마다 다음을 짧게 남긴다.

- 확인한 계획과 통과 기준
- 수정한 파일
- 최초 실패 증거
- 수정 내용
- 실행한 검증 명령과 종료 코드
- 실패가 있었다면 원인과 보완 내용
- 누적 회귀 검증 결과

최종 보고에는 실제로 통과한 검증만 적고, 실행하지 못한 항목은 사유와 함께 미검증으로 명시한다.
