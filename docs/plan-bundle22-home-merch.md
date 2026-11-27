# 22번 묶음 계획 · 홈 진열(섹션 제목·순서·추가, 추천 자료 진열, 배너 예약 노출)

작성일: 2026-11-26
판: 2 (검증 PASS, 2026-11-26) — PASS 뒤 minor 를 같은 판에서 반영함(14절, 문단 끝 `(PASS 뒤)`)
- 1판은 데이터·화면 두 관점 모두 FAIL(major 6, 겹친 것을 합치면 4)이었다. 반영은 13절 표에 있고, 고친 문단 끝에 `(2판)` 을 붙였다.
- 작업 순서표 6단계 22번 '홈 진열'(섹션 제목·순서·추가, **추천 자료 진열(관리자가 켜고 끔)**, 배너 예약 노출)을 만든다.
- 출처: `docs/admin-content-management-plan.md` 1절 8번·2-2·5절 5번, `docs/admin-ux-improvement-plan.md` C-09·C-10, 권한 `storefront.edit`.
- 국어·영어 같은 구조(메모리 '국어·영어 동일 구조'). 설정은 과목마다 따로.
- 화면은 20번 부품으로 그린다(20번 6-1 의 4단계를 이 묶음이 대신함).

## 0. 대표 결정과 질문
**이미 정해진 것(2026-11-20)**: 홈 추천 자료 진열을 만들고, 관리자가 켜고 끌 수 있게 한다.

**질문** — 답이 오기 전에는 기본안으로 진행한다.

Q1. 섹션 종류
- 기본안: **인기 다운로드**·**최근 등록**(지금 것)·**추천 자료**(관리자가 고른 상품). 인기·최근은 과목당 1개, 추천은 여러 개.
- 종류(그리는 규칙)는 코드, 제목·순서·켜기·고른 상품은 DB.

Q2. 상한
- 기본안: 과목당 섹션 8개, 추천 섹션당 상품 24개(지금 인기·최근 상한과 같음). 코드 규칙.

Q3. 추천 상품이 숨김·삭제·다른 과목이 되면
- 기본안: 회원 화면에서는 저절로 빠진다. 관리 화면은 회색 '지금 안 보임(이유)'으로 보이고 저장 때 경고만.

Q4. 섹션이 비었을 때
- 기본안: 기본은 **섹션째 숨김**. '빈 화면 문구'가 있으면 그 문구를 보인다.
- 지금 문구 두 개를 시드에 그대로 넣어 지금 모습을 지킨다: 인기 "아직 다운로드 집계가 없습니다.", 최근 "최근 등록된 자료가 없습니다.". (2판)
- 지금 영어 홈은 인기 0개라 이 문구를 보이고 있다(최근 30일 다운로드: 국어 12개 상품, 영어 0).

Q5. 배너 예약 시각
- 기본안: 한국 시간 분 단위 시작·끝(둘 다 선택). 끝난 배너는 지우지 않고 '종료'.
- **반영은 바로 된다**: 기간 거르기를 캐시 밖에서 요청마다 한다(3-5). (2판)

Q6. 보일 배너가 0개일 때
- 기본안: 배너 영역을 **숨긴다**(회원 화면 관리 계획 2-2). 지금은 빈 틀과 "등록된 ○○ 광고가 없습니다"·검색 링크를 보이는데, 이를 일부러 바꾼다(시험도 바꿈, 5절).
- 과목 탭은 클라이언트에서 바로 바뀌므로, 한 과목만 배너가 0개면 탭을 바꿀 때 위 영역이 생겼다 사라진다. 의도한 동작으로 본다(대표 확인). (2판)

Q7. 영어 홈 시험 광고 3개(켜져 있음)
- 기본안: 대표가 관리 화면에서 끈다(데이터). 코드로 처리하지 않는다.

Q8. 권한
- 기본안: `storefront.edit` 그대로.

## 1. 지금 상태(코드·운영 DB 확인, 2026-11-26)
- **회원 홈** `src/app/(solvook)/page.tsx`: `connection()` 뒤 두 과목을 함께 읽는다(`getCachedMarketHomeData`·`getCachedMainAdItems`).
  - 캐시 `src/lib/preview-home-cache.ts`: `unstable_cache` 60초. 홈 데이터는 상품 태그 `MARKET_PUBLIC_LIST_CACHE_TAG`, **배너는 태그 없음**.
  - `unstable_cache` 는 오래된 값이면 그것을 먼저 돌려주고 뒤에서 다시 채운다(Next 16 `unstable-cache.js` 'return stale immediately'). 다시 채우다 오류가 나면 이전 값을 유지한다. (2판)
  - 그리기 `src/app/(solvook)/_components/solvook-home-view.tsx`: `config.popular.isActive`·`config.recent.isActive` 로 두 섹션을 고정 순서로.
- **개발 미리보기** `src/app/preview/solvook-concept/page.tsx:38-43` 도 같은 캐시·부품으로 같은 고정 순서를 그린다. (2판)
- **코드에 있는 문구** (2판)
  - `…/home/popular-downloads-slider.tsx:14` "인기 다운로드 자료", `:17` "아직 다운로드 집계가 없습니다."
  - `…/home/home-material-sections.tsx:15` "최근 등록된 수업 자료", `:18` "최근 등록된 자료가 없습니다."
  - `…/home/main-ad-carousel.tsx` 의 빈 상태 "등록된 {과목} 광고가 없습니다"
  - 시험 `tests/market-home-empty-state-contract.test.mjs` 가 이 빈 틀·문구를 단언한다.
