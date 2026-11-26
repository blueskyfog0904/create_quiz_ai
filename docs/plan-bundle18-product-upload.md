# 18번 묶음 계획 · 상품 업로드 개선

작성일: 2026-11-26
판: 3 (검증 PASS, 2026-11-26) — 1판은 나누기 FAIL(major 3)·DB FAIL(major 1), 2판은 나누기 FAIL(major 1)·DB PASS, 3판은 PASS(minor 5, 같은 판에서 반영 — 17절)였다. 반영은 15~17절 표, 고친 곳 끝에 `(2판)`·`(3판)`.
- 작업 순서표 18번: 상품 화면 코드 나누기(B-12) → 같은 구성으로 다음 상품·복제, 업로드 진행 표시, 카테고리 검색, 빠진 항목 바로가기
- 출처: `docs/admin-ux-improvement-plan.md` 4-1(단계 흐름 전/후), 5절 1차-라
  - B-12 코드 나누기, B-04 다음 상품·복제, B-05 이번에 등록한 상품, G-05 업로드 진행, B-08 카테고리 검색, B-10 빠진 항목 칩
- 앞 묶음: 17번(학년·자료유형 목록, 출처 칸, 이용 근거 카드)이 배포된 뒤 시작한다. 같은 화면 파일을 나누기 때문이다.
- 뒤 묶음: 19번(서브상품 순서, 전체구매 표시명, 구성·파일 유형 설정 창 옮기기)이 나눈 부품 위에 붙는다.
- 국어·영어 같은 구조: 상품 화면은 과목별 메뉴 하나를 같이 쓴다. 바뀌는 것은 두 과목 모두에 적용된다.

## 0. 대표 결정이 필요한 것(질문)
답이 오기 전에는 '기본안'으로 진행한다.

| # | 질문 | 기본안 | 이유 |
|---|---|---|---|
| Q1 | 코드 나누기를 기능과 같이 할까? | **따로 한다.** 0단계 시험 기준선 → 1단계 '옮기기만'(함수 본문을 고치지 않음) → 2단계부터 기능 (2판) | 3,705줄 파일을 옮기면서 동작을 바꾸면 검증이 불가능하다(B-12 '저장 순서·호출은 그대로') |
| Q2 | [같은 구성으로 다음 상품]이 복사하는 것 | **카테고리, 자료 정보(연도·월·학년·자료유형), 출처 1~4, 서브상품(구성·이름·설명·가격·순서·사용·구매 안내), 전체구매(사용·가격·표시명·설명)** | 같은 시리즈를 연달아 올리는 경우가 많다(4-1 '25번 넘게 반복') |
| | 복사하지 않는 것 | 제목, 요약·설명, 문항 수, 상품 이미지, **판매 파일·샘플**, **이용 근거** | 파일·샘플은 상품마다 다르다. 이용 근거는 원저작물마다 확인해야 한다(다른 안: 근거도 복사하고 '복사됨 — 확인 필요' 표시) |
| Q3 | [복제](목록)와 다른 점 | **복제는 제목('… (사본)')·요약·설명·문항 수·상품 이미지(`thumbnail_image_id`, 같은 라이브러리 이미지를 가리킴)까지 복사**, 파일·샘플·이용 근거는 복사하지 않음 (2판) | 거의 같은 상품을 고쳐 올릴 때 쓴다 |
| Q4 | 만든 상품의 상태 | **늘 임시저장**(`draft`, `draft_source = 'manual'`) | 파일이 없으면 공개할 수 없다(B-04 안전장치) |
| Q5 | 업로드 진행 표시 | **파일마다 대기·올리는 중(%)·완료·실패와 [다시 시도].** 한 번에 1개씩 차례로 | 지금은 "업로드 중입니다" 한 줄뿐이다(G-05). 동시에 올리면 실패 원인을 가리기 어렵다 |
| Q6 | 비활성 카테고리 칸을 고르면 | **공개 전 상품은 필수 항목(공개 막음), 이미 공개된 상품은 경고**(저장은 막지 않음) (2판) | 비활성 칸의 상품은 회원 메뉴에서 안 보인다(B-08). 필수로만 두면 칸을 끈 뒤 공개 상품의 오타 하나도 고칠 수 없다(공개 상품 저장 버튼이 `isPublishBlocked` 를 봄) |
| Q7 | 서버 공개 검사(B-02)를 함께 할까? | **이번 범위 밖**(별도 묶음, 동작 변경 검증) | 이 묶음은 복제를 늘 임시저장으로 만들어 공개 경로를 새로 열지 않는다. 화면 점검(빠진 항목 칩)만 바꾼다 |
| Q8 | 최근 카테고리 칩 | **브라우저 저장(관리자별, 과목별 3개)**, 저장이 안 되면 칩 없이 동작 | 개인 편의라 DB 에 두지 않는다 |

## 1. 지금 상태(코드 확인, 2026-11-26)
- **화면 파일** `src/app/(admin)/admin/market/products/market-products-client.tsx`(3,705줄) 하나에 다음이 모두 들어 있다.
  - 목록: 상태 탭·정렬·일괄 숨김·이미지·삭제
  - 편집: 기본 정보·카테고리 `CategoryStepSelect`(135~173행)·자료 정보
  - 서브상품 표와 파일 올리기(`handleSubproductFileUpload` 2129~2210행)
  - 전체구매, 샘플 생성(`renderSamplePdfPages` 357행, 단계 표시 2235~2244행)
  - 공개 전 점검 `publishChecks`(2246~2266행)
  - 구성·파일 유형 설정 창(`MANAGE_*_VALUE` 492~493행)
- **같이 도는 화면**
  - `new/page.tsx`(새 상품 주소)
  - `admin-market-sample-preview-dialog.tsx`, `storage-cleanup-notice.tsx`
