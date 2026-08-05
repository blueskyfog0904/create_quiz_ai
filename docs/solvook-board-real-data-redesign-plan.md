# Solvook 컨셉 게시판 실제 데이터 재설계 계획

- 작성일: 2026-07-30
- 대상: `/preview/solvook-concept/boards/[slug]`
- 참고 화면: `https://solvook.com/categories/edition/solvookpassen?id=1003`
- 상태: 구현·검증 PASS — DB migration 적용 대기
- 구현 원칙: 참고 화면의 정보 구조와 밀도만 차용하고 브랜드, 이미지, 문구는 복제하지 않는다.
- 실행 제약: Docker와 원격 DB write를 사용하지 않는다.

## 1. 목표

프리뷰 게시판을 정적 샘플 게시판에서 과목별 실제 문제마켓 자료 게시판으로 전환한다.

- 1200px 중앙 레일 안에서 좌측 카테고리와 우측 자료 목록을 함께 표시한다.
- 영어와 국어를 동일한 컴포넌트와 데이터 계약으로 지원한다.
- 좌측에는 과목별 카테고리 그룹과 하위 카테고리를 2단계로 표시한다.
- 우측에는 선택 카테고리의 실제 공개 상품만 노출한다.
- DB에 없는 저자, 지문 수, 무료 여부를 추정하거나 샘플 데이터로 보충하지 않는다.
- 게시글 상세의 기존 프리뷰 디자인은 유지하고 목록에서 과목과 상품 식별자를 정확히 전달한다.

루트 `/`, 운영 `/english/market`, `/korean/market`은 이번 프리뷰 검증이 끝날 때까지 변경하지 않는다.

## 2. 현재 구조와 참고 화면 비교

| 구분 | 현재 임시 게시판 | 목표 구조 |
| --- | --- | --- |
| 데이터 | `SampleBoard`, `SampleMaterialPost` | 공개 `market_items` 기반 명시적 DTO |
| 과목 | 국어 문학 샘플에 고정 | `subject=english|korean` |
| 카테고리 | 단일 board slug | 좌측 그룹 → 하위 카테고리 |
| 본문 골격 | 전체 폭 헤더 → 필터 → 표 | 240px 좌측 레일 + 48px 간격 + 가변 본문 |
| 카테고리 탐색 | 없음 | 좌측 accordion + 본문 관련 카테고리 grid |
| 자료 행 | 표 또는 모바일 카드 | 썸네일 중심의 약 120px 목록 행 + 모바일 카드 |
| 노출 필드 | 저자, 교재, 작품 유형, 지문/문항 | 제목, 요약, 출처, 연월, 학년, 문항, 샘플, 파일 형식, 조회, 게시일 |
| CTA | 상세 링크, 샘플 | 샘플 보기, 상세 보기 |
| 정렬 | 최신, 조회, 문항 | 최신, 조회, 문항 |
| 필터 | 샘플 배열을 클라이언트 필터 | 서버 검색 params와 DB exact filter |

현재 게시판은 `StudioBoardPageFrame`의 세 슬롯에 맞춰 전체 폭으로 조립되어 있다. 단일 프리뷰를 위해 공용 frame에 sidebar slot을 추가하지 않고, 프리뷰 게시판 내부에 로컬 2열 shell을 둔다.

## 3. 카테고리 계층 결정

### 3.1 현재 DB가 지원하는 범위

현재 분류는 다음 두 단계다.

1. `workspace_subject`: 영어 또는 국어
2. `market_menu_entries`: 해당 과목의 평면형 문제마켓 메뉴

`market_menu_entries`에는 `parent_id`나 그룹 FK가 없다. `search_config`도 `marketSlug`, `entryHref`, `showDividerBefore`만 사용하므로 `EBS → 수능특강` 같은 그룹-하위 카테고리를 안전하게 표현하지 못한다.

`market_subproduct_categories`는 상품 내부의 판매 옵션 분류이므로 게시판 카테고리로 사용하지 않는다. `source_type`, `source_1..4` 역시 출처 메타데이터이며 운영 설정 없이는 카테고리로 해석하지 않는다.

