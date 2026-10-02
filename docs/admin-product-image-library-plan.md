# 관리자 상품 이미지 라이브러리(업로드·재사용·폴더 관리) 계획 — 확정

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD 4547be0) · 상태: **사용자 결정 반영 확정(9절, 10절)**. 코드·DB는 변경하지 않았다. DB 확인은 Supabase MCP SELECT만 했다.
- 요청: 상품 편집에서 이미지를 올릴 수 있고, 기존에 올린 이미지에서 고를 수도 있으며, 올린 이미지를 폴더로 관리한다. 매 상품마다 올리면 storage 부담이 크고 중복 이미지도 많으므로 중복 업로드를 줄이는 방법과 더 나은 방법을 제안한다.

## 1. 요청 분석

**사실(근거)**
- `market_items.thumbnail_url`(text)은 삭제되지 않은 146개 상품 **전부 NULL**이다. 이미지 전용 테이블·버킷은 없다. 관리자 상품 편집(`market-products-client.tsx:2064`)은 URL 텍스트 입력 하나뿐이고 API는 `items/route.ts:16`, `items/[id]/route.ts:23`의 zod `thumbnailUrl`이다.
- `thumbnail_url`을 DB에서 읽는 위치를 `grep -rn "thumbnail_url\|thumbnailUrl" src`로 전수 확인했다(4-1절에 파일:라인으로 확정). 서버 쪽 읽기 5곳(`market-search-server`, `market-board-server`, `market-categories-server`, `market-home-server` 2곳)과 보관함(`market-items-server`)에 더해 **preview 상세 `market-material-detail.tsx:176-179`가 `item.thumbnail_url`을 직접 렌더**한다(`getPublishedMarketItemById`의 `select('*')` 결과). 나머지 `<img>`·카드·슬라이더는 DTO의 `thumbnailUrl`만 받아 쓴다. 모두 값이 있으면 `<img>`, 없으면 점선 박스다.
- **상품 144/146개가 카테고리 항목 2개에 몰려 있다**(`수능특강 문학 변형문제` 80개, `독서 변형문제` 64개, 그룹 `EBS`). `market_items.category_item_id → market_category_items`(32개, `group_id → market_category_groups` 5개)이고 상품 편집 폼에 이미 이 선택(`categoryItemId`)과 관리 화면(`/admin/market-categories`)이 있다.
- 업로드 선례: 사이트 로고 `POST /api/admin/site-logo`는 `runtime='nodejs'`, 관리자 확인(`profiles.is_admin`) → `formData` → **`sharp`(0.34.5, 이미 의존성)** 로 검증·정규화(`limitInputPixels 25_000_000`, 애니메이션 거부, `rotate()`) → 서비스 롤로 **공개 버킷 `main-ad-images`**(10MB, jpeg/png/webp)에 `upsert:false`로 저장 → 실패 시 업로드 정리. 샘플 페이지 원본 업로드(`sample-pages/source`)는 `createSignedUploadUrl`(클라이언트 직접 업로드)을 쓰는데, 그 방식은 서버가 이미지를 가공하지 못해 리사이즈에 맞지 않는다.
- 버킷은 `main-ad-images`(공개)와 `market-files`(비공개, 판매 파일)뿐이다. 신규 테이블 RLS 패턴은 `is_admin()` 정책(`market_items`·`market_item_sample_pages` 등 `ALL` to `authenticated`)이다.
- 관리자 사이드바는 `src/lib/admin-sidebar.ts`의 `문제마켓 상품 관리` 옆에 항목을 추가하는 구조다. 상품 목록에는 이미 다중 선택(일괄 삭제)이 있다.

