# Solvook형 메인 광고 캐러셀 구현 계획

## 1. 목표와 확정 요구사항

`/preview/solvook-concept`의 현재 상단 `CampaignHero` 전체만 Solvook형 메인 광고 캐러셀로 교체한다. 광고 한 항목은 데스크톱 왼쪽 제목 목록의 한 행과 오른쪽 PC 광고 이미지 및 목적지 링크를 한 묶음으로 가지며, 모바일에서는 같은 항목의 모바일 이미지가 있으면 이를 우선 사용하고 없으면 PC 이미지를 사용한다.

관리자는 `/admin/main-ad-settings`에서 정확한 메뉴명 `(임시)메인광고설정`으로 공유 메인 광고를 관리한다. 지원 기능은 광고 등록·수정·삭제, 제목, 필수 PC 이미지, 선택 모바일 이미지, 필수 대체문구, 목적지 링크, 광고별 노출시간(기본 6초), 위/아래 순서 변경, 게시/비게시, 미리보기다.

완료 상태는 다음 조건을 동시에 만족하는 상태다.

- 공개 프리뷰의 헤더, `QuickAccessGrid`와 그 아래 모든 섹션 및 기존 전역 디자인은 변경되지 않는다.
- 설정이 없거나 유효한 게시 항목이 없으면 현재 `CampaignHero`가 그대로 fallback으로 렌더링된다.
- 활성 항목이 1개면 자동 전환, 진행 표시, 이전/다음 화살표가 모두 비활성화된다.
- 활성 항목이 2개 이상이면 항목별 노출시간에 따라 자동 전환하며, 제목/화살표 조작 시 즉시 전환하고 해당 항목의 타이머를 처음부터 다시 시작한다.
- 관리자 입력과 저장값은 서버 경계에서 정규화·검증되고, 공개 클라이언트에는 게시 중인 안전한 항목만 전달된다.

## 2. 관찰 근거와 디자인 기준

### 2.1 2026-07-25 실제 Solvook 관찰값

- 캐러셀 콘텐츠 최대 너비는 1200px, 높이는 360px이다.
- 데스크톱 왼쪽 제목 목록 너비는 1200px급에서 240px, 1080~1199px에서 200px이며 1079px 이하에서는 숨긴다.
- 활성 제목 행에는 회색 진행 레이어가 항목 노출시간 동안 기본 6초 `linear`로 차오른다.
- 제목 클릭은 즉시 해당 항목으로 전환하고 타이머를 리셋한다.
- 현재/전체 카운터는 우하단에 표시한다.
- 1200px급에서는 이전/다음 화살표를 제공한다.
- 640px 이하에서는 별도 모바일 이미지를 사용하고 카운터를 좌하단에 표시한다.
- 모바일 스와이프는 관찰되지 않았으므로 구현하지 않는다.

### 2.2 저장소 디자인 기준

- `DESIGN.md`의 1200px 콘텐츠 너비, responsive gutter, 44×44px 상호작용 영역, semantic HTML, keyboard 조작, `focus-visible` 기준을 적용한다.
- 기존 `StudioContainer`, shadcn primitive, Studio semantic token과 `/preview/design-system`의 검증된 패턴을 우선한다.
- Studio core 색상·너비·radius·shadow를 consumer에 새로운 raw hex 또는 임의 값으로 추가하지 않는다. 관찰값인 1200px/360px 및 명시된 breakpoint는 이 기능의 레이아웃 계약으로만 사용하고, 가능한 기존 container/token에 연결한다.
- 전역 `--primary`, subject theme, `globals.css`, 공통 primitive의 default 동작은 바꾸지 않는다.
- 캐러셀은 현재 한 consumer만 있으므로 새 공통 디자인 시스템 abstraction으로 승격하지 않고 프리뷰 로컬 컴포넌트로 둔다.

## 3. 범위

### 포함

- `CampaignHero` 영역 전체를 설정 기반 캐러셀 또는 기존 hero fallback으로 선택하는 서버 렌더링 경계
- 데스크톱 제목 목록, PC/모바일 이미지, 링크, 자동 전환, 진행 레이어, 카운터, 이전/다음 버튼
- 관리자 전용 설정 페이지와 서버 액션
- `system_settings.key = 'main_ad_carousel'`의 ordered JSON 저장·조회·정규화·검증
- 전용 public Supabase Storage bucket `main-ad-images` 생성과 관리자 서버 경계 업로드/교체/삭제
- 외부 `https://` 및 내부 `/` 상대 링크 허용, 동일 탭 이동
- 설정 계약 테스트와 공개/관리자 수동 검증

### 비범위

