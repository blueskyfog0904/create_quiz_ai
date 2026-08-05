# Solvook 컨셉 메인 광고 묶음 개선 계획

## 0. 문서 상태

- 작성일: 2026-07-29
- 대상: `/preview/solvook-concept?subject=english|korean`
- 관리자: `/admin/main-ad-settings?subject=english|korean`
- 상태: 구현·브라우저 검증·독립 재검증 완료(PASS)
- 목적: 현재 Solvook 컨셉 프리뷰의 상단 영역을 참고 이미지처럼 `왼쪽 제목 목록 + 오른쪽 광고 이미지`가 동기화되는 관리자 설정형 캐러셀로 운영한다.
- 제외: 루트 `/` 이전, 문제마켓 본문 섹션 변경, 광고 분석 통계, 예약 게시, 새로운 광고 테이블 도입

이 계획은 `요청 파악 → 현재 구조 파악 → 계획 작성 → 독립 검증` 순서로 작성한다. 이후 구현 요청을 받으면 각 Phase에서 `계획 확인 → 실패 테스트 작성 → 구현 → 검증 → 실패 원인 분석 및 최소 재구현` loop를 수행하고, 검증을 통과한 뒤에만 다음 Phase로 넘어간다.

## 1. 사용자 요청을 구현 계약으로 변환

광고 한 건은 다음 값이 하나의 묶음이다.

1. 왼쪽 목록에 표시할 제목 한 줄
2. 오른쪽 영역에 표시할 PC 광고 이미지
3. 선택 사항인 모바일 광고 이미지
4. 이미지 전체를 클릭했을 때 이동할 주소
5. 자동 전환까지 유지할 노출 시간
6. 공개 여부
7. 관리자 배열 안의 노출 순서

공개 화면의 왼쪽 목록에는 관리자가 입력한 제목만 표시한다. 시스템이 아이콘, 썸네일, 설명, 라벨을 추가하지 않는다. 현재 항목은 0초에는 음영이 없고, 해당 광고의 노출 시간 동안 흰 배경과 명확히 구분되는 회색 음영이 왼쪽에서 오른쪽으로 채워진다. 음영이 100%가 된 화면을 실제로 한 프레임 표시한 뒤 다음 광고 전환을 시작한다.

오른쪽 영역은 안정 상태에서 관리자가 업로드한 이미지 자체가 하나의 링크다. 자동·다음 전환은 기존 이미지가 왼쪽으로 나가고 다음 이미지가 오른쪽에서 들어오며, 이전 전환은 반대 방향으로 움직인다. 전환 중에는 이미지 링크와 이동 조작을 잠그고 기존 제목의 100% 음영·`aria-current`·카운터를 유지한다. 슬라이드가 끝나는 순간 다음 제목, 이미지, 링크와 카운터를 원자적으로 확정한 뒤 새 광고의 음영을 0%부터 시작한다.

## 2. 현재 구조 분석 결과

이번 요구를 위해 새 시스템을 만들 필요는 없다. 다음 기반이 이미 구현돼 있다.

| 요구 | 현재 구현 | 계획상 처리 |
|---|---|---|
| 과목별 광고 | `main_ad_carousel` v2의 `english`, `korean` ordered 배열 | 그대로 재사용 |
| 왼쪽 제목 | `MainAdCarouselItem.title` | 공개 목록에는 제목만 유지 |
| PC 이미지 | 필수 `pcImagePath`와 Storage 업로드 | 그대로 재사용 |
| 모바일 이미지 | 선택 `mobileImagePath`, 없으면 PC fallback | 그대로 재사용 |
| 이동 링크 | 내부 `/...` 또는 외부 `https://...` | 그대로 재사용 |
| 전환 시간 | 광고별 `durationSeconds`, 1~60초, 기본 5초 | 광고별 설정 방식 유지 |
| 공개 여부 | `isActive` | 그대로 재사용 |
| 순서 | 관리자 배열 순서와 위·아래 이동 | 그대로 재사용 |
| 자동 전환 | 현재 항목 duration 기반 `setTimeout` | 남은 시간 pause·진행 음영·슬라이드 계약 보강 |
| 이미지 전체 클릭 | 내부 `Link`, 외부 `a` | 그대로 재사용 |
| 광고 0건 | 공통 `MainAdCarousel` 골격의 명시적 빈 상태 | `docs/solvook-subject-ad-shell-parity-plan.md`가 기존 `CampaignHero` fallback 계약을 대체 |