- **홈 설정** `src/lib/market-home.ts`: `workspace_settings` 키 `market_home`(과목별 행), 판 1 `{version, popular{isActive, limit, rankingWindowDays}, recent{isActive, limit}}`. `validateMarketHomeConfig` 는 키를 정확히 검사하고, `normalizeMarketHomeConfig` 는 잘못되면 기본값(인기 12·최근 8). **운영에 `market_home` 행이 없다.**
- **읽기** `src/lib/market-home-server.ts`: 인기 `get_market_home_popular_items`, 최근 `published_at` 순, 카드 `toItem` + `loadMarketItemListEnrichment`. 설정 읽기 오류면 기본값으로 그린다(209-210행).
- **홈 설정 관리** `/admin/market-main-settings`(미리보기는 숫자 3개뿐, `market-main-settings-client.tsx:98-100`) → `POST /api/admin/market-main-settings`(가드 `storefront.edit`, `validateMarketHomeConfig` 후 `upsertWorkspaceSetting` 으로 통째로 덮어씀). **작업 기록 없음, 동시 저장 막기 없음.**
- **배너**: `system_settings.main_ad_carousel` 판 2, 항목 `{id, title, pcImagePath, mobileImagePath, alt, href, durationSeconds, isActive}`. 저장 RPC `update_main_ad_carousel_subject`(id·노출 초만 검사). TS `validateItem` 은 아는 칸만 담는다 → 옛 코드로 저장하면 모르는 칸이 사라진다. 공개 읽기 `getActiveMainAdCarouselItems` 는 `isActive` 만 본다(캐시 안). **작업 기록 없음.**
- **운영 배너**: 국어 3개 켜짐, 영어 3개는 시험 광고인데 켜짐.
- **작업 기록**: 홈 관련 종류 없음.

## 2. 목표
1. 관리자가 과목별로 섹션을 더하고·지우고·순서를 바꾸고·켜고 끄고, 제목과 빈 화면 문구를 고친다.
2. 추천 섹션에 상품을 골라 순서대로 진열하고 섹션째 켜고 끈다.
3. 회원 홈은 저장한 순서·제목대로 그린다. 제목·문구가 코드에 남지 않는다.
4. 배너에 노출 시작·끝을 정하고, 기간 밖 배너는 **바로** 회원 화면에서 빠진다. 보일 배너가 없으면 영역이 숨는다.
5. 홈 설정·배너 저장이 작업 기록에 남는다. 홈 설정은 동시 저장 때 나중 사람이 덮어쓰지 않는다.
6. 시드 뒤·배포 뒤에도 국어·영어 홈 모습(섹션·순서·개수·제목·빈 문구)이 지금과 같다.

## 3. 설계
### 3-1. 홈 설정 판 2(같은 행)
```
{ "version": 2, "revision": 1,                 // 시드 값 1, 저장마다 서버가 +1
  "sections": [                                 // 배열 순서 = 화면 순서, 1~8개
    { "id": "<uuid>", "kind": "popular", "isActive": true, "title": "인기 다운로드 자료",
      "emptyText": "아직 다운로드 집계가 없습니다.", "limit": 12, "rankingWindowDays": 30 },
    { "id": "<uuid>", "kind": "recent", "isActive": true, "title": "최근 등록된 수업 자료",
      "emptyText": "최근 등록된 자료가 없습니다.", "limit": 8 },
    { "id": "<uuid>", "kind": "featured", "isActive": false, "title": "추천 자료",
      "emptyText": null, "itemIds": [] } ],   // itemIds 0~24개, 중복 없음
  "emptyHomeLink": "국어 문제마켓 보기" }      // (PASS 뒤) 섹션·배너 모두 0개일 때 한 줄, 과목별 행마다
```
- 규칙(코드): 종류 3가지와 개수, 제목 1~40자, 빈 문구 0~80자, `MARKET_HOME_LIMITS`, id 중복 없음, 개인정보 모양 검사(14번 `member-facing-text-pii.ts`, 없으면 이 묶음이 만들고 14번이 이어 씀).
- 판 1·행 없음은 새 코드에서 **'설정 없음'** 상태다(3-3·3-4). (2판)
- **회원 홈 읽기 검사는 구조만**(키·종류·개수·길이) 본다. 개인정보 모양 검사는 **저장 때만** 한다. 14번이 검사 규칙을 넓혀도 이미 저장된 제목 때문에 회원 홈 섹션이 사라지지 않는다. (PASS 뒤)
- 빈 홈 링크 문구 `emptyHomeLink`(판 2 의 과목별 칸): 보일 섹션과 배너가 모두 0개일 때 과목 문제마켓으로 가는 한 줄. 시드 값은 지금 빈 배너 틀의 '○○ 문제마켓 보기' 글자. (PASS 뒤)

### 3-2. 추천 자료·미리보기 데이터 (2판)
- 회원 홈: `itemIds` 를 공개·활성·삭제 안 됨·같은 과목으로 거르고 순서 유지, 카드는 최근 등록과 같은 `toItem`.
- 관리 화면 상품 고르기: `GET /api/admin/market-main-settings/item-search?subject&q` (제목·id·상태·대표 그림).
- 관리 화면 미리보기(저장 전 값, 실제 카드 부품)
  - 관리 `page.tsx` 가 인기·최근을 **상한 24개까지** 미리 읽어 두고, 미리보기는 저장 전 `limit` 만큼 자른다.
  - 추천: `POST /api/admin/market-main-settings/preview-items` `{subject, itemIds}` → 회원 홈과 같은 거르기 + `toItem` 카드(공개 정보만). 빠진 상품은 이유와 함께.
  - 인기의 집계 기간을 바꾼 경우는 미리보기에 '저장 뒤 반영' 표시.
- 두 route 모두 가드 `storefront.edit`, 서버 키, 회원 정보 없음. 17~19번이 고치는 상품 화면 파일은 건드리지 않는다.

