# 14번 묶음 계획 · 공지 게시판 + FAQ

작성일: 2026-11-26
판: 3 (검증 PASS, 2026-11-26) — PASS 뒤 minor 2개를 같은 판에서 반영함(19절)
- 1판은 세 관점 모두 FAIL(major 8, 겹친 것을 합치면 6), 2판은 법률·보안·화면 PASS, DB FAIL(major 1 — 16번 down 과의 모순). 반영은 17절·18절 표에 있고, 고친 문단 끝에 `(2판)`·`(3판)` 을 붙였다.
- 작업 순서표 14번 '공지 게시판 + FAQ'(같은 틀: 관리자 작성·수정·삭제·고정·순서, 회원 목록·상세)를 만든다.
- 출처: `docs/operations-readiness-gaps.md` 1-13(FAQ), `docs/admin-content-management-plan.md`(회원·고객 메뉴), 운영 개선 계획 4-1 권한 `content.manage`('공지사항·FAQ 게시').
- 함께 처리하는 후속 과제: 작업 순서표 '(4번) … 공지 게시판(14번)이 생기면 재동의 확인 창의 알리는 수단 문구 교체'.
- 15번 계획 14절(미룬 것) 가운데 '팝업에서 게시글로 연결'만 정리한다(Q7). 팝업 기능은 만들지 않는다.
- 공지를 회원 알림(종 모양)으로 보내는 일은 16번이다. 14번은 연결점(글 주소, 개인정보 검사 함수)만 준비한다.

## 0. 대표 결정이 필요한 것(질문)
답이 오기 전에는 '기본안'으로 진행한다. 문구는 초안으로 넣고 최종은 대표가 관리자 화면에서 고친다.

| # | 질문 | 기본안 | 이유 |
|---|---|---|---|
| Q1 | 국어·영어로 나눌까? | **나누지 않는다(사이트 공통 하나)** | 공지·FAQ 는 회사·결제·계정 이야기라 과목과 무관하다 |
| Q2 | 누가 쓰나? | **대표 + `content.manage` 를 받은 직원.** 새 권한 없음. 가림(Q6)은 대표만 | 권한 표에 이미 '공지사항·FAQ 게시'로 있다 |
| Q3 | 본문 형식 | **서식 없는 글(문단·`- ` 목록·`## ` 소제목)** + 글마다 사이트 안 링크 1개(선택). 이미지·첨부·HTML 없음 | 약관 화면과 같은 그리기라 새 편집기·XSS 위험이 없다 |
| Q4 | 회원이 어디서 들어오나? | 하단에 '공지사항'·'자주 묻는 질문'(정책 링크와 다른 줄, DB 문구). **게시 글이 0개인 쪽은 링크가 저절로 숨는다.** 헤더 링크는 대표가 '상단 메뉴'에서 데이터로 더한다. 고객지원 화면 아래 FAQ 링크(13번 배포 뒤) (2판) | 빈 게시판으로 가는 링크를 막는다. 헤더 링크는 이미 DB 로 관리된다 |
| Q5 | 고정 글 최대 개수 | **5개**(DB 값) | 첫 화면이 고정 글로 가득 차지 않게 |
| Q6 | 삭제와 잘못 올린 개인정보 | **삭제 = 숨김 보관.** 글 원문은 가릴 수 있는 판 이력 표에만 두고, 지울 수 없는 작업 기록에는 지문·글자 수·바뀐 칸만 남긴다. 개인정보가 들어간 글은 대표가 [가림]으로 모든 판의 제목·본문을 가림 문구로 바꾼다 (2판) | 개인정보 검사는 모양(이메일·전화·주민번호)만 잡는다. 회원 이름 등은 사람이 실수할 수 있다. 13번과 같은 원칙(가릴 수 없는 작업 기록에 원문을 넣지 않음) |
| Q7 | 15번 공지 팝업과의 관계 | **팝업은 그대로.** 팝업 링크에 공지 주소(`/notices/{id}`)를 쓸 수 있게 [주소 복사]와 안내를 둔다. 팝업이 가리키는 글을 숨기거나 삭제하면 확인 창이 경고한다. 30일 고지 기간에는 팝업 링크를 `/terms/upcoming` 그대로 둔다 (2판) | 15번 끊김 판정은 링크가 `/terms/upcoming` 과 글자까지 같아야 한다(15번 4-3) |
| Q8 | 약관 변경 고지에 공지 게시판도 쓸까? | **보조로만 쓸 수 있다.** 정식 고지는 15번 경로(변경 예정 약관 게시·팝업·한 줄 안내)다 | 고지 증빙과 잠금은 15번 게시 행에 있다 |
| Q9 | FAQ 검색 | **만들지 않는다** | 글 수가 적다 |