**결정(기본안, 제안은 5절)**
- D1 **이미지 엔티티 + FK(제안 C)**: URL 문자열 대신 `market_images`를 참조한다. 사용 중 이미지 삭제를 DB가 막고, 사용처 수를 센다.
- D2 **폴더는 논리 구조(DB)만**: storage 경로는 폴더와 무관하게 내용 해시로 정해, 폴더 이름 변경·이동·삭제가 storage 복사 없이 DB 갱신뿐이다.
- D3 **업로드는 서버 경유 + 서버 `sharp` 정규화(제안 B)**: 긴 변 800px 이하, WebP, 메타데이터 제거. 원본은 저장하지 않는다. 입력 한도는 4MB(배포 환경의 요청 본문 한도 확인 필요, 8절).
- D4 **중복 제거 기준(제안 A, 해시 기준 통일)**: 권위 키는 서버가 만든 **정규화 결과(WebP 바이트)의 SHA-256 `content_sha256`**(unique, 저장 경로의 파일명)이고, 사전 확인용으로 **서버가 받은 바이트의 SHA-256 `source_sha256`**(비유니크 인덱스)를 함께 저장한다. 클라이언트는 **실제로 보낼 바이트**(4MB 초과라 선축소했다면 축소본)의 SHA-256을 `crypto.subtle`로 계산해 `check`에 보내므로 서버의 `source_sha256`과 같은 기준이다. 서버는 받은 바이트로 `source_sha256`을 다시 계산하고, 일치 행이 없으면 정규화 후 `content_sha256`으로 한 번 더 찾아 있으면 새 저장 없이 기존 행을 재사용한다(`duplicated:true`). **결정성**: 같은 입력·같은 `sharp` 버전(0.34.5 고정)·고정 파라미터면 같은 WebP가 나온다. `sharp`를 올리면 같은 원본도 다른 바이트가 될 수 있어 그 뒤 재업로드는 중복 저장될 수 있고(드묾), 브라우저별 canvas 축소(4MB 초과 파일)도 비결정적이라 같은 큰 파일을 다른 브라우저에서 올리면 중복될 수 있다. 이는 수용하고 유사 이미지 경고(G8)로 후속 대응한다.
- D5 **공개 버킷 `market-images` 신설(제안 D)**: 이미지는 원래 공개 정보라 서명 URL 없이 공개 URL + 1년 캐시(경로가 해시라 불변). 쓰기·삭제는 관리자 API(서비스 롤)로만 한다. 기존 `main-ad-images` 재사용은 정책 혼재(광고·로고)라 새 버킷을 권장한다(사용자 결정 Q8).
- D6 **표시 우선순위(사용자 결정 반영)**: ① 상품 `thumbnail_image_id` → ② 카테고리 항목 기본 이미지(제안 E) → ③ 점선 박스. **`thumbnail_url`은 더 이상 읽지 않는다.** 근거(단순성): 입력 칸을 없애면 쓸 방법이 없고 현재 값이 전부 NULL이라 읽기 경로가 죽은 코드가 된다. 남겨 읽어도 손해는 없지만 우선순위 규칙·select 컬럼·테스트가 한 단계씩 늘고, 컬럼은 DB에 남아 있어 필요하면 한 줄로 되살릴 수 있다. 읽기 5곳·보관함과 **preview 상세 경로(`getPublishedMarketItemById` + `market-material-detail.tsx`)**는 PostgREST 임베드(`thumbnail_image:market_images(storage_path)`, `category_item:market_category_items(default_image:market_images(storage_path))`) 한 번의 select로 받고 공용 순수 함수 `pickMarketThumbnailUrl`(2단계)로 URL을 만든다. select 문자열의 `thumbnail_url`과 `normalizeText(item.thumbnail_url)` 같은 매핑은 제거한다(추가 쿼리 0, N+1 없음).
- D7 **`thumbnail_url` 컬럼은 DB에 남기고 코드에서는 쓰지 않는다**(사용자 결정). 상품 편집의 URL 입력 칸은 **제거**하고 업로드·선택으로 대체한다(`외부 URL(고급)`도 두지 않는다). **API zod의 `thumbnailUrl`은 `items/route.ts:16`·`items/[id]/route.ts:23`에서 삭제하고** `thumbnailImageId`로 대체하며, `market-items-server`의 생성·수정 함수(1879·1958행)도 `thumbnail_url`을 쓰지 않는다(수정 시 컬럼을 건드리지 않아 기존 NULL 유지). zod 객체는 알 수 없는 키를 제거하므로 옛 클라이언트가 `thumbnailUrl`을 보내도 오류 없이 무시된다. 컬럼 삭제는 후속으로 제안만 한다.

