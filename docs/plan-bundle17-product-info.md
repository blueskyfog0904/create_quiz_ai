# 17번 묶음 계획 · 상품 정보 입력 보완

작성일: 2026-11-26
판: 2 (검증 PASS, 2026-11-26) — 1판 두 관점(DB·보안, 상품 화면) PASS, minor 8개를 반영했다(15절). 고친 곳 끝에 `(2판)`.
- 작업 순서표 17번: 출처 1~4 입력칸, 학년·자료유형 목록(DB)과 선택식 입력, 검색 필터 "자료유형"→"구성", 상품별 원저작물 "이용 근거" 내부 칸.
- 출처: `docs/admin-content-management-plan.md` 1절 3·4·5번, 2-2 '상품 관리'·'상품 표시 설정(신설)', 3절 1-4·1-5.
- 함께 처리하는 후속 과제(작업 순서표 '검증에서 나온 후속 과제')
  - (가) 관리자 세션으로 DB 를 직접 부르면 서브상품 구성 slug·파일 유형 code 를 바꿀 수 있다(RLS 쓰기 허용) → DB 트리거로 막는다.
  - (나) 가입 트리거 `handle_new_user` 가 avatar 메타데이터를 무시하게 한다(4번 계획 0절 ②의 남은 일).
- 18번(업로드 개선)·19번(표시 설정)이 이 묶음의 표·설정 행·관리자 화면을 이어 쓴다. 17 → 18 → 19 순서로 한다.
- 국어·영어 같은 구조: 모든 목록·설정·화면은 두 과목에 똑같이 들어간다.

## 0. 대표 결정이 필요한 것(질문)
답이 오기 전에는 '기본안'으로 진행한다. 목록·문구는 초안으로 넣고 최종은 대표가 관리자 화면에서 고친다.

| # | 질문 | 기본안 | 이유 |
|---|---|---|---|
| Q1 | 학년·자료유형 목록을 과목별로 둘까? | **과목별 목록**(표 하나, `workspace_subject` 칸). 첫 값은 두 과목 같게 넣는다 | 구성(서브상품 분류)·파일 유형이 이미 과목별이다. 영어 문제은행 자료유형(교과서·모의고사·부교재)처럼 과목마다 달라질 수 있다 |
| Q2 | 학년 '전체' 값(국어 131개 상품)을 어떻게 할까? | **목록에 '전체' 항목을 두고 상품 값은 그대로 둔다** | 지금 관리자 화면은 빈 값을 '전체'로 보여 주는데 DB 에는 '전체' 글자가 131개 있다. 상품 데이터를 바꾸지 않는 쪽이 안전하다. 다른 안: '전체'를 빈 값으로 정리하는 스크립트(5-7, 되돌림 포함) |
| Q3 | 자료유형 첫 목록 | **수능특강·교과서·모의고사·부교재** 4개, 두 과목 같게 | 지금 쓰인 값(수능특강 2·교과서 1)과 영어 문제은행 `source_configs` 이름을 합쳤다. 초안이다 |
| Q4 | 출처 1~4 칸 이름 | **관리자 칸 이름은 '출처 1'~'출처 4'(코드), 회원 화면은 지금처럼 '출처' 한 줄에 ' · ' 로 이음** | 관리자 조작 문구라 코드에 둔다. 회원에게 보이는 '출처' 이름은 19번 '자료 정보 항목'에서 DB 로 옮긴다. 자료유형마다 칸 이름을 바꾸는 기능(교과서명·단원 등)은 범위 밖 |
| Q5 | 이용 근거 목록과 필수 여부 | **목록 5개 초안(DB, 11절) + 메모 칸 + 증빙 위치 칸. 공개를 막지 않는다.** 18번 공개 전 점검에 '이용 근거 미입력' 경고(노란 칩)로 보인다 | 기존 148개 상품에 값이 없다. 재정리 때 채운다. 막을지는 재정리 뒤 다시 정한다. 목록 문구는 변호사 확인(14절) |
| Q6 | 이용 근거를 볼 수 있는 사람 | **상품 편집 권한(`products.edit`)이 있는 관리자**(대표 포함) | 상품을 올리는 사람이 입력해야 한다. 다른 안: 대표만(그러면 직원은 입력 칸을 못 봄) |
| Q7 | 검색 필터 이름을 DB 로 | **이번에 '상품 표시 설정' 행을 만들고 검색·자료 보관함 필터 이름 4개를 넣는다.** '자료유형'은 '구성'으로. 주소 키(`type`)는 그대로 | 하드코딩 금지. 주소 키를 바꾸면 저장된 링크가 깨진다. 공통 행 하나(두 과목 같은 이름) |
| Q8 | slug·code 잠금 범위 | **slug·code·과목(`workspace_subject`) 변경을 모든 역할에서 막는다**(service_role·postgres 포함) | 코드가 `question_hwp`·`question_pdf`·`pdf`·`hwp`·`zip` 에 기댄다. 꼭 바꿔야 하면 새벽에 트리거를 잠깐 끄는 런북 절차(13절 6) |
| Q9 | `handle_new_user` 를 바꾸면서 `search_path` 도 고정할까? | **함께 고정한다**(`SET search_path = public, pg_temp`) | 같은 `CREATE OR REPLACE` 한 번이다. 함수 안은 모두 `public.` 을 붙였거나 내장 함수라 동작이 같다. 다른 안: avatar 만 빼기 |

## 1. 지금 상태(코드·운영 DB 읽기 전용 확인, 2026-11-26)
- **상품 칸**: `market_items` 에 `grade_level`·`source_type`·`source_1`~`source_4`·`exam_year`·`exam_month`·`question_count` 가 이미 있다.
  - 상품 수: 국어 148(공개 147·숨김 1), 영어 1(공개).
  - 학년: 국어 '전체' 131·빈 값 17, 영어 '1학년' 1.
  - 자료유형: 빈 값 146, '수능특강' 2, '교과서' 1.
  - 출처 1~4: 모두 0건. 연도 147, 월 1, 문항 수 146.
- **관리자 입력**(`src/app/(admin)/admin/market/products/market-products-client.tsx`, 3,705줄)
  - 학년 선택은 코드 상수 `LISTBOARD_GRADE_OPTIONS`(`src/lib/generate-menu.ts:27`, ['1학년','2학년','3학년'])와 빈 값 '전체'다(2969~2980행).
  - 자료유형은 자유 입력이다(2982~2984행).
  - 출처 1~4 는 폼 상태에 없다. 목록에서 상태만 바꿀 때 `buildItemPatchBody`(934~954행)가 지금 값을 다시 보낼 뿐이다.
  - 저장 route(`src/app/api/admin/market/items/route.ts`·`[id]/route.ts`)는 `gradeLevel`·`sourceType`·`source1~4` 를 trim 만 하고 그대로 저장한다.
  - `LISTBOARD_GRADE_OPTIONS` 는 생성 기능(`generate-menu.ts` 등)도 쓴다. 그래서 지우지 않는다.