## 1. 지금 상태(코드·운영 DB 읽기 전용 확인, 2026-11-26)
- **공지·FAQ 흔적 없음**: 운영 DB 에 관련 표·설정 키가 없다. 코드는 `src/lib/admin-permissions.ts:18` 의 `content.manage` 정의뿐이다(받은 직원 0명).
- **회원 화면 틀**: `src/app/(solvook)/layout.tsx` 가 헤더·하단·15번 팝업을 그린다. 12번이 같은 layout 에 이용 제한 한 줄 안내를 더한다.
- **하단**: `src/lib/solvook-footer-data.ts`, 정책 링크는 `solvook-footer.tsx:64-66` 의 `nav aria-label="약관 및 정책"` 안에 있다. 고객센터 칸은 `site_footer_content.fixedFields.customerCenter.value`(전화 모양)·`fixedFields.orderEmail.value` 다. 하단 정보의 약관 문서 칸은 고지 기간 동안 잠긴다(15번 4-4). 이 묶음은 그 행을 고치지 않는다. (2판)
- **헤더 링크**: `storefront_header_links` 에 '크레딧 충전' 1개.
- **동의 관문**: `src/lib/consent-gate.ts` 제외 목록 밖의 화면은 재동의 전 회원을 `/consent` 로 보낸다. 미들웨어(`src/lib/supabase/middleware.ts:97·503`)는 카카오 가입 미완료 회원에게 `/terms` 만 연다.
- **본문 그리기** `src/components/legal/policy-document-content.tsx`, **목록 나눔** `src/lib/list-pagination.ts`(기본 20개), **링크 규칙** `src/lib/site-notice-popup.ts` 의 `isAllowedNoticeLink`.
- **관리자 계정 삭제**는 auth 사용자를 지우고 `profiles` 가 CASCADE 로 지워진다(`src/lib/admin-accounts-server.ts:250`). 그래서 관리자를 가리키는 FK 는 계정 삭제를 막는다. 12번 마이그레이션과 `admin_audit_log` 는 행위자 칸을 FK 없는 uuid 로 둔다. (2판)
- **표 기본 권한**: 운영 `pg_default_acl` 이 public 새 표에 service_role 전체 권한(arwdDxtm)을, 새 함수에 anon·authenticated·service_role EXECUTE 를 준다. 그래서 회수 대상에 service_role 과 PUBLIC 을 모두 넣어야 한다(12번 마이그레이션 124~127행과 같은 방식). (2판)
- **행위자 판정**: 서버 키 함수는 행위자 id 로 직접 판정한다. 12번 `member_suspension_actor_allowed`(`20261214100000_member_suspension.sql:268-275`)의 식(`is_admin IS TRUE AND withdrawn_at IS NULL AND (owner OR (staff AND 권한 행))`)을 따른다. TS `buildAdminAccess` 는 `admin_role` 이 비면 staff 로 보므로 DB 가 더 엄격하다. (2판)
- **요청 정보**: 지금 `withdrawalRequestMeta(request: Request)`(`src/lib/member-withdrawal-server.ts:471`)는 서버 액션에서 쓸 수 없다. 13번이 공용 `adminRequestMeta`(`headers()` 지원)를 만든다(13번 계획, 아직 계획 단계). (2판)
- **작업 기록**: `src/lib/admin-audit-log.ts`, DB `record_admin_audit(…)` 9인자(운영 지문 `md5(pg_get_functiondef)` = `a42b474d9d95753ffba5041acb0c1c77`, 12번 사전 점검과 같은 값). 시험 `tests/admin-audit-log-contract.test.mjs` 는 DB 함수 안 기록 종류를 `DB_FUNCTION_ACTIONS` 에 등록해야 하고, 함수 안 글자가 `'종류',` 꼴이어야 한다. (2판)
- **관리자 메뉴·가드 시험**: `src/lib/admin-sidebar.ts`, `tests/admin-guard-coverage-contract.test.mjs`(액션 파일 목록 + `PAGE_REQUIREMENTS`).
- **4번 후속 문구**: `src/app/(admin)/admin/footer/signup-consent-admin.tsx:106-107` 과 403행 근처의 경우별 안내(관리자 안내, 코드 글자). (2판: 행 번호 고침)
- **마이그레이션**: 운영 마지막 적용 `20261216100000`. 12번 `20261214100000`, 13번 `20261215100000~130000`.

## 2. 목표
1. 회원(비로그인 포함)이 `/notices` 에서 목록을, `/notices/{id}` 에서 본문을 본다. 정렬은 5-4 '정렬 규칙'대로다.
2. 회원이 `/faq` 에서 분류별 질문을 펼쳐 본다. 질문 주소 `/faq#{id}` 로 오면 그 질문이 어느 분류·몇 번째든 펼쳐져 보인다. (2판)
3. 재동의 전·카카오 가입 미완료·이용 제한·로그인 차단(비로그인) 회원도 두 화면을 본다.
4. 권한 있는 관리자가 같은 틀로 글을 쓰고·고치고·숨기고·삭제하고, 공지 고정 순서와 FAQ 분류 안 순서를 바꾼다. 판(revision)으로 충돌을 막는다.
5. 화면 문구(제목·빈 화면·링크 이름·FAQ 분류)는 DB 에 있고 관리자 화면에서 고친다.
6. 모든 쓰기가 같은 거래에서 기록을 남긴다. 글 원문은 가릴 수 있는 판 이력 표에, 작업 기록에는 지문·글자 수·바뀐 칸만 남는다. (2판)
7. 개인정보 모양이 든 글·문구는 저장되지 않는다(회사 고객센터 연락처는 예외). 사람이 놓친 개인정보는 대표가 가린다. (2판)
8. 4번 후속 문구가 15번 정식 고지 절차를 먼저 안내하도록 바뀐다. (2판)

## 3. 범위
**넣는 것**: DB(표 2, 설정 행 1, 함수 7), 회원 화면 3개, 관리자 화면 2개 + 안내 문구 탭, 하단 링크, 동의 관문 제외, 고객지원 FAQ 링크, 4번 후속 문구, 시험.
**넣지 않는 것**(15절): 예약 게시, 이미지·첨부, 댓글, 조회 수, 검색, 되살리기, 공지 알림(16번), 15번 본 작업.

## 4. 원칙
- **하나의 틀**: 글 표 하나(`board` = `notice`·`faq`), 저장 함수 하나, 관리자 부품 하나, 회원 그리기 부품 하나.
- **회원 읽기는 서버 키 + 캐시**. 표에 anon·authenticated 권한을 주지 않는다.
- **쓰기는 DB 함수로만**. service_role 도 표에 직접 쓰지 못한다(SELECT 만). 함수가 권한·판·입력·개인정보·고정 상한을 보고 기록을 같은 거래에서 남긴다. (2판)
- **지울 수 없는 곳에 원문을 두지 않는다**(13번과 같은 원칙). 원문은 판 이력 표, 작업 기록은 지문. (2판)
- **코드에는 규칙만**: 종류 이름, 글자 수 상한, 링크·개인정보 판정, 정렬 규칙. 문구·분류·고정 상한은 DB.
- **운영 DB 한 개**: localhost 에서 저장·삭제·순서 저장·가림을 누르지 않는다.

## 5. DB 변경(마이그레이션 `20261217100000_bundle14_site_board.sql`, 가안)
버전은 가안이고 12·13번 실제 적용 순서에 맞춰 바뀔 수 있다(16번은 그 뒤). 새 표·행·함수만 만들고 기존 표의 정책·트리거를 건드리지 않는다. `system_settings` 에는 행 INSERT 만 한다. 실회원이 적은 시간에 `lock_timeout = '3s'` 로 적용한다. (2판)

### 5-1. 사전 점검(다르면 멈춤)
- `record_admin_audit(…)` 9인자의 지문이 `a42b474d…` 와 같다(12번 방식). `admin_permission_grants`, `profiles.admin_role`·`withdrawn_at` 이 있다. (2판)
- 새 표 2개·설정 키·함수가 아직 없다(다시 적용은 되돌리기 뒤에만).