현재 구현과 최신 요구의 실제 차이는 다음과 같다.

- 선택 행은 현재 처음부터 고정 음영을 가지며 duration 진행률을 표시하지 않는다.
- pause 후 resume하면 남은 시간이 아니라 광고의 전체 duration이 다시 시작된다.
- 오른쪽 이미지는 index가 바뀌는 즉시 교체되어 양방향 슬라이드가 없다.
- 관리자 PC 이미지 미리보기 비율 `10:3`이 공개 오른쪽 영역의 약 `8:3` 프레임과 일치하지 않아 crop 결과를 정확히 예측하기 어렵다.
- 현재 계약 테스트는 타이머와 breakpoint 문자열은 확인하지만 고정 선택 음영, pause 조건, 이미지 전체 단일 링크를 충분히 고정하지 않는다.

## 3. 확정 설계

### 3.1 데스크톱 구성

- 기존 `StudioContainer`의 최대 1200px와 360px 광고 높이를 유지한다.
- 1200px급에서는 왼쪽 제목 목록 240px, 오른쪽 이미지 960px 구조를 사용한다.
- 1080~1199px에서는 왼쪽 목록을 200px로 줄인다.
- 왼쪽 목록의 각 항목은 최소 60px 높이의 `button`이고 제목 텍스트만 렌더한다.
- 광고가 6개를 넘으면 목록만 세로 스크롤하며, 자동·수동 전환된 활성 제목은 `scrollIntoView({ block: 'nearest' })`로 항상 보이게 한다.
- 선택된 제목은 `aria-current="true"`를 유지하고, 복수 광고에서는 행 전체의 회색 진행 레이어가 0%에서 100%까지 왼쪽에서 오른쪽으로 채워진다.
- 진행 레이어는 텍스트 아래에 두고 `transform-origin: left`와 `scaleX`를 사용해 매 프레임 React 렌더 없이 진행한다.
- 오른쪽 이미지는 영역 전체를 채우고 이미지 전체가 하나의 이동 링크가 된다.
- 카운터와 이전·다음 버튼은 기존처럼 우하단에 둔다.

### 3.2 자동 전환

- 노출 시간은 광고별 설정을 사용한다. 기본값 5초, 허용 범위 1~60초를 유지한다.
- 현재 광고의 시간이 끝나면 진행 음영을 100%로 확정해 한 프레임 표시한 뒤 다음 광고 슬라이드를 시작하고, 마지막 광고 다음에는 첫 광고로 순환한다.
- 광고별 설정 시간은 이미지가 안정적으로 보이는 순수 노출 시간이다. 450ms 슬라이드는 이 시간에 포함하지 않으며, 슬라이드가 끝난 뒤 새 광고의 전체 노출 시간을 시작한다.
- 자동·다음은 기존 이미지가 왼쪽으로 나가고 다음 이미지가 오른쪽에서 들어온다. 이전은 반대 방향이다.
- 제목 선택은 높은 index면 다음 방향, 낮은 index면 이전 방향으로 전환한다. 같은 제목을 다시 선택하면 슬라이드 없이 해당 광고의 진행 시간만 0초부터 재시작한다.
- 문서 hidden 상태에서는 경과 시간을 보존하고 resume 시 남은 시간과 진행률부터 이어간다. 클릭·키보드 focus와 pointer hover는 진행 상태를 계속 재생한다.
- 슬라이드 중에는 이미지 링크, 제목 버튼과 이전·다음 버튼을 잠그고 완료 후 다시 활성화한다.
- 과목 전환이나 관리자 설정 갱신으로 광고 목록이 바뀌면 이전 예약과 전환 token을 화면 그리기 전에 무효화하고 첫 광고의 전체 노출 시간부터 다시 시작한다.
- 활성 광고가 1개면 자동 전환과 이전·다음 버튼을 끈다.
- 활성 광고가 0개여도 공통 `MainAdCarousel` 골격을 렌더하고 광고 컨트롤·가짜 광고가 없는 명시적 빈 상태를 표시한다.
- 문서 hidden 상태에서는 진행 음영과 타이머를 같은 남은 시간에서 멈춘다.
- `prefers-reduced-motion: reduce`에서는 자동 전환과 진행 애니메이션을 시작하지 않고 수동 조작은 슬라이드 없이 즉시 확정한다.
- 슬라이드는 `transform` 기반 450ms `ease-out`만 사용하며 fade나 새 animation dependency는 추가하지 않는다.