- **파일 올리기**: 3단계다.
  1. `POST …/subproducts/{id}/files` `{step:'prepare'}` → 서명 업로드 주소
  2. `createBrowserSupabaseClient().storage.uploadToSignedUrl`(브라우저가 Storage 로 직접)
  3. `{step:'complete'}`
  - `uploadToSignedUrl` 은 진행률을 주지 않는다. 상한은 50MB(`src/lib/market-storage.ts:96-102`)이고, 화면에 미리 적혀 있지 않다.
- **임시 상품**: 카테고리를 고른 뒤 파일을 먼저 놓으면 `draft_source = 'auto_upload'` 임시 상품이 생긴다(1233~1251행). 버려진 것은 정리 route(`market-auto-upload-cleanup`)가 지운다.
- **공개 전 점검**: 화면만 막는다(서버 검사 없음, B-02 미구현).
  - 필수: 카테고리·제목·서브상품 1개·모든 서브상품 파일·전체구매 가격
  - 권장: 가격 0 없음·이미지·샘플
  - 맨 아래에 "필수 n개 남음"만 보이고, 눌러도 이동하지 않는다.
- **카테고리 고르기**: 단계마다 아래로 쌓이는 선택칸이다. 검색이 없고 비활성 칸도 고를 수 있다.
- **이 파일을 글자로 읽는 시험이 21개**다(`grep -l market-products-client tests/*`, 17번 뒤 다시 뽑음 — 5-0). 예: `market-admin-product-form-steps-contract`·`market-admin-subproduct-ui-contract`·`market-upload-cancel-ui-contract`·`admin-unsaved-draft-preservation-contract`·`security-quick-fixes-contract`
  - **지금도 2건이 실패한다**(1판 검증, `cbe27ee` 에서 pass 120·fail 2) (2판)
    - `admin-product-year-options-contract.test.mjs:45`: 옛 `pdfPrice` 입력칸 글자
    - `market-admin-subproduct-ui-contract.test.mjs:104`: 옛 `formData.append('fileTypeId', …)`. 지금은 서명 업로드 prepare 본문으로 보낸다
  - 위치·순서·들여쓰기에 기대어 잘라 읽는 시험이 6개, 잘라 읽는 곳이 8곳이다(5-3 표). (3판)
- **요청 본문을 만드는 함수**: `buildRequestBody`(1101~1121행)는 `form`·`categoryItemId`·`savedCategoryItemId` 를 품은 클로저다. `buildItemPatchBody`(934행)는 목록 상태 바꾸기에 쓰인다. 주소가 변수인 `fetch`(`filesUrl`·`deleteUrl`·`url`)와 fetch 가 아닌 `uploadToSignedUrl`(1609·2178행)도 있다. (2판)
- **상품 만들기** `createMarketItem`(`src/lib/market-items-server.ts:1780`)은 서버 키로 한 행씩 넣는다. 서브상품·전체구매는 별도 route 다.
- **localhost = 운영 DB**: 화면에서 저장·업로드·복제를 누르면 실제 상품과 파일이 생긴다.

## 2. 목표
1. 상품 화면 코드가 역할별 파일로 나뉘고, 나누기 전후 동작이 같다.
2. 공개·임시저장이 끝나면 [같은 구성으로 다음 상품] / [빈 새 상품] / [상세 페이지 보기]를 고른다. 아래에 '이번에 등록한 상품' 표가 남는다(이 창을 닫으면 사라짐).
3. 목록 행의 [복제]가 임시저장 사본을 만든다. 상품·서브상품·전체구매가 한 거래로 만들어지거나, 하나도 안 만들어진다.
4. 파일마다 진행률·완료·실패·[다시 시도]가 보인다. 상한(50MB)과 허용 형식은 놓기 전에 보인다.
5. 카테고리를 한 줄 검색칸에서 전체 경로로 찾는다. 최근 칩 3개, 비활성 칸 경고가 있다.
6. 빠진 항목이 고정 요약판에 칩으로 보이고, 누르면 그 입력칸으로 이동해 초점이 간다. 17번 이용 근거 미입력은 노란 경고 칩이다.

## 3. 범위
**넣는 것**: 코드 나누기, DB 함수 1개(복제), route 1개, 업로드 진행 모듈, 카테고리 검색 순수 함수, 공개 전 점검 순수 함수·칩, 시험.
**넣지 않는 것**
- 서버 공개 검사(B-02)·가격 0 막기(B-01)·일괄 상태 변경(C-06)
- 수정 화면 별도 주소(B-09)·저장 안 된 변경 경고(B-03)
- 파일명으로 제목 채우기(B-04 일부)
- 여러 상품 한 번에 올리기(4-4), 파일 교체(G-04)
- 서브상품 순서·전체구매 표시명(19번)

## 4. 원칙
- **나누기는 옮기기만**(Q1): 같은 요청(주소·메서드·본문 키·순서), 같은 문구, 같은 상태 전이. 바꾸고 싶은 것이 보여도 2단계로 미룬다.
- **규칙은 순수 함수로**: 공개 전 점검, 카테고리 검색, 업로드 상태 전이, 복사할 칸 목록을 `src/lib/` 순수 함수로 두고 단위 시험을 한다.
- **복제는 DB 한 거래**: 여러 route 를 차례로 부르면 중간 실패 때 반쪽 임시 상품이 남는다.
- **돈 경로를 건드리지 않는다**: 복제본은 임시저장이고 파일이 없어 살 수 없다. 결제·환불 함수는 바꾸지 않는다.
- **운영 DB 한 개**: 화면 시험은 미리보기로, 실제 쓰기 시험은 배포 뒤 대표 승인으로 시험 카테고리에서만 한다.