### 5-2. 표 `site_board_posts`(지금 글)
- 칸: `id`, `board`(`notice`·`faq`), `title`(1~100, 한 줄), `body`(1~20000), `link_url`·`link_label`(선택), `faq_category_key`(FAQ 만), `is_pinned`(공지만), `sort_order integer NOT NULL DEFAULT 0`, `is_published`, `published_at`(처음 게시), `content_updated_at`(게시 뒤 제목·본문·링크가 바뀐 마지막 때), `deleted_at`, `redacted_at`, `created_by uuid NOT NULL`·`updated_by uuid`·`deleted_by uuid`·`redacted_by uuid`(**FK 없는 uuid**, 관리자 계정을 지워도 기록이 남음 — 12번·작업 기록과 같은 이유), `created_at`·`updated_at`, `revision` (2판)
- CHECK: FAQ 는 고정 불가, 공지는 분류 없음, 게시 중이면 `published_at` 있음, 삭제한 글은 게시 아님.
- 인덱스: `(board) WHERE is_published AND deleted_at IS NULL` 하나(글 수가 적다. 정렬은 5-4 규칙으로 쿼리에서). (2판)
- 권한: RLS 켬, 정책 없음. `REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated, service_role` 뒤 `GRANT SELECT … TO service_role`. (2판)

### 5-3. 표 `site_board_post_revisions`(판 이력, 가릴 수 있음) (2판)
- 칸: `id`, `post_id`(같은 묶음 안이라 FK, ON DELETE 없음), `revision`, `title`, `body`, `link_url`, `link_label`, `faq_category_key`, `is_pinned`, `is_published`, `body_sha256`, `saved_by uuid`(FK 없음), `saved_at clock_timestamp()`, `redacted_at`, `redacted_by`. UNIQUE `(post_id, revision)`.
- 저장·삭제마다 그 뒤 상태 1행. 순서만 바꾼 것은 넣지 않는다(작업 기록으로 충분).
- 가드 트리거: DELETE·TRUNCATE 거부. UPDATE 는 거래 로컬 설정 `app.site_board_redact` 가 그 `post_id` 와 같을 때 `title`·`body` → 가림 문구, `link_url`·`link_label` → NULL, `redacted_*` NULL→값만 받는다(13번 가림 방식과 같음). 링크 주소의 검색어 부분에도 이름이 들어갈 수 있어서 링크는 지운다. (3판)
- 권한: 5-2 와 같다(service_role SELECT 만).
- 보관: 공개하려고 쓴 글이라 기한을 두지 않는다. 개인정보는 가림으로 처리한다.

### 5-4. 설정 행 `site_board_content`(`ON CONFLICT (key) DO NOTHING`)
```
{ "revision": 1,
  "notice": { "pageTitle", "pageDescription", "emptyTitle", "emptyDescription", "pinnedLabel", "updatedLabel",
              "backToListLabel", "notFoundTitle", "notFoundDescription", "footerLinkLabel", "maxPinned": 5 },
  "faq":    { "pageTitle", "pageDescription", "emptyTitle", "allCategoryLabel",
              "categories": [ { "key": "credit", "label": "…" }, … ],
              "supportPrompt", "supportLinkLabel", "footerLinkLabel" },
  "footer": { "navLabel" },
  "redactedText": "개인정보가 포함되어 가린 글입니다." }
```
- 하단·고객지원 링크는 스위치가 아니라 **게시 글이 1개 이상일 때만** 보인다(Q4). (2판)
- 쓰기 막기 RESTRICTIVE 정책은 만들지 않는다(13번과 같은 판단: 결제·법적 문구가 아니고, 표 전체 잠금을 피함). 대표 세션의 직접 수정은 읽을 때 필수 키 검사로 걸러진다(5-6).

### 5-5. 정렬 규칙(코드 `site-board.ts` 와 함수가 같은 규칙) (2판)
- **공지**: 고정 글을 `sort_order, id` 순으로 먼저, 그 뒤 비고정 글을 `published_at DESC, id` 순. 비고정 글에는 `sort_order` 를 쓰지 않는다.
- **FAQ**: 설정 `categories` 배열 순서 → 분류 안 `sort_order, id`. '전체' 탭도 같은 순서로 분류 제목 아래 묶어 보인다.
- **sort_order 를 바꾸는 때**: 고정으로 바뀌면(새 글이든 기존 글이든) 고정 맨 뒤, 고정이 풀리거나 삭제되면 0, FAQ 가 새로 생기거나 분류가 바뀌면 새 분류 맨 뒤.
- **고정 글 수**는 '미삭제이고 고정인 글(숨김 포함)' 한 가지 정의로 상한·순서 범위·`maxPinned` 검사에 같이 쓴다.
- **FAQ 분류 범위**(순서 바꾸기)는 '그 분류의 미삭제 글(숨김 포함)'이다. **분류 사용 중**도 '미삭제 글(숨김 포함)이 1개 이상'이다. 삭제한 글에 남은 옛 분류 key 는 그대로 두며, 삭제 글만 남은 분류는 지울 수 있다. 관리자 순서 묶음(7-2)도 이 범위 그대로 숨긴 글을 보인다. (3판)