- 헤더, `QuickAccessGrid`, 추천 자료·교재 탐색·최근 자료·하단 CTA 등 hero 아래 섹션
- 기존 전역 디자인, Studio token, 공통 primitive 또는 page template 변경
- analytics/클릭 추적, 예약 노출, 과목별 광고 또는 subject 분리
- drag-and-drop 순서 변경, 새 창 열기 옵션, 모바일 swipe
- `http://`, `javascript:`, `data:`, `//example.com` 형식의 protocol-relative URL 지원
- 캐러셀 관리 목적의 별도 광고 테이블이나 별도 workspace setting 도입

## 4. 현재 구조와 변경 경계

- 현재 공개 페이지 `src/app/preview/solvook-concept/page.tsx`는 서버 컴포넌트이며 `CampaignHero`를 `StudioLandingPageFrame`의 `hero` slot으로 전달한다. 이 서버 페이지에서 설정을 읽고 활성 항목만 캐러셀에 넘기면 아래 섹션 경계를 유지할 수 있다.
- 현재 `src/app/preview/solvook-concept/_components/home/campaign-hero.tsx`는 hero 자체와 fallback에 필요한 기존 콘텐츠를 소유한다. 기존 파일은 fallback 보존용으로 유지하고 캐러셀을 별도 로컬 클라이언트 컴포넌트로 분리한다.
- `src/lib/landing-page-server.ts`와 `src/lib/header-navigation-server.ts`는 service-role 기반 `system_settings` 조회/upsert 관례를 제공한다. 메인 광고도 같은 서버 모듈 패턴을 따르되 subject/workspace 분기는 두지 않는다.
- `src/lib/admin-sidebar.ts`가 기본 관리자 메뉴와 순서 계약을 소유한다. 새 메뉴는 이 기본 목록에 한 항목만 추가한다.
- 관리자 UI는 `src/app/(admin)/admin/landing-pages`의 page/client 구성, 관리자 확인과 오류 표현 방식을 참고하되 저장 mutation은 통합 Route Handler로 보낸다.

## 5. 정확한 파일 후보

구현 시 실제 import와 기존 변경 상태를 다시 확인하고, 아래 최소 후보 안에서만 작업한다.

### 신규

- `src/lib/main-ad-carousel.ts`
  - 타입, 기본값, ordered JSON 정규화, 저장 검증, URL 검증, 활성 항목 필터
- `src/lib/main-ad-carousel-server.ts`
  - `system_settings` 조회, 저장 path에서 공개 URL 파생, 공개용 활성 항목 조회와 통합 저장 Route Handler용 서버 helper
- `src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx`
  - 공개 클라이언트 캐러셀의 상태·타이머·조작·responsive UI
- `src/app/(admin)/admin/main-ad-settings/page.tsx`
  - 관리자 확인 후 초기 설정을 읽는 서버 페이지
- `src/app/(admin)/admin/main-ad-settings/main-ad-settings-client.tsx`
  - CRUD 편집, 위/아래 정렬, 게시 상태, 이미지 입력, 미리보기 UI
- `src/app/api/admin/main-ad-settings/route.ts`
  - 관리자 재검증부터 config upsert와 obsolete object 정리까지 한 요청에서 담당하는 `POST` multipart Route Handler
- `supabase/migrations/<timestamp>_create_main_ad_images_bucket.sql`
  - public `main-ad-images` bucket 생성. anon/authenticated object write 정책은 만들지 않음
- `tests/main-ad-carousel-contract.test.mjs`
  - 정규화, ordered JSON, URL·Storage path 허용/거부, fallback/단일 항목 계약
- `tests/main-ad-settings-route-contract.test.mjs`
  - 통합 저장 Route Handler의 인증·draft/file 매핑·검증·보상 삭제·obsolete cleanup 계약

### 수정

- `src/app/preview/solvook-concept/page.tsx`
  - 서버에서 설정 조회, 활성 항목 유무에 따라 캐러셀 또는 현재 `CampaignHero` 선택
- `src/lib/admin-sidebar.ts`
  - `(임시)메인광고설정` → `/admin/main-ad-settings` 기본 메뉴 추가

### 원칙상 수정하지 않음

- `src/app/preview/solvook-concept/_components/home/campaign-hero.tsx`
  - 현재 구현을 fallback으로 보존한다. 타입 연결 때문에 불가피한 최소 변경이 생길 경우에도 시각/동작은 바꾸지 않는다.
- `src/app/preview/solvook-concept/_components/home/quick-access-grid.tsx`
- `src/app/preview/solvook-concept/_components/home/home-material-sections.tsx`
- `src/app/preview/solvook-concept/_components/preview-header.tsx`
- `src/app/globals.css`, `src/components/ui/*`, `src/components/design-system/*`, `src/components/page-templates/*`

## 6. 데이터 계약