- **회원 화면**
  - 상세(`src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx`): 115~149행이 자료 정보 표(과목·학년·출처·자료유형·문항 수·등록일자), 220~241행이 배지(연도·자료유형·학년)를 그린다.
  - 홈 섹션(`src/lib/market-home-server.ts:20·82`)도 `source_type`·`source_1~4` 를 읽는다.
  - 검색 필터: `src/app/(solvook)/search/_components/search-view.tsx:30-35` `FACET_DEFS` 의 `{ key: 'type', label: '자료유형' }` 은 실제로 서브상품 **구성**(`market_subproduct_categories`)을 거른다(`src/lib/market-search-server.ts:148-155`). 상세의 '자료유형'(`source_type`)과 다른 값이다.
  - 자료 보관함 필터: `src/app/(solvook)/library/_components/library-view.tsx:65-93` 도 같은 이름이다. 빈 화면 글(556행) "검색어나 자료유형 필터를 변경해 보세요."도 그렇다.
- **읽기 권한**: `market_items` 의 정책 "Authenticated users can read published market items" 는 로그인 회원이 공개 상품 행의 **모든 칸**을 REST 로 읽게 둔다. 그래서 내부 전용 칸(이용 근거)을 `market_items` 에 두면 안 된다.
- **slug·code 잠금**
  - 지금은 앱에서만 막는다(`src/lib/market-items-server.ts:488-491` slug, `656-660` code).
  - 표 정책 `market_subproduct_categories_admin_write`·`market_file_types_admin_write`(ALL, `has_admin_permission('products.edit')`) 때문에 브라우저 세션이 직접 UPDATE 할 수 있다.
  - 두 표에는 `updated_at` 트리거만 있다. UNIQUE `(workspace_subject, slug)`·`(workspace_subject, code)` 가 있다.
- **가입 트리거**: `handle_new_user` 는 `md5(pg_get_functiondef)` = `61bc7b1469fb4dd6e795725040efe394` 다.
  - avatar_url 을 메타데이터(`avatar_url`·`picture`·`kakao_account.profile.profile_image_url`)에서 읽어 `profiles.avatar_url` 에 넣는다.
  - SECURITY DEFINER 인데 `search_path` 가 없다.
  - 운영 `profiles` 19행 중 avatar 있는 행은 0이다. 후기는 avatar 를 읽지 않는다(4번에서 늘 null).
- **참고 표** `source_configs`(문제은행 출처 이름, 대표 전용 RLS)는 생성 기능용이다. 상품에는 쓰지 않는다.
- **작업 기록**: `src/lib/admin-audit-log.ts`. DB 함수 안에서 남기는 종류는 `tests/admin-audit-log-contract.test.mjs` 의 `DB_FUNCTION_ACTIONS` 에 등록한다.
- **관리자 메뉴**: `src/lib/admin-sidebar.ts:72-85`(과목별 '문제마켓' 묶음)
- **마이그레이션**: 운영 마지막 적용 `20261216100000`. 12·13·14·16번이 그 뒤에 더한다(12번 코드는 로컬 커밋 `cbe27ee`, 운영 DB 미적용). 이 묶음 버전은 적용 순서에 맞춰 정한다.

## 2. 목표
1. 관리자가 상품마다 출처 1~4 를 입력한다. 상세·홈의 '출처'에 보인다.
2. 학년·자료유형은 과목별 DB 목록에서 고른다. 목록 이름·순서·숨김은 '상품 표시 설정'에서 고친다. 이름을 바꾸면 그 값을 쓰던 상품도 함께 바뀐다.
3. 검색·자료 보관함의 '자료유형' 필터가 '구성'으로 보인다. 이름은 DB 에 있다.
4. 상품마다 원저작물 이용 근거(목록 + 메모 + 증빙 위치)를 남긴다. 회원은 어떤 경로로도 읽지 못한다.
5. 브라우저 세션이든 서버 키든, slug·code·과목을 바꾸는 UPDATE 는 DB 가 거절한다.
6. 새 가입자의 `profiles.avatar_url` 은 메타데이터와 상관없이 늘 비어 있다.

## 3. 범위
**넣는 것**: DB(표 2, 설정 행 1, 함수 5, 트리거 2, 가입 트리거 교체), 상품 편집 칸, '상품 표시 설정' 화면(목록 3개 + 검색 필터 이름), 상품별 이용 근거 카드, 검색·보관함 필터 이름, 시험.
**넣지 않는 것**: 상세 안내 문구·자료 정보 항목 이름(19번), 구성·파일 유형 설정 창 옮기기(19번), 공개 전 점검 칩·업로드 개선(18번), 자료유형별 출처 칸 이름, 서버 공개 검사(B-02).

## 4. 원칙
- **상품에는 글자 값을 그대로 둔다**: `grade_level`·`source_type` 은 지금처럼 이름 글자다.
  - 목록 표는 '고를 수 있는 값'만 정한다. 그래서 `market_items` 에 칸·FK 를 더하지 않는다(표 잠금 DDL 없음).
  - 옛 코드도 그대로 돈다.
- **검사는 저장 route 에서**: 새 값은 그 과목·종류의 사용 중 목록에 있어야 한다. 다만 **상품의 지금 값과 같으면 통과**한다(숨긴 항목·옛 값으로 저장된 상품도 다른 칸을 고칠 수 있게).
- **내부 전용은 별도 표**: 이용 근거는 회원 읽기 정책이 없는 표에 둔다. 회원 화면 코드가 그 표·모듈을 가져오지 않음을 계약 시험으로 고정한다.
- **쓰기는 DB 함수로**: 목록·이용 근거·표시 설정은 함수가 권한·판·입력을 보고 같은 거래에서 작업 기록을 남긴다. 14번 방식이다.
- **코드에는 규칙만**: 종류 이름(`grade`·`material_type`·`usage_basis`), 글자 수 상한, 필터 key. 목록 이름·필터 이름은 DB 에 둔다.
- **운영 DB 한 개**: localhost 에서 저장을 누르지 않는다. 상품 상세를 열지 않는다(조회 기록이 운영에 쓰임).