### 5-6. 함수(SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` 뒤 service_role 만 EXECUTE)
- **`site_board_actor_allowed(p_actor_id)`**(내부): `p_actor_id IS NOT NULL AND is_admin IS TRUE AND withdrawn_at IS NULL AND (admin_role = 'owner' OR (admin_role = 'staff' AND content.manage 권한 행))`. `admin_role` 이 빈 관리자는 거절(TS 보다 엄격, 예시 묶음에 따로 적음). (2판)
- **`member_facing_text_pii_hits(p_text)`** → text[](STABLE): 이메일·휴대폰·일반 전화·주민번호 모양. `fixedFields.customerCenter.value`·`fixedFields.orderEmail.value` 와 같은 것은 뺀다. 전화는 **숫자만 남겨** 비교한다(하이픈 유무 무관). 16번이 같은 함수를 쓴다. TS 순수 함수 `src/lib/member-facing-text-pii.ts` 와 같은 예시 묶음을 돌린다. (2판)
- 모든 쓰기 함수의 마지막 인자는 `p_request_meta jsonb` 다. 객체가 아니면 `SITE_BOARD_INPUT_INVALID`. details 의 `request` 에 넣는다. (2판)
- **`save_site_board_post(p_actor_id, p_id, p_expected_revision, p_board, p_title, p_body, p_link_url, p_link_label, p_faq_category_key, p_is_pinned, p_is_published, p_request_meta)`** → jsonb
  - 권한 없으면 `SITE_BOARD_ACTOR_NOT_ALLOWED`. 새 글은 `p_id`·판 NULL. 고칠 때는 `FOR UPDATE`, 판이 다르면 `SITE_BOARD_REVISION_CONFLICT`, 삭제·가린 글이면 `SITE_BOARD_POST_DELETED`. 종류는 못 바꾼다.
  - 다듬기·검사(`SITE_BOARD_INPUT_INVALID` + 칸 이름): 링크는 `isAllowedNoticeLink` 와 같은 예시 묶음, FAQ 분류는 설정에 있어야 함.
  - 개인정보: 제목·본문·링크 주소·링크 이름 → `SITE_BOARD_PII_SUSPECTED`(종류만 돌려줌). (2판)
  - **잠금 순서**(3판 PASS 뒤): 종류와 관계없이 입력 다듬기 뒤, 설정 행 읽기(FAQ 분류 존재·`maxPinned`)와 sort_order 계산 **전에** `pg_advisory_xact_lock(hashtext('site_board_order'))` 를 잡는다. 분류 지우기·상한 낮추기(`save_site_board_content`)와 동시에 와도 설정에 없는 분류의 글이나 상한 초과가 생기지 않는다.
  - 고정 상한: 잠금 뒤 읽은 `maxPinned` 로 5-5 정의를 센다 → `SITE_BOARD_PIN_LIMIT`. 5-5 의 sort_order 규칙을 적용한다. (3판)
  - 날짜: 처음 게시 때 `published_at`. 게시된 적이 있는 글의 제목·본문·링크가 바뀌면 `content_updated_at = clock_timestamp()`(고정·순서·게시 여부만 바뀌면 그대로). 회원 상세에 '수정 날짜'가 보인다. (2판)
  - 바뀐 것이 없으면 기록 없이 돌려준다. 바뀌면 판 이력 1행 + 작업 기록 `site_board_post_save`(details: `board`, `post_id`, `created`, `revision_before/after`, `revision_row_id`, `changed_fields`, `title_length`·`body_length`, `body_sha256_before/after`, `is_published`·`is_pinned` 앞뒤, `request`, `saved_at`. **제목·본문 원문은 넣지 않는다**). (2판)
- **`delete_site_board_post(p_actor_id, p_id, p_expected_revision, p_request_meta)`**: `deleted_at`, 게시 끔, 고정 해제·`sort_order = 0`, 판 이력 1행, 기록 `site_board_post_delete`(지문·글자 수만).
- **`reorder_site_board_posts(p_actor_id, p_board, p_scope, p_ids, p_request_meta)`**: 범위는 공지 `'pinned'`(5-5 고정 글 정의), FAQ 분류 key. id 집합이 정확히 같아야 함(`SITE_BOARD_REORDER_MISMATCH`). 같은 advisory lock. 기록 `site_board_post_reorder`(범위, 앞뒤 id 순서).
- **`redact_site_board_post(p_actor_id, p_id, p_reason_code, p_request_meta)`** (2판): **대표만**. 글이 게시 중이면 거절(먼저 숨김·삭제). 지금 글과 모든 판 이력의 제목·본문을 `redactedText` 로, 링크 주소·이름을 NULL 로 바꾸고 `redacted_*` 를 채운다. (3판) 사유는 정해진 코드(`pii` 등)만 받는다(자유 글 없음). 기록 `site_board_post_redact`(바뀐 판 수).
- **`save_site_board_content(p_actor_id, p_expected_revision, p_value, p_request_meta)`**: **함수 첫머리에서 같은 advisory lock 을 잡은 뒤** 권한·판, (3판 PASS 뒤) 필수 키 빈 값 거부, 분류 key 형식·중복, **글이 남은 분류 지우기 거부**(`SITE_BOARD_CATEGORY_IN_USE`), `maxPinned` 1~20 이고 지금 고정 글 수 이상(**같은 advisory lock 을 먼저 잡고** 센다 — 상한 낮추기와 고정이 동시에 와도 어긋나지 않게), `redactedText` 는 한 줄·100자 이하(가림이 제목 CHECK 에 걸려 실패하지 않게), 회원에게 보이는 모든 문구에 개인정보 검사. (3판) 기록 `site_board_content_update`(before·after — 회사가 쓰는 화면 문구라 그대로, 개인정보 검사 통과). (2판)
- 필수 키 목록은 코드(`SITE_BOARD_REQUIRED_KEYS`)와 함수가 같이 쓰고 계약 시험이 대조한다.

### 5-7. VERIFY·되돌리기
- VERIFY: 표 2개·CHECK·인덱스·RLS·정책 0개, **표 권한 = service_role SELECT 만**(anon·authenticated·PUBLIC 0), 가드 트리거, 함수 7개의 SECURITY DEFINER·search_path·EXECUTE(service_role 만), 행위자 칸에 FK 없음, 설정 행 필수 키. (2판)
- 되돌리기 `supabase/rollback/20261217100000_bundle14_site_board_down.sql`(코드 먼저 되돌린 뒤): 함수 → 표 2개 → 설정 행. **글이 1건이라도 있으면 멈춘다**(상수 `c_allow_drop_posts`, 대표 확인). **16번 함수가 있거나, `site_board_posts` 를 가리키는 FK 제약(`pg_constraint.confrelid`) 가운데 14번 판 이력 표(`conrelid = site_board_post_revisions`)가 아닌 것이 있으면 멈춘다.** 16번 함수는 plpgsql 본문이라 의존성으로 잡히지 않으므로 **이름으로** 검사한다: `member_facing_text_pii_hits` 를 부르는 `send_member_broadcast`·`save_member_notification_texts`·`retract_member_broadcast`·`member_broadcast_preview`, 5인자 `reject_point_charge_refund`(16번 5-8). 개인정보 판정 함수를 지워 환불 거절이 실행 중에 깨지는 일을 막는다. (3판 PASS 뒤) 16번 down 은 함수와 `post_id` FK 를 지우고 기록 표는 증빙으로 남기므로, **기록 표가 있는 것만으로는 멈추지 않는다.** `c_allow_drop_posts` 로 지울 때 기록 표에 `post_id` 가 있는 행이 있으면, 그 값은 지워진 글을 가리키게 된다(기록 표는 가드로 고칠 수 없음). 그래서 16번을 다시 적용할 때 FK 를 `NOT VALID` 로 붙인다(16번 5-1). (3판)

### 5-8. 리허설(운영 DB, `BEGIN … ROLLBACK`, 반복 가능)
15번 11-2 원칙(경우 격리·표지 예외, 임시 표 + 마지막 SELECT, 마지막 줄 ROLLBACK, 생성기 사본, 결과는 `output/`)을 따른다.