### 6.1 저장 위치

- 공유 설정이므로 subject/workspace 분리 없이 `public.system_settings`의 단일 key `main_ad_carousel`를 사용한다.
- 배열 순서가 곧 노출 순서인 ordered JSON으로 저장한다.
- 설정 row가 없거나 JSON이 정규화 후 빈 배열이면 공개 화면은 현재 `CampaignHero` fallback을 사용한다.

권장 계약:

```ts
interface MainAdCarouselConfig {
  version: 1
  items: MainAdCarouselItem[]
}

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

interface PublicMainAdCarouselItem
  extends Omit<MainAdCarouselItem, 'pcImagePath' | 'mobileImagePath' | 'isActive'> {
  pcImageUrl: string
  mobileImageUrl: string | null
}

interface MainAdSaveResponse {
  config: MainAdCarouselConfig
  cleanupWarnings: Array<{ path: string; message: string }>
}
```

- `id`: 클라이언트 편집 및 React key에 사용하는 안정적인 UUID다. 광고 추가 시 client가 `crypto.randomUUID()`로 생성하고 수정/정렬 시 보존하며, 서버는 UUID 형식과 config 내 중복을 검증한다.
- `title`: trim 후 비어 있으면 저장 거부한다.
- `pcImagePath`: 필수이며 public URL이 아닌 `main-ad-images` bucket-relative object path를 저장한다.
- `mobileImagePath`: 선택 bucket-relative object path이며 빈 문자열은 `null`로 정규화한다.
- `alt`: 필수 대체문구로 trim 후 비어 있으면 저장 거부한다. 제목으로 묵시적 대체하지 않는다.
- `href`: 필수 목적지 링크. trim 후 URL 규칙을 통과해야 한다.
- `durationSeconds`: 광고별 양의 유한 숫자. 미입력/비정상 입력의 정규화 기본값은 6초이며, 관리자 저장 시에는 허용 범위를 명시하고 범위 밖 값을 오류로 표시한다. 구현 전 과도한 타이머 값 방지를 위한 최소/최대 범위(권장 1~60초)를 계약 테스트에 고정한다.
- `isActive`: 게시 여부. 공개 서버 조회는 `true` 항목만 기존 배열 순서대로 반환한다.
- 저장 path 형식은 `carousel/{itemId}/{pc|mobile}/{assetUuid}.{ext}`로 고정한다. 선행 `/`, `..`, 역슬래시, URL scheme, percent-encoded traversal을 거부하고 각 path의 `{itemId}`와 role prefix가 해당 config item의 `id` 및 `pcImagePath`/`mobileImagePath` 역할과 일치해야 한다.
- 공개 서버는 검증된 path에만 `supabase.storage.from('main-ad-images').getPublicUrl(path)`를 적용해 `PublicMainAdCarouselItem.pcImageUrl/mobileImageUrl`을 파생한다. public URL은 설정 JSON에 저장하지 않고 공개 client DTO에서만 사용한다.
- multipart draft의 각 item은 기존 `pcImagePath/mobileImagePath`만 담고 새 File 자체는 JSON에 넣지 않는다. File은 `file:{itemId}:pc` 또는 `file:{itemId}:mobile` part로 대응시키며, 성공 응답은 path가 치환된 저장 `config`와 cleanup 실패 목록 `cleanupWarnings`를 반환한다.

### 6.2 URL 검증

허용:

- `https://example.com/path`
- `/preview/solvook-concept/boards/...`처럼 단일 `/`로 시작하는 내부 상대 경로

거부:

- `http://...`
- `javascript:...`, 대소문자 또는 공백/인코딩으로 우회한 동등 형식
- `data:...`
- `//example.com/...`
- 빈 문자열, 역슬래시 기반 scheme 우회, 파싱 불가능한 값

내부 단일 `/` 상대 링크는 Next `Link`, 외부 HTTPS는 `<a>`로 명시적으로 분기한다. 둘 다 이미지 전체를 감싸는 하나의 same-tab 링크이며 `target="_blank"` 옵션을 만들지 않고, 왼쪽 제목 행은 이동 링크가 아니라 해당 광고로 전환하는 `button`이다. 정규화 함수와 저장 검증 함수가 같은 validator를 사용하고 계약 테스트에서 허용/거부 표를 고정한다.

### 6.3 이미지 저장과 보안 경계