### 3.2 권장안: 카테고리 그룹을 별도 관리

`market_menu_entries`를 실제 상품이 연결되는 leaf로 유지하고, 별도 그룹을 추가한다.

```text
workspace_subject
└── market_menu_groups
    └── market_menu_entries
        └── market_items
```

권장 최소 스키마:

```text
market_menu_groups
- id
- workspace_subject
- group_key
- title
- sort_order
- is_visible
- is_active
- created_at / updated_at / deleted_at

market_menu_entries
- group_id nullable FK → market_menu_groups.id
```

과목 교차 연결은 단일 `group_id` FK가 아니라 복합 FK로 DB에서 거부한다.

```text
market_menu_groups unique (id, workspace_subject)
market_menu_entries
  foreign key (group_id, workspace_subject)
  references market_menu_groups (id, workspace_subject)
```

- `workspace_subject`는 `english|korean` check를 유지한다.
- group key는 `(workspace_subject, group_key)` unique로 둔다.
- 공개 read는 visible/active/not-deleted group만 허용하고 write는 admin만 허용한다.
- 다른 과목 group에 leaf를 배치하는 요청은 API와 DB constraint 양쪽에서 거부한다.

이 방식을 권장하는 이유:

- 기존 `market_items.menu_entry_id`와 운영 상세 URL을 변경하지 않는다.
- 기존 평면 메뉴·상품 CRUD를 유지한 채 게시판 sidebar만 그룹화할 수 있다.
- 영어와 국어 그룹을 DB에서 격리할 수 있다.
- 그룹이 없는 기존 메뉴는 “기타” 영역에 정직하게 표시하고, 값을 임의 추론하지 않는다.
- 관리자 메뉴관리에서 그룹 순서와 하위 메뉴 배치를 명시적으로 관리할 수 있다.

스키마 추가를 원하지 않을 경우 프리뷰 전용 하드코딩 그룹으로 화면만 만들 수 있으나, 실제 데이터·관리자 관리 요구와 어긋나므로 권장하지 않는다.

## 4. 실제 게시판 공개 DTO

브라우저에 raw `market_items`, Storage path, 구매 이벤트를 전달하지 않는다.

```ts
interface MarketBoardData {
  subject: 'english' | 'korean'
  groups: Array<{
    id: string
    title: string
    entries: Array<{
      id: string
      slug: string
      title: string
      description: string | null
      itemCount: number
    }>
  }>
  category: {
    id: string
    slug: string
    title: string
    description: string | null
  }
  total: number
  filters: {
    years: number[]
    months: number[]
    grades: string[]
    sourceConfigs: Array<{
      typeName: string
      fields: Array<{
        key: 'source1' | 'source2' | 'source3' | 'source4'
        label: string
        options: string[]
      }>
    }>
  }
  rows: MarketBoardRow[]
}

interface MarketBoardRow {
  id: string
  title: string
  summary: string | null
  thumbnailUrl: string | null
  categoryTitle: string
  materialType: string | null
  sourceFields: Array<{ label: string; value: string }>
  examYear: number | null
  examMonth: number | null
  gradeLevel: string | null
  questionCount: number | null
  sample: { available: boolean; pageCount: number }
  fileTypeLabels: string[]
  viewCount: number
  publishedAt: string
}
```

### 노출하는 필드

- 제목: `market_items.title`
- 보조 설명: `summary`
- 썸네일: `thumbnail_url`, 없으면 프리뷰 로컬 문서 cover fallback
- 자료 유형: `source_type`, 없으면 별도 category label만 표시
- 출처: `source_configs`의 라벨과 `source_1..4` 값을 조합
- 연도·월·학년: `exam_year`, `exam_month`, `grade_level`
- 문항 수: `question_count`
- 샘플: active sample page 존재 여부와 page 수
- 제공 형식: v2 active subproduct file type을 우선하고, v2가 전혀 없을 때만 legacy PDF/HWP/ZIP file을 fallback
- 조회·등록일: `view_count`, `published_at ?? created_at`