### 3.3 이미지 렌더링

- PC 이미지는 오른쪽 공개 프레임과 같은 약 `8:3` 비율의 관리자 미리보기를 제공한다.
- 모바일 이미지는 현재 모바일 프레임과 가까운 `8:5` 미리보기를 유지한다.
- 공개 화면과 관리자 미리보기 모두 같은 `object-cover` 규칙을 사용한다.
- 관리자 안내문에 PC `1920×720px (8:3)`, 모바일 `1200×750px (8:5)` 권장 규격을 표시한다.
- 권장 규격은 도움말이며 업로드 차단 조건으로 사용하지 않는다. 실제 노출 영역에서는 가장자리가 crop될 수 있음을 함께 명시한다.
- PC 이미지는 필수, 모바일 이미지는 선택이며 미등록 시 PC 이미지를 사용한다.

### 3.4 반응형

- 1079px 이하에서는 왼쪽 제목 목록만 숨기고 이미지, 카운터, 링크와 44×44px 이전·다음 버튼을 표시한다.
- 640px 이하에서는 모바일 이미지가 있으면 우선 사용하고, 없으면 PC 이미지를 사용한다.
- 모바일에서도 이미지 전체 클릭 링크, 현재/전체 카운터와 이전·다음 수동 탐색을 유지한다.
- 320px까지 가로 overflow가 없어야 한다.

## 4. 관리자 화면 계약

기존 `(임시)메인광고설정` 화면을 재사용하며 광고 항목별로 다음 입력만 제공한다.

- `광고 제목`: 공개 왼쪽 목록에 표시되는 유일한 문구
- `바로가기 주소`: `/`로 시작하는 내부 경로 또는 `https://` 외부 주소
- `이미지 대체 텍스트`: 접근성을 위한 필수 값
- `노출 시간(초)`: 광고별 1~60초
- `광고 노출`: 공개 포함 여부
- `PC 이미지`: 필수
- `모바일 이미지`: 선택
- 위로·아래로 이동, 삭제

영어·국어 전환은 현재처럼 같은 설정 key 안의 과목별 배열을 편집한다. 과목을 바꾸면 client를 다시 mount하여 다른 과목의 draft가 남지 않게 한다.

이번 요구에는 전체 공통 노출 시간, drag-and-drop, 예약 노출, 새 창 열기, 광고별 상세 문구, 왼쪽 아이콘 설정을 추가하지 않는다. 광고별 시간은 현재 데이터 모델과 자동 전환 동작에 직접 대응하며 별도 schema 변경이 필요 없다.

새 광고를 추가할 때 `노출 시간(초)`는 5초로 시작하고, 관리자가 항목별로 1~60초 안에서 변경할 수 있다.

## 5. 데이터·API·Storage 계약

### 5.1 저장 모델

기존 `system_settings.main_ad_carousel` v2 JSON을 그대로 사용한다.

```ts
interface MainAdCarouselItem {
  id: string
  title: string
  pcImagePath: string
  mobileImagePath: string | null
  alt: string
  href: string
  durationSeconds: number
  isActive: boolean
}

interface MainAdCarouselConfig {
  version: 2
  items: {
    english: MainAdCarouselItem[]
    korean: MainAdCarouselItem[]
  }
}
```

배열 순서가 공개 순서다. 새 테이블이나 DB migration은 만들지 않는다.

### 5.2 저장과 보안

기존 단일 `POST /api/admin/main-ad-settings` multipart 흐름을 유지한다.

1. 로그인과 `profiles.is_admin` 재검증
2. `english | korean` 과목 검증
3. config와 모든 파일 part 전체 검증
4. PC 필수·모바일 선택, UUID와 pc/mobile role 일치 검증
5. JPEG/PNG/WEBP, 파일당 10MB 제한 검증
6. 신규 이미지를 `main-ad-images` bucket에 업로드
7. 선택 과목 배열만 교체하고 반대 과목 배열은 보존
8. 전체 v2 config 저장
9. 더 이상 어느 과목에서도 참조하지 않는 이전 이미지만 삭제

업로드 또는 DB 저장 실패 시 이번 요청의 신규 파일을 보상 삭제한다. 저장 성공 후 이전 이미지 삭제만 실패한 경우 저장 결과는 유지하고 `cleanupWarnings`와 서버 로그로 보고한다.