## 5. DB 변경(마이그레이션 `<버전: 적용 순서에 맞춰 정함>_bundle17_product_info.sql`)
새 표·행·함수만 만든다. 기존 표에는 트리거 2개만 붙인다. `lock_timeout = '3s'`, 실회원이 적은 새벽에 적용한다.

### 5-1. 사전 점검(다르면 멈춤)
- `handle_new_user` 지문이 `61bc7b14…` 와 같다.
- `record_admin_audit(…)` 9인자 지문이 12·14번 사전 점검 값과 같다.
- 새 표 2개·설정 키 `market_item_display`·새 함수·트리거가 아직 없다.
- 두 표의 slug·code 가 코드가 기대는 값으로 있다: 두 과목 모두 `question_pdf`·`question_hwp`, `pdf`·`hwp`·`zip`.

### 5-2. 표 `market_item_attribute_options`(학년·자료유형·이용 근거 목록)
- 칸: `id`, `workspace_subject`(korean·english CHECK), `kind`(`grade`·`material_type`·`usage_basis` CHECK), `label`(1~40자, 한 줄), `sort_order`, `is_active`, `revision`, `updated_by uuid`(FK 없음 — 관리자 계정을 지워도 남게, 14번과 같은 이유), `created_at`·`updated_at`
- UNIQUE `(workspace_subject, kind, label)`. 숨긴 항목도 이름을 차지한다. 같은 이름을 다시 쓰려면 숨김을 푼다.
- 지우기는 없다(숨김만). 숨긴 항목은 새로 고를 수 없고, 이미 그 값인 상품은 그대로 보인다.
- 권한: RLS 켬, 정책 없음. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 뒤 `GRANT SELECT … TO service_role`(14번 1절 기본 권한 메모와 같은 방식).
- 첫 값(`ON CONFLICT DO NOTHING`, 두 과목 같게, 11절 초안)
  - 학년: 1학년·2학년·3학년·전체
  - 자료유형: 수능특강·교과서·모의고사·부교재
  - 이용 근거: 5개
- 첫 값에 지금 상품의 모든 비지 않은 값이 들어 있는지 VERIFY 로 확인한다(빠지면 적용 실패).

### 5-3. 표 `market_item_usage_bases`(상품별 이용 근거, 내부 전용)
- 칸: `item_id`(PK), `workspace_subject`, `basis_option_id`(→ 5-2, ON DELETE 없음), `note`(0~2000자), `evidence_ref`(0~300자, 계약서·허락 메일 보관 위치), `revision`, `updated_by uuid`(FK 없음), `updated_at`
- FK `(item_id, workspace_subject)` → `market_items(id, workspace_subject)` ON DELETE CASCADE. 이력 없는 상품을 완전 삭제하면 함께 지워진다. 이력 있는 상품은 숨김이라 남는다.
- 권한은 5-2 와 같다(service_role SELECT 만). 회원·관리자 세션 모두 표를 직접 읽지 못한다.
- `basis_option_id` 는 같은 과목·`usage_basis` 종류여야 한다(함수가 검사).

### 5-4. 설정 행 `market_item_display`(`system_settings`, `ON CONFLICT (key) DO NOTHING`)
```
{ "revision": 1,
  "facetLabels": { "category": "카테고리", "type": "구성", "year": "연도", "grade": "학년" },
  "libraryEmptyFilterHint": "검색어나 {type} 필터를 바꿔 보세요." }
```
- 두 과목 공통 행 하나다(Q7). 19번이 같은 행에 `detail` 키를 더한다.
- 쓰기 막기 RESTRICTIVE 정책은 만들지 않는다(14번과 같은 판단: 결제·법 문구가 아니고, `system_settings` 표 잠금을 피함). 대표 세션의 직접 수정은 읽을 때 필수 키 검사로 걸러진다.

### 5-5. 함수(SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` 뒤 service_role 만 EXECUTE)
- **`market_catalog_actor_allowed(p_actor_id)`**(내부)
  - 식: `is_admin IS TRUE AND withdrawn_at IS NULL AND (admin_role = 'owner' OR (admin_role = 'staff' AND products.edit 권한 행))`. 12번 `member_suspension_actor_allowed` 와 같은 꼴이다.
  - 18·19번 함수도 이것을 쓴다.
- **`save_market_item_option(p_actor_id, p_id, p_expected_revision, p_subject, p_kind, p_label, p_is_active, p_request_meta)`** → jsonb
  - 새 항목은 `p_id` NULL, 맨 뒤 순서. 고칠 때는 `FOR UPDATE`, 판이 다르면 `MARKET_OPTION_REVISION_CONFLICT`. 과목·종류는 못 바꾼다.
  - 잠금 순서: 권한 확인 직후 `pg_advisory_xact_lock(hashtext('market_item_options:' || subject || ':' || kind))`, 그다음 행 잠금
  - 입력: 앞뒤 공백 정리, 1~40자, 줄바꿈 없음, 이름 중복이면 `MARKET_OPTION_DUPLICATE`
  - **이름을 바꾸면 그 값을 쓰는 상품도 바꾼다**: `grade` 는 `grade_level`, `material_type` 은 `source_type` 을 `UPDATE market_items … WHERE workspace_subject = 과목 AND 칸 = 옛 이름`(행 잠금만)
  - 작업 기록 `market_item_option_save`: details 에 `subject`·`kind`·`option_id`·`before`·`after`(이름·사용 여부)·`renamed_item_count`·`request`
  - 바뀐 것이 없으면 기록 없이 돌려준다.
- **`reorder_market_item_options(p_actor_id, p_subject, p_kind, p_ids, p_request_meta)`**
  - 같은 advisory lock. id 집합이 그 과목·종류 전체(숨김 포함)와 정확히 같아야 한다(`MARKET_OPTION_REORDER_MISMATCH`).
  - 기록 `market_item_option_reorder`(앞뒤 id 순서)
- **`save_market_item_usage_basis(p_actor_id, p_item_id, p_expected_revision, p_basis_option_id, p_note, p_evidence_ref, p_request_meta)`**
  - 상품 행을 `FOR SHARE` 로 잠가 과목을 읽는다. 행이 없으면 넣고 판 1.
  - 근거가 '기타' 같은 메모 필수 항목인지는 코드에 두지 않는다. 메모는 늘 선택이다(Q5).
  - 기록 `market_item_usage_basis_save`: before·after(항목 id·이름, 메모·증빙 위치 전문 — 회사 내부 업무 기록이다. 개인정보는 넣지 말라는 안내를 칸 옆에 둔다)