### 노출하지 않는 값

- `created_by`를 저자로 표시하지 않는다.
- passage relation이 없으므로 지문 수를 표시하지 않는다.
- source config label 없이 `source_1`을 교재로 고정하지 않는다.
- 가격 0을 무료로 해석하지 않는다. 현재 legacy에서는 0이 미제공 의미다.
- Storage bucket/path, 원본 파일명, checksum, 사용자·구매·권한·다운로드 event id를 공개 DTO에 넣지 않는다.

## 5. 화면 구성

### 5.1 데스크톱

`StudioContainer`의 1200px 레일을 유지한다.

기본 container padding으로 내부 폭이 1152px가 되지 않도록 기존 프리뷰의 `studio-reference-gutter` 계약을 사용한다. 1280px viewport에서 실제 grid 폭 1200px를 browser bounding box로 검증한다.

```text
┌────────────── 240px ──────────────┬─ 48px ─┬──────── minmax(0,1fr) ────────┐
│ 과목명                            │        │ breadcrumb / category title    │
│ 그룹 1                            │        │ category intro                 │
│   하위 카테고리                   │        │ 관련 카테고리 grid             │
│   하위 카테고리                   │        │ result count / sort            │
│ 그룹 2                            │        │ material rows                  │
└───────────────────────────────────┴────────┴─────────────────────────────────┘
```

- 좌측 레일: 40~44px 행, 현재 그룹만 펼침, 현재 항목 `aria-current`.
- breadcrumb: 과목 / 그룹 / 카테고리.
- category intro: 실제 `title`, `description`, 자료 수와 샘플 수만 표시.
- 참고 화면의 광고·남은 시간·무료 횟수는 실제 데이터 원천이 없으므로 만들지 않는다.
- 관련 카테고리 grid: 현재 그룹의 sibling leaf를 4열로 표시한다.
- 결과 toolbar: 총 개수 왼쪽, 최신/조회/문항 정렬 오른쪽.
- 자료 행: 약 120px 높이, `56×79` 썸네일, 제목/요약/출처, 메타 badge, 샘플/상세 CTA.
- 전체 행 제목 영역은 상세 링크이며, 중첩 CTA는 독립 button/link로 동작한다.
- 페이지네이션은 목록 하단 중앙에 둔다.
- 실제 상품 UUID의 `상세 보기`는 이번 게시판 단계에서 기존 운영 상세 `/{subject}/market/{slug}/items/{id}`로 연결한다.
- 샘플 전용 preview detail route에 실제 UUID를 넣어 404를 만들지 않는다. 실제 데이터용 concept 상세 전환은 별도 후속 범위로 둔다.

### 5.2 모바일·태블릿

- `lg` 이상: 240px sidebar + 48px gap.
- `md` 이상 `lg` 미만: 200px sidebar + 24px gap.
- `md` 미만: sidebar를 본문 상단의 단일 accordion navigation으로 이동한다.
- 768px 미만: 관련 카테고리는 2열, 작은 화면은 1열.
- 데스크톱 표를 억지로 축소하지 않고 현재 모바일 카드 패턴을 유지한다.
- 320/390px에서 가로 overflow가 없어야 한다.
- 필터, 결과 live region, 샘플 dialog는 DOM에 각각 하나만 둔다.
- 모든 조작 target은 최소 44×44px, focus-visible과 키보드 조작을 제공한다.

## 6. 검색·정렬·페이지 처리

- route: `/preview/solvook-concept/boards/[slug]?subject=english|korean`
- subject를 먼저 정규화하고 같은 subject의 visible/active category만 찾는다.
- title은 정규화된 `ilike` 검색을 사용한다.
- year, month, grade, source_type, source_1..4는 서버 exact filter를 사용한다.
- source type을 먼저 선택한 뒤 해당 `sourceConfigs[typeName].fields`만 노출한다.
- 정렬: `latest`, `views`, `questions`.
- `price_asc`는 v2 전체 가격을 대표하지 못하므로 프리뷰 목록 정렬에서 제외한다.
- 전체 상품을 client에 내려 필터하지 않고 `.range()`와 `{ count: 'exact' }`를 사용해 서버 pagination한다.
- 최신 정렬은 `published_at desc nulls last → created_at desc → id asc`, 조회/문항 정렬도 `published_at → id` tie-break를 둔다.
- 상세 링크와 샘플 링크에 현재 subject를 보존한다.
- 샘플 CTA는 기존 `/api/market/items/[itemId]/sample-pages` 계약에 연결하며 sample page가 없으면 렌더링하지 않는다.