외부 링크는 credential 없는 HTTPS만 허용하고 내부 링크는 `/`로 시작하는 안전한 상대 경로만 허용한다. `http`, `javascript:`, `data:`, protocol-relative, traversal 경로는 거부한다.

## 6. 최소 변경 경계

### 반드시 변경할 후보

- `src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx`
  - 광고별 시간과 동기화된 0→100% 진행 음영
  - document hidden의 남은 시간 pause
  - 양방향 이미지 슬라이드와 전환 잠금
  - reduced-motion 즉시 수동 전환
- `src/app/(admin)/admin/main-ad-settings/main-ad-settings-client.tsx`
  - PC 미리보기 비율을 공개 프레임과 일치
  - 제목, PC·모바일 권장 규격과 crop 안내 문구 명확화
- `src/lib/main-ad-carousel.ts`
  - 새 광고와 누락된 기존 duration 정규화의 기본값을 5초로 변경
- `tests/main-ad-carousel-contract.test.mjs`
  - 선택 음영, pause, 단일 링크, timer reset 계약
- `tests/main-ad-settings-route-contract.test.mjs`
  - 기존 관리자·파일·과목 격리 계약 회귀
- 필요 시 신규 `tests/main-ad-carousel-browser.test.mjs`
  - 실제 복수 광고 진행률·자동/수동 슬라이드와 viewport 검증

### 변경하지 않을 예상 범위

- `src/app/preview/solvook-concept/page.tsx`
- `src/app/preview/solvook-concept/_components/home/campaign-hero.tsx`
- `src/lib/main-ad-carousel-server.ts`
- `src/app/api/admin/main-ad-settings/route.ts`
- 문제마켓 본문 섹션과 관리자 문제마켓 메인 설정
- 루트 `/`와 운영 market index

기존 데이터·서버·API 계약에서 테스트로 재현되는 결함이 발견되지 않는 한 위 파일을 수정하지 않는다.

## 7. 구현 Phase와 검증 loop

### Phase 0. 현재 dirty worktree와 소유권 감사

계획 확인:

- 현재 작업 트리에는 문제마켓 메인 구현의 미커밋 변경이 이미 존재한다.
- 구현 시작 직전에 `git status --short`, `git diff --name-status`, `git diff`와 이전 orchestration의 `filesModified`를 대조해 이번 광고 작업 이전 변경을 기록한다.

허용 변경 후보는 다음으로 제한한다.

- `docs/main-ad-carousel-plan.md`
- `src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx`
- `src/app/(admin)/admin/main-ad-settings/main-ad-settings-client.tsx`
- `src/lib/main-ad-carousel.ts`
- `tests/main-ad-carousel-contract.test.mjs`
- `tests/main-ad-settings-route-contract.test.mjs`
- 필요 시 신규 `tests/main-ad-carousel-browser.test.mjs`

검증 게이트:

- 위 목록 밖의 기존 수정·신규 파일은 보존하고 수정하지 않는다.
- broad `git restore`, `git checkout`, `git reset`, 기존 untracked 파일 삭제를 수행하지 않는다.
- 병렬 작업자가 같은 파일을 변경한 경우 먼저 diff를 재확인하고 해당 변경을 보존할 수 없으면 구현을 중단해 사용자에게 알린다.
- 각 Phase 종료 시 `git diff --name-only`와 허용 목록을 대조하고, 목록 밖 변경은 이번 작업이 만든 것이 아님을 분리 기록한다.

### Phase 1. 공개 캐러셀 계약 테스트

계획 확인:

- 제목-only rail, 진행 음영, 동일 index, 광고별 duration, 남은 시간 pause와 슬라이드 조건을 다시 확인한다.

구현:

- 먼저 계약 테스트를 추가해 현재 구현에서 실패함을 확인한다.
- 실패 항목만 `main-ad-carousel.tsx`에서 수정한다.

검증 게이트:

- 공개 왼쪽 행에는 `title` 외 광고 데이터가 렌더되지 않는다.
- 선택 행은 0초에 음영이 없고 광고 duration 동안 왼쪽에서 오른쪽으로 100%까지 채워진다.
- 100% 음영이 실제로 표시된 다음 이미지 슬라이드가 시작된다.
- 슬라이드 중에는 기존 제목·카운터·100% 진행 상태를 유지하고 이미지 링크와 조작을 잠근다.
- settle 시 제목·이미지·링크·카운터가 같은 index로 원자적으로 확정된다.
- 제목·화살표 조작 후 settle된 광고의 타이머가 해당 광고 duration으로 초기화된다.
- document hidden pause는 남은 시간을 보존하며 reduced motion에서는 자동 진행과 슬라이드를 끈다.
- 단일 광고에서 자동 전환과 화살표가 없다.
- 제목 버튼은 최소 44×44px이고 Tab으로 접근한 뒤 Enter·Space로 광고를 전환할 수 있다.
- 이미지 링크와 이전·다음 버튼은 명확한 `focus-visible`을 가지며 이전·다음 버튼도 최소 44×44px이다.

### Phase 2. 관리자 미리보기 정합성

계획 확인:

- 공개 PC 프레임과 관리자 미리보기의 crop 규칙을 대조한다.

구현:

- PC 미리보기 비율을 `8:3`으로 맞춘다.
- `광고 제목`이 왼쪽 목록의 유일한 표시 문구라는 도움말을 추가한다.
- PC `1920×720px (8:3)`, 모바일 `1200×750px (8:5)` 권장 규격과 crop 안내를 추가한다.
- 신규 항목과 duration 누락 데이터의 기본 노출 시간을 5초로 맞춘다.
- 기존 입력·업로드·정렬·삭제 구조는 변경하지 않는다.

검증 게이트:

- PC와 모바일 미리보기는 공개 프레임과 같은 `object-cover` 규칙이다.
- 제목, 링크, alt, 시간, 활성화, PC/모바일 이미지 입력이 저장 draft와 일치한다.
- 과목 전환 후 다른 과목의 unsaved draft가 남지 않는다.
- 위·아래 순서가 저장 배열과 공개 순서에 그대로 반영된다.

### Phase 3. 저장·보안 회귀

계획 확인:

- 이번 UI 변경이 기존 API·Storage 수명주기를 바꾸지 않는지 확인한다.

검증 게이트:

- 401, 403, invalid subject 400과 성공 저장 계약
- 새 항목 PC 파일 누락, 잘못된 MIME·확장자·크기, item/role 불일치 거부
- 선택 과목만 변경되고 반대 과목 config와 이미지가 보존됨
- 중간 업로드·DB 실패 시 신규 파일 보상 삭제
- obsolete 삭제 실패가 `cleanupWarnings`로 분리됨
- 기존 Node 계약 테스트가 모두 exit code 0

### Phase 4. 실제 브라우저 통합 검증

복수 활성 광고 2개 이상을 가진 검증 데이터로 다음을 확인한다.

- 왼쪽 제목 클릭 시 올바른 방향으로 이미지가 슬라이드되고 settle 후 제목·이미지·링크가 일치
- 각 광고의 서로 다른 노출 시간대로 자동 전환
- 0초·중간·종료 시점에서 진행 음영이 각각 0%·중간값·100%이고 100% 표시 후 슬라이드
- 자동·다음, 이전, 제목 상·하 index와 마지막·첫 번째 순환의 슬라이드 방향
- 수동 조작과 같은 제목 재선택 후 타이머 reset
- 문서 hidden pause 후 남은 시간부터 resume, 클릭·키보드 focus 중 진행 유지
- reduced motion에서 자동 진행·슬라이드 없이 수동 즉시 전환
- 전환 중 연속 입력 잠금과 transition 종료 fallback
- 이미지 전체 클릭이 설정 주소로 이동
- 영어·국어 광고 배열이 서로 섞이지 않음
- active 0개는 공통 캐러셀 골격의 빈 상태, active 1개는 정적 이미지
- 1280, 1200, 1079, 768, 640, 390, 320px에서 레이아웃과 horizontal overflow
- 1080px 이상에서는 제목 버튼, 모든 지정 viewport에서는 이미지 링크와 이전·다음 버튼의 최소 44×44px hit area와 visible focus
- keyboard-only로 Tab 순회, 제목 Enter·Space 전환, 이전·다음 버튼 Enter·Space 전환

로컬 또는 검증 환경에 복수 광고 데이터가 없으면 브라우저 자동 전환 검증을 생략한 채 완료 처리하지 않는다. 임시 검증 데이터는 기존 설정을 백업한 뒤 관리자 경계를 통해 추가하고, 검증 후 원래 설정으로 복원한다.

### Phase 5. 전체 회귀와 독립 검증