### 3-3. 회원 홈 그리기 (2판)
- `getMarketHomeData` 가 섹션 배열을 돌려주고, `SolvookHomeView`·미리보기 page 가 `sections.map` 으로 종류별 부품을 그린다. 부품은 `title`·`emptyText` 를 받는다(코드 기본 문구 삭제).
- 꺼진 섹션은 읽지 않는다. 상품 0개면 `emptyText` 가 있을 때 그 문구, 없으면 숨김.
- 실패 나누기
  - **일시 읽기 오류**: 캐시 함수 안에서 throw → `unstable_cache` 가 이전 정상 값을 유지한다.
  - **첫 채움부터 실패**: page 가 받아 '배너만'으로 그린다.
  - 보일 섹션과 배너가 **모두 0개**면 `emptyHomeLink` 한 줄(과목 문제마켓 `/search?subject=…`)을 보인다. 빈 여백만 남지 않게. (PASS 뒤)
  - **판 2 검사 실패·설정 없음(판 1·행 없음)**: 섹션 0개(기본 문구로 돌아가지 않음) + 서버 로그 + 관리 화면 빨간 띠 '회원 홈 설정이 없거나 형식이 다릅니다'.

### 3-4. 동시 저장 막기 (2판)
- 관리자 읽기는 `revision` 을 준다. 판 1·행 없음이면 `revision: 0`.
- 행이 판 2 이고 `revision` 이 정수인데 구조 검사에 실패하면, 관리자 읽기는 **저장된 revision 을 그대로** 주고 편집 화면은 읽을 수 있는 섹션만(없으면 빈 시작값) 채운다. 저장은 아래 '≥ 1' 경로로 덮어써 복구한다. (PASS 뒤)
- 저장(서버 키, 새 `revision` 은 서버가 정함)
  - 받은 값 ≥ 1: `UPDATE … WHERE workspace_subject = ? AND setting_key = 'market_home' AND value->>'version' = '2' AND value->>'revision' = '<받은 값>'` → 새 revision = 받은 값 + 1.
  - 받은 값 = 0 이고 행 없음: `INSERT … ON CONFLICT DO NOTHING`, revision 1.
  - 받은 값 = 0 이고 행이 판 1: `UPDATE … WHERE value->>'version' IS DISTINCT FROM '2'`, revision 1.
  - 영향 행 0 → 409 `REVISION_CONFLICT`('다른 관리자가 먼저 저장했습니다. 다시 불러오세요').
- 그래서 판 1 로 덮인 경우에도 화면에서 판 2 로 다시 저장해 복구할 수 있다.

### 3-5. 배너 예약 (2판)
- 항목에 `startsAt`·`endsAt`(ISO, 각각 null 가능). 화면은 한국 시간으로 받고 서버가 UTC 로 바꾼다. `endsAt > startsAt`. 판은 올리지 않는다.
- **캐시 함수는 `isActive` 항목을 `startsAt`·`endsAt` 과 함께 돌려준다.** 기간 거르기 `isMainAdVisibleAt(item, now)` 와 0개 판정은 **캐시 밖**, 요청마다 도는 `(solvook)/page.tsx`(두 과목)와 `preview/solvook-concept/page.tsx` 에서 한다. 그래서 반영 지연이 없다.
- 걸러진 결과가 0개면 `MainAdCarousel` 을 그리지 않는다.
- 옛 코드는 모르는 칸을 무시하고 읽는다. 옛 코드로 저장하면 예약 칸이 지워지므로 새 코드 배포 전에는 예약을 넣지 않는다.
- 배너에는 동시 저장 막기를 넣지 않고 작업 기록만 더한다(11절 2).

## 4. DB 변경 — 스키마 없음, 데이터 스크립트만
**시드 `supabase/scripts/<날짜>_bundle22_home_sections_seed.sql`**
- 두 과목에 3-1 의 판 2 행(`revision: 1`, 섹션 id 는 `gen_random_uuid()`)을 `INSERT … ON CONFLICT (workspace_subject, setting_key) DO NOTHING`. 행이 이미 있으면: 판 2 면 멈추고 보고, 판 1 이면 그 행만 판 2 로 바꾼다(H6). 지금 0행. (PASS 뒤)
- 문구는 지금 코드 글자 그대로 4개(제목 2·빈 문구 2) + 추천 제목 초안. 최종은 대표가 화면에서(메모리 '문구는 초안').
- 작업 기록 1행(`market_home_sections_seed`), 방식은 11번 스크립트 A(`checkout_consent_keys_seed`)와 같게.
- 끝에 확인 SELECT. 행만 넣어 표를 잠그지 않는다.

**되돌림 스크립트**: 판 2·`revision = 1` 인 행만 DELETE(고친 뒤면 멈춤). **코드를 되돌린 뒤에만** 실행한다 — 새 코드에서는 행이 없으면 섹션 0개다. (2판)

**리허설**(운영, `BEGIN … ROLLBACK`, 반복 가능)
| 경우 | 기대 |
|---|---|
| H1 | 시드 → 확인 → 되돌림 → 0행 |
| H2 | 이미 행이 있으면 멈춤 |
| H3 | 옛 `normalizeMarketHomeConfig` 에 판 2 → 기본값(인기 12·최근 8) — 시드~배포 사이 회원 홈이 그대로라는 근거(순수 시험) |
| H4 | 작업 기록 1행 |
| H5 | 시드로 넣은 두 value 를 SELECT 해 새 판 2 검사에 넣으면 통과(리허설 출력 → 순수 시험 입력). (2판) |
| H6 | 행이 판 1 이면 시드가 그 행만 판 2(revision 1)로 바꾼다(`UPDATE … WHERE value->>'version' IS DISTINCT FROM '2'`), 판 2 행은 건드리지 않음 (PASS 뒤) |