## 7. 최소 구현 파일 경계

### 새 파일 후보

- `src/app/preview/solvook-concept/_components/board/board-category-sidebar.tsx`
- `src/app/preview/solvook-concept/_components/board/real-market-board.tsx`
- `src/lib/market-board.ts`
- `src/lib/market-board-server.ts`
- category group migration과 RLS test
- 실제 데이터·반응형·브라우저 계약 test

### 수정 후보

- `src/app/preview/solvook-concept/boards/[slug]/page.tsx`
- `src/app/preview/solvook-concept/_components/board/board-list-controller.tsx`
- `src/lib/market-menu-server.ts`
- `src/app/(admin)/admin/menu-management/*`
- `src/types/supabase.ts` — migration 적용 후 공식 재생성

### 유지

- `StudioContainer`, `StudioFilterPanel`, `StudioBoardShell`, `StudioPagination`, `StudioEmptyState`
- 현재 샘플 preview dialog
- 게시글 상세의 요약/탭/작업 panel 구조
- 기존 sample detail route와 sample data
- 루트와 운영 market index

샘플 controller는 한 번에 삭제하지 않는다. 실제 데이터 board가 검증된 뒤 preview sample 의존을 제거한다.

## 8. 구현·검증 loop

### Phase 0. 기준선과 변경 보호

- `git status`, 대상 diff, 병렬 변경 소유권 기록
- 현재 게시판의 320/390/768/1200/1280px screenshot과 DOM 계약 기록
- 허용 파일 밖 변경, restore/reset/delete 금지

통과: 현재 샘플 게시판과 상세가 재현되고 기존 변경 소유권이 기록됨.

### Phase 1. 카테고리 그룹 모델

- schema/RLS/관리자 계약 테스트를 먼저 실패시킴
- 과목별 group CRUD, entry 배치, 정렬, visible/active 구현
- `(group_id, workspace_subject)` 복합 FK와 과목 check/RLS 구현
- 기존 ungrouped entry는 “기타” fallback
- 원격 DB write와 Docker 없이 migration SQL·Node 계약 검증까지만 수행

통과: 교차 과목 FK와 관리자 외 write가 DB/API 양쪽에서 거부되고 기존 entry/item 관계가 보존됨.

### Phase 2. 공개 board DTO와 서버 query

- explicit DTO contract와 private field 부재 test를 먼저 실패시킴
- published/active/not-deleted + subject/menu visibility 필터
- v2 file type 우선, legacy fallback
- sample page, source label, pagination/count 조립
- 섹션별 오류를 가짜 데이터로 대체하지 않고 명시적 empty/error 상태로 처리

통과:

- 영어/국어 교차 데이터가 없음.
- private/storage/user field가 client DTO에 없음.
- source type별 label/options만 반환됨.
- `.range()` 결과 수와 exact total이 일치함.
- 동일 데이터 반복 조회에서 null-last와 tie-break 순서가 안정적임.

### Phase 3. 좌측 2단계 navigation과 본문 shell

- 1200px 안에서 `240px + 48px + minmax(0,1fr)`
- 그룹 accordion, 현재 category, sibling grid, breadcrumb 구현
- 과목 query와 상세 링크 보존

통과:

- 1280px viewport에서 outer/grid/sidebar/gap/content bounding box가 `1200/1200/240/48/912` 오차 1px 이내임.
- `md` 구간은 `200/24/minmax`, `<md`는 단일 accordion으로 전환됨.
- 같은 category에서 영어/국어가 동일 구조, 다른 데이터로 렌더링됨.
- accordion에 `aria-expanded`, `aria-controls`, 현재 leaf에 `aria-current`가 있음.