| 경우 | 기대 결과 |
|---|---|
| B1 적용 | VERIFY 통과, 되돌리기 → 남는 것 0 → 다시 적용. 16번 함수가 있으면 멈춤, **16번 down 뒤 상태(기록 표만 남고 FK 없음)에서는 통과** (3판) |
| B2 권한 | 대표·`content.manage` 직원 성공 / 권한 0 직원·`admin_role` 빈 관리자·`is_admin=false` 인데 권한 행 남음·탈퇴 관리자·일반 회원·없는 id 거절. 가림은 직원 거절 (2판) |
| B3 저장 | 새 글·고침·판 충돌·삭제 글·종류 바꾸기·칸별 입력 오류·바뀐 것 없음(기록·판 이력 0)·처음 게시 날짜 유지·게시 뒤 본문 수정 → `content_updated_at`, 순서만 → 그대로 |
| B4 개인정보 | 네 모양 거절(본문·링크 주소·설정 문구), 고객센터 번호 하이픈 있음·없음 통과, 응답에 글자 없음 |
| B5 고정·순서 | 상한 초과(숨긴 고정 포함), 기존 글 고정 → 맨 뒤, 고정 해제 → 날짜순 자리, FAQ 분류 바꿈 → 새 분류 맨 뒤, 순서 집합 불일치 3종 거절, 숨긴 고정 글·숨긴 FAQ 가 있는 범위의 순서 저장 성공 (3판). 상한 낮추기와 고정의 동시 실행은 `BEGIN…ROLLBACK` 로 재현할 수 없어 계약 시험이 '두 함수 모두 같은 잠금을 먼저 잡음'을 단언한다 |
| B6 삭제·분류·가림 | 삭제 뒤 목록에서 빠짐, 글(숨김 포함) 있는 분류 지우기 거절, 삭제 글만 남은 분류 지우기 통과, 게시 중 가림 거절, 가림 뒤 판 이력 전부 가림 문구·링크 NULL, 긴·여러 줄 `redactedText` 저장 거절, 판 이력 DELETE·다른 UPDATE 거절 (3판) |
| B7 기록 | 경우마다 종류·건수, details 에 `request` 있고 제목·본문 원문 없음 |
| B8 권한 표 | anon·authenticated 로 표 SELECT·INSERT 거절, **service_role 로 INSERT·UPDATE·DELETE 거절**, anon·authenticated 로 함수 호출 거절 (2판) |

## 6. 코드 변경
- **선행**: 13번의 공용 `adminRequestMeta`(`headers()` 지원) 커밋. 서버 액션이 `adminRequestMeta(await headers())` 를 `p_request_meta` 로 넘긴다. (2판)
- **읽기 `src/lib/site-board-server.ts`**(server-only, 서버 키)
  - `getSiteBoardContent()`: `unstable_cache` 60초, 태그 `site_board_content`. 행이 없거나 필수 키가 비면 예외. 기본 문구를 코드에 두지 않는다.
  - `getNoticePage(page)`(쪽 나눔)·`getNotice(id)`·`getAllPublishedFaqs()`(**쪽 나눔 없이 전부**)·`getBoardLinkAvailability()`(종류별 게시 글 있음 여부). 모두 `unstable_cache` **60초 상한 + 태그** `site_board_posts`. 저장 뒤 `revalidateTag(…, { expire: 0 })`. 태그 갱신이 실패해도 60초 안에 내려간다. (2판)
  - id 는 uuid 모양이 아니면 바로 없음.
- **규칙 `src/lib/site-board.ts`**(순수): 종류, 상한, 링크 검사(`isAllowedNoticeLink` 를 가져다 씀), 필수 키, 5-5 정렬, 오류 코드 → 관리자 문구.
- **개인정보 판정** `src/lib/member-facing-text-pii.ts`.
- **동의 관문**: `consent-gate.ts` 제외 목록에 `/notices`·`/faq`, 미들웨어 카카오 미완료 분기에도 두 경로. 12번이 같은 파일을 고치므로 12번 커밋 위에 이어 붙인다.
- **하단**: `getSolvookFooterData` 가 게시 글이 있는 종류의 링크를 돌려주고, 하단은 정책 `nav` 와 **다른 `nav`**(이름 `footer.navLabel`, DB)로 그린다. 읽기 실패면 링크만 빼고 하단은 그린다. (2판)
- **고객지원 FAQ 링크**: FAQ 게시 글이 있을 때만. 13번이 고치는 화면 파일 위에 붙인다. 13번 `support_page_content` 키는 건드리지 않는다.
- **4번 후속 문구**(2판): `signup-consent-admin.tsx:106-107` 과 403행 경우별 안내를 15번 절차 순서로 바꾼다. "① 변경 예정 약관을 게시한다(`/terms/upcoming`, 런북 절차 — 고지 증빙·고지 기간 잠금이 여기서 생김) ② 회원에게 불리한 변경은 30일 전부터, 공지 팝업을 켠다 ③ 필요하면 공지사항에도 같은 내용을 올린다(보조) ④ 시행일 당일: 15번 시행 스크립트(런북)로 시행하면 본문 교체와 다시 동의가 함께 되므로 이 버튼을 누르지 않는다. 스크립트를 쓰지 않는 변경은 하단 정보 본문이 새 전문으로 바뀐 것을 확인한 뒤 누른다." 지금 문구의 '본문을 바꾼 뒤 누르기' 조건을 잃지 않는다. 관리자 안내라 코드 글자로 둔다. (3판)

## 7. 관리자 화면
### 7-1. 위치와 권한
- 사이드바 '회원·고객' 묶음에 `/admin/notices`·`/admin/faq`, 경로 권한 `content.manage`.
- 페이지 `requireAdminPagePermission('content.manage')`. 서버 액션(`src/app/(admin)/admin/notices/actions.ts` 하나를 두 화면이 씀): `requireAdmin()` → `assertAdminActionPermission(…)`(가림은 `'owner'`) → 서버 키로 5-6 함수 → `revalidateTag`.
- 시험 갱신(2판): `admin-guard-coverage-contract` 의 액션 파일 목록과 `PAGE_REQUIREMENTS` 두 줄(`notices/page.tsx`·`faq/page.tsx`), `admin-audit-log-contract` 의 `DB_FUNCTION_ACTIONS` 다섯 줄(9절 종류), 함수 안 기록 종류는 `'종류',` 꼴.