## 5. 코드 변경
- `src/lib/market-home.ts`: 판 2 타입·검사, 판 1·행 없음 → '설정 없음', 섹션 이동·추가 순수 함수. 판 1 타입은 `MarketHomeConfigV1` 로 이름을 바꿔 남기고, 쓰이지 않는 `…/home/campaign-hero.tsx` 가 그것을 쓰게 한다(죽은 코드는 지우지 않고 대표에게 알림). (PASS 뒤)
- `src/lib/market-home-server.ts`: 섹션별 읽기(일시 오류는 throw), 추천 거르기, 관리자 읽기(`revision`, 24개 미리 읽기), 조건부 저장(3-4).
- 회원 부품: `solvook-home-view.tsx`, `popular-downloads-slider.tsx`, `home-material-sections.tsx` 가 제목·빈 문구를 받고 코드 문구를 지운다. 새 `featured-materials.tsx`.
- **`src/app/preview/solvook-concept/page.tsx`**: 같은 섹션 배열·배너 거르기로. (2판)
- 배너: `main-ad-carousel.ts`·`-server.ts`(예약 칸 검사·보존, `isMainAdVisibleAt`), `preview-home-cache.ts` 의 배너 캐시는 거르지 않은 값, `main-ad-carousel.tsx` 의 빈 틀 제거.
- route: `api/admin/market-main-settings`(판 2·409·작업 기록·캐시 무효화), 새 `item-search`·`preview-items`, `api/admin/main-ad-settings`(작업 기록). 작업 기록 실패는 U3-5 '로그로만' 규칙.
- 시험 갱신: `admin-guard-coverage-contract`(새 route 2개), `main-ad-carousel-contract`·`main-ad-settings-route-contract`·`main-ad-carousel-browser`(예약 칸), **`market-home-empty-state-contract` 는 의도적으로 바꾼다**(빈 섹션 문구는 DB 값으로, 0개 배너는 영역 숨김 — 바꾼 이유를 시험 주석에). (2판)
  - 함께 의도적으로 바꾸는 시험(PASS 뒤): `market-home-ui-contract`(73·75행 고정 순서 → `sections.map` 단언), `main-ad-carousel-contract`(299-302행 빈 상태 → 0개면 그리지 않음), `market-public-gate-hidden-board`(148-151행: 가짜 DB 에 판 2 행을 넣고, '숨김 게시판 상품도 추천 섹션에 들어간다' 경우를 더함).

## 6. 관리 화면(20번 부품)
**'홈 진열'**(`/admin/market-main-settings`, 과목 전환기는 제목줄 도구 칸)
- 맨 위: 설정 없음·형식 오류면 빨간 띠(3-3).
- 섹션 표: 순서(위·아래 버튼), 종류, 제목, 켜기, 상품 수·개수, [편집], '⋯'(지우기).
- [섹션 추가] → 종류 고르기(인기·최근이 이미 있으면 흐리게).
- 편집 옆 창: 제목·빈 문구·개수·기간(인기) / 추천 상품 고르기(검색·더하기·순서·빼기, 안 보이는 상품 회색 + 이유).
- **회원 홈 미리보기**(3-2 데이터).
- 저장 바 반영 안내: '저장하면 바로 회원 홈에 반영(상품 정보는 최대 1분)'. 409 면 [다시 불러오기].
- 확인 창: 섹션 지우기·추천 끄기("‘수능특강 추천’ 섹션을 지웁니다. 고른 상품 12개 목록도 함께 사라집니다").

**'홈 배너'**(`/admin/main-ad-settings`)
- 요약 표(C-10): 작은 미리보기, 제목, 링크, 노출 기간, 상태(노출 중·예약·종료·꺼짐 — 20번 tone).
- 편집 창: 시작·끝(비우면 '바로'·'계속'), 지금 기준 상태 미리 계산.
- 보일 배너가 0개가 되는 저장이면 확인 창("저장하면 회원 홈에 배너 영역이 사라집니다").

**localhost 확인**: 저장·지우기를 누르지 않는다. 미리보기·편집 창·확인 창 [취소]까지.

## 7. 작업 기록 종류(`src/lib/admin-audit-log.ts`)
| 종류 | 이름 | 남기는 곳 | details |
|---|---|---|---|
| `market_home_sections_save` | 홈 진열 저장 | route(저장 성공 뒤) | 과목, 이전·새 revision, 섹션별 바뀐 칸(종류·켜기·제목 글자 수·상품 id 차이), request |
| `market_home_sections_seed` | 홈 진열 첫 값 넣기(SQL 스크립트) | 4절 스크립트 | 과목 2, 섹션 수 |
| `main_ad_carousel_save` | 홈 배너 저장 | route(저장 성공 뒤) | 과목, 배너별 바뀐 칸(켜기·기간·링크·순서), request |
- 제목·문구 원문은 넣지 않는다(14번 원칙). 13번 보관 정책에서 2년 쪽.

## 8. 시험
- `tests/bundle22-home-sections.test.mjs`(순수)
  - 판 2 검사, 판 1·행 없음 → 설정 없음, H3·H5
  - **시드 값으로 그리면 국어·영어 모두 지금과 같은 섹션·문구**(영어 인기 0개 → "아직 다운로드 집계가 없습니다.") (2판)
  - 섹션 이동·추가, 추천 거르기, 3-4 저장 경로별 조건(revision 0/≥1, 행 없음/판 1)