### Phase 4. 실제 자료 행과 필터

- 실제 DTO 기반 desktop row/mobile card
- thumbnail fallback, source metadata, question/sample/file type 표시
- sample/detail CTA와 server pagination
- 샘플 `authorLabel`, passages, workType 의존 제거

통과:

- DB에 없는 값이 화면에 없고, null/empty 자료도 레이아웃을 깨지 않음.
- 샘플 CTA가 실제 sample API를 열고 없는 경우 렌더링되지 않음.
- 실제 UUID 상세 CTA가 subject를 보존한 운영 상세로 정상 진입하며 404가 아님.
- 페이지 전환 전후 exact count와 row 범위가 일치함.

### Phase 5. 관리자 연결

- 기존 메뉴관리 안에서 category group 순서와 leaf 배치 제공
- subject switch 시 과목별 상태 초기화
- 저장 후 공개 preview revalidate

통과: 영어 저장이 국어 구조를 바꾸지 않고 반대도 동일함.

### Phase 6. 통합 검증

- 관련 Node 계약 test
- 대상 ESLint
- `npx tsc --noEmit`
- `git diff --check`
- `npm run build`
- 320/390/768/1079/1200/1280px 브라우저 검증
- keyboard-only, focus-visible, 44px, overflow, hydration warning
- 영어/국어, group 없음, 자료 없음, source 없음, sample 없음, thumbnail 없음 상태
- `aria-expanded`, `aria-controls`, `aria-current`, 단일 결과 live region, 단일 sample dialog
- 실제 상세 진입, sample API, private field 부재
- 별도 검증자의 read-only PASS/FAIL

FAIL이면 원인과 직접 관련된 최소 변경만 한 뒤 실패 검증과 누적 검증을 다시 실행한다. 독립 PASS 전에는 완료로 보고하지 않는다.

## 9. 확정된 구현 방향

첨부 화면처럼 `EBS → 수능특강`의 실제 2단계를 관리자에서 관리하기 위해 `market_menu_groups`를 추가하는 권장안으로 진행한다.

프리뷰 하드코딩 분류는 사용하지 않으며 실제 데이터와 관리자 편성 결과만 노출한다.

## 10. 구현·검증 결과

- `/preview/solvook-concept/boards/[slug]`를 실제 공개 `market_items` 조회로 전환했다.
- 영어와 국어가 동일한 1200px 게시판 shell, 2단계 카테고리, 서버 필터, 정렬, 페이지네이션을 사용한다.
- 실제 DB에 아직 그룹 schema가 없는 경우 같은 과목의 visible leaf만 `기타` 아래에 표시한다.
- 관리자 메뉴관리에서 과목별 그룹 CRUD, 순서, 노출·활성 상태, leaf 배치를 관리하도록 구현했다.
- 임의 `sourceType`과 허용되지 않은 `source_1..4` URL 값은 DB 조건과 화면 필터에서 제거한다.
- 실제 샘플 자료는 기존 공용 샘플 dialog를 한 번만 사용하고, 실제 상품 상세 URL로 연결한다.
- 루트와 운영 market index는 변경하지 않았다.

검증 결과:

- 관련 Node 계약 test 58/58 PASS
- 대상 ESLint PASS
- `npx tsc --noEmit` PASS
- `git diff --check` PASS
- `npm run build` PASS
- 영어·국어 실제 HTTP 200
- 320/390/768/1079/1200/1280px에서 overflow, 44px target, 중복 id, subject 링크와 실제 행을 확인
- 샘플 dialog 열기·닫기와 원래 trigger focus 복귀 확인
- 독립 검증 FAIL 2건을 수정한 뒤 최종 PASS

Docker와 원격 DB write는 사용하지 않았다. 따라서 migration과 pgTAP의 실제 DB 실행은 남아 있다.
`market_menu_groups` migration 적용 전에도 공개 게시판은 안전한 `기타` fallback으로 동작하지만,
관리자 그룹 저장은 migration 적용 후 사용할 수 있다.