## 5. 시험 기준선과 코드 나누기(B-12)
### 5-0. 0단계: 시험 기준선(별도 커밋) (2판)
- 지금 실패하는 2건(1절)을 지금 코드에 맞게 고친다. 나누기 커밋과 섞지 않는다.
- **17번 배포 커밋에서 시험 집합을 다시 뽑는다**(`grep -l market-products-client tests/*`). 17번이 더한 시험(`bundle17-product-info-contract` 등)도 5-3 의 '도우미만'·'파일별 잘라 읽기' 가운데 하나로 나눠 표에 더한다. (3판)
- **기준 커밋 해시와 `test()` 수·통과 수를 이 절에 적는다.** 2판 검증 때 `467da68` 기준 `test()` 122개(통과 120·실패 2)다. 고친 뒤 기대는 122/122 이고, 17번 뒤 다시 센 수로 바꾼다. (3판)
- 이 기준선이 '나누기 전 전부 통과'의 기준이다.

### 5-1. 나눈 뒤 모양(가안, 구현 때 이름은 바뀔 수 있음)
```
src/app/(admin)/admin/market/products/
  market-products-client.tsx        # 목록 ↔ 편집 전환, 공유 상태, 목록 상태와 그 처리 함수(change*·toggleFilteredSelection·buildItemPatchBody — persistForm 이 목록 상태를 함께 써서 여기에 둠)(목표 700줄 안) (3판)
  _list/product-list.tsx            # 상태 탭·정렬·쪽·일괄 처리 바
  _editor/product-editor.tsx        # 단계 머리·<section id> 틀과 그 제목·저장 버튼·공개 전 점검 자리
  _editor/basic-info-section.tsx    # 제목·요약·설명·이미지
  _editor/category-step.tsx         # CategoryStepSelect
  _editor/material-info-section.tsx # 연도·월·학년·자료유형·문항 수·출처(17번)
  _editor/usage-basis-card.tsx      # 17번 이용 근거 카드
  _editor/subproduct-table.tsx      # 서브상품 행·파일 올리기(섹션 제목은 product-editor 에 둠)
  _editor/bundle-section.tsx        # 전체구매
  _editor/sample-section.tsx        # 샘플 생성·미리보기
  _settings/subproduct-category-settings-dialog.tsx
  _settings/file-type-settings-dialog.tsx
  _hooks/use-product-form.ts        # 폼 상태·불러오기·refreshEditingFiles·buildRequestBody·persistForm(클로저 그대로)
  _hooks/use-subproduct-uploads.ts
  _hooks/use-sample-generation.ts
  _lib/types.ts                     # 공용 타입·interface(MarketItemFormState·PersistFormOptions 등, PersistFormOptions 를 맨 앞에) (3판)
  _lib/product-form.ts              # buildEmptyForm·buildEditForm 등 지금 모듈 수준 함수 (3판: buildItemPatchBody 는 컴포넌트 안 지역 함수라 껍데기에 그대로)
  _lib/sample-render.ts             # canvasToJpegBlob·withTimeout·renderSamplePdfPages(지금 순서, renderSamplePdfPages 를 맨 끝에) (3판)
```
- **큰 덩어리 위치**(3판): 목록 일괄 처리 함수(`handleDeleteFromList`·`handleVisibilityFromList`·`handleBulk*`, 원본 1296~1527행)와 삭제·일괄 확인 대화상자는 `_list/product-list.tsx` 에, 미리보기·카테고리 관리·구성·파일 유형 설정 대화상자(원본 3417~3705행)는 `_settings/*` 에 둔다. 껍데기에는 상태 선언·`change*`·`toggleFilteredSelection`·`buildItemPatchBody`·훅 부르기·부품 연결만 남는다.
- **훅 사이 상태 소유와 부르는 순서**(3판): `useState`·`useRef` 선언과 `persistSamplePageOrder`·`persistBundleOption` 은 껍데기나 `use-product-form` 이 가진다. `use-sample-generation`·`use-subproduct-uploads` 는 처리 함수만 가지고, 필요한 상태·setter·`ensureDraftItemForUpload`·`refreshEditingFiles` 를 인자로 받는다. 부르는 순서는 form → sample·uploads 다(서로 부르지 않음, 본문 글자 그대로).
- 밑줄로 시작하는 폴더는 Next 경로가 되지 않는다. `new/page.tsx` 는 같은 `market-products-client` 를 그대로 쓴다.
- **1단계 규칙**(2판)
  - 함수 본문을 고치지 않는다. 클로저 함수(`buildRequestBody`·`persistForm`·`handle*`)는 훅 안에 같은 모양으로 둔다. 인자를 더해 순수 함수로 바꾸는 일은 2단계로 미룬다.
  - 지금 모듈 수준인 함수·타입만 `_lib/*` 로 옮긴다(본문 글자 그대로). 컴포넌트 안 지역 함수는 모듈 수준으로 올리지 않는다. `src/lib` 로는 옮기지 않는다. (3판)
  - 컴포넌트·훅 안 함수는 지금처럼 2칸 들여쓰기로 둔다(시험이 `\n  }\n` 로 본문을 자름).
  - 섹션 틀(`<section id=…>`)과 그 제목 `<p>` 는 `product-editor.tsx` 에 지금 순서대로 둔다.

### 5-2. 같음을 보이는 방법 (2판)
- **옮긴 덩어리 대조(주 근거)**: `git diff -M --color-moved=zebra --color-moved-ws=allow-indentation-change` 로 나누기 커밋을 본다.
  - 지운 줄이 모두 '옮겨진 줄'로 표시되고, 새로 생긴 줄은 import·export·props 넘기기·훅 반환값뿐이어야 한다.
  - 스크립트 `scripts/check-product-admin-moved.mjs`(결과는 `output/`)가 '옮겨지지 않은 추가·삭제 줄' 목록을 뽑는다. 검증자는 그 목록만 줄마다 확인한다.