## 2. 데이터 모델 초안(`apply_migration` 개별 적용, `db push` 금지)
- 버킷 `market-images`: `public=true`, `file_size_limit` 2MB, `allowed_mime_types=['image/webp']`. `storage.objects`에 anon/authenticated 쓰기 정책을 만들지 않는다.
- `market_image_folders`: `id uuid pk`, `name text not null`(trim 1~60, `unique (lower(name))`), `sort_order int`, `created_at/updated_at`, `created_by uuid`. **1단계 폴더**(중첩 없음, Q1). **권한(아래 `권한 규칙` 참조)**.
- `market_images`: `id uuid pk`, `folder_id uuid null references market_image_folders on delete restrict`(**이미지가 있는 폴더는 DB가 삭제를 막는다**, Q2 결정. `folder_id` NULL은 '미분류'), `display_name text not null`(원본 파일명 기반, 수정 가능), `storage_path text not null unique`(`thumbnails/<content_sha256 앞 2자>/<content_sha256>.webp`), `content_sha256 text not null unique`(`^[0-9a-f]{64}$` check), `source_sha256 text not null`(같은 check, 비유니크, 사전 확인용 인덱스), `width/height/bytes int > 0`, `mime_type text = 'image/webp'`, `created_by`, `created_at`. 인덱스 `(folder_id, created_at desc)`. **권한(아래 `권한 규칙` 참조)**. 사용자 읽기 정책은 만들지 않는다(표시는 서버가 서비스 롤로 읽어 공개 URL만 내려준다).
- FK 컬럼(2번째 migration): `market_items.thumbnail_image_id uuid null references market_images on delete restrict`, `market_category_items.default_image_id uuid null references market_images on delete restrict`, 각 부분 인덱스. `src/types/supabase.ts`는 `generate_typescript_types`로 갱신한다.
- **권한 규칙(R2 B1 반영, 장바구니 migration `20260930020304`의 `revoke … from public, anon, authenticated` + `grant … service_role` 패턴과 동일)**. 이 환경은 새 테이블에 기본으로 `anon`·`authenticated`에 전 권한이 붙는다(`market_item_sample_pages`의 `relacl`에 `anon=arwdDxtm`, `authenticated=arwdDxtm`이 있음을 SELECT로 확인).
  - **신규 테이블 2개**(`market_image_folders`, `market_images`): 생성 직후 `alter table … enable row level security;` + `revoke all on table public.<t> from public, anon, authenticated;`(직접 권한을 주지 않으므로 `authenticated`에 `grant`도 없다). 모든 읽기·쓰기는 관리자 API가 서비스 롤(`createAdminClient`)로만 한다. 정책은 만들지 않는다(RLS 켠 채 정책 없음 = 서비스 롤 외 전부 거부, 권한 revoke와 이중 방어). 앞서 쓴 `is_admin()` ALL 정책은 직접 접근을 허용하지 않기로 했으므로 **폐기**한다.
  - **RPC `public.delete_market_image(p_image_id uuid) returns jsonb`**: `language plpgsql`, **`volatile`**, **`security definer`**, **`set search_path = public, pg_temp`**, 본문의 모든 객체를 스키마를 붙여(`public.market_images`, `public.market_items`, `public.market_category_items`) 참조한다. 정의 직후 `revoke all on function public.delete_market_image(uuid) from public, anon, authenticated;` + `grant execute on function public.delete_market_image(uuid) to service_role;`. Postgres 함수는 기본으로 PUBLIC에 EXECUTE가 열려 있어 이 revoke가 없으면 일반 사용자가 PostgREST로 직접 호출해 이미지를 지우거나 상품 참조를 NULL로 만들 수 있다.
- 적용 전 객체 체크리스트(테이블·정책·버킷·제약·함수·ACL)를 쓰고 적용 후 대조해 부분 적용 흔적이 없는지 확인한다(v4 방식).

## 3. 관리자 UI 흐름
- **라이브러리 화면** `/admin/market/images`(사이드바 `문제마켓 이미지 관리`, `문제마켓 상품 관리` 아래): 왼쪽 폴더 목록(`전체`·`미분류`·폴더들, 개수, `새 폴더`, 이름 변경, 삭제=비어 있을 때만 가능, 이미지가 남아 있으면 버튼을 비활성으로 두고 `이미지 N장이 남아 있어 삭제할 수 없습니다. 이미지를 이동하거나 삭제한 뒤 다시 시도하세요.`를 보여 준다), 오른쪽 이미지 그리드(썸네일·이름·용량·사용처 수 배지, 검색, 정렬, 다중 선택 → `폴더로 이동`·`삭제`), 상단 업로드 영역(여러 장 드롭·붙여넣기·`파일 선택`), 상단에 `총 N장 · 용량` 표시(제안 G). 이미지 클릭 → 우측 패널(이름 수정, 폴더, 사용처 목록, 삭제 — 사용 중이면 비활성 + 사유).
- **공용 컴포넌트** `MarketImageLibrary`(모드 `manage`/`select`)와 `MarketImagePicker`(Dialog로 `select` 모드). 소비처는 라이브러리 화면·상품 편집·카테고리 항목 편집·일괄 지정으로 2곳 이상이다. 선택 모드의 `새로 업로드`는 현재 폴더(기본: 마지막 사용 폴더, 없으면 미분류)에 올리고 올린 즉시 선택한다. 업로드 중 같은 해시가 있으면 `이미 등록된 이미지를 재사용했습니다`로 안내한다.
- **상품 편집**: `썸네일 URL` 입력 칸을 **제거**하고 `현재 이미지 미리보기 + [이미지 선택][새로 업로드][제거]`로 대체한다(폼 상태의 `thumbnailUrl`도 `thumbnailImageId`로 바꾼다). **카테고리 항목 편집**(`/admin/market-categories`)에 `기본 이미지` 지정을 추가한다(제안 E). **상품 목록**의 다중 선택에 `이미지 일괄 지정`을 추가한다(제안 F).