### 7-2. 목록
- 같은 부품 `BoardAdmin`(`board` 인자). 칸: 상태, 고정(공지), 분류(FAQ), 제목, 게시일·수정일, 마지막 수정자.
- 순서 바꾸기: 고정 공지·FAQ 분류 안에서 [위로]·[아래로] → [순서 저장]. 묶음은 5-5 범위 그대로라 **숨긴 글도 '숨김' 표시를 달고 함께 보인다**(빠지면 순서 저장이 늘 어긋남). 충돌이면 다시 읽는다. (3판)

### 7-3. 글 편집(옆 창)
- 칸: 제목, 본문(글자 수), 링크 주소·이름, 분류(FAQ), 고정(공지), 게시 스위치. 개인정보 경고(TS), [미리보기](회원 그리기 부품, 저장 없음).
- [주소 복사](게시된 공지): `/notices/{id}`. 옆 안내 "공지 팝업 링크로 쓸 수 있습니다. 약관 변경 고지 기간에는 팝업 링크를 바꾸지 마세요." 고지 기간(15번 게시 행 `upcoming`)이면 경고 색. **지금 켜진 팝업의 `linkUrl` 이 이 글이면 '지금 공지 팝업이 이 글로 연결됩니다'** 를 보인다. (2판)
- **팝업 연결 판정**(3판): `shouldServeNoticePopup` 이 참(켜짐·끝이 미래, 시작 전 예약 포함)이고, `linkPathOf(linkUrl)`(쿼리·`#`·끝 `/` 를 뗀 경로, `src/lib/site-notice-popup.ts:277`)를 uuid 소문자로 맞춘 값이 `/notices/{id}` 와 같을 때. 글자 비교만 하지 않는다.
- **숨기기·삭제 확인 창**(2판): 기본 "회원 화면에서 사라집니다. 기록에는 남습니다." 켜진 팝업이 이 글을 가리키면 "지금 공지 팝업 버튼이 이 글로 연결됩니다. 숨기면 팝업 버튼이 끊깁니다. 먼저 팝업 링크를 바꾸세요." 경고를 더한다(서버가 팝업 설정만 읽음, DB 변경 없음). 16번 뒤에는 이 글로 보낸 공지 알림이 있으면 같은 경고를 더한다.
- **[가림]**(대표, 숨김·삭제한 글만): 확인 창 "이 글의 모든 판에서 제목·본문이 가림 문구로 바뀌고 링크가 지워지며 되돌릴 수 없습니다." 16번 뒤 이 글로 보낸 공지 알림이 있으면 "이 글로 보낸 공지 알림도 '알림' 화면에서 [회수](개인정보, 가림 포함)하세요"를 더한다(같은 조회). (3판)

### 7-4. 안내 문구 탭
- `site_board_content` 칸별 편집, FAQ 분류 추가·이름·순서(글 있는 분류 지우기는 막힘), 고정 상한. 저장 → `save_site_board_content` → 태그 두 개.

## 8. 회원 화면
- **`/notices`**: 제목·설명(DB), 5-5 순서. 고정 글은 첫 쪽 위에 따로 붙고, 머리표 `pinnedLabel` 은 글자로. **쪽 나눔은 비고정 게시 글 수로만 센다**(`getListPagination`, 쪽당 20개 — 고정 글은 쪽 수·offset 에 넣지 않음, 빠지거나 겹치는 글이 없게). (3판) 빈 화면 `StudioEmptyState`(DB 문구).
- **`/notices/[id]`**: 제목, 게시일, `content_updated_at` 이 있으면 '`updatedLabel` 날짜', 본문, 링크 버튼, `backToListLabel`. 없는·숨김·삭제 글은 이 경로 전용 not-found(`notFoundTitle`·`notFoundDescription` + 목록으로 버튼, DB 문구). 가린 글은 회원 화면에 나오지 않는다(게시 불가). `generateMetadata` 로 탭 제목. (2판)
- **`/faq`**(2판): 게시 FAQ 를 **쪽 나눔 없이 한 번에** 읽는다. 분류 탭은 클라이언트에서 거른다. 게시 글이 0개인 분류 탭은 숨긴다. 주소에 `#id` 가 있으면 '전체' 탭으로 두고 그 질문을 펼친 뒤 그 자리로 스크롤하고 초점을 둔다. 첫 화면뿐 아니라 **`hashchange`(같은 화면 안 링크로 `#id` 만 바뀔 때)에도** 같이 한다. (3판) 질문은 `<details id="{id}">`. 아래 고객지원 링크.
- 375px 에서 가로 스크롤 없음, 누르는 곳 44px 이상. 조회 기록을 쓰지 않는다(localhost 에서 열어도 운영 DB 쓰기 없음).

## 9. 작업 기록 종류(`src/lib/admin-audit-log.ts`) (2판)
| 종류 | 이름 | 보관 분류 |
|---|---|---|
| `site_board_post_save` | 공지·FAQ 글 저장 | 2년 쪽(결제 연결 아님, `paymentLinkedActions` 에 넣지 않음) |
| `site_board_post_delete` | 공지·FAQ 글 삭제 | 2년 쪽 |
| `site_board_post_reorder` | 공지 고정·FAQ 순서 변경 | 2년 쪽 |
| `site_board_post_redact` | 공지·FAQ 글 가림 | 2년 쪽 |
| `site_board_content_update` | 공지·FAQ 안내 문구 수정 | 2년 쪽 |
- 모두 DB 함수 안에서 남긴다. details 에 `request` 가 있고, 글 원문은 없다(판 이력 표에 있음). 2년 정리가 생겨도 게시 증빙은 판 이력 표에 남는다.