- **호출 목록(보조)**: `fetch(`(31곳)·`uploadToSignedUrl(`(2곳)·`router.refresh(`(7곳, 저장·삭제 뒤 다시 읽기) 호출을 뽑는다. 생기면 `router.push(`·`router.replace(` 도 넣는다. 각 호출이 **어느 함수 안에 있는지**와 그 함수 안 순서를 함께 적는다. (3판)
  - 주소가 변수이면 대입한 줄까지 따라가 주소 틀을 적는다. 본문이 함수 호출이면 함수 이름을 적는다.
  - 나누기 전후 목록이 같아야 한다(`tests/fixtures/product-admin-call-inventory.json`).
- **문구 대조**: 화면 글자(JSX 텍스트·toast 문구) 집합이 같아야 한다.
- **시험**: 5-3 규칙대로 5-0 에서 다시 뽑은 집합 전부 통과. 기준선과 같은 `test()` 수·통과 수다. (3판)
- `tsc --noEmit`·lint 통과(구현 때 내가 돌림, 빌드·서버는 대표가 정한 때)
- 독립 검증 1관점: '옮기기만인가'(옮겨지지 않은 줄 목록·호출 목록·effect 의존 배열)

### 5-3. 시험을 고치는 규칙 (2판·3판)
- **기본은 명시한 목록**: 공용 도우미 `tests/helpers/product-admin-sources.mjs` 가 나눈 파일 목록을 **이름과 순서까지 적어 두고**(지금 원본에서 그 코드가 나오던 순서, `_lib/*` 포함) 이어 붙인 글을 돌려준다. 모든 시험의 단언은 이 글을 읽고, 단언 글자는 그대로 둔다.
- **잘라 읽기만 파일별로**(3판): `body()`·`extractBetween`·`indexOf` 순서 비교처럼 위치에 기대어 자르는 줄만 아래 파일에서 읽는다. 같은 시험의 나머지 단언(개수 세기·effect 반복문·`doesNotMatch` 등)은 도우미 글을 읽는다.