- **`save_market_item_display(p_actor_id, p_expected_revision, p_value, p_request_meta)`**
  - 필수 키(코드 `MARKET_ITEM_DISPLAY_REQUIRED_KEYS` 와 계약 시험으로 대조)가 비면 거절한다.
  - 상한을 칸별로 나눈다(2판): `facetLabels` 각 값은 1~20자 한 줄, `libraryEmptyFilterHint` 는 1~60자 한 줄이고 `{type}` 은 이 칸에서만 받는다(없어도 됨).
  - 이 규칙은 17번 키에만 적용한다. 19번이 더하는 `detail` 은 19번 4-2 규칙을 따른다.
  - 기록 `market_item_display_update`(before·after)
- **잠금 트리거 함수 2개**(2판: 표마다 따로 — 한 함수에서 `OLD.slug`·`OLD.code` 를 함께 쓰면 없는 칸 오류로 정상 UPDATE 까지 막힘)
  - `guard_market_subproduct_category_identity()`: UPDATE 때 `slug`·`workspace_subject` 가 바뀌면, DELETE 때는 늘 `RAISE EXCEPTION 'MARKET_IDENTIFIER_LOCKED'`(ERRCODE `P0001`)
  - `guard_market_file_type_identity()`: 같은 규칙으로 `code`·`workspace_subject`
  - 트리거: 각 표에 `BEFORE UPDATE OF <식별 칸>, workspace_subject OR DELETE … FOR EACH ROW`
  - **hard DELETE 도 막는다**(2판). RLS ALL 정책으로 세션이 코드가 기대는 행(예: 아직 쓰이지 않은 영어 `zip`)을 지울 수 있어서다. 앱 삭제는 `deleted_at` UPDATE 라 영향이 없다.
  - 역할을 가리지 않는다(Q8). 이름·설명·순서·사용 여부·`deleted_at` 은 그대로 고칠 수 있다.
- **`handle_new_user()` 교체**
  - `v_avatar_url` 변수와 읽기를 지우고 INSERT 의 `avatar_url` 을 넣지 않는다(칸 기본값 NULL).
  - 나머지 글자는 그대로 둔다. `SET search_path = public, pg_temp` 를 더한다(Q9).
  - 옛 정의 전문은 down 파일에 그대로 넣는다.

### 5-6. VERIFY·되돌리기
- **VERIFY**
  - 표 2개·CHECK·UNIQUE, RLS 켬·정책 0개, **표 권한 = service_role SELECT 만**
  - FK(usage → items CASCADE, usage → options), 함수의 SECURITY DEFINER·search_path·EXECUTE(service_role 만)
  - 트리거 2개가 있고 사용 중
  - 첫 값이 두 과목 같음, 지금 상품 값이 모두 목록에 있음
  - 설정 행 필수 키
  - `handle_new_user` 본문에 `avatar` 글자 없음·`search_path` 있음
- **되돌리기** `supabase/rollback/<버전>_bundle17_product_info_down.sql`(코드를 먼저 되돌린 뒤)
  - 트리거 2개 → 트리거 함수 2개 → 쓰기 함수 → `market_item_usage_bases` → `market_item_attribute_options` → 설정 행 → `handle_new_user` 옛 정의
  - **이용 근거 행이 1건이라도 있으면 멈춘다**(상수 `c_allow_drop_usage_bases`, 대표 확인. 지우기 전에 CSV 로 꺼내는 조회를 머리말에 둔다).
  - 18·19번 함수가 있으면 멈춘다. plpgsql 본문이라 의존성으로 잡히지 않으므로 이름으로 검사한다: `duplicate_market_item`, `reorder_market_item_subproducts`, 19번판 `save_market_item_display`(본문에 `detail`).
  - 이름 바꾸기로 바뀐 상품 값은 되돌리지 않는다(작업 기록에 옛 이름이 있음).

### 5-7. (Q2 다른 안을 고를 때만) '전체' 학년 정리 스크립트
- `supabase/scripts/<날짜>_bundle17_grade_all_cleanup.sql`: `grade_level = '전체'` 인 행의 id 목록을 작업 기록(`market_item_bulk_attribute_update`, details 에 id 배열·옛 값)에 남기고 NULL 로 바꾼다.
- 되돌림 스크립트는 그 기록의 id 가운데 지금도 NULL 인 행만 '전체'로 되돌린다.
- 기본안에서는 만들지 않는다.

### 5-8. 리허설(운영 DB, `BEGIN … ROLLBACK`, 반복 가능)
15번 11-2 원칙을 따른다(경우 격리, 임시 표 + 마지막 SELECT, 마지막 줄 ROLLBACK, 생성기 사본, 결과는 `output/`).
- **light**(낮에 돌려도 됨, 기존 표 잠금 DDL 없음)
  - 사본은 `market_item_usage_bases` 의 `market_items` FK 를 뺀다(FK 를 만들면 `market_items` 에 SHARE ROW EXCLUSIVE 가 걸림).
  - 기존 두 표의 `CREATE TRIGGER` 도 뺀다. 대신 트리거 함수 2개를 두 표의 임시 사본(`CREATE TEMP TABLE … (LIKE market_file_types INCLUDING ALL)` 등)에 붙여 시험한다.
  - `handle_new_user` 교체(함수만 바뀌고 표 잠금 없음)와 `auth.users` 시험 행 INSERT 는 light 에 넣는다.
  - 이름 바꾸기 경우는 행 잠금만 생긴다. 실상품 1행('교과서')에만 걸리게 짧게 한다.
- **b_full**(새벽만): 실제 마이그레이션 전문(FK·트리거 포함) → VERIFY → down → 남는 것 0 → 다시 적용. 적용 전에 반드시 돈다.

| 경우 | 기대 결과 |
|---|---|
| P0 사전 점검 | 지문 다르면 멈춤, 이미 있으면 멈춤 |
| P1 권한 | 대표·`products.edit` 직원 성공 / 권한 없는 직원·`admin_role` 빈 관리자·탈퇴 관리자·일반 회원·없는 id 거절 |
| P2 목록 저장 | 새 항목 맨 뒤, 판 충돌, 중복 이름(숨김 포함), 줄바꿈·41자 거절, 과목·종류 바꾸기 거절, 바뀐 것 없음(기록 0) |
| P3 이름 바꾸기 | '교과서' → '교과서(시험)': 해당 과목 상품 1행만 바뀜, 다른 과목 같은 이름 그대로, 기록의 `renamed_item_count` = 1. `usage_basis` 이름 바꾸기는 상품을 건드리지 않음 |
| P4 순서 | 집합 불일치 3종(빠짐·더함·다른 과목) 거절, 숨김 포함 순서 저장 성공 |
| P5 이용 근거 | 새로·고침·판 충돌, 다른 과목·다른 종류 항목 거절, 2001자 거절, 상품 없음 거절 |
| P6 표시 설정 | 필수 키 빈 값·필터 이름의 `{type}`·필터 이름 21자·안내 61자 거절, **첫 값 그대로 저장 → 성공**(2판), 정상 저장 판 +1 |
| P7 잠금 트리거 | 두 표 각각 slug·code UPDATE 거절, **과목만 바꾸는 UPDATE 거절**, **hard DELETE 거절**(service_role·postgres 모두), 이름·순서·사용 여부·`deleted_at` UPDATE 통과 (2판) |
| P8 가입 트리거 | `avatar_url`·`picture`·`kakao_account.profile.profile_image_url` 이 든 시험 사용자 INSERT → `profiles.avatar_url` NULL, 나머지 칸(provider·kakao_id·phone·signup_completed)은 옛 함수와 같은 값 |
| P9 권한 표 | anon·authenticated 로 두 표 SELECT 거절, service_role 로 INSERT·UPDATE·DELETE 거절, anon·authenticated 로 함수 호출 거절 |
| P10 기록 | 경우마다 종류·건수, details 에 `request` 있음 |