- `tests/bundle22-main-ad-schedule.test.mjs`(순수): `isMainAdVisibleAt` 경계(시작 정각 보임, 끝 정각 안 보임, null), 한국 시간 → UTC, 끝 < 시작 거절, 예약 칸 보존.
- 계약
  - 회원 부품에 코드 한국어 제목·빈 문구 없음(인기 빈 문구 포함)
  - **배너 기간 거르기가 `unstable_cache` 로 감싼 함수 안에 없음**, page 두 곳에서 거름 (2판)
  - 홈 설정 일시 오류는 캐시 함수 안에서 throw
  - route 가드 네 곳(화면·저장·검색·미리보기)·작업 기록 순서·409, 검색·미리보기 응답에 회원 정보 없음
- 화면 시험(Claude in Chrome, 나 → 대표, 읽기만): 시드 전·후·배포 뒤 국어·영어 홈 같은지, 375×667·1366×768, 관리 화면 미리보기·편집 창·확인 창 [취소].

## 9. 검증 관점(계획·구현 모두 PASS 까지)
1. **회원 화면**: 시드·배포 앞뒤 홈이 같은가(빈 문구 포함), 0개 배너, 캐시와 예약 지연, 미리보기 page, 과목 동일 구조
2. **데이터·동시성**: 판 2 검사, 3-4 경로별 저장, 옛 코드 저장 때 손실, 시드·되돌림 순서
3. **권한·기록**: `storefront.edit` 네 곳, 작업 기록(원문 없음), 하드코딩 금지
- 결제·크레딧을 건드리지 않아 결제 검증 3명은 두지 않는다.

## 10. 배포 순서
1. 계획 검증 PASS → 0절 답 반영
2. 선행: 20번 0단계. 14번 개인정보 검사 파일이 있으면 그것을 씀
3. 구현 → 계약 시험 → 구현 검증 PASS
4. 리허설(H1~H5) → **시드 실행**(승인, 데이터만) → 운영 홈 그대로 확인
5. **시드 ~ 배포 사이 '홈 진열' 저장 금지**(옛 화면이 판 1 로 덮음 — 덮여도 3-4 로 복구 가능). 런북 한 줄
6. 로컬 확인(나 → 대표, 읽기만) → **push 직전 두 행이 `version 2`·`revision 1` 인지 SELECT**(아니면 시드를 다시 돌리거나 배포를 미룸) → push·배포 (PASS 뒤)
7. 대표: 영어 시험 광고 끄기, 추천 섹션 상품 고르고 켜기, 문구 확정
8. 진행 기록 갱신
- **되돌리기** (2판)
  - 먼저 **기간 밖 배너를 모두 끈다**(시작 전·종료 모두, `isActive` 이면서 지금이 기간 밖). 런북에 찾는 읽기 SQL: `main_ad_carousel` 의 `items` 에서 `startsAt > now()` 또는 `endsAt <= now()` 인 항목.
  - 코드 revert(판 2 행이 있어도 옛 코드는 기본값으로 돈다). **revert 동안 '홈 진열' 저장 금지.**
  - 다시 배포하기 전에 두 행이 판 2 인지 SELECT 로 확인한다. 행이 없거나 판 1 이면 **배포 전에** 시드 스크립트를 다시 돌린다(승인, H6 경로). 배포 시점에 두 행이 판 2 여야 회원 홈에 빈 시간이 없다. (PASS 뒤)
  - 되돌림 스크립트는 코드 revert 뒤에만.

## 11. 열린 질문
1. 카테고리별 자동 진열 섹션도 만들지(기본: 만들지 않음).
2. 배너에도 동시 저장 막기를 넣을지(기본: 넣지 않음, 직원에게 `storefront.edit` 를 주면 다음 판).
3. 섹션별 노출 기간(예약)이 필요한지(기본: 배너만).

## 12. 범위 밖
- 섹션 끌기, 배너 이미지 보관함 고르기, 클릭 통계, 회원별 맞춤 진열, 카테고리 화면 진열.

## 13. 1판 검증 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| 데이터·화면 major | 인기 빈 문구 빠짐 → 영어 홈 인기 섹션 사라짐 | Q4, 1절, 3-1 시드 값, 8절 시험(영어 인기 0개) |
| 데이터 major | 판 1·행 없음이면 저장이 늘 409, 복구 불가 | 3-4 revision 0 경로, 3-3 빨간 띠, 10절 되돌리기 |
| 데이터·화면 major | 배너 거르기가 캐시 안이면 몇 시간 늦음 | Q5, 3-5 캐시 밖 거르기, 8절 시험 |
| 화면 major | 미리보기 데이터 경로 없음 | 3-2 24개 미리 읽기·`preview-items` route·'저장 뒤 반영' |
| minor | 시드 검사·첫 revision | 3-1 revision 1, 4절 gen_random_uuid·H5 |
| minor | 되돌릴 때 끌 배너 범위 | 10절 시작 전·종료 모두 + 찾는 SQL |
| minor | 일시 오류를 섹션 0개로 캐시 | 3-3 throw 로 이전 값 유지 |
| minor | 미리보기 page·빈 상태 시험·되돌림 순서·탭 깜박임 | 5절 preview page·시험 의도 변경, 4절 되돌림 순서, Q6 |

## 14. 2판 검증(PASS) 뒤 minor 반영
| 관점 | 지적 | 반영 |
|---|---|---|
| 데이터 minor | 판 2 검사 실패 때 저장이 막힐 수 있음 | 3-1 읽기는 구조만·개인정보는 저장 때만, 3-4 저장된 revision 으로 복구 |
| 데이터 minor | push 직전 판 2 확인 없음 | 10절 6 |
| 화면 minor | 빠진 시험 갱신 3개 | 5절 시험 목록 |
| 화면 minor | campaign-hero 가 판 1 타입에 기댐 | 5절 `MarketHomeConfigV1` |
| 화면 minor | 다시 배포 때 빈 홈 시간 | 10절 되돌리기, 4절 H6 |
| 화면 minor | 섹션·배너 모두 0개면 빈 여백 | 3-1·3-3 `emptyHomeLink` |