| 시험 | 파일별로 읽는 잘라 읽기 | 읽는 파일 |
|---|---|---|
| `market-admin-product-form-steps-contract` | `<section id>` 5개 `indexOf` 순서, '서브상품 구성'·'샘플 생성' 제목 위치 | `_editor/product-editor.tsx`(섹션 틀·제목을 여기에 둠) |
| `market-admin-sample-preview-ui-contract` | 첫 `onDrop={(event) => {` → ``className={`flex min-h-24`` (샘플 놓는 칸) | `_editor/sample-section.tsx` |
| 〃 | `handleSelectSampleSourceFile` → `handleGenerateSampleImages`, `handleGenerateSampleImages` → `handleDeleteSamplePage` | `_hooks/use-sample-generation.ts`(세 함수를 지금 순서로) |
| 〃 | `refreshEditingFiles` → `buildRequestBody` | `_hooks/use-product-form.ts`(두 함수를 지금 순서로) |
| `market-upload-draft-source-contract` | `ensureDraftItemForUpload` 본문 자르기 | `_hooks/use-product-form.ts`. 끝 표시 `const handleStatusAction = async` 는 원본에 없어 글 끝까지 자르므로, 본문이 든 파일이면 통과한다. **`handleStatusAction` 이름은 만들지 않는다**(form-steps 시험이 없어야 한다고 단언) (3판) |
| `market-products-admin-pagination-contract` | `body()` 7개(`toggleFilteredSelection`·`change*`) | `market-products-client.tsx`(목록 처리 함수가 남는 곳). effect 반복문·'1개 이상 맞음' 단언(더함, 지금 맞는 것은 `reloadUploadTaxonomy` 1개)·`listQuery.update` 개수·`nextFilterCategoryId` 비교(persistForm)는 도우미 글 |
| `market-admin-item-category-contract` | `changeFilterCategory` 본문 | `market-products-client.tsx`. 카테고리 Label·`buildRequestBody` 단언은 도우미 글 |
| `market-auto-sample-generation-contract` | `async function renderSamplePdfPages` → `interface PersistFormOptions` | `_lib/sample-render.ts` 뒤에 `_lib/types.ts` 를 이은 글(앞 파일 끝 = renderSamplePdfPages, 뒤 파일 처음 = PersistFormOptions) (3판) |
- `admin-product-year-options-contract` 는 잘라 읽기가 없어 도우미 글만 읽는다(`buildEmptyForm` 이 `_lib/product-form.ts` 에 있어 목록에 들어감). (3판)
- 위 표 말고 단언을 고치는 일은 없다. 표에 없는 실패가 나오면 나누기를 고친다.

## 6. DB 변경(마이그레이션 `<버전: 적용 순서에 맞춰 정함>_bundle18_product_duplicate.sql`)
함수 하나만 만든다(표·정책·트리거 없음). light 리허설만으로 충분하고 낮에 돌려도 된다.

### 6-1. 사전 점검
- 17번 `market_catalog_actor_allowed`·`market_item_usage_bases` 가 있다.
- `record_admin_audit` 지문이 같다.
- `duplicate_market_item` 이 아직 없다.

### 6-2. `duplicate_market_item(p_actor_id, p_subject, p_source_item_id, p_mode, p_request_meta)` → jsonb `{ item_id, subproduct_count, skipped_subproduct_count, bundle_copied }` (2판: 과목 인자)
- SECURITY DEFINER, `search_path` 고정, service_role 만 EXECUTE. 행위자 판정은 17번 함수를 쓴다.
- `p_mode`: `'next'`(같은 구성으로 다음 상품) 또는 `'copy'`(복제). 다른 값이면 `MARKET_DUPLICATE_INPUT_INVALID`.
- 원본 상품을 `FOR SHARE` 로 잠근다. 지운 상품(`deleted_at`)이거나 원본 `workspace_subject` 가 `p_subject` 와 다르면 `MARKET_DUPLICATE_SOURCE_NOT_FOUND`. (2판)
- 새 상품 행
  - `workspace_subject`·`category_item_id`·`subject_code` 는 원본 그대로다. 과목 비교에는 `workspace_subject` 만 쓴다(운영 국어 상품 148개의 `subject_code` 가 'english' 로 남아 있음). (2판)
  - `menu_entry_id` 는 NULL(새 상품은 게시판에 잇지 않음, `createMarketItem` 규칙), `thumbnail_url`(옛 칸) NULL, `sort_order` 0 (2판)
  - 이미지: `copy` 는 `thumbnail_image_id` 를 복사한다(FK RESTRICT 라 라이브러리 이미지가 지워지지 않음). `next` 는 NULL (2판)
  - 상태 `draft`, `draft_source 'manual'`, `is_active true`, `published_at NULL`, `view_count 0`, `created_by = updated_by = 행위자`
  - 복사하는 칸은 0절 Q2·Q3 표대로다. `copy` 제목은 원본을 `120 − 접미사 길이`자로 자른 뒤 ' (사본)'을 붙인다(상품 제목 상한 120자, `validateMarketItemInput`). (2판) `'next'` 의 제목은 빈 문자열이 아니라 '새 상품'이다(NOT NULL·`validateMarketItemInput` 규칙). 화면이 제목 칸을 비우고 초점을 둔다.
  - 옛 가격 칸 `pdf_price`·`hwp_price`·`zip_price` 는 0 이다(옛 판매 방식, 새 상품에 쓰지 않음).
- 서브상품: 원본의 지우지 않은 행(사용 여부 그대로)을 복사한다. 파일 행(`market_subproduct_files`)은 복사하지 않는다. (2판)
  - 순서: 원본을 `(sort_order, created_at, id)` 로 읽어 `ROW_NUMBER` 로 매긴 `10 × 순번` 을 넣는다(19번 순서 규칙과 같음). 한 거래 안의 `created_at` 이 같아 겹친 값의 순서가 흔들리지 않게 한다.
  - **지운 구성(`deleted_at`)의 서브상품은 건너뛰고** `skipped_subproduct_count` 로 센다. 비활성 구성의 서브상품은 복사하고, 화면이 '비활성 구성' 표시를 단다.
- 전체구매: 사용 중인 행이 있으면 그 행, 없으면 `updated_at` 이 가장 최근인 1행을 복사한다(사용 여부·가격·표시명·설명). (2판)
- 샘플·판매 파일·후기·조회 기록·이용 근거는 복사하지 않는다.
- 작업 기록 `market_item_duplicate`: details 에 `mode`·`source_item_id`·`new_item_id`·`subproduct_count`·`bundle_copied`·`request`
- 함수는 Storage 를 건드리지 않는다(파일 복사 없음).

### 6-3. VERIFY·되돌리기·리허설
- VERIFY: 함수 하나, SECURITY DEFINER·search_path·EXECUTE(service_role 만)
- 되돌리기 `supabase/rollback/<버전>_bundle18_product_duplicate_down.sql`(**복제 route·버튼을 먼저 되돌려 배포한 뒤**, 함수가 없으면 route 가 500 이 됨): 함수만 지운다. 만들어진 사본 상품은 일반 임시 상품이라 남긴다(관리자가 지움). 17번 down 은 이 함수 이름이 있으면 멈추므로, **17번을 되돌리려면 18번 down 을 먼저 적용**한다. (3판)
- 리허설(light, `BEGIN … ROLLBACK`): 함수 만들기는 표를 잠그지 않는다. 새 상품·서브상품 INSERT 는 새 행만 만든다.

| 경우 | 기대 결과 |
|---|---|
| D1 권한 | 대표·`products.edit` 직원 성공 / 권한 없음·탈퇴·일반 회원 거절 |
| D2 next | 서브상품 수·이름·가격·순서·사용 여부 같음, 파일 0, 제목 '새 상품', 문항 수·`thumbnail_image_id`·설명 NULL, 상태 draft·manual, 출처·학년·자료유형 같음, `menu_entry_id` NULL. 원본 `sort_order` 가 겹친 경우 사본 순서 = 원본 공개 읽기 순서. 지운 구성 서브상품 건너뜀·비활성 구성 서브상품 복사 (2판) |
| D3 copy | 제목 '… (사본)'(118자 원본 → 120자 안), 요약·설명·문항 수·`thumbnail_image_id` 같음, 파일·샘플 0 (2판) |
| D4 전체구매 | 사용 중 행이 있으면 그 행, 사용 안 함 행만 여럿이면 가장 최근 1행, 없으면 0행 (2판) |
| D5 원본 | 지운 상품·없는 id·`p_subject` 가 원본과 다름 거절, 원본 행 바뀐 것 없음(`updated_at` 그대로) |
| D6 이용 근거 | 사본에 근거 행 없음 |
| D7 결제 판정 | 사본 서브상품 id 로 `evaluate_market_targets` 가 '살 수 없음'(공개 아님·파일 없음) |
| D8 기록 | 1건, details 키 |

## 7. 코드 변경(2단계 이후 커밋)
- **복제 route** `POST /api/admin/market/items/[id]/duplicate`(`products.edit`, 본문 `{ mode }`)
  - `resolveAdminWorkspaceSubject(?subject)` 를 `p_subject` 로 넘긴다. 함수가 원본 `workspace_subject` 와 대조한다(`subject_code` 는 쓰지 않음) (2판)
  - 성공하면 새 상품 id 를 돌려준다. 공개 목록 캐시는 갱신하지 않는다(임시저장).
- **업로드 진행** `src/lib/admin-upload-queue.ts`(순수 상태 전이: 대기 → 준비 → 올리는 중(n%) → 등록 → 완료 / 실패(단계·사유))
  - 올리는 부분: 같은 서명 주소로 `XMLHttpRequest` PUT 을 보내고 `upload.onprogress` 를 쓴다. 서명 주소·헤더 형식은 설치된 `@supabase/storage-js` 의 `uploadToSignedUrl` 구현과 같게 맞춘다(구현 첫 단계에서 소스로 확인하고 계약 시험에 적음).
  - 확인이 안 되면 진행률 없이 단계 표시만 한다(Q5 대체안).
  - [다시 시도]는 그 파일만 prepare 부터 다시 한다. 완료된 파일은 다시 보내지 않는다.
  - 파일 크기·형식을 놓는 순간 미리 검사해 '건너뜀(50MB 초과)'으로 보인다. 서버 검사는 그대로 둔다.
- **카테고리 검색** `src/lib/admin-category-search.ts`(순수)
  - 트리를 '전체 경로' 목록으로 펴서 띄어쓰기로 나눈 낱말이 모두 들어간 경로를 찾는다.
  - 비활성 칸·비활성 조상이 있으면 `inactive: true`
  - 결과 상한 20개, 같은 점수면 트리 순서
- **공개 전 점검** `src/lib/admin-market-publish-checks.ts`(순수): 1단계에서 편집 부품에 그대로 둔 `publishChecks` 식을 2단계에서 이 파일로 옮기고(옮기기 전 출력 스냅샷 시험을 먼저 만듦), 규칙에 (2판) 다음을 더한다.
  - `level`(`required`·`warning`)과 `targetId`(이동할 입력칸 id)
  - 비활성 카테고리(공개 전 상품은 필수, 이미 공개된 상품은 경고, Q6) (2판)
  - 17번 '이용 근거 미입력'(경고). 근거 여부는 17번 근거 모듈이 돌려주는 상품 id 집합으로만 판단한다(공용 select 에 표를 넣지 않음, 17번 6절) (2판)
  - 필수 항목 조건 자체는 지금과 같다.

## 8. 관리자 화면
- **고정 요약판**(넓은 화면 오른쪽, 좁으면 위쪽 접힘)
  - 상품 카드 미리보기, 판매 구성 요약(서브상품 n개·합계·전체구매 가격), 샘플 장수
  - **빠진 항목 칩**: 필수는 빨강, 경고는 노랑. 누르면 그 칸으로 스크롤하고 초점을 준다. 접힌 단계면 펼친다.
  - 단계 칩은 스크롤해도 위에 붙어 있다.
- **저장·공개 뒤 창**: [같은 구성으로 다음 상품](→ 복제 route `next` → 새 상품 편집, 제목 칸 초점) / [빈 새 상품] / [상세 페이지 보기](공개일 때만, 새 탭)
  - **띄우는 때**(3판): 지금 `handleSave` 갈래 가운데 (a) 새 상품 저장, (b) `auto_upload` 임시 상품 최종 등록, (c) 이 창에서 [같은 구성으로 다음 상품]·[복제]로 만든 상품(화면 메모리에 id 를 둠)의 첫 임시저장·공개 뒤. **기존 상품 수정 저장에는 띄우지 않는다.**
  - (a)(b)는 지금처럼 `resetForm(카테고리)` 를 한다. **창은 `handleSave` 의 `if (requiresFinalRegistration) { … }` 블록 안이 아니라** `persistForm` 이 돌려준 결과를 '이번에 등록한 상품' 상태에 넣는 곳에서 연다(그 블록은 `resetForm`·`return` 두 줄만 그대로). 창을 닫거나 [빈 새 상품]을 누르면 지금과 같은 상태(카테고리만 남은 빈 폼)다. (c)는 그 상품에 머문 채 띄운다. (3판)
  - 아래 '이번에 등록한 상품' 표: 제목·상태·서브상품 수·[다시 수정]. 화면 메모리에만 둔다.
- **목록 행 [복제]**: 확인 창 "임시저장 사본을 만듭니다. 판매 파일·샘플·이용 근거는 복사하지 않습니다." → 새 상품 편집으로 이동
- **카테고리 칸**: 한 줄 검색칸(경로 후보 목록, 키보드 위·아래·Enter), 위에 최근 칩 3개, 비활성 후보는 흐리게 + '비활성' 글자. 기존 단계 선택칸은 '목록에서 고르기'로 접어 둔다.
- **업로드 행**: 놓는 칸 아래 "PDF·HWP·ZIP, 파일당 50MB까지"(허용 형식은 DB 파일 유형 목록에서 만든다). 파일마다 이름·크기·진행 막대(%)·상태·[다시 시도]·[빼기]. 화면 읽기 프로그램용 `aria-live="polite"` 요약 한 줄("3개 중 2개 완료")을 둔다.
- 관리자 조작 문구(버튼·확인 창)는 코드에 둔다(`docs/admin-content-management-plan.md` 기준). 회원 화면 문구는 바뀌지 않는다.

## 9. 회원 화면
- 바뀌는 것 없음. 사본은 임시저장이라 보이지 않는다. 공개는 지금처럼 관리자가 파일을 올리고 [공개]를 눌러야 한다.

## 10. 작업 기록 종류(`src/lib/admin-audit-log.ts`)
| 종류 | 이름 | 남기는 곳 |
|---|---|---|
| `market_item_duplicate` | 상품 복제·같은 구성으로 새 상품 | DB 함수(`DB_FUNCTION_ACTIONS` 등록) |
- 파일 올리기·지우기 기록은 지금 규칙 그대로다(G-07 은 범위 밖).

## 11. 시험
### 11-1. 0·1단계(기준선·나누기) (2판)
- 0단계: 실패 2건을 고친 커밋 뒤 다시 뽑은 집합 전부 통과, 기준 커밋·`test()` 수·통과 수를 5-0 에 적음 (3판)
- 1단계: 5-3 규칙(도우미 + 시험 6개의 잘라 읽기 8곳)으로 같은 집합 통과, 수 = 기준선 (3판)
- 새 시험 `tests/bundle18-product-split-contract.test.mjs`
  - 호출 목록 스크립트 결과 = 저장된 기준(`tests/fixtures/product-admin-call-inventory.json`)
  - 도우미의 파일 목록이 **나눈 파일**(`market-products-client.tsx` 와 `_list`·`_editor`·`_settings`·`_hooks`·`_lib` 아래 `.ts/.tsx`)과 빠짐없이 같다. 기존 `page.tsx`·`new/page.tsx`·`admin-market-sample-preview-dialog.tsx`·`storage-cleanup-notice.tsx` 는 비교와 목록에서 뺀다(넣으면 `doesNotMatch` 단언 대상이 바뀜) (3판)
  - `market-products-client.tsx` 가 700줄을 넘으면 실패가 아니라 경고를 내고, 넘은 까닭을 검증 근거(`output/`)에 적는다. 줄 수를 맞추려고 계획에 없는 재배치를 하지 않는다 (3판)
  - `_editor`·`_list`·`_settings` 파일이 서버 전용 모듈(`server-only`, `bypass`)을 가져오지 않음
- 옮겨지지 않은 줄 목록(5-2)을 검증 근거로 남긴다(`output/`)
### 11-2. 2단계(기능) `tests/bundle18-product-upload-contract.test.mjs` + 단위 시험
- 공개 전 점검 순수 함수: 필수·경고 경우표(17번 근거 미입력은 경고라 공개를 막지 않음, 비활성 칸은 필수), 모든 항목에 `targetId` 가 있고 화면에 같은 id 가 있다.
- 카테고리 검색: 낱말 순서 무관, 대소문자·공백, 비활성 조상, 상한 20, 빈 검색어 → 빈 목록
- 업로드 상태 전이: 성공·준비 실패·올리기 실패·등록 실패·다시 시도(완료 파일 재전송 없음)·50MB 초과 건너뜀
- 마이그레이션: 함수 하나, EXECUTE 회수, 기록 종류 글자 꼴, 파일 표 INSERT 없음, 상태 `'draft'` 고정
- route: `products.edit`, 과목 대조, `mode` 두 값만
- 가드 범위 시험 `admin-guard-coverage-contract` 의 route 권한 표에 `'market/items/[id]/duplicate/route.ts': all('products.edit', 'POST')` 한 줄을 더한다 (3판)
- `market-upload-draft-source-contract` 의 `resetForm` 단언(L41-42)은 고치지 않고 그대로 통과해야 한다. L41 은 (b) 갈래 블록에 `resetForm`·`return` 말고 다른 줄이 없어야 맞으므로, 창은 8절대로 그 블록 밖에서 연다 (3판)
### 11-3. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost 는 개발 전용 미리보기(`PRODUCT_ADMIN_PREVIEW=1`, `NODE_ENV === 'development'` 일 때만)
  - 메모리 속 예시 상품·트리·업로드 흉내(진행률 0→100, 실패 1개)로 그린다.
  - 저장·복제·업로드 버튼은 미리보기에서 서버를 부르지 않는다.
- 확인할 것
  - S1 나누기 전후 같은 화면(새 상품·수정·목록·설정 창 캡처 비교)
  - S2 빠진 항목 칩 → 이동·초점
  - S3 카테고리 검색 키보드
  - S4 업로드 행 진행·실패·다시 시도
  - S5 저장 뒤 창과 '이번에 등록한 상품' 표
  - S6 375px·1366px
- **운영 쓰기 시험**(배포 뒤, 대표 승인): 숨김 처리된 시험 카테고리에서 상품 1개 → [같은 구성으로 다음 상품] 1번 → 파일 1개 올리기 → 둘 다 삭제(이력 없음) → 남은 것 0 확인(SELECT)

## 12. 검증 관점(계획·구현 모두 PASS 까지)
1. **옮기기 동등성**(0·1단계 전용): 기준선 커밋·통과 수, 옮겨지지 않은 줄 목록, 호출 목록(변수 주소·Storage 업로드 포함), effect 의존 배열, 시험 대응표(5-3) 밖 단언 변경 없음 (2판)
2. **DB 함수**: 권한·과목·복사 칸 목록, 한 거래, 원본 불변, 사본이 살 수 없음(결제 판정 함수로 확인)
3. **화면**: 칩 이동·초점, 검색 키보드, 업로드 상태와 실패 복구, 접근성(진행 알림), 두 과목 같음
- 결제·환불 함수를 바꾸지 않는다. 결제 검증 3명은 두지 않는다. D7 만 2관점이 확인한다.

## 13. 배포 순서
1. 계획 검증 PASS → 0절 답 반영
2. **0단계**: 실패 2건 고친 커밋 → 기준 커밋·통과 수 기록(5-0). (2판)
3. **1단계**: 나누기 커밋 → 시험(기준선과 같은 수) → 옮겨지지 않은 줄 목록·호출 목록 → 독립 검증(관점 1) → 로컬 확인(미리보기, 대표) → push·배포. DB 변경 없음.
4. **2단계**: 기능 구현 → 시험 → 구현 검증(관점 2·3) PASS
5. light 리허설(낮) → **DB 적용**(함수만, 대표 승인) → 로컬 확인 → push·배포
6. 운영 쓰기 시험(11-3 마지막 줄) → 진행 기록 갱신
- 19번은 1단계 배포 뒤 계획 검증을 시작할 수 있다. 구현은 18번 2단계 배포 뒤에 한다(같은 `_editor` 파일).

## 14. 열린 질문·범위 밖
1. Q2 의 '이용 근거 복사' 다른 안을 쓸지(재정리 때 같은 원저작물 상품이 많으면 유리)
2. 버려진 사본(임시저장)을 언제 정리할지. 기본: 목록의 '임시저장' 탭에서 관리자가 지움. 자동 정리는 `auto_upload` 만 그대로 둔다.
3. 범위 밖(후속): B-02 서버 공개 검사, B-03 이탈 경고, B-09 수정 별도 주소, 파일명으로 제목 채우기, 같은 제목 경고, G-04 파일 교체, 여러 상품 한 번에 올리기

## 15. 1판 검증 반영 (2판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 나누기 major | 폴더를 이어 붙여 읽으면 순서·들여쓰기에 기대는 시험이 깨지거나 약해짐, `src/lib` 로 옮긴 함수를 못 읽음 | 5-3: 명시 목록(순서 포함)과 위치 의존 6개의 파일별 읽기 대응표, 2칸 들여쓰기·섹션 틀 위치를 나누기 규칙으로, `_lib` 만 쓰고 `src/lib` 로 옮기지 않음 |
| 나누기 major | 지금 main 에서 이미 2건 실패 | 5-0 기준선 단계(별도 커밋, 기준 커밋·통과 수 기록), 13절 0단계 |
| 나누기 major | `fetch(` 글자 대조는 변수 주소·본문 함수·Storage 업로드를 못 잡음 | 5-1: 클로저 함수는 훅 안에 그대로(순수 함수화는 2단계), 5-2: `--color-moved` 옮긴 줄 대조를 주 근거로, 호출 목록에 `uploadToSignedUrl`·router·변수 주소 추적 |
| 나누기 minor | 함수에 과목 인자가 없어 D5 를 DB 에서 못 봄 | 6-2 `p_subject`, route 가 넘김 |
| 나누기 minor | Q3 '이미지 복사'와 6-2 '이미지 연결 복사 안 함'이 부딪침 | Q3·6-2: `copy` 는 `thumbnail_image_id` 복사, `next` NULL, `thumbnail_url` NULL |
| 나누기 minor | 비활성 칸 필수면 공개 상품 오타도 못 고침, 비활성 구성 서브상품 복사 규칙 없음 | Q6: 공개 전만 필수·공개 상품은 경고, 6-2: 지운 구성 건너뜀·비활성 구성 복사 표시, D2 |
| DB major | 이미지 복사 규칙 모순 | 위와 같음, D2·D3 에 `thumbnail_image_id` 값 |
| DB minor | 과목 칸이 모호(`subject_code` 'english' 148행), `menu_entry_id` 복사 | 6-2: 비교는 `workspace_subject`, `menu_entry_id` NULL, 7절 route |
| DB minor | `sort_order` 겹침 → 사본 순서 흔들림 | 6-2: `ROW_NUMBER` 로 10×순번, D2 경우 |
| DB minor | '(사본)'이 120자 상한을 넘김, 전체구매 여러 행 중 무엇을 복사할지 없음 | 6-2: 제목 자르기, 사용 중 행 → 없으면 최근 1행, D3·D4 |

## 16. 2판 검증 반영 (3판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 나누기 major | 5-3 표가 시험 전체를 한 파일로 읽게 함, sample-preview `onDrop` 대상 파일 틀림, 두 쌍 누락, pagination effect 단언을 목록 파일에서 돌리면 실패, 없는 '목록 훅' | 5-3: 잘라 읽기만 파일별·나머지는 도우미 글, `onDrop` → `sample-section`, 두 쌍 → `use-sample-generation`, `body()` → 껍데기(목록 처리 함수 위치), effect·개수 → 도우미 글, '목록 훅' 삭제 |
| 나누기 minor | `renderSamplePdfPages` → `PersistFormOptions` 잘라 읽기 누락, 타입 파일 없음 | 5-1 `_lib/types.ts`·`_lib/sample-render.ts`, 5-3 표에 줄 추가, 1절 '시험 6개·잘라 읽기 8곳' |
| 나누기 minor | `buildItemPatchBody` 를 `_lib` 로 옮기는 것과 '모듈 수준만' 규칙이 부딪침 | 껍데기에 그대로 둠(가안 (가)) |
| 나누기 minor | 호출 목록에 없는 push·replace, 실제 `router.refresh` 7곳 누락 | 5-2: `router.refresh` 와 둘러싼 함수·순서 |
| 나누기 minor | 시험 집합 21개 고정, 통과 수가 `test()` 수, 도우미 목록 범위 | 5-0: 17번 뒤 다시 뽑기·`test()` 수 표기, 11-1: 나눈 파일만 비교 |
| 나누기 minor | 저장 뒤 창 띄우는 조건 없음 | 8절: (a)(b)(c) 갈래, 기존 수정 저장 제외, `resetForm` 유지 |
| 나누기 minor | 가드 범위 시험 표 갱신 누락 | 11-2 한 줄 |
| DB minor | 되돌리기 순서(코드 먼저), 17번 down 과의 짝 | 6-3 |

## 17. 3판 검증 minor 반영 (같은 판)
| 지적 | 반영 |
|---|---|
| (b) 갈래 블록에 창 여는 줄을 넣으면 draft-source L41 이 깨짐 | 8절: 창은 블록 밖(결과를 '이번에 등록한 상품'에 넣는 곳)에서, 11-2: L41-42 그대로 |
| draft-source 끝 표시는 원본에 없음, 그 이름을 만들면 form-steps 가 깨짐 | 5-3 표: 글 끝까지 자름, `handleStatusAction` 이름 만들지 않음 |
| 개수 불일치(7개 vs 표 6개) | 1절·11-1·16절: '시험 6개·잘라 읽기 8곳' |
| 700줄 고정 조건에 큰 덩어리 위치가 없음 | 5-1: 일괄 처리·삭제 대화상자 → `_list`, 설정 대화상자 → `_settings`, 11-1: 넘으면 경고 |
| 훅 사이 상태 소유가 정해지지 않음 | 5-1: 상태는 껍데기·`use-product-form`, 나머지 훅은 인자로 받음, 순서 form → sample·uploads |