## 6. 코드 변경
- **규칙 `src/lib/market-item-options.ts`**(순수): 종류, 글자 수 상한, 'route 저장 값 검사'(목록에 있거나 지금 값과 같음), 오류 코드 → 관리자 문구, 표시 설정 필수 키·자리표시 채우기
- **읽기 `src/lib/market-item-options-server.ts`**(server-only, 서버 키)
  - `listMarketItemOptions(subject, kind)`: `unstable_cache` 60초, 태그 `market_item_options`
  - `getMarketItemDisplay()`: 태그 `market_item_display`. 행이 없거나 필수 키가 비면 예외. 회원 화면은 필터 이름만 숨기고 필터 동작은 그대로 둔다.
- **이용 근거 `src/lib/market-item-usage-basis-server.ts`**(server-only): 관리자 route 만 가져다 쓴다. 회원 화면·`src/lib/market-items-server.ts`·공개 API 는 가져오지 않는다(계약 시험).
  - 표 이름 `market_item_usage_bases` 는 이 파일에서만 쓴다. 공용 select 상수(`market-items-server.ts:250-253` 등, 회원 route 도 씀)에 끼워 넣지 않는다. 18번의 '이용 근거 미입력' 칩은 이 모듈이 돌려주는 상품 id 집합만 받는다 (2판)
- **route**
  - 상품 POST·PATCH(`items/route.ts`·`items/[id]/route.ts`): `gradeLevel`·`sourceType` 을 규칙 함수로 검사(`INVALID_INPUT`, '목록에 없는 학년입니다' 등). `source1~4` 는 각 0~100자, 빈 값은 NULL.
  - 새 `GET·PUT /api/admin/market/items/[id]/usage-basis`(`products.edit`): PUT 은 5-5 함수.
  - 새 `/api/admin/market/item-options`·`/api/admin/market/item-display`(`products.edit`): 저장·순서 → 함수 → `revalidateTag(…, { expire: 0 })`
    - 무효화 태그: 목록 저장은 `market_item_options`, 표시 설정은 `market_item_display`. **이름 바꾸기로 `renamed_item_count > 0` 이면 `MARKET_PUBLIC_LIST_CACHE_TAG` 도**(검색 카탈로그·홈이 60초 캐시로 옛 학년·자료유형을 보이지 않게) (2판)
  - **상품 POST·PATCH 의 목록 검사는 캐시 없이 DB 에서 읽는다**(2판). 이름을 바꾼 직후 옛 이름이 캐시로 통과하지 않게 한다. 거절 문구는 "목록이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요."(목록 화면 상태 바꾸기가 열 때의 값을 다시 보내는 경우 포함)
  - 모든 쓰기 route 가 `p_request_meta` 를 넘긴다. 13번 공용 `adminRequestMeta` 가 있으면 쓰고, 없으면 같은 모양으로 만든다.
- **slug·code 오류**: `market-items-server.ts` 의 수정 함수가 DB 오류 `MARKET_IDENTIFIER_LOCKED` 를 받으면 지금과 같은 문구로 바꾼다(앱 잠금은 그대로 둠).
- **회원 화면**
  - `search-view.tsx`·`library-view.tsx` 의 필터 이름을 서버에서 받은 `facetLabels` 로 그린다. key 와 거르는 동작은 그대로다.
  - 보관함 빈 화면 글은 `libraryEmptyFilterHint` 에 `{type}` 을 채워 쓴다.
- `LISTBOARD_GRADE_OPTIONS` 는 상품 화면에서만 가져오지 않게 하고 남긴다(생성 기능이 씀).

## 7. 관리자 화면
### 7-1. '상품 표시 설정'(신설, 과목별 메뉴 `/admin/market/product-settings`)
- 위치: 사이드바 '문제마켓' 묶음, `ADMIN_MARKET_MENU_HREFS` 에 더한다. 페이지는 `requireAdminPagePermission('products.edit')`.
- 탭: [학년] [자료유형] [이용 근거(내부)] [검색 필터 이름]. 19번이 [상세 안내 문구] [자료 정보 항목] [구성·파일 유형] 탭을 더한다.
- [검색 필터 이름] 탭(과 19번 공통 탭) 머리에 '국어·영어 공통 설정입니다'를 적는다. 이 탭은 주소의 과목과 상관없이 같은 행을 읽고 쓴다 (2판)
- 목록 탭: 이름·사용 여부·[위로]/[아래로]·[순서 저장]. 이름을 바꿀 때 확인 창에 "이 이름을 쓰는 상품 n개도 함께 바뀝니다. 옛 이름으로 저장된 검색 링크(`?grade=옛 이름`)는 결과가 비게 됩니다."(서버가 센 수)를 띄운다. (2판)
- 이용 근거 탭 머리에 "회원에게 보이지 않는 내부 기록입니다"를 적는다.
- 시험 갱신: `admin-guard-coverage-contract`(`PAGE_REQUIREMENTS` 한 줄, route 권한 표), `admin-sidebar-*` 시험

### 7-2. 상품 편집
- '자료 정보' 상자
  - 학년·자료유형: DB 목록 선택칸. 맨 위는 '선택 안 함'(빈 값)이다. '전체'는 목록 항목으로만 나온다(Q2).
  - 상품 값이 숨긴 항목이거나 목록에 없는 옛 값이면 선택칸에 '(숨김) 이름'으로 함께 보이고 그대로 저장된다.
  - 출처 1~4: 한 줄 입력 4개(각 100자). 설명 "상세 '출처'에 입력한 순서대로 ' · '로 이어 보입니다."