- 관련 Node 계약 테스트
- 변경 TS/TSX 대상 ESLint
- `npx tsc --noEmit`
- `git diff --check`
- `npm run build`
- root `/`, 운영 market index, 문제마켓 본문 섹션 diff 없음
- 지정 viewport 스크린샷과 keyboard/focus 검증
- 별도 검증 에이전트가 이 계획의 acceptance criteria와 실제 diff를 독립 검토

FAIL이면 실패 항목의 Phase로 돌아가 재현 테스트를 먼저 고정하고 최소 수정 후 해당 Phase와 전체 회귀를 다시 실행한다. 독립 리뷰가 PASS일 때만 구현 완료로 보고한다.

## 8. Acceptance Criteria

- [x] 관리자 광고 한 건이 제목, PC/모바일 이미지, 링크, 노출 시간, 활성 여부와 순서를 하나의 묶음으로 저장한다.
- [x] 공개 왼쪽 목록에는 관리자 제목만 표시되며 시스템 아이콘·설명·썸네일이 없다.
- [x] 선택 행은 0초에 음영이 없고 광고별 시간 동안 왼쪽에서 오른쪽으로 100%까지 채워진다.
- [x] 100% 진행 상태가 표시된 뒤 자동·다음은 왼쪽 방향, 이전은 오른쪽 방향으로 이미지가 슬라이드된다.
- [x] 오른쪽은 관리자 업로드 이미지이며 영역 전체가 설정 링크다.
- [x] 전환 중에는 링크와 조작을 잠그고 settle 시 제목, 이미지, 링크, 카운터가 같은 index로 원자 확정된다.
- [x] 광고 목록 길이·순서·내용이 갱신되면 이전 타이머와 전환을 취소하고 첫 광고의 0% 진행 상태로 일관되게 초기화된다.
- [x] 광고별 1~60초 노출 시간이 적용되고 수동 전환 시 타이머가 초기화된다.
- [x] 새 광고와 duration 누락 데이터의 기본 노출 시간은 5초이며 관리자에서 항목별 변경할 수 있다.
- [x] 클릭·키보드 focus와 pointer hover 중에는 진행률이 계속 증가하고, hidden document에서는 진행률과 남은 시간이 보존된다. reduced motion에서는 자동 진행과 슬라이드가 멈춘다.
- [x] 제목 버튼·이미지 링크·이전·다음은 keyboard-only로 조작되고, 최소 44×44px hit area와 명확한 focus-visible을 갖는다.
- [x] 1200px급 240px rail + 960px image, 1080~1199px 200px rail, 1079px 이하 image-only 계약이 지켜진다.
- [x] 복수 광고의 이전·다음 버튼은 1079px 이하에서도 유지되어 자동 전환을 끈 사용자도 모든 광고를 탐색할 수 있다.
- [x] PC 이미지 필수, 모바일 이미지 선택과 PC fallback이 동작한다.
- [x] 관리자 업로드 영역에 PC `1920×720px (8:3)`, 모바일 `1200×750px (8:5)` 권장 규격과 crop 안내가 보인다.
- [x] 영어·국어 설정과 이미지 참조가 서로 격리된다.
- [x] active 0개는 공통 `MainAdCarousel` 골격의 빈 상태이고, active 1개는 자동 전환 없는 정적 광고다.
- [x] 관리자 저장·파일 검증·보상 삭제·obsolete cleanup 경계가 회귀하지 않는다.
- [x] root, 운영 market index와 광고 아래 문제마켓 본문 구조가 변경되지 않는다.
- [x] 구현 전 dirty worktree 소유권을 기록하고 허용 목록 밖 기존·병렬 변경을 수정·복원·삭제하지 않는다.
- [x] 테스트, 대상 ESLint, TypeScript, build, 브라우저 검증과 독립 리뷰가 모두 PASS다.

## 9. 사용자 확정사항

1. 노출 시간은 광고별 설정을 사용하며 기본값은 5초다.
2. 1079px 이하에서는 왼쪽 제목 목록만 숨기고 이미지, 카운터와 이전·다음 버튼을 표시한다.
3. 관리자 이미지 업로드 영역에는 PC와 모바일 권장 규격을 표시한다.
4. 선택 제목의 회색 음영은 광고별 노출 시간 동안 0%에서 100%까지 채운다.
5. 음영이 100%가 되면 자동·다음은 왼쪽으로, 이전은 반대 방향으로 이미지를 슬라이드한다.