## 15. 구현 메모 (2026-11-27)
0절 질문은 모두 기본안으로 구현했다. DB 스키마 변경이 없어(4절) 마이그레이션(예약해 둔 20261224100000)·down 파일은 만들지 않았다. 운영 DB 에는 아무것도 적용하지 않았다(시드 미실행).

**만든 것·고친 것**
- 규칙: `src/lib/market-home.ts`(판 2 타입·검사, `readMarketHomeConfig` 의 ok·missing·invalid, 섹션 이동·추가, 추천 거르기, 작업 기록 차이, 판 1 타입은 `MarketHomeConfigV1`), `src/lib/market-home-server.ts`(섹션별 읽기·일시 오류 throw, 추천 거르기, 관리자 읽기 24개 미리 읽기, 상품 검색, 3-4 조건부 저장).
- 배너: `src/lib/main-ad-carousel.ts`(`startsAt`·`endsAt` 검사·보존, `isMainAdVisibleAt`·`filterVisibleMainAdItems`, `kstLocalToUtcIso`·`utcIsoToKstLocal`, 상태 `live`·`scheduled`·`ended`·`off`, 배너 차이), `main-ad-carousel-server.ts`(공개 항목에 기간 싣기). `admin-status-tone.ts` 의 배너 키는 바꾸지 않고 `satisfies Record<MainAdScheduleStatus, AdminTone>` 로 묶었다.
- 회원: `(solvook)/page.tsx`·`preview/solvook-concept/page.tsx`(기간 거르기는 캐시 밖, 첫 채움 실패면 배너만), 새 `market-home-sections.tsx`(섹션 배열·빈 홈 링크)·`featured-materials.tsx`, 인기·최근 부품은 제목·빈 문구를 받음, `main-ad-carousel.tsx` 빈 틀 제거.
- route: `api/admin/market-main-settings`(판 2·개인정보 검사·409·작업 기록·`revalidateTag(MARKET_HOME_CACHE_TAG)`), 새 `item-search`(GET)·`preview-items`(POST), `api/admin/main-ad-settings`(작업 기록). 작업 기록 종류 3개는 `admin-audit-log.ts`.
- 관리 화면: '홈 진열'은 20번 부품(제목줄·표·옆 창·저장 바·확인 창·빨간 띠)으로 새로 그렸다. '홈 배너'는 요약 표·기간 칸·상태 배지·0개 확인 창을 더했다.
- DB 스크립트: `supabase/scripts/20261224_bundle22_home_sections_seed.sql`, `..._seed_revert.sql`, 리허설 `supabase/scripts/bundle22_rehearsal/`(generate.mjs → a_light.sql).

**계획과 달리 정했거나 덧붙인 것(확인 필요)**
1. 리허설은 light(`a_light.sql`) 하나뿐이다. 마이그레이션·이력 표가 없어 full 과 차이가 없기 때문이다. 경우 H1·H2·H4·H5·H6 와 되돌림 멈춤(R)이 있고, H3 는 순수 시험이 옛 파일 사본(`tests/fixtures/bundle22-market-home-v1.ts`, 648e68c 그대로)으로 본다.
2. 시드의 '이미 판 2' 처리: 두 과목 모두 판 2 면 멈춘다(H2). 한 과목만 판 2 면 그 행은 건드리지 않고 다른 과목만 넣는다(H6 '판 2 행은 건드리지 않음'). 10절 되돌리기의 '한쪽만 판 1 로 덮인 경우'도 다시 실행으로 고칠 수 있게 하려는 것이다.
3. 시드가 판 1 행을 바꿀 때, 판 1 이 옛 코드 검사를 통과하면 인기·최근의 켜기·개수·기간을 이어받는다. 통과하지 못하면 옛 코드처럼 기본값을 쓴다. 지금 모습을 지키려는 것이며 운영은 지금 0행이다.
4. 시드·되돌림 행위자: 실제 실행은 마지막으로 로그인한 대표다(11번 스크립트 A 와 같음). 리허설은 거래 안 설정 `bundle22.rehearsal_actor` 로 @test.com 시험 계정을 쓴다. 되돌림도 작업 기록을 1행 남긴다(같은 종류, `mode: 'revert'`).
5. 회원 홈 캐시 키를 `preview-market-home-v2` 로 바꿨다. 배포 직후 옛 모양 캐시 값을 읽어 화면이 깨지지 않게 하려는 것이다. 홈 진열 저장 때는 새 태그 `MARKET_HOME_CACHE_TAG` 로 바로 비운다. 배너 캐시 키는 그대로 두었다. 옛 값에는 기간 칸이 없어 늘 보이는 것으로 읽는다.
6. 첫 채움부터 읽기에 실패하면 회원 홈 데이터 상태를 `error`(`marketHomeReadFailed`)로 두고 배너만 그린다.
7. 빈 화면 문구·빈 홈 링크는 null 또는 1자 이상이다. 화면에서 비우면 null 이 되고, 섹션은 숨는다·링크는 보이지 않는다.
8. 알려진 한계: 판 2 인데 revision 이 정수가 아닌 행은 수동 SQL 로만 생긴다. 이런 행은 관리자 읽기가 revision 0 을 주므로 저장이 계속 409 가 되고, 시드도 판 2 라 건너뛴다. 생기면 SQL 로 revision 을 고친다.
9. 배너 '편집 창'은 따로 띄우지 않았다. 기존 광고 카드 안에 시작·끝 칸(한국 시간, 비우면 '바로'·'계속')과 '지금 기준' 상태를 넣고, 위에 요약 표(C-10)를 두었다. 0개 확인 창은 '지금 보이는 배너가 있었는데 저장하면 0개'일 때만 띄운다.
10. 20번 6-1 4단계(홈): 두 화면의 주황 `adminAction` 버튼을 `brandOutline` 으로 바꾸고, 래칫 목록에서 main-ad-settings 를 뺐다.
11. 관리 화면 미리보기는 빈 홈 링크 판정에 지금 보이는 배너 수를 쓴다(page 가 배너 설정을 읽어 넘김). Q3 '저장 때 경고'는 저장 바 위 경고 띠로 넣었다(저장을 막지 않음).
12. 화면 제목은 DB 메뉴 이름(`AdminMenuName`)을 그대로 쓰고, 기본 글 '(임시) 문제마켓 메인 관리'도 그대로 두었다. '홈 진열'로 바꾸려면 메뉴 관리에서 DB 를 고친다.
13. 쓰이지 않는 `…/home/campaign-hero.tsx` 는 지우지 않았다(죽은 코드, 대표에게 알림).