## 4. API(모두 관리자 전용, `runtime='nodejs'`, 관리자 확인은 라우트의 `requireAdminUser` 로컬 함수 패턴 — 신규 이미지·폴더 라우트는 `src/lib/market-images-server.ts`의 공용 `requireMarketImageAdmin`을 쓰고 비로그인 401·비관리자 403)
| 메서드·경로 | 동작 |
|---|---|
| `GET /api/admin/market/images?folderId&q&sort&cursor` | 목록 + `publicUrl` + `usageCount`(**삭제되지 않은** 상품 수 + 카테고리 항목 수, 삭제 차단 기준과 동일) |
| `POST /api/admin/market/images/check` `{hashes[]}` | `source_sha256`(클라이언트가 보낼 바이트의 해시) 또는 `content_sha256`이 일치하는 이미지 id 반환(업로드 생략용) |
| `POST /api/admin/market/images` multipart `files[]`, `folderId?` | sharp 검증·정규화 → `source_sha256`/`content_sha256` 조회(D4) → storage `upsert:false` → DB insert. 응답 항목별 `{image, duplicated}`. storage 성공 + DB 실패 시 객체 정리, unique 충돌은 기존 행 반환 |
| `PATCH /api/admin/market/images/[id]`, `POST …/images/move` | 이름 변경, 폴더 이동(단건·다건) |
| `DELETE /api/admin/market/images/[id]` | RPC `delete_market_image(id)`가 한 트랜잭션에서 처리: **사용 중 = 삭제되지 않은 상품(`deleted_at is null`)의 `thumbnail_image_id` + 카테고리 항목의 `default_image_id`**. 있으면 409 `IN_USE`(사용처 목록), 없으면 **삭제된 상품의 참조를 NULL로 비우고** 이미지 행을 삭제한 뒤 storage를 지운다(FK `restrict`는 행이 있는 한 막으므로 소프트 삭제 상품이 영구 사용 중이 되는 것을 이 RPC가 방지). RPC 실행 중 **FK 위반(`23503`)이 나면**(확인과 삭제 사이에 다른 관리자가 이미지를 지정한 경합) API가 이를 409 `IN_USE`로 변환하고 사용처를 다시 조회해 돌려준다. 호출은 서비스 롤로만 가능 |
| `GET·POST /api/admin/market/image-folders`, `PATCH·DELETE …/[id]` | 폴더 CRUD(이름 중복 409). `DELETE`는 이미지가 있으면 409 `FOLDER_NOT_EMPTY`와 `imageCount`를 반환하고(DB `restrict`가 경합도 막음), 비어 있을 때만 삭제 |
| 기존 `items`·`items/[id]` | zod의 `thumbnailUrl`을 삭제하고 `thumbnailImageId`(uuid\|null) 추가. 신규 `POST …/items/thumbnail` `{itemIds, imageId\|null}` 일괄 지정 |
| 기존 `market-categories/items` | `defaultImageId`(uuid\|null) 추가 |
변경 후 목록 캐시가 있는 공개 경로는 `revalidatePath`/태그로 갱신한다.

## 4-1. 표시·쓰기 대상 확정 목록(`grep -rn "thumbnail_url\|thumbnailUrl" src` 전수, 2026-10-02)
- **DB 읽기·매핑 → 임베드 select + `pickMarketThumbnailUrl`로 전환(`thumbnail_url` 제거)**: `src/lib/market-search-server.ts:76,136` · `src/lib/market-board-server.ts:44,81,349` · `src/lib/market-categories-server.ts:190,272` · `src/lib/market-home-server.ts:29,113,189,238` · `src/lib/market-items-server.ts:2817`(보관함) · **`src/lib/market-items-server.ts`의 `getPublishedMarketItemById`(약 1372행 `select('*')`)에 임베드를 더해 `thumbnailUrl`을 붙이고, `src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx:176,179`는 `item.thumbnail_url` 대신 `item.thumbnailUrl`을 렌더**(B1).
- **쓰기 제거·대체**: `src/lib/market-items-server.ts:1861,1879,1918,1958` · `src/app/api/admin/market/items/route.ts:16,131` · `src/app/api/admin/market/items/[id]/route.ts:23,150`(`thumbnailUrl` → `thumbnailImageId`).
- **관리자 화면**: `src/app/(admin)/admin/market/products/market-products-client.tsx:79,149,175,756,905,2064`(폼 상태·URL 입력 칸 제거, 이미지 선택으로 대체. 175·756행은 관리자 목록 API 응답을 읽으므로 응답에 `thumbnailImage {id, publicUrl}`를 포함).
- **DTO 값만 전달(무변경)**: `market-material-list.tsx:13,23,27` · `home/popular-downloads-slider.tsx:31` · `home/home-material-sections.tsx:101` · `board/real-market-board-results.tsx:151` · `src/components/market/market-item-list-row.tsx:20,23` · `market-item-card.tsx:24,27` · `(solvook)/library/_components/library-view.tsx:557` · DTO 타입 `market-board.ts:56`, `market-home.ts:66`, `market-search-server.ts:26`, `market-items-server.ts:87`.
- 변경 후 `thumbnail_url` 문자열은 `src/types/supabase.ts`(생성 타입)에만 남아야 한다.