## 10. 시험
### 10-1. 계약 시험 `tests/bundle14-site-board-contract.test.mjs`
- 마이그레이션: VERIFY 항목, 추가형, 사전 점검 지문, REVOKE 대상에 service_role·PUBLIC 포함과 GRANT 목록 = service_role SELECT 만, 행위자 칸에 `REFERENCES` 없음, 함수 EXECUTE 회수, 기록 종류 글자 꼴, 오류 코드 목록 = `site-board.ts` 매핑 (2판)
- 행위자 판정·개인정보 판정·링크 규칙·정렬 규칙 예시 묶음을 TS 함수에 돌리고 같은 표를 리허설에 넣음(행위자는 'DB 가 더 엄격' 줄 포함)
- details 에 제목·본문 원문 키가 없음, `request` 키 있음
- 회원 화면이 문구를 DB 에서만 읽음, 필수 키 목록이 함수와 같음, 표를 세션 클라이언트로 읽는 코드 없음
- 글 읽기 캐시에 60초 상한이 있음, FAQ 읽기에 쪽 나눔 인자가 없음
- 동의 관문: `/notices`·`/notices/x`·`/faq` 제외, `/noticesx` 는 제외 안 됨
- 하단 링크가 정책 `nav` 밖, 게시 글 0개면 링크 없음
- 사이드바·가드·작업 기록 시험 갱신(7-1)
- 4번 후속: '공지 게시판이 생기기 전까지는' 글자가 사라지고 '변경 예정 약관' 단계가 먼저 나오며, '본문이 새 전문으로 바뀐 것을 확인한 뒤' 조건이 남음 (3판)
- 두 함수(`save_site_board_post`·`save_site_board_content`)가 같은 advisory lock 을 설정 행 읽기·분류 사용 중 검사·고정 수 검사 **전에** 잡음(순서까지 단언), 14번 down 의 멈춤 조건이 '16번 함수 이름 목록 또는 판 이력 표가 아닌 FK'이고 기록 표 존재가 아님 (3판·PASS 뒤)
- 팝업 연결 판정이 `linkPathOf` 를 씀 (3판)
### 10-2. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost 는 개발 전용 미리보기로 예시 글을 메모리에서 그린다. 11번 `src/lib/checkout-consent-preview.ts` 처럼 `NODE_ENV === 'development'` 이고 터미널 환경 변수(`SITE_BOARD_PREVIEW=1`)일 때만 켜진다. 예시 글은 `output/` 의 JSON 에서 읽는다. 관리자 화면은 열어 보기만 한다.
- N1 `/notices` 순서(고정 → 날짜, 고정 해제한 글이 날짜 자리)·쪽 나눔(고정 3 + 비고정 21 → 2쪽에 21번째 비고정 글 1개)·빈 화면 (3판) / N2 상세: 수정 날짜, 링크, 없는 id 의 전용 not-found / N3 `/faq`: 탭, 빈 분류 탭 숨김, 25번째 질문 `#id`, 다른 분류 질문 `#id`, 다른 분류 탭에 있을 때 같은 화면 안 `/faq#id` 링크 누르기, 키보드 (3판) / N4 375×667·1366×768 / N5 하단 링크(별도 nav 이름) / N6 관리자 목록(숨긴 고정 글이 순서 묶음에 보임)·편집 창·미리보기·개인정보 경고·팝업 연결 경고(예시 팝업 값: 쿼리가 붙은 링크, 시작 전 예약 팝업) (3판)
- 운영 배포 뒤 대표가 첫 글을 올리고 N1~N3 를 운영 주소로 본다.

## 11. 문구 초안(DB `site_board_content`, 최종은 대표가 7-4 에서)
| 키 | 초안 |
|---|---|
| `notice.pageTitle` / `pageDescription` | 공지사항 / 서비스 변경, 점검, 약관 개정 소식을 알려 드립니다. |
| `notice.emptyTitle` / `emptyDescription` | 아직 공지사항이 없습니다 / 새 소식이 생기면 이곳에 올리겠습니다. |
| `notice.pinnedLabel` / `updatedLabel` / `backToListLabel` | 중요 / 수정 / 목록으로 |
| `notice.notFoundTitle` / `notFoundDescription` | 공지를 찾을 수 없습니다 / 내려갔거나 주소가 바뀐 공지입니다. 공지 목록에서 다시 찾아 주세요. |
| `notice.footerLinkLabel` / `faq.footerLinkLabel` / `footer.navLabel` | 공지사항 / 자주 묻는 질문 / 공지와 도움말 |
| `faq.pageTitle` / `pageDescription` | 자주 묻는 질문 / 크레딧·결제·자료 다운로드·계정에 관해 자주 받는 질문입니다. |
| `faq.emptyTitle` / `allCategoryLabel` | 아직 등록된 질문이 없습니다 / 전체 |
| `faq.supportPrompt` / `supportLinkLabel` | 찾는 답이 없으면 1:1 문의를 남겨 주세요. / 1:1 문의하기 |
| `faq.categories` | `credit` 크레딧·결제 / `refund` 환불 / `download` 자료·다운로드 / `account` 계정·회원 |
| `redactedText` | 개인정보가 포함되어 가린 글입니다. |
- FAQ 글은 넣지 않는다. 답이 약관 숫자와 어긋나면 안 되므로 대표가 쓴다.

## 12. 검증 관점(계획·구현 모두 PASS 까지)
1. **DB·마이그레이션**: 권한(서비스 키 포함)·FK·함수 권한, 판·상한 경합, 정렬 규칙, 되돌리기, 리허설
2. **법률·보안**: 권한 세 곳 일치, 원문 보관 위치와 가림, 개인정보 판정, 링크 주입, 4번 후속 문구가 정식 고지 절차와 맞는지
3. **회원 화면**: 접근(관문·카카오·정지), 정렬·FAQ 바로가기, 빈 게시판, 팝업 연결 끊김, 접근성·모바일, 캐시
- 결제·크레딧을 건드리지 않아 결제 검증 3명은 두지 않는다.

## 13. 배포 순서
1. 계획 검증 3관점 PASS → 0절 답 반영
2. 선행: 12번 커밋(동의 관문·layout), 13번 공용 `adminRequestMeta` 커밋 (2판)
3. 구현 → 계약 시험 → 구현 검증 PASS
4. 리허설(5-8) 통과 → **DB 적용**(승인, 추가만이라 옛 코드 영향 없음)
5. 로컬 확인(나 → 대표, 쓰기 없음) → 대표 승인 → push·배포. 글이 0개라 하단·고객지원 링크는 아직 보이지 않는다 (2판)
6. 대표가 첫 공지·FAQ 를 올린다(운영) → 링크가 저절로 보인다. 헤더 링크는 '상단 메뉴'에서 대표가 정한다
7. 13번 배포 뒤 고객지원 FAQ 링크 커밋 → 로컬 확인 → push
8. 런북에 '공지·FAQ 올리기·숨기기·가림'(개인정보가 들어간 글: 숨김 → 가림 → (16번 뒤) 그 글로 보낸 공지 알림 회수·가림, 팝업이 가리키는 글 주의) (3판) → 진행 기록 갱신
- 일정: 12-10 고지 마감과 묶이지 않는다. 16번은 이 묶음 DB 적용 뒤.