**시험**
- 새 파일 3개: `tests/bundle22-home-sections.test.mjs`(순수·가짜 DB: H3·H5, 시드 값으로 그린 국어·영어 홈, 3-4 경로), `tests/bundle22-main-ad-schedule.test.mjs`, `tests/bundle22-home-merch-contract.test.mjs`(문구 없음·캐시 밖 거르기·route 403/409/400·작업 기록 순서·회원 정보 없음·리허설 사본). 자료는 `tests/fixtures/bundle22-seed-values.json`(리허설 H1 출력) 이다.
- 일부러 바꾼 시험(각 파일 주석에 이유): market-home-empty-state·ui·contract·config-normalize·admin-route, main-ad-carousel-contract·settings-route·browser, market-public-gate-hidden-board(판 2 행 + 숨김 게시판 상품이 추천 섹션에 들어감), remove-home-source-section, admin-guard-coverage(새 route 2개), admin-phase1a(U2: 빈 홈 링크가 검색으로), market-images-display(캐시 태그), admin-kit(래칫 목록).
- `node --test tests/*.test.mjs`: 2406개 중 실패 43개이며, 모두 22번 전부터 실패하던 것과 이름이 같다(새 실패 0). 22번 전부터 실패하던 main-ad-carousel-contract 'preview page …' 시험은 구현 검증 지적에 따라 22번 구조(캐시 밖 거르기·0개 숨김·MarketHomeSections)로 고쳐 통과한다. market-home-ui 'preview renders database category board…'는 22번과 관계없어 그대로 둔다.
- 구현 검증 minor 반영: 저장 뒤 `router.refresh()` 로 미리보기 재료를 다시 받아 '저장 뒤 반영' 안내가 남지 않게 했다. 상품 검색어의 `*`(PostgREST 가 `%` 로 바꿈)는 뺐다. `npx tsc --noEmit -p .`(.next 밖 0)과 바꾼 파일 eslint 도 0 이다.

**리허설 결과(운영, 2026-11-27, BEGIN…ROLLBACK)**: 시작 때 market_home 행 0개·시드 작업 기록 0개였다. H1·H2·H4·H6·R 과 '남은 것 없음'(Z)이 모두 통과했다. H5 출력은 위 시험 자료다.

**남은 단계(10절 순서, 구현 검증 뒤 갱신)**
1. 22번 코드는 main 이 아니라 로컬 브랜치 `bundle22-home-merch` 에 둔다. 다른 묶음 push 에 섞이지 않게 하기 위해서다. 새 코드는 market_home 행이 없으면 회원 홈 섹션이 0개다. 그래서 이 묶음만 **시드 → main 합치기·push** 순서다(작업 순서표 진행 표 22번 행).
2. (대표 승인) 시드 실행 → 운영 회원 홈이 그대로인지 확인(옛 코드는 판 2 행을 기본값으로 읽음, H3).
3. 시드 ~ 배포 사이에는 '홈 진열' 저장을 하지 않는다(런북 11-6).
4. localhost 확인(나 → 대표, 읽기만): 회원 홈과 관리 화면 미리보기·편집 창·확인 창 [취소]까지 본다. 로컬 dev 도 운영 DB 를 쓴다. **시드 전에 브라우저로 보면 회원 홈은 섹션 0개(배너만), 관리 화면은 '설정 없음' 빨간 띠가 정상이다.** 이때 저장 버튼은 누르지 않는다. '시드 뒤 홈 모습이 같은지'는 시드 뒤에 본다.
5. push 직전 두 행이 `version 2`·`revision 1` 인지 SELECT 한다. 아니면 시드를 다시 돌리거나 배포를 미룬다. 그다음 main 합치기·push·배포.
6. 대표 할 일: 영어 시험 광고 끄기, 추천 섹션 상품 고르고 켜기, 문구 확정.

## 16. 섹션 제목 꾸밈 (2026-11-27, 대표 요청 — 커밋 전)