## 5. 제안 A~G 비교(기본안 포함 여부는 사용자 결정)
| 제안 | 장점 | 비용·위험 | 권장 |
|---|---|---|---|
| A 해시 중복 제거 | 같은 파일 재업로드 0, storage·네트워크 절약, 요구한 '중복 방지'를 자동 보장 | 클라이언트 해시 + 서버 재계산, 포맷이 다른 같은 그림은 못 잡음(G8) | **포함(결정됨)** |
| B 업로드 리사이즈·WebP | 장당 수십 KB로 감소(원본 1~2MB 대비 약 95% 감소, 추정). `sharp` 이미 사용 중 | 원본 미보관(되돌릴 수 없음), 서버 CPU, 요청 본문 한도 | **포함(결정됨), 서버 처리**(클라이언트 canvas는 4MB 초과 파일을 줄이는 보조로만) |
| C 이미지 엔티티 + FK | 사용 중 삭제 방지, 사용처 수, 고아 정리, 폴더·메타 관리의 전제 | migration 2개, 읽기 5곳 select 변경(임베드), 타입 갱신 | **포함(결정됨, 필수 기반)** |
| D 공개 버킷 + 캐시 | 서명 URL·API 왕복 없음, CDN 캐시 효율, 구현 단순 | 공개 URL 노출(상품 이미지라 허용), 새 버킷 | **포함(결정됨, 필수 기반)** |
| E 카테고리 항목 기본 이미지 상속 | 현재 데이터로 **144개 상품이 이미지 2장으로 커버**되어 업로드 자체가 줄어듦 | 상품 이미지와 우선순위 규칙 필요, 카테고리 편집 UI 확장 | **포함(결정됨, 효과가 가장 큼)** |
| F 일괄 지정 | 시리즈 전체에 한 번에 지정, 기존 다중 선택 재사용 | 실수로 덮어쓰기 → 확인 Dialog와 건수 표시 필요 | **포함(결정됨)** |
| G1 총 용량·장수 표시 | storage 부담을 눈으로 확인 | 집계 쿼리 1개 | 포함 |
| G8 유사 이미지 경고(지각 해시) | 다른 포맷·재저장된 같은 그림도 경고 | `sharp`로 9×8 그레이 dHash 계산, 오탐 가능, 차단 아닌 경고만 | 보류(결정됨) |
| G5 드래그앤드롭·붙여넣기, G4 마지막 폴더 기억 | 작업 속도 | UI 코드만 증가 | 포함(저비용) |
| G6 크롭 도구 | 비율 통일 | UI 복잡, 표시가 `object-contain`이라 불필요 | 비권장 |

## 6. 단계별 작업과 검증(각 단계 독립 검증 후 진행)
- **M1 migration 1**(버킷·폴더·이미지): 검증 SQL — `select rowsecurity from pg_tables`(둘 다 true), `pg_policies`에 두 테이블 정책 0건, `has_table_privilege('anon'|'authenticated','public.market_images'|'public.market_image_folders','select')`·`insert`·`update`·`delete`가 모두 false이고 `service_role`은 true(`relacl`에 `anon`·`authenticated` 없음), `storage.buckets`(public, 2MB, webp), `pg_get_constraintdef`(`content_sha256` unique·check, `source_sha256` 비유니크 인덱스), 재실행 안전, `supabase/tests/market_images.test.sql`(begin…rollback: 해시 중복 거부, 이미지가 있는 폴더 삭제 거부(restrict), 빈 폴더 삭제 성공, 일반 사용자(`set local role authenticated`) 직접 select·insert 거부).
- **M2 migration 2**(FK 컬럼 + `delete_market_image` RPC) + 타입 갱신: `select prosecdef, proconfig, provolatile from pg_proc where proname='delete_market_image'` → `t`, `{search_path=public, pg_temp}`, `v` · `has_function_privilege('anon', 'public.delete_market_image(uuid)', 'execute')=false`, `authenticated`도 false, `service_role`은 true(`pg_proc.proacl`에 `=X`(PUBLIC) 항목 없음) · `set local role authenticated`로 RPC를 호출하면 `permission denied` · 삭제된 상품만 참조하는 이미지는 RPC로 삭제되고(참조 NULL 처리), 삭제되지 않은 상품·카테고리 항목이 참조하면 `IN_USE`를 반환하는지 `begin…rollback` SQL로 확인, `thumbnail_image_id` 가진 이미지 삭제가 FK로 거부되는지 SQL, `npx tsc --noEmit` exit 0.
- **S3 서버 라이브러리·API**: `src/lib/market-images*.ts`(정규화·해시·경로·`pickMarketThumbnailUrl`)와 위 API. 검증 — `node --test tests/market-images-*.test.mjs`, 비로그인/비관리자 401/403(curl), 같은 파일 2회 업로드 시 두 번째 `duplicated:true`이고 `select count(*)` 불변, 4MB 초과 파일을 클라이언트가 축소해 올린 뒤 같은 축소본 재업로드도 `check`가 일치, 사용 중 삭제 409.
- **S4 라이브러리 화면·Picker**: 검증 — 브라우저(폴더 생성·이름 변경·삭제, 다건 업로드, 이동, 검색, 320/1280px, 키보드 조작, 44px).
- **S5 상품 편집·카테고리·일괄 지정 연결**: 검증 — 브라우저(상품에서 업로드 → 즉시 선택, 기존 이미지 선택, 제거, URL 입력 칸이 없음, 폴더 삭제 시 이미지가 남은 폴더는 막히고 남은 수를 안내, 카테고리 기본 이미지, 일괄 지정 확인 Dialog).
- **S6 표시 경로 전환**: 4-1절 목록의 DB 읽기 6곳(검색·보드·카테고리·홈 2곳·보관함)과 **preview 상세(`getPublishedMarketItemById` + `market-material-detail.tsx`)**, 관리자 쓰기·화면(`thumbnail_url` 제거). 검증 — 상품 이미지 > 카테고리 기본 > 점선 박스 우선순위를 SQL 세팅 후 홈·카테고리·검색·**preview 상세(`/preview/solvook-concept/boards/<slug>/items/<id>`)**·보관함에서 확인, `grep -rn "thumbnail_url" src`가 `src/types/supabase.ts`만 출력, 이미지 URL이 `market-images` 공개 URL이며 200(`curl -I`), 쿼리 수 증가 없음.
- **S7 통합**: `npm run lint`·`npm run build`·`node --test` 새 실패 0, `select count(*), sum(bytes), avg(bytes) from market_images`로 용량 확인, 사용자 기존 변경 보존.