- **'원저작물 이용 근거(내부)' 카드**: 새 상품은 첫 저장 뒤에 열린다. 근거 선택, 메모, 증빙 위치, [이용 근거 저장](상품 저장과 따로). 카드 머리에 '회원에게 보이지 않음' 배지를 단다.
- 18번이 코드를 나누므로, 이 묶음은 지금 파일에 최소로 넣는다(18번 5절이 그대로 옮김).

## 8. 회원 화면
- 상세·홈: 구조 변화 없음. 출처가 입력된 상품에 '출처' 줄이 생긴다.
- 검색·자료 보관함: 필터 이름이 '구성'(DB 값). 주소 `?type=` 그대로다.
- 이용 근거는 어느 화면·API 응답에도 없다. 상세 HTML·`/api/market/**` 응답에 근거 글자가 없는지 시험한다.

## 9. 작업 기록 종류(`src/lib/admin-audit-log.ts`)
| 종류 | 이름 | 남기는 곳 |
|---|---|---|
| `market_item_option_save` | 상품 목록 항목(학년·자료유형·이용 근거) 저장 | DB 함수 |
| `market_item_option_reorder` | 상품 목록 항목 순서 변경 | DB 함수 |
| `market_item_usage_basis_save` | 상품 원저작물 이용 근거 저장 | DB 함수 |
| `market_item_display_update` | 상품 표시 설정 수정 | DB 함수(19번도 같은 종류) |
- 모두 `DB_FUNCTION_ACTIONS` 에 등록한다. 함수 안 글자는 `'종류',` 꼴이다. 결제 연결 아님(`paymentLinkedActions` 에 넣지 않음).
- 상품 칸(학년·출처 등) 저장은 지금처럼 기록하지 않는다. 상태·가격만 기록하는 기존 규칙 그대로다.

## 10. 시험
### 10-1. 계약 시험 `tests/bundle17-product-info-contract.test.mjs`
- 마이그레이션
  - VERIFY 항목, 추가형(기존 표는 트리거 2개만)
  - REVOKE 대상에 service_role·PUBLIC, GRANT = service_role SELECT 만
  - `updated_by` 에 `REFERENCES` 없음
  - 트리거가 slug·code·workspace_subject 를 봄, 기록 종류 글자 꼴
  - 오류 코드 목록 = `market-item-options.ts` 매핑
  - down 의 멈춤 조건(근거 행, 18·19번 함수 이름)
- route 검사 예시 묶음: 목록에 있음 / 없음 / 숨김인데 지금 값과 같음 / 다른 과목 이름. 같은 표를 리허설 P2 에 넣는다.
- **내부 전용 고정**
  - `market-item-usage-basis-server` 를 가져오는 파일이 `src/app/api/admin/**` 와 `src/app/(admin)/**` 뿐이다.
  - `src/` 안에서 `market_item_usage_bases` 글자는 그 모듈과 `src/types/supabase.ts` 에만 있다(공용 select 에 끼워 넣는 누출을 막음) (2판)
  - `market_items` 에 새 칸이 없다.
  - 회원 화면 파일에 `usage_bas` 글자가 없다.
- 필터 이름을 DB 에서만 읽음(`'자료유형'` 글자가 `search-view.tsx`·`library-view.tsx` 에 없음), key `type` 유지
- `handle_new_user` 새 정의에 avatar 없음, search_path 있음
- 사이드바·가드·작업 기록 시험 갱신
- 지금 상품 폼 시험(`market-products-admin-material-info-contract` 등)을 새 칸에 맞춘다. `LISTBOARD_GRADE_OPTIONS` 를 상품 폼에서 쓰지 않음.
### 10-2. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost 는 개발 전용 미리보기(`PRODUCT_INFO_PREVIEW=1`, `NODE_ENV === 'development'` 일 때만, 11번 `checkout-consent-preview.ts` 방식)로 목록·설정 값을 메모리에서 그린다. 저장 버튼은 누르지 않는다.
- 확인할 것
  - V1 상품 편집 자료 정보(숨긴 옛 값 표시)·출처 4칸·이용 근거 카드
  - V2 상품 표시 설정 탭 4개, 이름 바꾸기 확인 창, 영어 메뉴에서 본 필터 이름 = 국어 메뉴에서 본 값 (2판)
  - V3 검색·보관함 '구성' 필터
  - V4 375px 가로 스크롤 없음
- 운영 배포 뒤 대표가 시험용 자료유형을 하나 만들어 이름을 바꿔 보고 숨긴다(상품 0개에 걸린 이름).

## 11. 문구·목록 초안(DB, 최종은 대표가 7-1 에서)
| 키 | 초안 |
|---|---|
| 학년 | 1학년 / 2학년 / 3학년 / 전체 |
| 자료유형 | 수능특강 / 교과서 / 모의고사 / 부교재 |
| 이용 근거(내부) | 자체 제작(원저작물 없음) / 저작권자 이용 허락(계약·서면) / 공개 이용 허락(공공누리·CC 등) / 기타(메모에 근거) / 확인 중 |
| `facetLabels` | 카테고리 / 구성 / 연도 / 학년 |
| `libraryEmptyFilterHint` | 검색어나 {type} 필터를 바꿔 보세요. |

## 12. 검증 관점(계획·구현 모두 PASS 까지)
1. **DB·마이그레이션**: 권한(서비스 키 포함)·FK·트리거, 이름 바꾸기 연쇄, 판·잠금 순서, light/b_full 나눔, 되돌리기, 가입 트리거 동등성(avatar 외 칸 같음)
2. **보안·법률**: 이용 근거가 회원 경로에 새지 않는지(REST·서버 응답·캐시), 이용 근거 목록 문구, 가입 트리거 변경이 4번 고지('프로필 이미지 수집 안 함')와 맞는지
3. **화면**: 옛 값·숨긴 값 상품 저장, 두 과목 같음, 검색·보관함 필터 동작 그대로
- 결제·크레딧을 건드리지 않는다. 결제 검증 3명은 두지 않는다. 가입 트리거를 바꾸므로 2번 관점이 회원가입(이메일·카카오) 흐름을 함께 본다.

