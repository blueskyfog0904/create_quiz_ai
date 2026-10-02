# 홈 "교재와 출처" 섹션 삭제 계획

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD 01429ae 이후) · 상태: 검증 OK(R1), 구현 단계. DB는 SELECT만 했다.
- 요청(사용자 결정): 문제마켓 홈의 "교재와 출처" 섹션을 사용자 화면과 관리자 설정(`(임시) 문제마켓 메인 관리`) 모두에서 삭제한다.

## 1. 조사 결과(사실)

**사용자 화면**
- 섹션 컴포넌트는 `src/app/preview/solvook-concept/_components/home/home-material-sections.tsx`의 `TextbookExplorer`(제목 `교재와 출처로 골라보기`, `id="source-explorer"`)다. 링크는 `sourceHref()`가 만드는 과거 경로 `/{subject}/market/{slug}?sourceType=…&sourceN=…`이다. 같은 파일의 `RecentMaterials`·`HomeFinalCta`는 유지한다.
- 이 섹션을 그리는 곳은 두 곳이다.
  - `src/app/preview/solvook-concept/page.tsx:46-48`(프리뷰 홈)
  - `src/app/(solvook)/_components/solvook-home-view.tsx:55-57`(루트 `/` 홈)
  - 둘 다 `homeData.config.sourceExplorer.isActive && <TextbookExplorer … configs={homeData.sourceConfigs} paths={homeData.sourcePaths} />` 형태다.
- `campaign-hero.tsx`(`CampaignHero`)는 **어디서도 import되지 않는다**(`grep CampaignHero src` 결과 정의 파일뿐). 즉 화면에 그려지지 않는다. 기존 계약 테스트 4개가 페이지에 `CampaignHero`가 **없음**을 확인하고 있고, `studio-adoption-contract`는 파일 목록에 이 파일을 포함한다. 다만 이 파일도 `config.sourceExplorer.isActive`(20행)를 읽으므로 설정 타입에서 `sourceExplorer`를 빼면 컴파일 오류가 난다(3절 D3에서 처리).

**홈 데이터·설정 타입**
- `src/lib/market-home.ts`
  - `MarketHomeConfig.sourceExplorer {isActive, sourceTypes}`와 `DEFAULT_MARKET_HOME_CONFIG.sourceExplorer`가 있다.
  - `MarketHomeSourceConfig`·`MarketHomeSourcePath` 타입과 `MarketHomeData.sourceConfigs`·`sourcePaths`가 있다.
  - `validateMarketHomeConfig`가 최상위 키를 `['version','popular','sourceExplorer','categories','recent']`로 **정확히** 검사하고(`assertExactKeys`), `sourceExplorer` 하위 키도 검사한다.
  - `normalizeMarketHomeConfig`는 검증이 실패하면 **설정 전체를 기본값으로** 되돌린다.
- `src/lib/market-home-server.ts`
  - `loadSourceExplorer()`(280~370행)가 `source_configs`와 `market_items.source_*`를 읽어 `sourcePaths`를 만든다. `getMarketHomeData`는 `config.sourceExplorer.isActive`일 때 이를 호출한다.
  - `EMPTY_HOME_DATA.sourceConfigs/sourcePaths`, 반환값 `sourceConfigs`·`sourcePaths`가 이 섹션 전용이다.
  - `SourceConfigRow` 타입은 `loadSourceExplorer`와 `getMarketHomeAdminOptions`에서만 쓴다.
  - `getMarketHomeAdminOptions`는 `categories`와 `sourceTypes`(같은 `source_configs` 조회)를 돌려주고, 관리자 화면과 저장 API가 쓴다.
  - `ItemRow`의 `source_type`, `source_1~4`는 `toItem`의 `sourceType`·`sources`(최근 자료 메타 라벨)에 계속 쓰이므로 **유지**한다.

**관리자**
- `src/app/(admin)/admin/market-main-settings/market-main-settings-client.tsx`
  - `교재·출처` 카드(250~285행): Switch `aria-label="교재 출처 노출"`, 출처 유형 Checkbox 목록
  - `withExplicitSelections`의 `sourceExplorer` 보정
  - `uniqueSourceTypes`·`configuredSourceTypes`·`missingSourceTypes`
  - 미리보기 카드의 `출처 경로 N개`와 결손 경고 문구(`현재 출처 설정 또는 상품 메타데이터에 결손이 있어 출처 탐색 결과가 비어 있을 수 있습니다.`)
  - props `sourceTypes`
  - 빠른 링크의 `/admin/source-configs`(출처 관리)는 이 섹션과 별개라 **유지**한다.