## 7. 테스트
- 단위(`node --test`): `normalizeMarketImage`(큰 PNG→긴 변 ≤800 WebP, EXIF 회전 적용, 애니메이션·2,500만 픽셀 초과·비이미지 거부, 같은 입력 두 번 → 같은 `content_sha256`/경로, 같은 PNG를 다른 파일명으로 올려도 같은 `content_sha256`), `pickMarketThumbnailUrl` 우선순위 2단계(상품 이미지 → 카테고리 기본 → null, `thumbnail_url`이 있어도 무시).
- 계약(소스): 각 이미지·폴더 라우트 파일이 관리자 확인을 호출하고(로컬 `requireAdminUser` 패턴 또는 공용 `requireMarketImageAdmin`; 공용 함수 본문에 `is_admin` 확인과 401·403 분기가 있음) `runtime='nodejs'`, 업로드가 `upsert:false`와 실패 시 정리, 삭제가 `delete_market_image` RPC를 호출하고 `IN_USE` 409(삭제되지 않은 상품·카테고리 항목 기준), 마이그레이션에 두 신규 테이블의 `enable row level security`와 `revoke all on table … from public, anon, authenticated`, 이미지·폴더 정책 없음, FK `restrict`, `delete_market_image`의 `security definer`·`set search_path = public, pg_temp`·`volatile`·스키마 접두사 사용·`revoke all on function … from public, anon, authenticated`·`grant execute … to service_role`(장바구니 RPC 계약 테스트와 같은 방식), 삭제 라우트가 `23503`을 409 `IN_USE`로 변환, 읽기 서버 5곳·보관함·`getPublishedMarketItemById`가 임베드 select + `pickMarketThumbnailUrl`을 쓰고 `market-material-detail.tsx`가 `item.thumbnail_url`이 아니라 `item.thumbnailUrl`을 렌더하며, **`src/` 아래 모든 `.ts`·`.tsx`(생성 타입 `src/types/supabase.ts` 제외)에 `thumbnail_url` 문자열이 0건**(전수 검사), 두 `items` 라우트 zod에 `thumbnailUrl`이 없고 `thumbnailImageId`가 있음, 상품 편집 폼에 `thumbnailUrl` 입력이 없음, 폴더 삭제 API가 `FOLDER_NOT_EMPTY` 409와 `imageCount`를 반환하고 이미지 FK가 `on delete restrict`, `main-ad-images`·`market-files` 미사용, 컴포넌트에 raw hex·임의 radius 없음.
- DB 테스트(`supabase/tests/market_images.test.sql`)와 브라우저 절차(6절 S3~S6).