## 13. 배포 순서
1. 계획 검증 PASS → 0절 답 반영
2. 구현 → 계약 시험 → 구현 검증 PASS
3. light 리허설(낮) → b_full 리허설(새벽, 적용 전 필수)
4. **DB 적용**(대표 승인, 새벽). 추가와 트리거뿐이라 옛 코드 영향은 없다. 다만 옛 관리자 화면에서 slug·code 를 바꾸는 요청은 이제 DB 에서도 거절된다(앱이 이미 막음).
5. 로컬 확인(미리보기, 쓰기 없음, 나 → 대표) → 대표 승인 → push·배포
6. 운영 확인: 대표가 시험 항목으로 목록 저장·이름 바꾸기·숨기기, 시험 계정 이메일 가입 1건 → `avatar_url` NULL(운영 시험 계정, 대표 승인 뒤)
7. **slug·code 를 꼭 바꿔야 할 때**(런북에 더함): 새벽 → `BEGIN; ALTER TABLE … DISABLE TRIGGER …; UPDATE …; ALTER TABLE … ENABLE TRIGGER …; COMMIT;` → 코드가 기대는 값과 맞는지 확인. 표 잠금이라 낮에는 하지 않는다.
8. 진행 기록·작업 순서표 후속 과제 두 줄(slug·code, avatar)을 '17번에서 처리'로 고친다.
- 18번은 이 묶음 배포 뒤에 시작한다(같은 화면 파일을 나눔).

## 14. 열린 질문·범위 밖
1. 이용 근거 목록 문구와 '확인 중' 상태로 판매해도 되는지 → 변호사 질문 목록(`docs/launch-owner-todo.md` 변호사 목록에 '(17번)'으로 더함)
2. 상품 재정리 뒤 이용 근거를 공개 필수로 올릴지(Q5) → 재정리 끝에 대표가 정함
3. 받아들이는 위험(2판): 상품 저장의 '지금 값과 같으면 통과' 읽기와 전체 행 쓰기 사이에 이름 바꾸기가 커밋되면 그 상품이 옛 이름으로 남는다(ms 창). 다음 저장도 통과하므로 잃는 값은 없고, 관리자가 목록 탭에서 다시 고친다.
4. 범위 밖: 자료유형별 출처 칸 이름, 이용 근거 증빙 파일 올리기(지금은 위치 글만), 이용 근거 일괄 입력, 상품 칸 변경 이력 기록

## 15. 1판 검증 반영 (2판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| DB·보안 minor | 이름 바꾸기 뒤 검색·홈 캐시(60초)가 옛 값을 보임 | 6절: `renamed_item_count > 0` 이면 `MARKET_PUBLIC_LIST_CACHE_TAG` 무효화, 7-1 확인 창에 옛 링크 안내 |
| DB·보안 minor | 누출 시험이 import 만 봄(공용 select 로 샐 수 있음) | 6절·10-1: 표 이름 글자가 근거 모듈·타입에만 있음, 18번 칩은 id 집합만 받음 |
| DB·보안 minor | 한 트리거 함수에서 `OLD.slug`·`OLD.code` 비교 → 없는 칸 오류 | 5-5: 표마다 함수 2개, P7 에 과목만 바꾸기 경우 |
| DB·보안 minor | hard DELETE 는 막지 않음 | 5-5: BEFORE DELETE 도 거절, P7 경우 추가 |
| DB·보안 minor | 저장 검사와 이름 바꾸기 경합, 목록 화면 재전송 | 6절 거절 문구(새로고침 안내), 14절 3 받아들이는 위험 |
| 상품 minor | 안내 문구(23자)가 '1~20자' 규칙에 걸림 | 5-5: 칸별 상한(필터 20자, 안내 60자), P6 '첫 값 그대로 저장 성공' |
| 상품 minor | 목록 검사가 60초 캐시로 옛 이름을 통과시킴 | 6절: 상품 저장의 목록 검사는 캐시 없이 DB 에서 |
| 상품 minor | 과목별 메뉴 안의 공통 설정이 헷갈림 | 7-1: '국어·영어 공통' 안내, V2 에 두 메뉴 값 같음 |

## 16. 구현 메모 (2026-11-26)
- **버전**: `20261219100000_bundle17_product_info.sql`(16번 `20261218100000` 뒤), down `supabase/rollback/20261219100000_bundle17_product_info_down.sql`, 리허설 `supabase/scripts/bundle17_rehearsal/`(`generate.mjs` → `a_light.sql`·`b_full.sql`).
- **0절 질문**: 답이 오기 전이라 Q1~Q9 모두 기본안으로 넣었다. 5-7('전체' 정리 스크립트)은 만들지 않았다.
- **계획과 다른 점**
  - 운영 `market_items` 에는 PK(`id`)만 있고 `(id, workspace_subject)` UNIQUE 가 없다. 그래서 5-3 의 복합 FK 대신 `item_id → market_items(id) ON DELETE CASCADE` 하나만 건다. 근거 표의 `workspace_subject` 는 저장 함수가 상품 행(`FOR SHARE`)에서 읽어 넣는다(상품 칸·FK 를 더하지 않는다는 4절 원칙 유지).
  - 결과: 근거 행의 과목·근거 항목 과목이 상품 과목과 같다는 것은 DB 제약이 아니라 저장 함수가 보장한다. 상품 과목을 DB 에서 직접 바꾸면 근거 행과 어긋날 수 있으므로, 나중에 상품 과목을 바꾸는 기능을 넣을 때 근거 행도 함께 고치도록 런북에 적는다.
  - 구현 검증 minor 반영(2026-11-26): 근거 저장(PUT)도 읽기(GET)와 같게 주소의 과목과 상품 과목이 다르면 404, 이름 바꾸기 확인 창은 상품 수만 다시 읽고 다른 줄의 고치던 값·저장 전 순서를 지우지 않음, 근거 저장 뒤 서버 값(다듬은 메모·판)으로 다시 그림, 필터 이름(DB)을 못 읽으면 검색·보관함 필터 막대를 숨김(코드 기본 이름 없음, 정렬·검색은 그대로).
  - 이용 근거 저장에 상품별 advisory lock(`'market_item_usage_basis:' || item_id`)을 더했다. 같은 상품 첫 저장 두 건이 PK 충돌로 500 이 나지 않게 한다. 순서: 권한 → advisory lock → 상품 행 FOR SHARE → 근거 항목 FOR SHARE → 근거 행 FOR UPDATE.
  - 순서 저장은 판(`revision`)을 바꾸지 않는다(14번과 같음 — 열린 이름 편집과 충돌하지 않게). `updated_by`·`updated_at` 만 바꾼다.
  - 표시 설정 함수는 17번 키(`revision`·`facetLabels`·`libraryEmptyFilterHint`)만 다시 만들고, 설정 행의 다른 키는 **저장된 값 그대로** 둔다(넘긴 값의 다른 키는 쓰지 않음). 본문에 `detail` 글자가 없어야 down 의 19번판 판정이 맞다(계약 시험).
  - 목록 route 에 `GET /api/admin/market/item-options?subject=&kind=`(항목별 상품 수, 캐시 없음)를 더했다. 이름 바꾸기 확인 창이 저장 직전에 서버가 센 수를 다시 읽고, 저장 뒤 목록·판을 다시 읽는다. 표시 설정 route 는 PUT 만 있다(화면은 서버 컴포넌트가 읽음).
  - 상세·홈은 이미 `source_1~4` 를 ' · '로 이어 보여서 고치지 않았다.
  - 검색·보관함 페이지는 기존 `await searchCachedMarketItemsForSubject(…)`·`Promise.all([rows, purchasePolicy])` 모양을 그대로 두고(기존 시험), 필터 이름 읽기만 앞에서 따로 시작해 함께 기다린다.