- 전용 public bucket 이름은 정확히 `main-ad-images`다. 공개 캐러셀은 public URL로 이미지를 읽는다.
- 브라우저가 Supabase Storage에 직접 쓰지 않는다. `POST /api/admin/main-ad-settings` 하나가 `requireAdmin` 또는 동등한 인증·관리자 재검증 후 multipart 저장 요청 전체를 처리한다. 기존 market 파일 Route Handler의 `request.formData()` 패턴을 따르며 Server Action body-size/직렬화 위험과 이미지·config 간 두 요청 불일치를 피한다.
- multipart에는 `config` key의 draft config JSON과 새 이미지 File parts를 함께 보낸다. File part key는 `file:{itemId}:{role}`로 고정하고 `role`은 `pc` 또는 `mobile`만 허용한다. 같은 item/role의 중복 part, config에 없는 item id, 임의 key의 File part, role 불일치 part를 거부한다.
- 허용 파일 상수는 MIME `image/jpeg`, `image/png`, `image/webp`; 확장자 `jpg`, `jpeg`, `png`, `webp`; 파일당 최대 `10 * 1024 * 1024` bytes로 확정한다. MIME과 확장자를 각각 검증하고 둘 중 하나라도 불일치하면 업로드 전에 거부한다.
- 새 object path는 서버가 생성한 asset UUID를 사용해 `carousel/{itemId}/{pc|mobile}/{assetUuid}.{ext}`로 만든다. 저장 draft가 가진 기존 path도 동일 item id/role prefix와 정확히 일치해야 하며 traversal, URL, bucket/prefix 밖 path를 거부한다.
- 새 item은 새 PC File이 필수다. 기존 config에 있던 item은 유효한 기존 `pcImagePath` 또는 같은 요청의 새 PC File 중 하나가 필수이며 모바일은 기존 path, 새 File 또는 `null` 중 하나다.
- Route Handler 처리 순서는 `(1) 관리자 재검증 → (2) draft config JSON 및 File part 파싱 → (3) 기존 config 조회 → (4) UUID/중복/필수값/URL/path/File 전체 검증 → (5) 신규 files upload → (6) draft의 해당 path를 신규 path로 치환 → (7) 최종 config 재검증 및 system_settings upsert → (8) 성공 후 old config 대비 더 이상 참조되지 않는 obsolete paths 삭제`로 고정한다.
- 전체 검증이 끝나기 전에는 object를 업로드하거나 DB를 변경하지 않는다. 다중 upload 도중 하나가 실패하거나 DB upsert가 실패하면 이번 요청에서 이미 업로드한 신규 objects를 모두 보상 삭제하고 기존 config와 기존 objects는 유지한 채 실패 응답을 반환한다.
- DB 저장 성공 후 obsolete path 삭제 실패는 저장 자체를 rollback할 수 없으므로 성공 응답의 구조화된 `cleanupWarnings`와 서버 로그에 남긴다. 운영자가 같은 안전한 삭제 helper로 재시도할 수 있게 path와 오류 문맥을 보존하되 별도 예약 cleanup/cron은 추가하지 않는다.
- 관리자 UI는 저장 전 선택 이미지를 `URL.createObjectURL()`로 로컬 미리보기하고 교체·취소·unmount 시 `URL.revokeObjectURL()`한다. 저장 요청 전 취소하거나 페이지를 이탈하면 Storage object가 생성되지 않는다.
- bucket migration은 public bucket read만 제공하고 anon/authenticated에 대한 `storage.objects` INSERT/UPDATE/DELETE 정책은 만들지 않는다. write는 관리자 검증을 마친 통합 Route Handler가 service-role로 수행하며, service-role은 Storage RLS를 우회하므로 Route Handler의 관리자·draft·file·path 검증이 유일한 write authorization 경계다.

### 6.4 공개 데이터 경계

`page.tsx` 서버 컴포넌트가 `main_ad_carousel`을 읽고 정규화한 뒤 `isActive === true`인 항목의 검증된 Storage path를 `getPublicUrl`로 변환해 공개 DTO만 클라이언트 캐러셀 props로 전달한다. 비게시 항목, bucket-relative path를 포함한 원본 설정 객체, 관리자용 상태는 client bundle에 포함하지 않는다. 조회 오류, 설정 없음, 유효 항목 0개는 모두 기존 `CampaignHero` fallback으로 안전하게 수렴한다.

## 7. 상호작용·반응형 계약