## 8. 위험
| 위험 | 대응 |
|---|---|
| 배포 환경(Vercel로 추정)의 요청 본문 한도(약 4.5MB)로 큰 파일 업로드 실패 | 입력 4MB 제한과 오류 문구, 큰 파일은 클라이언트 canvas로 선축소(배포 환경 확인 필요) |
| 원본 미보관 후 더 큰 해상도가 필요해진다 | 800px는 현재 최대 표시(약 130×92 CSS px, 2x)의 3배 이상. 필요 시 변환 규칙만 바꿔 재업로드 |
| storage 업로드 성공 후 DB 실패로 고아 객체 | 실패 시 즉시 삭제, 경로가 해시라 재시도는 멱등, 정기 정합성 점검 쿼리를 후속 제안 |
| 읽기 경로(서버 5곳·보관함·preview 상세) select 변경 중 회귀 또는 누락 | 4-1절 확정 목록 + `thumbnail_url` 0건 전수 테스트, 단계 S6에서 곳별 검증, 임베드 결과가 null이어도 점선 박스로 동작하도록 순수 함수가 null을 허용 |
| 옛 화면 캐시가 `thumbnailUrl`을 계속 보낸다 | zod가 알 수 없는 키를 제거하므로 무시되고 오류 없음. S5에서 확인 |
| RPC·테이블이 일반 사용자에게 열려 이미지가 삭제·변조된다 | 위 `권한 규칙`(revoke + service_role grant + RLS), M1·M2 검증의 `has_*_privilege`·`set local role authenticated` 거부 확인 |
| 삭제 확인과 RPC 사이에 다른 관리자가 이미지를 지정한다 | FK `restrict`가 최후 방어, `23503`을 409 `IN_USE`로 변환 |
| 소프트 삭제된 상품의 참조 때문에 이미지가 영구 사용 중이 된다 | 삭제 기준에서 삭제된 상품을 제외하고 RPC가 그 참조를 NULL로 비운다(N2) |
| 같은 큰 파일(4MB 초과)을 다른 브라우저에서 올리면 축소본이 달라 중복된다 | 서버 `content_sha256`이 2차 방어. 남는 경우는 G8로 후속 대응 |
| 폴더 정리가 번거롭다(이미지가 있으면 삭제 불가) | 남은 이미지 수 안내와 다건 이동·삭제 기능으로 완화 |
| 일괄 지정·카테고리 기본 이미지로 의도치 않게 덮어씀 | 확인 Dialog(대상 건수·미리보기), 상품 이미지가 항상 우선 |
| 같은 해시 동시 업로드 경합 | unique 충돌 시 기존 행 반환, storage `upsert:false` 충돌은 성공으로 취급 |
| 공개 버킷 노출 | 상품 이미지는 공개 정보, 업로드·삭제는 관리자 API만 |

## 9. 사용자 결정 항목(모두 결정됨, 2026-10-02)
- Q1 폴더는 **1단계**(결정됨). Q2 이미지가 있는 폴더는 **비어 있을 때만 삭제**, 남은 이미지 수 안내(결정됨, 권장안과 다름 — DB `restrict`·API 409·UI 반영 완료).
- Q3 800px·WebP·원본 미보관(결정됨). Q4 카테고리 **항목** 수준만, 그룹 수준 없음(결정됨). Q5 상품 편집 URL 입력 칸 **제거**, `thumbnail_url` 컬럼은 DB에 남기고 코드에서는 읽지 않음, zod `thumbnailUrl` 삭제(결정됨).
- Q6 일괄 지정 포함(결정됨). Q7 유사 이미지 경고 보류(결정됨). Q8 새 공개 버킷 `market-images`(결정됨). Q9 `/admin/market/images`(결정됨). Q10 모든 관리자가 미사용 이미지를 삭제할 수 있고 사용 중 이미지는 항상 삭제 차단(결정됨).
- 업로드 입력은 4MB를 넘지 않게 하고(배포 환경 Vercel 4.5MB 추정) 큰 파일은 클라이언트에서 먼저 축소한다(8절 위험 대응 유지).