- **제목 강조**: 제목 글 안에서 `**…**` 로 감싼 부분을 회원 홈이 강조 색(`--studio-primary`)으로 그린다. 이모지는 제목에 그대로 적는다. 규칙은 `splitMarketHomeTitle`(`src/lib/market-home.ts`), 그리는 곳은 `SectionHeading`. 설정 값의 키·구조는 그대로라 DB 변경이 없다(제목 40자에는 별표도 센다). 짝이 없는 `**` 는 글자 그대로 보인다.
- **관리 화면**: 편집 창 제목 칸 아래에 쓰는 법 한 줄. 표·확인 창·읽어 주는 이름은 별표를 뺀 제목(`plainMarketHomeTitle`). 미리보기는 회원 홈과 같은 부품이라 저장 전에 강조 색을 볼 수 있다.
- **꾸밈 그림**: 섹션 제목 줄 오른쪽 뒤에 낙서풍 선 그림 두 장을 섹션 순서대로 번갈아 깐다(`SectionDoodle`, `public/home-decor/section-doodle-a.webp`·`-b.webp`, ChatGPT 이미지 생성으로 만든 것). md 폭부터 보이고 읽어 주지 않는다.
- **순서**: 코드 배포 → 그 뒤에 대표가 '홈 진열'에서 제목에 이모지·별표를 넣어 저장. 배포 전에 별표를 넣으면 옛 코드가 별표를 글자 그대로 보인다(이모지만 넣는 것은 언제든 괜찮다).
- **시험**: `tests/bundle22-home-sections.test.mjs` 에 제목 나누기 시험 1개, `tests/market-home-ui-contract.test.mjs` 의 섹션 그리기 모양 갱신.

## 17. 인기 기간 버튼과 펼쳐보기 (2026-11-27, 대표 요청 — 커밋 전)

- **무엇**: 인기 섹션 제목 아래에 기간 버튼(예: 월간 30일·주간 7일)을 두고, 누르면 그 기간(오늘부터 거꾸로 센 일수)의 인기 순위를 보인다. 인기·최근 섹션은 처음에 정한 개수만 보이고 목록 아래 펼치기 버튼으로 '개수'까지 보인다. 추천 섹션은 그대로다.
- **속도**: DB 변경이 없다. 순위는 지금 함수 `get_market_home_popular_items(과목, 시작 시각, 개수)` 를 버튼마다 한 번씩 부른다(덮는 인덱스로 1.5~5ms). 회원 홈은 60초 캐시라 버튼이 2개여도 과목당 1분에 2번이고, 버튼을 누를 때는 이미 받은 목록을 바꿔 보이기만 한다(다시 읽지 않음).
- **설정 키(판 2 그대로, 모두 선택 — 없으면 22번과 같은 모양·같은 동작)**
  - 인기 섹션 `periodTabs: [{ label, days }]`: 1~3개, 이름 1~10자, 일수는 집계 기간과 같은 범위(1~90), 같은 일수 두 번 금지. 있으면 `rankingWindowDays` 는 검사 때 첫 버튼의 일수로 맞춘다.
  - 인기·최근 섹션 `collapsedLimit`: 1 이상 '개수' 이하. 숨은 상품이 없으면 버튼이 나오지 않는다.
  - 설정 맨 위 `expandLabel`·`collapseLabel`: 1~20자. `collapsedLimit` 를 쓰는 섹션이 있으면 둘 다 있어야 저장된다. 비우면 칸째 두지 않는다.
  - 버튼 이름·버튼 글자는 코드에 없다(관리자가 적는 DB 값, 저장 때 개인정보 모양 검사). 코드에는 기간 버튼을 더할 때의 일수 시작값(30·7·1)만 있다.
- **빈 목록**: 빈 화면 문구가 있으면 0개인 기간도 버튼을 보이고 그 문구를 보인다. 문구가 없으면 0개인 기간의 버튼을 숨기고, 모든 기간이 0개면 섹션째 숨긴다(`visibleMarketHomePeriods`·`visibleMarketHomeSections`). 빈 홈 링크 판정도 같은 규칙을 쓴다.
- **회원 화면**: 기간 버튼은 `aria-pressed`, 펼치기 버튼은 `aria-expanded`·`aria-controls`. 기간을 바꾸면 목록은 다시 접힌 채로 시작한다. 펼치기 계산은 `collapseMarketHomeItems`.
- **관리 화면**: 인기 편집 창에 기간 버튼 목록(이름·일수, 추가·빼기 — 버튼이 있으면 '집계 기간' 칸은 숨김), 인기·최근 편집 창에 '처음 보이는 개수', 섹션 표 아래에 펼치기·접기 버튼 글자. 미리보기는 회원 홈과 같은 부품이고, 저장 전 버튼의 일수로 실제 순위를 읽는다(새 route `preview-popular`, `storefront.edit`, 읽기만 — 저장된 버튼의 일수는 화면을 열 때 미리 읽는다).
- **적용 순서**: ① 코드 배포 → ② 관리자 '홈 진열'에서 값 저장(과목마다). 배포 전에 새 칸을 저장하면 옛 코드가 '모르는 칸'으로 읽어 회원 홈 섹션이 0개가 된다 — 그래서 배포 전 확인은 관리 화면 미리보기로만 한다(저장 버튼을 누르지 않는다). 캐시 키는 `preview-market-home-v3` 으로 올렸다.
- **되돌릴 때**: ① 관리자 화면에서 기간 버튼·처음 보이는 개수·버튼 글자를 지워 저장(새 칸이 값에서 사라진다) → ② 코드 되돌리기. 순서를 바꾸면 되돌린 코드가 새 칸을 읽지 못해 회원 홈 섹션이 0개가 된다.
- **시험**: `tests/bundle22-home-sections.test.mjs` 에 17절 시험 6개(검사·정리, 빈 목록 규칙, 펼치기 계산, 버튼 더하기·작업 기록 차이, 회원 홈 읽기, 관리 화면 재료·저장), `tests/bundle22-home-merch-contract.test.mjs` 에 4개(미리보기 route 403·400, 저장 route 개인정보 검사, 회원 부품·관리 화면 모양)와 캐시 키·권한 목록 갱신, `tests/admin-guard-coverage-contract.test.mjs` 에 새 route 한 줄.