- `src/app/(admin)/admin/market-main-settings/page.tsx`는 `getMarketHomeAdminData` 결과를 펼쳐 넘긴다(변경 불필요, 타입에서 `sourceTypes`가 빠질 뿐).
- `src/app/api/admin/market-main-settings/route.ts`
  - `validateAllowlist`의 `sourceTypes` 인자와 `invalidSourceType` 검사(`선택한 출처 유형이 현재 과목의 출처 설정에 없습니다.`)
  - `options.sourceTypes`로 Set을 만드는 부분

**DB**
- `select … from workspace_settings where setting_key = 'market_home'` 결과 **0건**(2026-10-02, 개발 DB). 저장된 설정이 없으므로 데이터 이전·정리가 필요 없다.
- 메모리 기록상 이 Supabase는 운영 전 개발 DB이고, 다른 환경(운영 DB)은 아직 없다.
- **주의(무해하지 않음)**: 지금 검증 규칙은 알 수 없는 키를 무시하지 않는다. `sourceExplorer` 키가 남은 값이 저장돼 있다면 삭제 후에는 `assertExactKeys`가 실패한다. 그러면 `normalizeMarketHomeConfig`가 인기·카테고리·최근 설정까지 **전부 기본값으로** 되돌린다. 현재 0건이라 실제 영향은 없다(3절 D4).

**범위 밖(유지)**
- 게시판 목록의 `교재·출처` 필터(`src/app/preview/solvook-concept/_components/board/board-list-controller.tsx:589`)와 게시판 서버의 `sourceConfigs`
- `market_items.source_*` 데이터, `source_configs` 테이블, 출처 관리 화면(`/admin/source-configs`)
- 과거 `/{subject}/market/{slug}?sourceType=…` 필터 경로(`market-home-source-filter-contract`가 검사)

이들은 홈 섹션 삭제와 독립적으로 쓰이므로 건드리지 않는다.

## 2. 변경 대상
1. `home-material-sections.tsx`
   - `TextbookExplorer`, `sourceHref`, `textbookTones`를 삭제한다.
   - 이로써 고아가 되는 import(`BookOpen`·`ArrowRight`·`Link`·`MarketHomeSourceConfig`·`MarketHomeSourcePath`)를 정리한다. 다른 컴포넌트가 쓰는 것은 남긴다(구현 시 eslint로 확인).
2. `preview/solvook-concept/page.tsx`, `(solvook)/_components/solvook-home-view.tsx`: `TextbookExplorer` import와 조건부 렌더 블록을 삭제한다. 섹션 순서는 인기 → 최근 → 마무리 CTA가 된다.
3. `market-home.ts`
   - `MarketHomeConfig`·`DEFAULT_MARKET_HOME_CONFIG`에서 `sourceExplorer`를 삭제한다.
   - `validateMarketHomeConfig`의 키 목록·검사·반환값과 `normalizeMarketHomeConfig`의 기본값 복사에서 `sourceExplorer`를 삭제한다.
   - `MarketHomeSourceConfig`·`MarketHomeSourcePath` 타입과 `MarketHomeData.sourceConfigs`·`sourcePaths`를 삭제한다.
4. `market-home-server.ts`
   - `loadSourceExplorer`, `SourceConfigRow`, `EMPTY_HOME_DATA`의 두 필드, `getMarketHomeData`의 해당 Promise·반환 필드를 삭제한다(`Promise.allSettled` 배열과 구조 분해 순서 조정).
   - `getMarketHomeAdminOptions`는 `source_configs` 조회를 빼고 `{ categories }`만 돌려준다. `MarketHomeAdminOptions.sourceTypes`도 삭제한다.
5. 관리자 클라이언트
   - `교재·출처` 카드를 삭제한다.
   - `withExplicitSelections`의 `sourceExplorer` 블록과 `sourceTypes` 인자를 삭제한다.
   - `uniqueSourceTypes`·`configuredSourceTypes`·`missingSourceTypes`를 삭제한다.
   - 미리보기의 `출처 경로` 줄과 결손 경고 문단을 삭제한다(미리보기 그리드는 3칸).
   - props `sourceTypes`와 그 타입 import를 삭제한다. `Checkbox`는 카테고리 카드가 계속 쓴다.
6. 저장 API: `validateAllowlist`에서 `sourceTypes` 인자와 출처 검사를 삭제하고, 호출부의 Set 생성을 삭제한다.
7. `campaign-hero.tsx`(미사용): D3 결정대로 처리한다.
8. 브라우저 검증 스크립트 `scripts/studio-browser-verify.mjs:507`의 기대 제목 목록에서 `교재와 출처로 골라보기`를 삭제한다(스크립트는 이미 다른 제목·빠른 메뉴 기대도 낡아 있으나 이번 범위에서는 이 줄만 고친다).