- **오류 코드**(마이그레이션 RAISE = `MARKET_ITEM_OPTION_ERROR_MESSAGES`, 계약 시험 대조): `MARKET_CATALOG_ACTOR_NOT_ALLOWED`, `MARKET_OPTION_INPUT_INVALID:칸`, `MARKET_OPTION_NOT_FOUND`, `MARKET_OPTION_REVISION_CONFLICT`, `MARKET_OPTION_DUPLICATE`, `MARKET_OPTION_REORDER_MISMATCH`, `MARKET_ITEM_NOT_FOUND`, `MARKET_USAGE_BASIS_INPUT_INVALID:칸`, `MARKET_USAGE_BASIS_REVISION_CONFLICT`, `MARKET_ITEM_DISPLAY_MISSING`, `MARKET_ITEM_DISPLAY_REVISION_CONFLICT`, `MARKET_ITEM_DISPLAY_INPUT_INVALID:칸`, `MARKET_IDENTIFIER_LOCKED`.
- **코드 파일**
  - 규칙 `src/lib/market-item-options.ts`(순수), 읽기·호출 `src/lib/market-item-options-server.ts`(회원 화면은 `getMarketItemDisplay` 만), 이용 근거 `src/lib/market-item-usage-basis-server.ts`(표 이름은 src 안에서 이 파일에만).
  - route: `api/admin/market/item-options`(GET·POST·PUT), `item-display`(PUT), `items/[id]/usage-basis`(GET·PUT) — 모두 `products.edit`, 쓰기는 `adminRequestMeta` 를 넘기고 미리보기면 DB 를 부르지 않는다.
  - 상품 POST·PATCH: `findMarketItemProductOptionProblem`(캐시 없는 DB 목록) + 출처 각 100자. 거절 문구 '목록에 없는 학년입니다. 목록이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.'(자료유형도 같은 꼴).
  - 관리자 화면: `/admin/market/product-settings`(사이드바 '상품 표시 설정', 과목별 묶음), 상품 폼의 학년·자료유형 선택칸('선택 안 함' + 사용 중 목록 + '(숨김) 옛 값'), 출처 1~4, `market-item-usage-basis-card.tsx`(첫 저장 뒤).
  - `market-items-server.ts`: 구성·파일 유형 수정이 DB 오류 `MARKET_IDENTIFIER_LOCKED` 를 받으면 지금과 같은 문구로 바꾼다(기존 앱 잠금 줄은 그대로).
- **시험**: 새 `tests/bundle17-product-info-contract.test.mjs`(19건)·`tests/fixtures/bundle17-product-info-examples.json`(route 검사 예시 9개 — 리허설 P2 가 같은 표). 고친 시험: 작업 기록·가드 표·사이드바 권한·기능 묶음 사이드바 목록·상품 폼 자료 정보(출처 1~4 다시 입력). 시험 도우미 `tests/helpers/market-images-harness.mjs` 는 순수 규칙 모듈을 실제 파일로 쓰고, route 로더가 목록 검사(DB 읽기)를 기본으로 통과시킨다. 전체 `node --test tests/*.test.mjs` 실패 46건은 구현 전과 같은 이름(새 실패 0).
- **리허설**
  - light: 2026-11-26 운영 DB 실행 PASS(로그 193줄, `RH FAIL` 0, 마지막 ROLLBACK 뒤 운영 상태 그대로 — 표 없음·가입 함수 지문 `61bc7b14…`·설정 행 0 확인). 결과 `output/b17-light-result.json`.
  - light 에서 본 것: P0(지문·이미 있음 멈춤), P1(권한 7종 + admin_role 빈 관리자는 CHECK 로 상태 자체 거절), P2(+route 예시 9개), P3(국어 '교과서' 1행만), P4, P5, P6, P7(임시 사본에서 slug·code·과목만·hard DELETE 거절, postgres·service_role), P8(카카오·이메일 시험 가입: 새 함수 avatar NULL, 나머지 칸 옛 함수와 같음), P9, P10(경우마다 기록 키·request), B1(근거 행·18·19번 함수·다른 FK 멈춤, down → 남는 것 0 → 다시 적용).
  - b_full(실제 두 표 트리거 P7F·대표 세션 slug 변경 거절·down 원본·이력 행)은 돌리지 않았다. **새벽, DB 적용 직전에 반드시 돈다.**
  - light 측정 적용 뒤 지문(18·19번 사전 점검용, md5(pg_get_functiondef)): `market_catalog_actor_allowed` 5b4bfe82fda3026623a2d77862f6f9a9, `save_market_item_option` 443509ac2c6148a0eafc85dba52be2ab, `reorder_market_item_options` 6718831114a84959c5214c0599b048aa, `save_market_item_usage_basis` df88f4ab5d3079815853eb81191f7e21, `save_market_item_display` 5cd1e1f548bd73aea05f5845a0212a6a, `handle_new_user` f418d1f7d1dffeb48d979a4e89a02b6b.
- **미리보기(10-2)**: `node supabase/scripts/bundle17_rehearsal/generate.mjs --preview` → `PRODUCT_INFO_PREVIEW=1 PRODUCT_INFO_PREVIEW_FILE=output/b17-product-info-preview.json npm run dev`. 마이그레이션 첫 값에서 만들고, V1(숨긴 옛 값 표시)을 보려고 국어 '부교재'를 숨긴 상태로 둔다. 미리보기에서는 저장 route 가 409 '미리보기에서는 저장하지 않습니다.'를 돌려준다.
- **문서**: `docs/launch-owner-todo.md` 변호사 목록에 '(17번)' 이용 근거 문구·'확인 중' 판매 질문을 더했다(14절 1).
- **남은 일**: 구현 검증(12절 세 관점) → b_full(새벽) → DB 적용(대표 승인) → 화면 확인(10-2, 나 → 대표) → push. 13절 8(진행 기록·후속 과제 두 줄)은 배포 뒤.