- 공통: 이미지 전체를 광고 목적지 링크로 제공하고 필수 `alt`를 적용한다. 현재/전체 카운터에는 읽을 수 있는 텍스트를 제공한다.
- 1200px급: 총 높이 360px, 왼쪽 목록 240px, 오른쪽 이미지 영역, 우하단 카운터, 44×44px 이상의 이전/다음 버튼을 표시한다.
- 왼쪽 제목 목록은 항목 수가 높이를 넘을 때 `overflow-y-auto`로 스크롤되며 각 전환 `button`의 높이/hit area는 최소 44px다. 제목 클릭, 화살표, 자동 타이머 전환 모두 선택 행에 `scrollIntoView({ block: 'nearest' })` 또는 동등한 처리를 적용해 활성 제목이 항상 목록 viewport 안에 보이게 한다.
- 1080~1199px: 왼쪽 목록을 200px로 줄이고 나머지는 이미지 영역에 배정한다.
- 1079px 이하: 왼쪽 목록을 숨기고 이미지 중심으로 표시한다.
- 640px 이하: 모바일 이미지가 있으면 `<picture>` 또는 동등한 source 선택으로 모바일 이미지를 사용하며 카운터를 좌하단에 둔다. 모바일 이미지가 없으면 PC 이미지를 사용한다.
- 이미지에는 컨테이너를 채우는 일관된 렌더 규칙을 적용하고, 관리자 미리보기에서도 공개 화면과 같은 crop/비율을 사용해 결과를 예측 가능하게 한다.
- 활성 항목이 2개 이상일 때만 자동 전환과 진행 레이어를 실행한다. 진행 애니메이션 duration은 현재 항목의 `durationSeconds`, timing function은 `linear`다.
- 제목 클릭, 이전/다음 클릭은 즉시 index를 변경하고 animation/timer key를 갱신해 새 항목의 전체 노출시간으로 리셋한다.
- 마지막 항목 다음은 첫 항목, 첫 항목 이전은 마지막 항목으로 순환한다.
- active 1개일 때 카운터는 표시할 수 있으나 자동 전환, 진행 레이어, 화살표는 렌더링하거나 동작시키지 않는다.
- 제목 행과 화살표는 keyboard로 조작 가능하고 `focus-visible`을 제공한다. 자동 전환 중 사용자가 포커스한 조작 대상을 강제로 이동시키지 않는다.
- 모바일 swipe, hover pause, 새창 옵션 등 확정되지 않은 상호작용은 추가하지 않는다.

## 8. Phase별 구현과 검증 게이트

각 Phase는 `계획 파악 → 구현 → 검증 → 실패 원인 분석 → 최소 재구현 → 재검증` 순서로 진행하며, 게이트 통과 전 다음 Phase로 넘어가지 않는다.

### Phase 1. 순수 데이터 계약과 테스트

구현:

- `src/lib/main-ad-carousel.ts`에 타입, 기본 6초, ordered JSON 정규화, 저장 검증, URL validator, 활성 항목 필터를 작성한다.
- `tests/main-ad-carousel-contract.test.mjs`에 정상/결손/악성 입력과 순서 보존 테스트를 먼저 추가해 실패를 확인한 뒤 구현한다.

검증 게이트:

- 유효 배열의 순서와 안정적 id가 보존된다.
- item id는 UUID만 허용되고 중복 UUID가 거부된다.
- 빈 선택 이미지가 `null`, 미입력 노출시간이 6초로 정규화된다.
- 제목/PC 이미지/대체문구/링크 필수 계약과 duration 범위가 저장 시 검증된다.
- 외부 HTTPS와 내부 상대 링크만 통과하고 `http`, `javascript`, `data`, protocol-relative 및 우회형이 거부된다.
- 저장 이미지 path가 전용 bucket prefix의 상대 path일 때만 통과하고 URL/traversal/bucket 밖 path는 거부된다.
- 비게시 항목은 공개 활성 목록에서 제거된다.
- 계약 테스트 명령이 exit code 0이다.

### Phase 2. 저장소·Storage 서버 경계

구현:

- migration으로 public `main-ad-images` bucket을 만들되 anon/authenticated object write 정책은 추가하지 않는다.
- `src/lib/main-ad-carousel-server.ts`에 `system_settings.main_ad_carousel` 조회, path→public URL 파생 및 통합 Route Handler가 재사용할 검증·Storage helper를 구현한다.
- `POST /api/admin/main-ad-settings`가 관리자 재검증, draft와 files 전체 검증, 신규 upload, path 치환, config upsert, obsolete path cleanup을 단일 multipart 요청 순서로 수행한다.

검증 게이트:

- 설정 read 실패/row 없음/invalid JSON이 공개 fallback용 빈 활성 목록으로 수렴한다.
- 저장은 서버 validator 통과 후에만 ordered JSON을 upsert한다.
- 통합 Route Handler의 비인증 요청은 401, 인증됐지만 비관리자인 요청은 403이고 설정이나 파일을 변경하지 않는다.
- malformed config, invalid/duplicate UUID, 새 item의 PC File 누락, unexpected/duplicate File part, itemId/role 불일치가 upload 전에 4xx로 거부된다.
- MIME/확장자 허용 목록과 파일당 10MB 제한이 각각 적용되며 invalid MIME/ext/size이면 Storage upload가 호출되지 않는다.
- 다중 upload 중간 실패와 DB upsert 실패는 이번 요청 신규 objects를 전부 보상 삭제하고 기존 config/objects를 유지한다.
- 성공 후 old config 대비 obsolete paths만 삭제하며 실패는 성공 응답 `cleanupWarnings`와 서버 로그에 남는다.
- 검증된 Storage path가 `getPublicUrl`로 공개 DTO URL에 파생되고 저장 JSON에는 URL이 들어가지 않는다.
- bucket 밖/traversal path, item id/role prefix가 맞지 않는 path, 최종 config가 계속 참조하는 공유 path 삭제가 거부된다.
- migration 검토에서 public read, anon/authenticated object write policy 부재, service-role 전용 write와 애플리케이션 관리자 검증 경계가 확인된다.
- `node --test tests/main-ad-carousel-contract.test.mjs tests/main-ad-settings-route-contract.test.mjs`가 exit code 0이다.

### Phase 3. 관리자 설정 UI

구현:

- `/admin/main-ad-settings` page/client와 통합 저장 Route Handler를 추가하고 사이드바에 정확히 `(임시)메인광고설정`을 등록한다.
- 광고 등록·수정·삭제, 위/아래 버튼 정렬, 게시/비게시, 필드별 validation 오류, PC/모바일 미리보기를 제공한다.
- 광고 추가 즉시 client가 `crypto.randomUUID()`로 stable id를 만들고, 선택 이미지는 저장 전 `URL.createObjectURL()`로만 미리보기한다.
- destructive 삭제는 기존 Dialog/AlertDialog 패턴으로 명확히 구분한다.

검증 게이트:

- 관리자만 페이지와 mutation에 접근한다.
- PC 이미지 없이는 등록/저장되지 않고 모바일 이미지는 선택 사항이다.
- 필수 대체문구, 제목, 링크, 노출시간 오류가 해당 입력 근처에 표시된다.
- 위/아래 조작 결과가 저장 JSON 배열 순서 및 새로고침 후 순서와 일치한다.
- 게시/비게시 상태가 저장되고 공개 전달 후보에 즉시 반영된다.
- 미리보기가 PC/모바일 source fallback과 실제 crop 규칙을 재현한다.
- 저장 전 취소/페이지 이탈 시 신규 Storage object가 없고 object URL이 revoke된다.
- 키보드 접근, 44×44px hit area, focus-visible, loading/success/error 상태를 수동 확인한다.

### Phase 4. 공개 캐러셀 통합

구현:

- 공개 서버 페이지가 설정을 읽어 활성 항목만 `main-ad-carousel.tsx`에 넘긴다.
- 활성 항목 0개 또는 설정 오류면 기존 `CampaignHero`를 그대로 사용한다.
- 캐러셀 클라이언트는 index와 timer만 소유하고 DB/API 호출은 하지 않는다.

검증 게이트:

- `StudioLandingPageFrame`의 hero slot 이외의 JSX와 데이터 흐름은 변경되지 않는다.
- 1280/1200/1079/640/390px 캡처에서 관찰 breakpoint, 목록 너비/숨김, 카운터 위치, 모바일 이미지 선택이 맞는다.
- 기본 6초 및 광고별 duration으로 자동 전환되고 진행 레이어가 `linear`로 동기화된다.
- 제목/이전/다음 클릭이 즉시 전환하며 타이머를 리셋한다.
- 링크가 허용된 내부/외부 목적지로 동일 탭 이동한다.
- 활성 1개는 자동 전환/진행/화살표가 꺼지고, 0개/설정 없음은 현재 hero fallback이다.
- 헤더, `QuickAccessGrid`와 아래 모든 섹션의 캡처/DOM 순서가 변경 전과 동일하다.

### Phase 5. 전체 회귀 검증과 범위 감사

검증:

- `npm run lint`
- `npm run build`
- `node --test tests/main-ad-carousel-contract.test.mjs tests/main-ad-settings-route-contract.test.mjs`로 설정 정규화·URL/Storage path 검증 및 통합 저장 Route Handler 계약 테스트
- Route Handler 401/403, malformed config, duplicate/invalid id, 새 item missing PC, unexpected/duplicate file part를 검증
- MIME `image/jpeg,image/png,image/webp`, 확장자 `jpg,jpeg,png,webp`, 파일당 `10 * 1024 * 1024` bytes 경계와 invalid MIME/ext/size 시 upload 미호출을 검증
- File part의 itemId/role과 `carousel/{itemId}/{pc|mobile}/...` prefix 불일치, traversal/path outside를 검증
- multi-upload 중간 실패 및 DB upsert 실패의 신규 object 전체 보상 삭제와 기존 config/objects 유지를 검증
- 성공 후 obsolete old path 삭제, 계속 참조되는 공유 path 보존, 삭제 실패 시 성공 응답 `cleanupWarnings`와 서버 로그를 검증
- 저장 전 local object URL 미리보기와 취소/이탈 시 Storage object 미생성·URL revoke를 검증
- Storage path→public URL 파생 및 저장 config에 public URL이 없음을 검증
- 관리자 CRUD/정렬/게시 수동 검증
- 1280/1200/1079/640/390 화면 캡처 비교
- 6초 자동 전환, 제목/화살표 전환, 타이머 리셋, 링크 이동 검증
- 설정 없음, invalid/빈 설정, active 0개, active 1개, active 복수 검증
- PC 이미지만 있는 모바일 fallback과 별도 모바일 이미지 선택 검증
- `git diff --check`
- `git diff --name-only` 및 `git diff`로 후보 파일 밖 변경, 전역 디자인/하단 섹션 변경 여부 확인