## 10. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 계획 초안(95줄)·결정 반영 확정본(101줄) | 독립 검증(팀 리드 전달) | **FAIL** → 보완 | B1 preview 상세(`market-material-detail.tsx:176-179`) 누락 + `grep` 전수 대상 목록 미확정. N1 해시 기준 불일치, N2 소프트 삭제 상품 참조, N3 관리자 확인 패턴 문구 |
| R2 | R1 보완본(111줄) | 독립 검증(팀 리드 전달) | **FAIL** → 보완 | B1: `delete_market_image` RPC에 PUBLIC EXECUTE 기본 개방 방지 규칙(security definer·search_path·스키마 접두사·VOLATILE·revoke·grant service_role)과 신규 테이블 revoke 누락. N1: `23503`→409 `IN_USE` 미명시. (대상이었던 R1 보완 내용: | B1: 4-1절에 파일:라인 확정 목록, D6·S6·계약 테스트(`thumbnail_url` 0건 전수)에 preview 상세 추가. N1: D4를 `content_sha256`(권위·정규화 결과) + `source_sha256`(서버가 받은 바이트, 사전 확인) 이중 키로 정리, 결정성 판단. N2: 사용 중 = 삭제되지 않은 상품 + 카테고리 항목, `delete_market_image` RPC가 삭제된 상품 참조를 비움. N3: 로컬 `requireAdminUser` 패턴·공용 `requireMarketImageAdmin`에 맞춘 계약 문구) |
| 사용자 결정 | A·B·C·D·E·F 포함, Q1~Q10 확정(2026-10-02) | 사용자(팀 리드 전달) | 반영 | Q2 비어 있을 때만 폴더 삭제(권장안과 다름: `on delete restrict`·`FOLDER_NOT_EMPTY` 409·UI 안내), Q5 URL 입력 칸 제거·`thumbnail_url`은 DB에만 남기고 읽지 않음(단순성)·zod `thumbnailUrl` 삭제, 나머지 미질문 항목은 권장안으로 확정 |
| R2 보완 | 이 문서 수정본 | (재검증 대기) | | B1: 2절 `권한 규칙`(테이블 2개 enable RLS + revoke all from public, anon, authenticated, 정책 없음, RPC 규칙 6가지), M1·M2 검증에 `has_table_privilege`·`has_function_privilege`·`proacl`·`set local role authenticated`, 계약 테스트·위험 표 반영. N1: 삭제 API가 RPC 중 `23503`을 409 `IN_USE`로 변환 |
| R3 | R2 보완본(117줄, sha256 a6b1194f…) | 독립 검증(팀 리드 전달) | **OK** | R2 B1·N1 반영 확인 |
| 적용 M1 | `20261002014044_market_image_library`(로컬 `20261002100000`에서 이름 변경) | 팀 리드(사용자 승인 "승인, 적용") | 적용·확인 | history 98, 버킷 public·2MB·webp, RLS 2/2, 정책 0, relacl postgres·service_role만, 제약 7·인덱스 3·트리거 1 |
| 적용 M2 | `20261002014653_market_image_refs`(로컬 `20261002101000`에서 이름 변경) | 팀 리드 | 적용·확인 | history 99, FK 2개 restrict, 부분 인덱스 2, RPC prosecdef·volatile·search_path·proacl(postgres·service_role), `market_images.test.sql` 원격 실행(단일 트랜잭션 + sentinel 예외로 rollback) 전부 통과·fixture 잔존 0, 타입 재생성(+116줄)·tsc exit 0 |
| 적용 후 검증 | M1·M2 원격 스키마·권한·RPC 동작·advisor | 독립 검증(imglib-db-verifier) | **OK** | 이력·파일명 일치, 스키마=로컬 SQL, RPC 본문 동일, 동작 확인 rollback, 신규 advisor는 의도된 `rls_enabled_no_policy` INFO 2건 |
| S3 | 서버 라이브러리·관리자 이미지/폴더 API·테스트 | 독립 리뷰(imglib-s3-reviewer) | **OK**(R1 MINOR 4 반영 후 재검증 OK) | 이동 200건 상한(`.in()` URL 한도 실측), storage 삭제 전 `storage_path` 재확인 헬퍼, 요청당 20장·`maxDuration=60`, 정규화 비입력 오류 로그, 테스트 33/33·전체 실패 41건 기존과 동일 |
| S4 | 라이브러리 화면·`MarketImageLibrary`·`MarketImagePicker`·사이드바 | 독립 리뷰(imglib-s3-reviewer) | **OK**(R1 MINOR 6 + NIT 반영, R2 NIT 3 반영 후 최종 OK) | 붙여넣기 가드(입력·대화상자·표 HTML만 제외), 네트워크 오류 결과 반환·항상 새로고침, 검색·정렬 시 선택 해제, Safari WebP→JPEG 축소 대체, 상세 패널 xl 미만 스크롤·포커스 복귀, 업로드 흐름 `market-images-upload.ts` 분리·주입 fetch 테스트, 관련 테스트 66/66·전체 실패 41건 기존과 동일. 브라우저 확인은 사용자 몫. english 사이드바 저장 순서(`workspace_settings.admin_sidebar_navigation`)에는 새 항목이 끝에 붙음 — DB 수정은 권한 검사에서 거부되어 사용자 결정 대기 |
| S5 | 상품 편집·카테고리 기본 이미지·일괄 지정, items API `thumbnailImageId` | 독립 리뷰(imglib-s3-reviewer) | **OK**(R1 MINOR 4 + NIT 반영 후 재검증 OK) | 계획 대비 변경: 카테고리 항목 PATCH 본문 키는 같은 라우트 기존 키(`sort_order`·`is_active`)에 맞춰 `default_image_id`(snake_case). 미저장 초안 병합, 그룹 이미지 필드 제거, 미리보기 파생, 삭제된 폴더 업로드 미분류 재시도, 관련 테스트 82/82·전체 실패 41건 기존과 동일. 쓰기 후 공개 페이지 캐시 무효화는 S6에서 처리 |