## 3. 결정
- D1 **완전 삭제**: 설정의 `isActive=false` 기본값으로 숨기는 대신 코드·타입·조회를 함께 없앤다. 사용자 결정(사용자·관리자 모두 삭제)에 맞고, 남겨 두면 매 홈 요청마다 쓰이지 않는 `source_configs`·`market_items` 조회를 하지 않게 하는 분기만 남는다.
- D2 **고아만 정리**: 이 섹션을 지우면 사용처가 없어지는 것(위 2절 목록)만 지운다. 게시판·출처 관리·`source_*` 데이터는 다른 곳이 쓰므로 둔다.
- D3 **`campaign-hero.tsx`**: 화면에서 쓰이지 않는 파일이지만 `config.sourceExplorer`를 읽어 타입 삭제 후 컴파일이 깨진다. 기본안은 **20행의 `교재와 출처` 캠페인 항목 줄을 삭제**하는 최소 수정이다(파일은 삭제하지 않는다). 63행 소개 문구의 `교재와 출처를 찾고,` 수정은 선택이다.
  - 대안: 미사용 파일이므로 통째로 삭제한다. 다만 `studio-adoption-contract.test.mjs`의 파일 목록(52행)도 함께 고쳐야 하고, "관련 없는 dead code는 보고만" 규칙상 이번 요청 범위를 넘는다.
- D4 **저장 값 호환**: 저장 행이 0건이고 운영 DB도 아직 없으므로 옛 `sourceExplorer` 키를 무시하는 호환 코드는 **넣지 않는다**(불필요한 방어 코드 금지).
  - 저장 API도 엄격 검사를 유지해, 옛 화면이 `sourceExplorer`를 보내면 400(`config.sourceExplorer is not supported`)으로 거절한다. 새 화면은 보내지 않는다.
  - 대안(검증자·사용자가 원하면): `normalizeMarketHomeConfig`(읽기 경로)에서 검증 전에 `sourceExplorer` 키만 제거하는 3줄을 추가해, 혹시 남은 값이 있어도 나머지 설정이 기본값으로 초기화되지 않게 한다.
- D5 **캐시**: 홈 데이터는 `unstable_cache`(60초, `market-public-lists` 태그) 대상이다. 배포 시 새 코드가 새 캐시 키로 다시 읽으므로 별도 무효화는 필요 없다.

## 4. 테스트
**영향받는 기존 계약 테스트와 갱신 방향**

| 파일:행 | 현재 검사 | 갱신 |
|---|---|---|
| `tests/main-ad-carousel-contract.test.mjs:201` | 프리뷰 페이지에 `TextbookExplorer` 있음 | `doesNotMatch`로 반전(이 테스트는 기준선 39에 이미 다른 이유로 실패 중 — 이번에 새로 깨지지 않게만 맞춘다) |
| `tests/market-home-browser.test.mjs:25` | 섹션 순서 배열에 `<TextbookExplorer` | 배열에서 제거(인기 → 최근 → CTA) |
| `tests/market-home-browser.test.mjs:59` | (실서버 환경변수 있을 때만) 제목 순서에 `교재와 출처로 골라보기` | 배열에서 제거 |
| `tests/market-home-ui-contract.test.mjs:74` | `sourceExplorer.isActive && <TextbookExplorer` | `doesNotMatch(/sourceExplorer\|TextbookExplorer/)`로 반전 |
| `tests/market-home-contract.test.mjs:36-37` | `sourceIndexes: number[]`·서버의 `sourceIndexes` | 두 줄 삭제(테스트 제목의 "source paths" 부분도 정리) |
| `tests/market-home-contract.test.mjs:44` | 서버 빈 대체값 `sourcePaths: []` | 이 줄만 삭제. 같은 테스트의 `popular: []`·`recent: []` 검사는 유지하고, 32행 테스트 제목의 "source paths" 부분을 정리 |
| `tests/market-home-admin-route-contract.test.mjs:67` | 관리자 화면에 `결손` 문구 | 삭제(대신 `교재·출처` 부재 검사) |
| `tests/solvook-preview-original-visual-contract.test.mjs:37-38` | `RecentMaterials` < `TextbookExplorer` < `HomeFinalCta` | `RecentMaterials` < `HomeFinalCta`로 변경(기준선에 이미 실패 중인 테스트) |
| `tests/studio-browser-fixture-contract.test.mjs:694` | 스크립트에 `교재와 출처로 골라보기` 기대 | 목록에서 제거(2절 8번과 함께) |
| `tests/studio-adoption-contract.test.mjs:52` | `campaign-hero.tsx`가 목록에 있음 | D3 기본안이면 변경 없음 |
| `tests/market-home-empty-state-contract.test.mjs:21` | 섹션 빈 상태 문구 `출처별 자료를 준비하고 있습니다` | 삭제(구현 중 발견, 계획서 초안에서 누락) |