최종 게이트:

- lint/build/계약 테스트가 모두 exit code 0이다.
- 수동 검증표와 각 viewport 캡처가 준비되어 acceptance criteria 전 항목을 입증한다.
- 기존 unrelated 실패가 있으면 이번 변경 검증과 분리해 재현 명령·출력을 기록하고, 이번 변경으로 생긴 실패는 해결 전 완료 처리하지 않는다.

## 9. 전체 Acceptance Criteria

1. `/preview/solvook-concept` 상단에서만 최대 1200px, 높이 360px의 설정 기반 광고 캐러셀이 표시된다.
2. 1200px급 왼쪽 목록 240px, 1080~1199px 200px, 1079px 이하 숨김 계약이 지켜진다.
3. 왼쪽 제목과 오른쪽 이미지/링크가 동일 광고 항목과 항상 같은 index를 사용한다.
4. 복수 활성 광고는 광고별 노출시간(기본 6초) 후 순환하고 활성행 회색 진행 레이어는 같은 duration의 `linear` 애니메이션이다.
5. 제목·이전·다음 조작은 즉시 전환하고 새 항목 타이머를 리셋한다.
6. 데스크톱 카운터는 우하단, 640px 이하 카운터는 좌하단이며 1200px급 이전/다음 화살표가 제공된다.
7. 640px 이하에서 별도 모바일 이미지가 우선되고 없으면 PC 이미지가 fallback된다.
8. active 1개면 자동 전환·진행·화살표가 꺼지고, 유효 active 0개/설정 없음/조회 실패면 기존 `CampaignHero`가 보존된다.
9. 관리자 `/admin/main-ad-settings` 메뉴명이 정확히 `(임시)메인광고설정`이며 확정된 CRUD·정렬·게시·미리보기 기능만 제공한다.
10. 설정은 subject 분리 없이 `system_settings.main_ad_carousel` ordered JSON으로 저장되고 공개 클라이언트에는 active items만 전달된다.
11. 설정에는 검증된 bucket-relative PC/모바일 path만 저장되고 공개 active DTO의 URL은 서버 `getPublicUrl`로 파생된다.
12. 단일 `POST /api/admin/main-ad-settings` multipart 요청이 관리자 재검증부터 신규 파일 upload, config upsert, obsolete cleanup까지 정해진 순서로 수행하며 이외의 별도 저장 endpoint를 두지 않는다.
13. 새 item은 PC File이 필수이고 기존 item은 기존 PC path 또는 새 PC File이 필수이며, File part와 저장 path는 item UUID 및 pc/mobile role과 일치한다.
14. MIME은 JPEG/PNG/WebP, 확장자는 jpg/jpeg/png/webp, 파일당 최대 크기는 10MB만 허용된다.
15. upload/DB 실패는 이번 요청의 신규 objects를 전부 보상 삭제하고 기존 상태를 유지하며, 저장 성공 후 obsolete 삭제 실패는 `cleanupWarnings`와 서버 로그로 보고된다.
16. 저장 전 이미지는 local object URL로만 미리보기되어 취소/이탈 시 Storage object가 생기지 않는다.
17. 외부 HTTPS와 내부 상대 링크만 허용하고 `javascript`, `data`, protocol-relative 및 HTTP 링크를 거부하며 이미지 전체 단일 링크로 동일 탭 이동한다. 왼쪽 제목은 전환 button이다.
18. 왼쪽 목록은 overflow 시 스크롤되고 각 행은 최소 44px이며 수동·자동 선택 행이 항상 보인다.
19. analytics, 예약노출, 과목별 광고, drag-and-drop, 새창옵션, 모바일 swipe, 예약 cleanup/cron이 포함되지 않는다.
20. 헤더, `QuickAccessGrid` 이하 모든 섹션, 전역 디자인과 공통 primitive default가 변경되지 않는다.
21. lint, build, 계약/Route Handler 테스트, 수동 기능 검증, 지정 viewport 캡처, git diff 범위 감사가 모두 통과한다.