## 14. 15번 14절(미룬 것)과의 정리
| 15번 14절 항목 | 이 묶음 |
|---|---|
| 14번 공지 게시판과 연결(팝업에서 게시글로) | **흡수**: [주소 복사]·안내, 숨김·삭제 때 팝업 연결 경고(팝업 코드 변경 없음) (2판) |
| 4번 후속 '재동의 확인 창의 알리는 수단 문구 교체' | **흡수**(6절, 15번 절차 순서) |
| 관리자 메뉴 분리, 공지 목록·판 이력 화면 | 팝업은 넣지 않음. 팝업 판 이력은 작업 기록 화면 그대로 |
| 대상 고르기, 여러 팝업, 예약, 이미지, 영구 닫기, 서버 닫기 기록, 통계, 변경 예정 글 편집, Dialog 움직임 | 15번 본 작업으로 남김 |

## 15. 범위 밖(후속)
- 예약 게시, 이미지·첨부·서식 편집기, 조회 수, 검색, 댓글, 되살리기 화면
- 판 이력 보는 관리자 화면(지금은 리허설·런북 조회로)
- 검색 노출(robots·sitemap)은 26번, 공지 이메일 발송은 만들지 않음(기존 결정)

## 16. 열린 질문
1. FAQ 첫 분류 4개(11절)가 대표 생각과 맞는지.
2. 12번 이용 제한 한 줄 안내가 공지·FAQ 화면에도 보이는 것이 맞는지(기본: 보임, 같은 layout).
- (1판 16절 1 '관리자 삭제가 profiles 를 지우는지'는 코드로 확인해 닫았다: 지운다 → FK 없는 uuid, 5-2.)

## 17. 1판 검증 반영
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 법률·보안 major, DB minor | 글 원문을 지울 수 없는 작업 기록에 넣음, 개인정보 파기 경로 없음 | Q6·5-3 판 이력 표(가림 가능)·`redact_site_board_post`, 기록에는 지문·글자 수만(5-6·9절) |
| DB major | service_role 표 쓰기 권한이 남음 | 5-2 REVOKE 에 service_role·PUBLIC, GRANT SELECT, VERIFY·B8·계약 시험 |
| DB major | 관리자 FK 가 계정 삭제를 막음 | 행위자 칸 FK 없는 uuid(5-2), 16절 1 닫음 |
| DB major, 법률·보안 minor | 함수 서명에 요청 정보 없음, `adminRequestMeta` 선행 조건 없음 | 모든 쓰기 함수 `p_request_meta`, 6절·13절 선행 조건 |
| DB major, UX major | 정렬 규칙·sort_order 변경 때·고정 수 정의 모호, FAQ 전체 탭 순서 | 5-5 정렬 규칙, 5-6 적용, B5 |
| UX major | FAQ `#id` 가 쪽 나눔·탭에 가려 실패, 빈 분류 탭 | 8절 FAQ 전부 읽기·전체 탭 펼침·빈 탭 숨김, 6절 읽기 함수 분리, N3 |
| UX major | 팝업이 가리키는 글을 숨기면 팝업 버튼이 404 | 7-3 연결 표시·숨김·삭제 경고, 전용 not-found(DB 문구) |
| 법률·보안·DB minor | 행위자 판정이 12번보다 약함 | 12번 식 그대로(5-6), B2 경우 추가 |
| 법률·보안 minor | 4번 후속 문구가 정식 고지를 빠뜨림, 행 번호 | 6절 15번 절차 순서, 403행 |
| 법률·보안 minor | 게시 뒤 수정해도 처음 날짜만 | `content_updated_at`·상세 '수정 날짜' |
| 법률·보안 minor | 허용 연락처 칸 이름·숫자 비교, 링크·설정 문구 검사 빠짐 | 5-6 칸 명시·숫자 비교, 검사 대상 확대 |
| 법률·보안 minor | 글 캐시에 시간 상한 없음 | 6절 60초 상한 + 태그 |
| DB minor | 시험 갱신 지점·지문 사전 점검·버전 | 7-1 시험 지점, 5-1 지문, 5절 버전 가안 `20261217100000` |
| UX minor | 글 없을 때 빈 링크, 하단 nav 이름이 '약관 및 정책' | 게시 글 있을 때만 링크(Q4), 별도 nav(6절) |

## 18. 2판 검증 반영 (3판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| DB major | down 이 '16번 표가 있으면 멈춤'이라 16번 down(표를 남김)과 모순, 글 지울 때 남는 `post_id` | 5-7 멈춤 조건을 '16번 함수 또는 `site_board_posts` 를 가리키는 FK'로, 기록 표 존재는 멈추지 않음, 남는 `post_id` 는 16번 재적용 때 FK `NOT VALID`, B1 경우 추가. 16번 5-5·R7 과 같은 문장 |
| 법률·보안 minor | 가림이 링크 주소를 남김, `redactedText` 가 길면 가림 실패 | 5-3·5-6 링크 NULL, `save_site_board_content` 한 줄·100자 검사, B6 |
| 법률·보안 minor | 4번 후속 ④가 '본문을 바꾼 뒤' 조건을 잃음 | 6절 ④ 문장(시행 스크립트면 누르지 않음, 아니면 본문 교체 확인 뒤), 10-1 |
| 법률·보안 minor | 가림 때 공지 알림 사본 | 7-3 가림 확인 창 경고, 13절 런북 순서 |
| DB minor | `maxPinned` 낮추기와 고정의 경합 | 두 함수 모두 같은 잠금을 먼저, 잠금 뒤 `maxPinned` 읽기, 10-1 단언(리허설로는 재현 불가라 적음) |
| DB·화면 minor | FAQ 순서 범위·분류 사용 중 정의 없음, 관리자 순서 묶음에 숨긴 글 | 5-5 정의, 7-2 숨김 표시, B5·B6·N6 |
| 화면 minor | 같은 화면 안 `#id` 이동 | 8절 `hashchange`, N3 |
| 화면 minor | 팝업 연결 판정 방법(쿼리·예약 팝업) | 7-3 `shouldServeNoticePopup` + `linkPathOf`, N6 |
| 화면 minor | 고정 글과 쪽 나눔이 겹치거나 빠짐 | 8절 비고정 글로만 쪽 나눔, N1 |

## 19. 3판 검증(PASS) 뒤 minor 반영
| 지적 | 반영 |
|---|---|
| down 의 FK 조건이 14번 판 이력 표의 FK 도 세어 늘 멈춤, '16번 함수'가 무엇인지 없음 | 5-7 판 이력 표 제외, pii 함수를 부르는 16번 함수 이름 목록, 10-1. 16번 5-5 문장도 맞춤 |
| FAQ 분류 지우기와 FAQ 저장의 경합 | 5-6 두 함수의 잠금 순서(설정 읽기 전), 10-1 순서 단언 |