`market-home-source-filter-contract`(과거 경로 필터)와 `market-board-contract`의 `sourceConfigs`(게시판)는 범위 밖이라 변경하지 않는다.

**새 계약 테스트**(`tests/remove-home-source-section-contract.test.mjs`, 3가지만. 관리자 문구·홈 렌더 부재는 위 기존 테스트 갱신으로 충분)
1. `src/` 아래 `.ts`·`.tsx` 어디에도 `교재와 출처로 골라보기`, `TextbookExplorer`, `sourceExplorer`, `loadSourceExplorer`, `MarketHomeSourcePath`, `MarketHomeSourceConfig`, `source-explorer`가 없다(전수 검사).
2. `validateMarketHomeConfig`(실제 함수, TS import):
   - `sourceExplorer` 없는 설정을 통과시킨다.
   - 옛 `sourceExplorer` 키가 있으면 `config.sourceExplorer is not supported`로 거절한다.
   - `DEFAULT_MARKET_HOME_CONFIG`에 `sourceExplorer` 키가 없다.
3. 저장 API에 출처 검사(`invalidSourceType`·`출처 유형`)가 없고, 게시판 `교재·출처` 필터(`board-list-controller.tsx`)는 그대로 있다(범위 밖 유지 확인).

## 5. 검증
- `npx tsc --noEmit` exit 0, 변경 파일 eslint 오류 0
- 관련 테스트(위 표의 파일 + 새 계약 테스트) 통과
- 전체 `node --test tests/*.test.mjs` 실패 이름 목록이 기준선 39개와 같음(새 실패 0)
- scratchpad 복사본에서 `next build` exit 0. 포트 4000 사용 금지, 저장소 안에서 빌드 금지.
- 브라우저(사용자)
  1. `/`와 `/preview/solvook-concept`(영어·국어 전환 포함)에 `교재와 출처로 골라보기` 섹션이 없고, 인기 다운로드 → 최근 등록 → 마무리 CTA 순서로 빈 공간 없이 이어진다.
  2. 홈 헤더·광고 캐러셀·카테고리 링크가 그대로 동작한다.
  3. `/admin/market-main-settings`에 `교재·출처` 카드와 미리보기의 `출처 경로`·결손 경고가 없다. 인기·카테고리·최근 설정을 바꿔 저장하면 성공하고 프리뷰에 반영된다.
  4. 게시판(`/preview/solvook-concept/boards/<slug>`)의 `교재·출처` 필터와 `/admin/source-configs` 출처 관리는 그대로 동작한다.
  5. 저장 행이 없는 상태에서 홈이 기본 설정(인기 12개·최근 8개)으로 보인다.

## 6. 위험
| 위험 | 대응 |
|---|---|
| 옛 `sourceExplorer` 키가 저장된 환경에서 설정 전체가 기본값으로 초기화 | 현재 저장 0건·운영 DB 없음. 필요하면 D4 대안(읽기 경로에서 키 제거 3줄) |
| 관리자 화면을 열어 둔 채 배포되면 옛 화면이 `sourceExplorer`를 보내 저장 400 | 새로고침 안내. 오류 메시지로 원인 확인 가능 |
| 이미 다른 이유로 실패 중인 계약 테스트(기준선 39) 안의 섹션 검사 | 섹션 관련 줄만 새 구조에 맞추고, 실패 이름 목록이 기준선과 같은지로 확인 |
| 과거 경로 `/{subject}/market/…?sourceType=` 링크가 홈에서 사라짐 | 경로 자체(게시판 필터)는 유지되므로 외부 링크는 계속 동작 |

## 7. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증(팀 리드 전달) | **OK** | 보완 a(campaign-hero 20행은 항목 줄 삭제로 명시, 파일 삭제 안 함), b(새 계약 테스트 3가지로 축소), c(market-home-contract 44행만 삭제·popular/recent 검사 유지·32행 제목 정리) 반영 |
| 구현 리뷰 | 코드·테스트 변경 | 독립 리뷰(imglib-s3-reviewer) | **OK** | BLOCKER·MAJOR·MINOR 없음. 남은 참조 0건(campaign-hero 62행 소개 문구는 계획상 선택), 게시판 필터·출처 관리 유지, market_home 0행, 기존 실패 2곳 실패 이유 HEAD와 동일, 전체 실패 39 = 기준선 |