## 10. 실패 시 재작업 Loop

각 검증 실패는 다음 loop를 따른다.

1. 실패한 명령, viewport, 입력 상태, 기대값과 실제값을 기록한다.
2. 데이터 계약, 서버 권한/Storage, 관리자 상태, 공개 타이머/레이아웃 중 어느 경계의 문제인지 분리한다.
3. 실패를 재현하는 계약 테스트 또는 가장 작은 수동 재현 절차를 먼저 고정한다.
4. 해당 Phase의 후보 파일 안에서 최소 변경으로 수정한다. 인접 전역 코드나 아래 섹션을 우회 수정하지 않는다.
5. 해당 Phase 게이트를 전부 다시 실행하고, 통과 후 이미 완료한 상위 회귀 검증도 필요한 범위만 재실행한다.
6. lint/build/diff 감사까지 통과하기 전에는 완료로 보고하지 않는다.

## 11. 위험과 결정 기록

| 항목 | 결정 | 위험 및 완화 |
|---|---|---|
| 설정 저장소 | `system_settings.main_ad_carousel` ordered JSON | 개별 row CRUD보다 동시 편집 충돌 가능성이 있으나 현재 단일 관리자 설정 규모에 가장 단순하다. 저장 직전 서버 검증과 전체 배열 upsert를 사용한다. |
| subject 범위 | 공유 메인 광고, subject 분리 없음 | workspace setting으로 잘못 분기하지 않도록 key와 서버 모듈을 독립시킨다. |
| fallback | 설정 없음·오류·active 0개면 현재 `CampaignHero` | 운영 설정 장애가 빈 hero로 이어지지 않는다. 기존 hero 파일을 삭제하거나 재작성하지 않는다. |
| 단일 항목 | 자동 전환·진행·화살표 비활성 | 의미 없는 타이머와 조작을 제거하고 정적 광고로 동작시킨다. |
| 이미지 bucket | public `main-ad-images`, 통합 Route Handler 관리자 검증 후 service-role write | anon/authenticated object write policy를 만들지 않는다. service-role이 RLS를 우회하므로 단일 Route Handler의 관리자·draft·file·path 검증을 write authorization 경계로 둔다. |
| 이미지와 JSON의 원자성 | 한 요청에서 검증→upload→upsert→obsolete 삭제 | upload/DB 실패는 신규 objects를 보상 삭제한다. upsert 성공 뒤 cleanup 실패는 rollback 대신 warning/log로 운영 재시도를 지원하며 cron은 만들지 않는다. |
| 링크 | HTTPS 외부 + 단일 `/` 내부, 동일 탭 | XSS/open redirect성 scheme을 validator로 차단하고 계약 테스트로 우회 입력을 고정한다. |
| 반응형 | 관찰된 1200/1080/1079/640 계약만 구현 | 임의 breakpoint/동작 추가를 막고 지정 viewport 캡처로 검증한다. |
| 모바일 조작 | swipe 미포함 | 관찰되지 않은 기능을 추측해 추가하지 않는다. 화살표 노출은 확정된 1200px급에 한정한다. |
| 접근성 | alt 필수, 44×44px, keyboard/focus-visible | 자동 재생이 초래할 수 있는 사용성 위험은 조작 시 포커스를 강제 이동하지 않고 의미 있는 컨트롤 label로 완화한다. 별도 pause 기능은 승인 범위가 아니므로 추가하지 않는다. |
| 공통화 | 프리뷰 로컬 캐러셀 | 실제 consumer 1개이므로 디자인 시스템 공통 abstraction을 만들지 않는다. |
| 디자인 회귀 | hero slot만 교체 | 전역 token/primitive와 아래 섹션 파일을 수정 금지 목록으로 두고 diff 및 캡처로 감사한다. |

### 구현 전 고정할 세부 계약

다음 값만 요구사항에 구체 수치가 없으므로 구현 Phase 1에서 계약 테스트로 고정하되, 새 사용자 기능으로 확장하지 않는다.

- `durationSeconds`의 서버 허용 최소/최대값(권장 1~60초)
- 공개 이미지의 PC/모바일 권장 픽셀 크기를 관리자 도움말로 표시할지 여부

이미지 파일 계약은 MIME `image/jpeg,image/png,image/webp`, 확장자 `jpg,jpeg,png,webp`, 파일당 최대 `10 * 1024 * 1024` bytes로 이미 확정되어 구현자가 변경하지 않는다. 나머지 값은 데이터/표시 세부값이며 확정된 UI 범위나 상호작용을 바꾸지 않는다.
