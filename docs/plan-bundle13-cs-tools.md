# 13번 묶음 계획 · CS 도구(답변 템플릿·답변 수정·숨긴 카테고리 복구·고객지원 안내 문구 DB화·회원 정보 열람 기록)

작성일: 2026-11-26
판: 3 (검증 PASS, 2026-11-26) — 3판 검증의 minor 는 같은 판에서 반영했다(17-3).
- 1판은 네 관점 모두 FAIL(blocker 1, major 14), 2판은 회원 화면 코드 PASS·법률·DB·관리자 보안 FAIL(blocker 3 — 모두 같은 지적, major 4)이었다. 반영은 17절 표 두 개에 한 줄씩 적었다. 고친 문단 끝에 `(2판)`·`(3판)` 을 붙였다.
- 작업 순서표 13번(`docs/prelaunch-work-order.md`)의 범위다. 비고가 "CS 계정 발급 전에 끝내기"이므로, **직원(staff) 계정이 문의 권한을 받기 전에** 다섯 가지를 모두 배포한다.
- 출처 문서
  - `docs/admin-content-management-plan.md` 2-5: 안내 문구, 카테고리 복구, 답변 수정
  - `docs/operations-readiness-gaps.md` 1-9: 열람 기록 / 1-14: 템플릿
  - `docs/admin-operations-improvement-plan.md` 4-1: 권한 / U4-3: 템플릿 / Q-L: 마스킹·열람 기록 보류였던 것을 이번에 다룬다
- 회원 단위 관리자 메모는 12번 묶음 범위다(16절).

## 0. 대표 결정
**이미 정해진 것(다른 문서에서)**
1. 권한은 계정별이다. 문의 화면·API 는 `support.manage` 가 있어야 한다. 작업 기록을 보는 것은 대표(owner)만 한다.
2. 회원 화면 문구는 초안으로 넣는다. 최종 문구는 대표가 클라이언트와 정해 관리자 화면에서 고친다. 그래서 문구를 고치는 화면은 반드시 범위에 넣는다.
3. 데이터는 DB 에 둔다(문구, 템플릿, 보관 기간, 빈칸 표시). 규칙은 코드에 둔다(어느 화면이 기록하는지, 자리표시 종류).
4. 2026-12-10 ~ 2027-01-11 에는 약관·처리방침 본문과 가입 동의 terms·privacy 가 DB 트리거로 잠긴다(15번). 이번 묶음은 그 본문을 바꾸지 않는다(8-4).
5. (2026-11-26 대표) 열람 기록의 처리방침 문장은 **01-11 시행 개정에 함께 넣는다**(10번 스크립트가 시행, 8-4).
6. (2026-11-26 대표) Q12: 2026-11-19 에 만든 staff 계정은 **시험용**이다. CS 계정은 계획한 묶음을 모두 구현한 뒤 발급한다(Q14 (가) 조건 유지 — 15절 8단계).

**대표에게 묻는 것** (답을 받으면 이 절에 '결정'으로 옮긴다. 답이 오기 전에는 '권장'으로 구현한다)

열람 기록
- Q1 기록할 범위
  - (가·권장) 회원 이메일·전화가 보이는 관리자 화면 전부(목록 포함)
  - (나) 회원 상세·문의 상세·전화번호가 보이는 곳만
  - (2026-11-26) 01-11 시행 처리방침 2·10절('연락처를 보여 주는 관리자 화면을 열면 … 기록')이 (가)를 전제로 함 — 다른 안을 고르면 12-10 게시 전에 10번 스크립트 문장을 고치고 지문을 다시 확정하거나, 다음 개정에서 다시 고지한다.
- Q2 대표 본인이 본 것도 기록할까요?
  - 권장: 예. 안전성 확보조치 기준 8조는 개인정보를 다루는 사람 모두가 대상이고, 비용이 거의 들지 않는다.
- Q3 전화번호 가리기
  - (가·권장) 목록에서는 `010-****-1234` 로 보이고, 회원 상세·문의 상세에서만 전체 번호가 보인다.
  - (나) 상세에서도 가리고 [보기] 버튼(사유 입력)을 둔다.
  - (다) 지금처럼 다 보인다.
- Q4 기록을 남기지 못했을 때
  - (가·권장) 그 화면의 개인정보를 가려서 보이고 대표에게 알린다.
  - (나) 그대로 보이고 대표에게 알리기만 한다.
  - (2026-11-26) 01-11 시행 처리방침 2·10절('연락처를 보여 주는 관리자 화면을 열면 … 기록')이 (가)를 전제로 함 — 다른 안을 고르면 12-10 게시 전에 10번 스크립트 문장을 고치고 지문을 다시 확정하거나, 다음 개정에서 다시 고지한다.
- Q5 보관 기간
  - (가·권장) 2년
  - (2026-11-26) 01-11 시행 처리방침 3절에 '기록한 날부터 2년'으로 적었다(관리자 작업 기록도 같음). `accessLogRetentionYears` 첫 값은 2 여야 하고, 바꾸려면 처리방침을 다시 고지해야 한다.
  - (나) 1년(법이 정한 최소)
- **Q14 (2판) 직원이 DB API 를 직접 부르는 길**
  - 지금은 관리자 세션이면 `profiles`(이메일·전화·카카오 이메일)를 모두 읽을 수 있다(운영 DB 정책 `Admins can view all profiles` = `is_admin()`). 그래서 직원이 자기 로그인 정보로 DB API 를 직접 부르면 화면을 거치지 않고 읽을 수 있고, 그 조회는 열람 기록에 남지 않는다.
  - (가·권장) 이번 묶음에 M3(4-6)를 넣는다.
    - 관리자 화면이 세션으로 다른 회원의 `profiles` 를 끼워 읽는 곳에서 그 끼워 읽기만 빼고, 이메일·전화는 서버 키로 따로 읽어 붙인다(그때 열람 기록). 행 쿼리는 세션 그대로 두어 탈퇴 회원 가림(RLS)을 유지한다(8-2). (3판)
    - 먼저 탈퇴 가림 정책 4개가 `profiles` 를 직접 읽지 않게 SECURITY DEFINER 판정 함수로 바꾼다. 그래야 직원에게 탈퇴 회원 기록이 보이지 않는다(4-6). (3판)
    - 그다음 `profiles` 의 관리자 조회 정책을 대표만(`is_owner()`)으로 좁힌다.
    - (가-2·권장) 같은 M3 에서 `support_tickets` 의 관리자 조회도 `has_admin_permission('support.manage')` 로 좁힌다. 세션으로 문의를 읽는 곳은 문의 화면·문의 통계·작업 요약(권한별로 거름)뿐이라 깨지는 곳이 없다(1-4). (3판)
    - (가-3) 다운로드 기록(`market_download_events`, 회원 IP 포함)의 관리자 조회를 `is_owner()` 로 좁힌다. **넣는다**: 관리자 세션 경로 0건을 확인했다(2026-11-26, 읽는 곳은 `market-refunds.ts` 120~124행 `countDownloads`·`admin-orders-server.ts` 486행 모두 서버 키). 구현 때 12-1 전수 시험이 계속 0건인지 본다. (3판)
    - 남는 한계(주문·환불 행을 회원 id 로 읽는 것)는 문서로 둔다.
  - (나) 지금 한계를 받아들이고, 변호사 답(8-4 ④)을 받은 뒤 CS 계정을 발급한다.
  - **어느 쪽이든 CS 계정 발급의 조건이다**(15절 8단계).

답변 수정
- Q6 누가 고칠 수 있나
  - (가·권장) `support.manage` 가 있는 사람 누구나. 사유를 꼭 적고, 이전 글은 보관한다.
  - (나) 자기가 쓴 답변만
  - (다) 대표만
- Q7 답변을 고쳤을 때
  - 회원 화면에 '수정됨 · 날짜'를 보인다(권장: 예).
  - 이전 답변은 회원에게 보이지 않는다(권장. 보관만 하고, 회원이 요청하면 개인정보 열람 요청 절차로 보여 준다).
  - 회원 알림을 1건 보낸다(권장: 예). 보낼지 말지는 DB 값 `support_page_content.admin.notifyOnAnswerEdit` 로 둔다. (2판)

권한
- Q8 답변 템플릿을 만들고 고치는 사람
  - (가·권장) `support.manage`
  - (나) 대표만
  - 템플릿을 쓰는 것은 두 경우 모두 `support.manage` 다.
- Q9 고객지원 안내 문구(회원 화면)를 고치는 사람
  - (가·권장) 대표만. 응답 시간 같은 약속이 들어 있기 때문이다.
  - (나) `support.manage`

문구·그 밖
- Q10 응답 시간 약속
  - 초안은 지금 화면 그대로 "빠른 시일 내에"다. '영업일 N일 이내'처럼 바꿀지는 대표가 관리자 화면에서 정한다.
  - 운영 시간 칸은 비워 두면 보이지 않는다.
- Q11 카테고리 코드(slug) 잠금
  - 권장: 이번에 넣는다. DB 에서 막는다(7절, 2판).
- Q12 CS 계정 발급 목표일
  - 운영 DB 에 2026-11-19 에 만든 staff 계정 1개가 있다. 이 계정은 문의 권한이 없고, 회원·주문 조회·지급·마켓 환불 권한이 있다. 11-19 에 한 번 로그인했다.
  - 이 계정이 U3-9 시험 계정인지, 실제 CS 계정으로 쓸 것인지 알려 주세요.
  - **결정(2026-11-26)**: 시험용. 0절 위 6번.
- Q13 템플릿 첫 값
  - 넣는 것: 런북 12절 중 1:1 답변에 쓰는 12-2~12-7, 12-10
  - 넣지 않는 것: 12-1(배너용), 12-8(메일용), 12-9(고지 원문을 고치지 않고 붙여야 함)
- **Q15 (2판) 첫 답변 알림 문구**
  - 지금 route 에 직접 적혀 있다. route 를 새로 쓰므로, 수정 알림과 같은 키 묶음(`answerCreatedNotification*`)으로 옮길까요?
  - 권장: 옮긴다. 16번(알림 문구 관리)이 나중에 같은 키를 이어받는다.

## 1. 지금 상태(코드·운영 DB 확인, 2026-11-26)
### 1-1. 문의 흐름
- **회원 쪽**
  - 등록·수정·삭제는 SECURITY DEFINER RPC 3종(`create_support_ticket`, `update_own_pending_support_ticket`, `soft_delete_own_support_ticket`)으로 한다.
  - 회원이 글을 고치면 이전 글이 `support_ticket_revisions` 에 남는다(추가 전용).
- **관리자 답변**
  - `PATCH /api/admin/support/tickets/[id]` 가 **관리자 세션**으로 `admin_response`·`status`·`responded_at`·`updated_at` 을 UPDATE 한다(42행).
  - 작업 기록은 저장한 뒤 따로 남긴다(같은 트랜잭션이 아니다).
  - 회원 알림 문구는 코드에 적혀 있다(`type: 'inquiry_reply'`, 73~79행).
  - 답변은 한 번만 할 수 있다. 화면은 `status === 'pending'` 일 때만 답변 칸을 그린다.
- **권한**(운영 DB)
  - authenticated 는 위 4칸에 UPDATE 권한이 있다(`authenticated=w`). 정책 `support_tickets_admin_update` 가 `has_admin_permission('support.manage')` 로 거른다.
  - 그래서 문의 권한이 있는 직원은 자기 로그인 정보로 DB 를 직접 불러 `admin_response` 를 이력 없이 덮어쓸 수 있다.
  - 조회는 `is_admin()` 기준이다. 문의 권한이 없는 직원도 조회할 수 있다.
- 문의는 8건(해결 7, 회원 삭제 1), 카테고리는 8개다.
- 옛 화면 `src/app/legacy/mypage/support` 는 이미 닫혀 있다. 운영 `site_disabled_features` 에 `site_legacy_mypage` 가 있고, `src/lib/site-features.ts` 102~105행이 `/legacy/mypage/*` 를 `/mypage/{section}` 으로 보낸다(미들웨어). (3판)

### 1-2. 카테고리 숨김
- **숨김**: [숨김 처리]를 누르면 `DELETE …/categories/[id]` 가 `is_active=false`, `deleted_at=now()` 로 바꾼다. 되살리는 API 와 버튼이 없다.
- **헷갈리는 상태**: 수정 창의 '사용' 체크로 `is_active` 는 다시 켤 수 있다. 그런데 `deleted_at` 이 남아 있어서 회원 화면에는 계속 안 보이고, 배지도 '숨김'으로 남는다.
- **지금 데이터**: 지금 숨긴 카테고리는 0개다. 되살리는 기능만 없다.
- **slug 를 바꿔도 막는 곳이 없다**
  - 쓰기는 관리자 세션으로 한다(INSERT·UPDATE 정책은 `support.manage`).
  - 작업 기록이 남지 않는다.
  - slug 는 유일 인덱스만 있다.
- **slug 를 바꾸면 탈퇴 가림이 흔들린다**
  - 문의 8건 중 3건만 `category_snapshot` 에 slug 가 있다. 나머지 5건은 지금 카테고리의 slug 를 본다.
  - 탈퇴 가림의 환불 관련 판정(`redactionRefundCategorySlugs`)은 slug 로 한다.
  - 그래서 slug 를 바꾸면 이 판정이 조용히 바뀐다. (2판)

### 1-3. 탈퇴(10번) 가림과의 관계
- `member_withdrawal_facts` 의 문의 처리
  - 문의 제목·본문·답변(`admin_response`)과 회원 수정 이력에서 다음을 찾아 '가림 확인 필요'로 내놓는다: 긴 숫자, 환불 관련, 계좌 요청 뒤의 글
  - 확인 표시는 `redaction_reviewed_at >= GREATEST(member_updated_at, responded_at)` 일 때만 유효하다.
  - 문의 사건 시각 `v_last_ticket = max(GREATEST(responded_at, member_updated_at, created_at))` 은 `withdrawn_member_records.last_ticket_event_at`(보존 기간 계산의 기준)으로 들어간다(마이그레이션 20261126100000 829~832·4928행).
- 가림 함수(`redact_member_text`, `mark_member_text_reviewed`)가 받는 대상 종류는 셋뿐이다.
  - `support_ticket`(subject·message·admin_response)
  - `support_ticket_revision`(subject·message)
  - 환불 2종
- **같은 종류 목록이 TS 쪽에도 있다**
  - withdrawal route zod enum(33·72행)
  - `WithdrawalRedactionItem.kind`(`src/lib/member-withdrawal.ts` 90행)
  - `readWithdrawalTargetUserId` switch(`member-withdrawal-server.ts` 418~446행)
  - 패널 `TARGET_KIND_LABELS`·`TARGET_FIELDS`(`member-withdrawal-panel.tsx` 70~81행)
  - 패널은 모르는 종류를 만나면 154~155행에서 TypeError 가 나서 패널 전체가 깨진다. (2판)
- 트리거 `guard_withdrawn_member_write` 가 탈퇴 회원 문의의 INSERT·UPDATE 를 막는다. 가림 함수의 거래 로컬 설정이 있을 때만 통과한다.
- **탈퇴 회원 문의 열람**
  - 대표만, 사유를 적어야 연다.
  - 열면 `admin_audit_log` 에 `withdrawn_record_view` 로 남는다. IP·기기는 `withdrawalRequestMeta`(`member-withdrawal-server.ts` 474행)가 채운다.
  - 열람 결과의 타입(`withdrawn-tickets-panel.tsx` 20~23행)에는 이전 답변이 없다.
- 함수 지문(계산식 `md5(pg_get_functiondef('<서명>'::regprocedure))`, 운영 DB, 2026-11-26)
  - `member_withdrawal_facts(uuid,boolean)` = `a7674770964dac2fe5c9179b8403c3b4`
  - `redact_member_text(uuid,text,uuid,text,text,text)` = `90778a74269a727608f028b21b43b8f6`
  - `mark_member_text_reviewed(uuid,text,uuid)` = `b626dc43a8bb8402575f99a58bb5969b`
  - `read_withdrawn_member_ticket(uuid,uuid,text,jsonb)` = `cce39fd0ab514d2c9cdd9e42d225688e`
  - `anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)` = `1346d870d3623abae580a011b0484339`(고치지 않음. 확인만 한다)
- 작업 기록 `admin_audit_log` 에는 IP 칸이 없다. `request_id` 에는 인덱스가 없다.

### 1-4. 회원 개인정보가 보이는 관리자 경로 (2판: 빠진 곳을 더함)
표의 E = 이메일, P = 전화.

| 화면·경로 | 보이는 것 | 읽는 곳(클라이언트) |
|---|---|---|
| `/admin/users` 목록·검색 | E, P, 소속 | `admin-users-server.ts`(서버 키) |
| `/admin/users/[id]` | E, P, 결제·구매·크레딧 | `admin-member-detail-server.ts`(서버 키) |
| `/admin/support` 목록 | E, **P(목록 전체가 브라우저로 감)** | `support/page.tsx` `TICKET_COLUMNS`(**세션**) |
| 문의 상세·회원 요약 | E, P | 목록 데이터 + `…/member-summary`(서버 키) |
| 지급 창 회원 찾기 | E | `grant-credit-dialog.tsx` 69~73행(**브라우저 세션이 profiles 를 직접 읽음**) |
| `/admin/orders`(충전·마켓), 예외 환불 창 | E | `admin-orders-server.ts`(서버 키) |
| `/admin/refunds`, `GET /api/admin/refunds` | E | `refunds/page.tsx`: 충전 환불(41~63행)·수동 확인 주문(84~98행)은 서버 키, **자료 환불(145~147행)만 세션**(쪽 나눔 없음). route 는 서버 키 |
| `/admin/credits` | E | `admin-credit-transactions-server.ts`(서버 키) |
| `/admin/reviews`, `GET /api/admin/reviews` | E(작성자 이름에 포함) | `market-reviews-server.ts` 406·435행 |
| `/admin` 대시보드, `api/admin/stats` | E | `admin-dashboard-server.ts`(서버 키), stats route(**세션**) |
| `/admin/audit-log` | 대상 회원 E | `admin-audit-log-server.ts` 181·199행(대표만) |
| `/admin/questions`, `/admin/ai-question-generation-runs` | 올린 사람 E | **꺼진 기능**(`admin_disabled_features` 의 question_bank·ai_generation, 대표에게도 404). 다시 켤 때 기록을 더한다 |
- `kakao_email`·생년월일·주소·카카오 ID 는 어느 관리자 화면에도 나오지 않는다.
- **세션으로 다른 회원의 `profiles` 를 읽는 곳**: 문의 목록(끼워 읽기와 72행 이메일 검색), 환불 화면, 지급 창, stats route(그리고 꺼진 기능 두 곳). 나머지는 이미 서버 키로 읽는다. 이 목록 덕분에 Q14 (가)를 감당할 수 있다.
- **세션으로 `support_tickets` 를 읽는 곳**(3판, 2판의 `market-refunds.ts` 근거는 틀렸다 — 1054행이 `createAdminClient()` 다): `support/page.tsx`(가드 `support.manage`), `api/admin/support/stats`(가드 `support.manage`), `admin-work-summary-server.ts` 37~48행(권한별로 항목을 거름, `market_refund_requests` 건수도 세션).
- **탈퇴 가림은 RLS 에 기대고 있다**(3판): RESTRICTIVE 정책 4개(`support_tickets_withdrawn_hidden`(ALL), `support_ticket_revisions_withdrawn_hidden`, `refund_requests_withdrawn_hidden`, `market_refund_requests_withdrawn_hidden`)의 식이 모두 `NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = … AND p.withdrawn_at IS NOT NULL)` 다. 이 하위 조회는 **부른 사람의 `profiles` 조회 권한으로** 돈다. 문의·환불 화면은 이 정책 덕분에 세션 목록에서 탈퇴 회원 행이 빠지고, 따로 서버 키 요약을 붙인다(`support/page.tsx` 132행, `refunds/page.tsx` 150·160행). 운영 탈퇴 회원은 0명이다.
- 다운로드 기록 `market_download_events` 는 회원 IP 를 담고, 정책 `Admins can view all market download events` = `is_admin()` 이다. 관리자 쪽 읽기는 모두 서버 키다(`admin-orders-server.ts` 486행, `market-refunds.ts` 120~124·1067행). (3판)
- 쓰기 작업은 작업 기록에 남는다. **조회는 남지 않는다.**

### 1-5. 고객지원 회원 화면 문구(`support-view.tsx`, `page.tsx`) (2판: 전체 목록)
- 안내: 제목 "고객지원", "1:1 문의하기", 위쪽 안내(218행), 카테고리 기본 안내(248행), "문의 내역"·안내(306~308행), 빈 화면(314~315행)
- 접수 완료 창(464~465행): "빠른 시일 내에 답변드리겠습니다 …"(응답 약속)
- 삭제 확인 창(472~475행): "삭제한 내역은 복구할 수 없습니다."
- 입력 칸 이름(224·264·280행), 선택 칸 자리표시(234·340행), 제목·내용 기본 자리표시(272·287행), 버튼 "문의 등록하기"·"접수 중…"(300행)
- 수정 폼: 칸 이름(332·356·371행), 자리표시(362·377행), "취소"·"수정 완료"(383·386행), 아이콘 제목(415·425행)
- 화면 검사 알림(104·108·176·181행), 성공 알림(151·203행)
- "관리자 답변"(440행), "미분류"(76행), 상태 이름(35~47행)
- 탭 제목·설명: `page.tsx` 9~12행의 정적 `metadata`
- 카테고리별 안내(`help_text`·`guide_items`·자리표시)는 이미 DB 에 있다.
- 비슷한 선례: `pricing-page-content-server.ts`. 읽지 못하면 null 을 돌려주고, 문구 영역을 그리지 않는다.

### 1-6. 처리방침(운영 DB `site_footer_content.policyDocuments.privacyPolicy`, 읽기만 함)
- 1절 목적: "서비스 장애 대응, 보안 점검, 접속 기록 관리"
- 3절: 탈퇴하면 지체 없이 파기한다(결제 기록 5년 등은 예외).
- 10절 안전성 확보 조치: "접근 권한 관리와 관리자 권한 제한, … 관리자 작업 기록"

### 1-7. 권한 묶음
- `admin_permission_presets` 의 "CS 기본" = `support.manage`·`orders.view`·`members.view`·`credits.view`·`refunds.market`

## 2. 목표
1. 직원이 문의에 답할 때 **템플릿을 골라 넣는다**. 빈칸(○○)을 채우지 않으면 등록되지 않는다.
2. **보낸 답변을 고칠 수 있다.**
   - 고치면 다음이 추가 전용으로 남는다: 회원이 그때까지 본 글, 고친 사람, 사유, 시각, IP·기기
   - 직원 로그인으로 DB 를 직접 부르는 길을 포함해, 어떤 길로도 이력 없이 덮어쓸 수 없다.
3. **답변 이력도 탈퇴 규칙을 따른다.** 가림 확인 목록에 나오고, 가릴 수 있다. 보존 기간 기준 시각에 들어가고, 문의를 지우면 함께 지워진다. 화면은 새 종류에서 깨지지 않는다.
4. **숨긴 카테고리를 되살린다.** [다시 사용]으로 되살리고, 쓰기는 작업 기록에 남는다. 가림에 쓰이는 slug 는 DB 가 지킨다.
5. **고객지원 회원 화면 문구가 DB 에 있다.** 관리자 고객지원 화면의 '안내 문구' 탭에서 고친다.
6. **관리자가 회원 개인정보를 본 일이 남는다.**
   - 남는 것: 누가, 언제, 어느 회원, 어느 화면, 무슨 항목, (있으면) 사유, IP·기기
   - 추가 전용 기록에 남고, 대표가 본다. 월 1회 점검 절차가 런북에 있다.
   - Q14 (가)면, 화면을 거치지 않고 직원이 회원 연락처를 읽는 길도 막는다.
7. 시험 staff 계정으로 위 내용을 확인하고 Q14 조건을 채운 뒤에 CS 계정을 발급한다.

## 3. 범위
- 넣는 것
  - 4절 DB 파일 4개: M0 열람 기록, M1 추가, M2 답변 잠금, M3 탈퇴 가림 정책 바꾸기와 관리자 조회 좁히기(Q14 가, 3판)
  - 5~9절 코드·화면
  - 10절 문구 초안
  - 11절 작업 기록
  - 12절 시험
  - 런북 갱신: RB-8, RB-9, 10-9, 10-10, 12절
- 넣지 않는 것: 14절

## 4. DB 변경
공통 규칙
- 모든 파일 머리에 `SET LOCAL lock_timeout = '3s'`, `statement_timeout = '60s'` 를 건다. 사전 점검 DO 블록과 끝의 VERIFY 블록을 둔다.
- 새 트리거는 `CREATE TRIGGER` 만 쓴다(`DROP TRIGGER IF EXISTS` 없이, 15번 4-4 와 같은 이유).
- 파일 시각은 **12번(`20261214100000_member_suspension.sql`) 뒤로 둔다.** 적용 순서와 파일 시각이 같은 순서가 되게 한다. 실제 날짜는 일정이 정해질 때 같은 순서를 지켜 다시 정한다. (2판)

### 4-1. M0 `20261215100000_bundle13_member_access_log.sql` (열람 기록, 따로 뗀 파일) (2판)
- **표 `admin_member_access_log`**(추가 전용)
  - `id uuid PK`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `actor_id uuid NOT NULL`, `actor_role text`(그때 값)
  - `screen text NOT NULL`: 코드 목록 키. 작업 기록 `action` 처럼 CHECK 는 두지 않는다.
  - `member_ids uuid[] NOT NULL`: 1~200개, 중복 없음
  - `fields text[] NOT NULL`
  - `context jsonb NOT NULL DEFAULT '{}'`: 문의 id, 쪽, 검색했는지, 결과 수, 나눠 기록할 때의 순번. **검색어 원문은 넣지 않는다.**
  - `reason text NULL`: 200자 이하
  - `ip text`, `user_agent text`(300자)
- 회원 FK 는 두지 않는다. 회원이 완전 삭제돼도 기록이 남는다. 남는 것은 uuid 뿐이다(8-4 질문 ⑤).
- 인덱스: `(created_at DESC)`, `(actor_id, created_at DESC)`, GIN `(member_ids)`
- 수정 막기: 가드 트리거가 UPDATE·DELETE·TRUNCATE 를 거부한다. service_role 도 거부된다.
- 권한: RLS 를 켜고 정책은 두지 않는다. REVOKE ALL 뒤 `GRANT SELECT TO service_role` 만 준다.
- **기록 함수** `record_admin_member_access(p_actor_id, p_screen, p_member_ids, p_fields, p_context, p_reason, p_request_meta)`
  - SECURITY DEFINER 이고, EXECUTE 는 service_role 만 할 수 있다.
  - 행위자가 관리자인지 `profiles` 에서 확인한다.
  - 개수·글자 수를 검사한다.
  - 시각과 `actor_role` 은 함수가 정한다.
- **되돌리기 파일이 없다**
  - 법정 보관 기록이므로 표를 지우는 되돌리기를 두지 않는다.
  - 머리 주석에 '적용 직후 행이 0건일 때만' 쓰는 짧은 DROP 문을 적어 둔다.
  - 그래서 M1·M2·M3 를 되돌리고 다시 적용해도 이 표에 걸리지 않는다(경우 F).

### 4-2. M1 `20261215110000_bundle13_cs_tools.sql` (추가, 10번 함수 재정의)
**사전 점검**: 1-3 의 함수 지문 5개(재정의할 4개와 `anonymize_member`)가 같은지, 새 표와 새 키가 아직 없는지 본다.

1. **`support_tickets.response_edited_at timestamptz NULL`**
   - 기본값 없이 칸만 더한다. 그래서 짧은 ACCESS EXCLUSIVE 만 잡는다.
2. **표 `support_ticket_answer_revisions`**(답변 이력, 추가 전용)
   - 칸
     - `id`
     - `ticket_id NOT NULL REFERENCES support_tickets ON DELETE CASCADE`
     - `previous_response text NOT NULL`: 그때 회원이 보던 글
     - `previous_shown_at timestamptz NOT NULL`: 그 글이 보이기 시작한 시각
     - `edited_by uuid NOT NULL`
     - `reason text NOT NULL`: 1~300자
     - `created_at DEFAULT clock_timestamp()`
     - `redaction_reviewed_at`
   - 가드 트리거: UPDATE·DELETE·TRUNCATE 를 거부한다. 예외는 둘이다.
     - 부모 문의가 지워질 때의 연쇄 삭제
     - 가림 함수의 거래 로컬 설정(`app.member_withdrawal_bypass` = 그 회원 id)이 있을 때, `previous_response`·`reason`·`redaction_reviewed_at` 만 바뀌는 UPDATE (2판: `reason` 을 더함)
   - 권한: RLS 를 켜고 정책은 두지 않는다. REVOKE ALL 뒤 service_role 에 SELECT 만 준다. 쓰기는 4-3 함수로만 한다.
3. **표 `support_reply_templates`**
   - 칸: `id`, `title`(1~60), `body`(1~4000), `category_id NULL REFERENCES support_ticket_categories`, `sort_order`, `is_active`, `deleted_at`, `created_by`, `updated_by`, `created_at`, `updated_at`, `revision`
   - 권한: RLS 를 켠다. SELECT 정책은 `has_admin_permission('support.manage')` 이고, 쓰기 정책은 두지 않는다(서버 키로만 쓴다). anon 에는 권한을 주지 않고, authenticated 에는 SELECT 만 준다.
   - 첫 값: 표가 비어 있을 때만 10-2 초안을 INSERT 한다.
4. **설정 행 `support_page_content`**(`ON CONFLICT (key) DO NOTHING`)
   - `member`: 10-1 키
   - `admin`
     - `templateBlankMarker`("○○"): **DB 값이지만 관리자 화면에서는 고치지 않는다**(바꾸면 템플릿과 어긋난다. 바꿀 때는 템플릿과 함께 스크립트로). (2판)
     - `answerEditReasonGuide`
     - `notifyOnAnswerEdit`
     - `accessLogRetentionYears`(첫 값 2): **관리자 화면에서 고치지 않는다.** 01-11 시행 처리방침 3절 '기록한 날부터 2년'과 같아야 하므로, 9절 저장 검사는 이 값이 지금 값과 다르면 거부한다. 바꾸려면 처리방침 개정 고지와 스크립트로 한다(2026-11-26).
   - `revision`
   - 키별 RESTRICTIVE 정책은 만들지 않는다. 정책을 만들면 `system_settings` 전체에 ACCESS EXCLUSIVE 가 걸리고, 이 문구는 결제·법적 문구가 아니어서 대표 세션만 쓸 수 있는 일반 키 규칙으로 충분하다. 저장은 서버 키로 한다.
5. **카테고리 slug 지키기 트리거** `guard_support_category_slug`(Q11) (2판)
   - `support_ticket_categories` 에 BEFORE UPDATE OF slug 로 건다. 화면은 저장할 때 slug 를 늘 함께 보내므로(`buildCategoryPayload`), **`NEW.slug IS DISTINCT FROM OLD.slug` 일 때만** 검사한다. 이름·안내만 고치는 저장은 통과한다. (3판)
   - 함수는 SECURITY DEFINER, `SET search_path = public, pg_temp` 다. 직원 세션의 RLS 와 상관없이 세는 것이다. (3판)
   - 다음 두 경우에는 slug 를 바꾸지 못하게 거부한다(`SUPPORT_CATEGORY_SLUG_LOCKED`).
     - 그 카테고리에 문의가 1건이라도 있을 때. 회원이 삭제한 문의와 탈퇴 회원 문의도 센다. (3판)
     - 옛 slug 가 `member_withdrawal_policy.redactionRefundCategorySlugs` 에 들어 있을 때
   - slug 목록은 정책 값에서 읽는다. 트리거 안에 상수로 두지 않는다.
6. **답변 저장 함수**: 4-3
7. **10번 함수 재정의**: 4-4

### 4-3. 답변 저장 함수 `save_support_ticket_answer`
`(p_actor_id, p_ticket_id, p_response, p_status, p_expected_sha256, p_reason, p_operation_key, p_request_meta jsonb) RETURNS jsonb`. SECURITY DEFINER 이고, service_role 만 부른다.

1. **인자 검사**: 답변 1~10000자, 상태는 `in_progress|resolved|closed` 이거나 NULL, 키 1~200자, `p_request_meta` 는 객체
2. **행위자 확인**: `profiles` 를 직접 읽어, owner 이거나 `admin_permission_grants('support.manage')` 가 있는지 본다(서버 키로 부르므로 `auth.uid()` 가 없다).
3. **문의 잠그기**: 문의를 `FOR UPDATE` 로 잠근다. 문의가 없거나 회원이 삭제했으면 거부한다. 탈퇴 회원이면 기존 트리거가 `MEMBER_WITHDRAWN` 으로 막는다.
4. **재요청**: 잠근 뒤 `admin_audit_log` 에서 같은 기록(`action IN ('support_ticket_reply','support_ticket_reply_edit')`, `target_id = 문의 id`, `request_id = 키`)을 찾는다. 있으면 그 기록의 details(이력 id·상태)로 결과를 다시 만들어 돌려준다. 문의 한 건으로 범위를 좁혔으니 인덱스가 없어도 비용이 작다. (2판)
5. **충돌 확인**: 지금 답변(없으면 빈 문자열)의 sha256 이 `p_expected_sha256` 과 다르면 `SUPPORT_ANSWER_CONFLICT` 를 낸다.
6. **첫 답변**(지금 답변이 NULL)
   - 거래 로컬 설정 `app.support_answer_write = 문의 id` 를 켠다.
   - `admin_response`, `status`(없으면 resolved), `responded_at`, `updated_at` 을 저장한다.
   - 작업 기록 `support_ticket_reply` 를 남긴다. details 는 `{status, length, request: p_request_meta}` 다.
7. **수정**
   - 사유가 꼭 있어야 하고(1~300자), 새 글이 지금 글과 같으면 거부한다.
   - 이력에 1행을 넣는다. `previous_shown_at` 은 `COALESCE(response_edited_at, responded_at)` 이다.
   - 문의를 고친다: `admin_response`, `response_edited_at = now()`, `updated_at`, 그리고 `redaction_reviewed_at = NULL`(가림 확인을 다시 하게)
   - 작업 기록 `support_ticket_reply_edit` 를 남긴다. details 는 `{historyId, lengthBefore, lengthAfter, reasonLength, request}` 다. **답변 글과 사유 원문은 작업 기록에 넣지 않는다.** 작업 기록은 가릴 수 없는 표이기 때문이다. 사유는 이력 표에만 두고 가림 대상에 넣는다. (2판)
   - 상태는 바꾸지 않는다.
8. **결과**: 문의 요약과 `{isEdit, historyId, replayed}` 를 돌려준다. 4번 재요청이면 `replayed = true` 다. (3판)

### 4-4. 10번 함수 재정의(M1 안)
13절 2관점이 "바뀐 줄이 여기 적은 것뿐인지" 원문과 비교해 확인한다.

- **`member_withdrawal_facts`**
  - (가) 계좌 요청 시각(`v_account_at`)을 고를 때 이력의 `previous_response`·`previous_shown_at` 도 본다.
  - (나) 가림 항목에 `support_ticket_answer_revision` 을 더한다. 사유는 부모 문의의 REFUND_RELATED·AFTER_ACCOUNT_REQUEST, 그리고 `previous_response` 나 `reason` 의 LONG_NUMBER 다. `redaction_reviewed_at IS NULL` 인 것만 넣는다.
  - (다) (2판) `v_last_ticket` 을 `max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at))` 로 바꾼다. 고친 뒤 탈퇴하면 보존 기간이 수정 시각부터 시작한다.
  - 문의 행의 '확인됨' 판정에도 `response_edited_at` 을 넣는다. 4-3 이 `redaction_reviewed_at` 을 비우므로 이중 안전장치다.
- **`redact_member_text`·`mark_member_text_reviewed`**: 대상 종류 `support_ticket_answer_revision` 을 더한다. 필드는 `previous_response`·`reason` 이다(mark 는 종류만 더한다). 관리자 이벤트 가림은 `support_ticket_revision` 과 같게 부모 문의 기준으로 한다.
- **`read_withdrawn_member_ticket`**: 결과에 `answerRevisions` 를 더한다.
- **바꾸지 않는 것**
  - 고지 원문(`member_withdrawal_notice_text`)과 미리보기 건수: 고지 글자·지문이 그대로라 15번 잠금과 무관하다.
  - `anonymize_member`: 문의를 보존하지 않으면 연쇄 삭제로 이력도 지워지고, 보존하면 함께 남는다.

### 4-5. M2 `20261215120000_bundle13_support_answer_guard.sql` (잠금, 새 코드 배포 뒤)
- `REVOKE UPDATE (status, admin_response, responded_at, updated_at) ON support_tickets FROM authenticated` 를 한다. 정책 `support_tickets_admin_update` 를 DROP 한다.
  - 세션으로 `support_tickets` 를 UPDATE 하는 코드는 답변 route 하나뿐이고, 5절에서 함수 호출로 바꾼다.
  - 상태만 바꾸는 화면은 4단계(U4-1)에서 함수로 만든다. (2판)
- 트리거 `guard_support_ticket_answer_write`: BEFORE UPDATE OF `admin_response`, `responded_at`, `response_edited_at`
  - 다음 둘 중 하나일 때만 통과한다.
    - `app.support_answer_write` = 그 문의 id
    - `app.member_withdrawal_bypass` = 그 회원 id
  - 아니면 `SUPPORT_ANSWER_RPC_ONLY` 를 낸다. service_role 이 직접 UPDATE 해도 막힌다.

### 4-6. M3 `20261215130000_bundle13_admin_select_narrow.sql` (Q14 가, 코드 배포 뒤) (2판·3판)
**사전 점검**
- 탈퇴 가림 정책 4개의 지금 식(`pg_get_expr(polqual, polrelid)`, support_tickets 는 `polwithcheck` 도)이 10번 마이그레이션 453~477행에서 만든 식과 같은지 대조한다. 다르면 멈춘다.
- 좁힐 정책(`Admins can view all profiles`, `Admins can view all tickets`, (가-3)이면 `Admins can view all market download events`)의 지금 식이 `is_admin()` 인지 본다.
- 적용하는 사람의 확인 상수 `c_code_deployed`: 12-1 의 '세션으로 profiles 를 읽는 형태 전수 시험'이 통과한 커밋이 운영에 배포되었다는 확인이다.

**순서(한 거래 안)** (3판)
1. **판정 함수를 만든다**
   - 둘 다 **DB API 에 열리지 않는 `private` 스키마**에 둔다. 운영 DB 에는 아직 이런 스키마가 없으므로 `CREATE SCHEMA IF NOT EXISTS private` 로 만든다. PostgREST 가 RPC 로 여는 것은 public 스키마뿐이라, 로그인 회원이 다른 회원 uuid 로 탈퇴 여부를 물어볼 길이 없다. (3판)
   - `private.is_withdrawn_member(p_user_id uuid) RETURNS boolean`: `profiles.withdrawn_at IS NOT NULL` 이면 true, 없거나 NULL 이면 false.
   - `private.is_withdrawn_ticket_member(p_ticket_id uuid) RETURNS boolean`: 부모 문의의 회원으로 위 판정을 한다(수정 이력 정책용).
   - 둘 다 SECURITY DEFINER, STABLE, `SET search_path = public, pg_temp`, 소유자 postgres.
   - 권한: 정책 식에서 부르려면 부르는 역할에 권한이 있어야 한다. 그래서 `private` 스키마의 USAGE 와 두 함수의 EXECUTE 를 authenticated·service_role 에 준다. PUBLIC·anon 은 회수한다. anon 은 이 네 표에 맞는 PERMISSIVE 정책이 없어 식이 평가되지 않으므로 문제없다.
2. **탈퇴 가림 정책 4개의 식을 바꾼다**. `ALTER POLICY … USING (…)`(support_tickets 는 `WITH CHECK` 도)로 식만 바꾼다. 이름·RESTRICTIVE·명령·역할은 그대로다. 정책 식에서는 스키마 이름까지 붙여 부른다. (3판)
   - `support_tickets_withdrawn_hidden`: USING·WITH CHECK 모두 `NOT private.is_withdrawn_member(user_id)`
   - `refund_requests_withdrawn_hidden`, `market_refund_requests_withdrawn_hidden`: `NOT private.is_withdrawn_member(user_id)`
   - `support_ticket_revisions_withdrawn_hidden`: `NOT private.is_withdrawn_ticket_member(ticket_id)`
   - 이제 이 판정은 부른 사람의 `profiles` 조회 권한과 상관없다. 그래서 다음 단계에서 `profiles` 를 좁혀도 직원에게 탈퇴 회원 기록이 보이지 않는다.
3. **조회 정책을 좁힌다**. 여기서도 `ALTER POLICY … USING (…)` 로 식만 바꾼다. 사전 점검에서 지금 역할을 대조한다(운영: `Admins can view all profiles`·`… market download events` = authenticated, `Admins can view all tickets` = PUBLIC). VERIFY 는 적용 뒤 역할·명령·PERMISSIVE/RESTRICTIVE 가 적용 전과 같은지 본다. (3판)
   - `Admins can view all profiles`: `is_admin()` → `is_owner()`. 직원은 `Users can view own profile` 로 자기 행만 본다.
   - (가-2) `Admins can view all tickets`: `is_admin()` → `has_admin_permission('support.manage')`. 회원 본인 정책은 그대로 둔다.
   - (가-3) `Admins can view all market download events`: `is_admin()` → `is_owner()`.
- 2단계를 바꾼 뒤에는 정책 이름이 같으므로, 10번 되돌리기(`down_a` 79~82행, 이름으로 DROP)와 충돌하지 않는다.

**영향을 받지 않는 것** (3판에서 고쳐 씀)
- 다른 표 정책 가운데 `profiles` 를 직접 읽는 것은 자기 행 조건(`profiles.id = auth.uid()`, 예: `credit_transactions`)뿐이다. 나머지 관리자 판정은 SECURITY DEFINER 함수(`is_admin`·`is_owner`·`has_admin_permission`)다. 2단계 뒤에는 탈퇴 판정도 함수다. 12-1 DB 계약 시험이 "정책 식 안에 `profiles` 를 직접 읽는 하위 조회는 자기 행 조건뿐"을 확인한다.
- 서버 키 경로는 RLS 를 타지 않으므로 영향이 없다. 서버 키 경로의 탈퇴 가림은 지금처럼 코드(`markWithdrawnRows` 등)가 한다.

**남는 한계**(14절)
- 주문·충전 환불·자료 환불 행은 여전히 `is_admin()` 으로 조회할 수 있다(회원 id, 금액, 사유). 이메일은 붙지 않는다.
- (가-2)를 하지 않으면 문의 권한 없는 직원도 문의 본문을 DB API 로 읽을 수 있다.

### 4-7. 되돌리기 (2판·3판)
- **M3 down**: 좁힌 정책을 `ALTER POLICY` 로 `is_admin()` 으로 되돌린다 → 탈퇴 가림 정책 4개를 `ALTER POLICY` 로 10번 원래 식으로 되돌린다 → 판정 함수 2개를 지운다(`private` 스키마는 비어 있을 때만 지운다). 이 순서를 지켜야 함수를 지울 때 그 함수를 쓰는 정책이 남지 않는다. 확인 조회로 역할·명령이 그대로인지 본다. (3판)
  - CS 계정을 발급한 뒤에 M3 를 되돌리면, 다시 적용할 때까지 직원 계정의 문의·회원 조회 권한을 회수한다. 회수하지 않으려면 대표가 Q14 (나) 한계를 받아들였다는 기록을 남긴다. 런북 10-10 에도 적는다. (3판)
- **M2 down**: 트리거와 함수를 지운다. 4칸 UPDATE 권한과 정책 `support_tickets_admin_update` 를 다시 준다. 옛 코드가 세션 UPDATE 를 하므로, **코드를 되돌리기 전에** 해야 옛 코드가 바로 동작한다. (3판)
- **M1 down**
  1. M2 를 되돌렸는지 확인한다.
  2. 재정의 함수 4개가 13번 지문인지 확인하고 10번 원문으로 되돌린다.
  3. 다음을 지운다: 저장 함수, slug 트리거와 그 함수, 이력 표(가드 트리거·함수 포함), 템플릿 표, `support_page_content` 행, `response_edited_at` 칸
  - **답변 이력 행이 있으면 멈춘다.** 회원이 본 글의 유일한 사본이고, 지우면 가림 판정도 사라지기 때문이다.
  - 템플릿·문구가 첫 값과 다르면 확인 상수 `c_export_confirmed` 가 있어야 진행한다(12번과 같은 틀).
- **M0**: 되돌리기 없음(4-1).
- **순서**(3판): **M3 down → M2 down → 코드 되돌림 → (필요하면) M1 down**. M1 이 만든 표·칸은 옛 코드가 쓰지 않으므로, 코드를 먼저 되돌려도 문제없다. 10번을 되돌려야 하면 13번을 먼저 되돌린다. 런북 10-10 에 같은 순서로 적는다.

## 5. 답변 저장·수정(코드)
- **`PATCH /api/admin/support/tickets/[id]`**
  - 세션 UPDATE 를 없애고, 서버 키로 `save_support_ticket_answer` 를 부른다.
  - 몸통에 받는 것: `expectedSha256`, `reason`, `operationKey`(저장 창을 열 때 만든 uuid). `p_request_meta` 는 공용 함수(8-1)로 채운다.
  - route 의 `recordAdminAudit` 는 지운다(함수 안에서 남기므로).
- **빈칸 검사**
  - 답변에 `templateBlankMarker` 가 남아 있으면 400 을 낸다.
  - 표시 값을 읽지 못하면 저장을 막는다.
- **오류 안내**: `SUPPORT_ANSWER_CONFLICT` 이면 최신 글을 다시 읽는다. 탈퇴 회원, 회원이 삭제한 문의, 권한 없음은 각각 안내한다.
- **알림**
  - 첫 답변: 지금처럼 `type: 'inquiry_reply'` 로 보낸다. Q15 가 '예'면 문구를 DB(`answerCreatedNotification*`)에서 읽는다.
  - 수정: `notifyOnAnswerEdit` 가 켜져 있을 때만 같은 type 으로 보낸다. 문구는 `answerEditedNotificationTitle`·`…Message` 이고, 자리표시는 `{문의제목}` 하나다. 줄바꿈은 JSON 문자열의 `\n` 으로 저장한다. 문구를 못 읽으면 보내지 않고 `notificationFailed` 로 화면에 알린다. (2판)
  - 결과가 `replayed` 이면 알림을 보내지 않는다. 첫 요청 때 알림이 실패했다면 그때의 `notificationFailed` 안내로 처리한다. (3판)
- **관리자 문의 상세 창**
  - 답변이 있으면 [답변 수정]을 보인다.
  - 수정 칸과 사유 칸을 둔다. 사유 칸 안내는 `answerEditReasonGuide` 다(초안에 "계좌·전화 같은 개인정보는 적지 마세요" 포함). 그리고 "회원은 고친 글만 봅니다. 이전 글은 기록으로 남습니다"를 보인다.
  - 이전 답변 목록은 접어 둔다. 읽는 곳은 서버 함수(가드 `support.manage`, 탈퇴 회원이면 404)이고, 열람 기록 `support.ticket` 에 들어간다.
  - 회원이 삭제한 문의와 탈퇴 회원 문의에는 버튼이 없다.
- **회원 화면** (2판)
  - "관리자 답변" 이름 옆에 `answerEditedLabel` · `response_edited_at` 의 한국 날짜를 보인다.
  - 오른쪽 날짜(`responded_at`)는 그대로 둔다.
  - 이름 값이 비어 있으면 수정 표시 전체를 숨긴다.
- **옛 화면**: 이미 `site_legacy_mypage` 로 닫혀 `/mypage/support` 로 넘어간다(1-1). 코드는 고치지 않는다. 이 기능을 다시 켜면 수정 표시 없이 답변이 보인다는 점을 알려진 한계로 둔다(14절). (3판)

### 5-1. 10번 가림 코드 갱신(같은 코드 배포에 꼭 넣는다) (2판, blocker 반영)
M1 뒤 새 코드가 들어가야 이력 행이 생긴다. 그래서 이 수정은 15절 5단계와 같은 배포에 넣는다.
1. withdrawal route(`api/admin/users/[id]/withdrawal/route.ts`)
   - 33행 `targetKind` enum 에 `support_ticket_answer_revision` 을 더한다.
   - 72행 `field` enum 에 `previous_response` 를 더한다. `reason` 은 이미 있다.
2. `WithdrawalRedactionItem.kind` 유니온(`member-withdrawal.ts` 90행)에 같은 종류를 더한다.
3. `readWithdrawalTargetUserId` 에 case 를 더한다: 이력 → `ticket_id` → 문의 `user_id`
4. 패널 `TARGET_KIND_LABELS`('답변 수정 이력')와 `TARGET_FIELDS`(`[['previous_response','이전 답변'],['reason','수정 사유']]`)를 더한다.
   - `RedactionRow` 는 모르는 종류를 만나도 죽지 않게 한다. 칸 목록이 없으면 [확인함]만 보인다.
5. `withdrawn-tickets-panel.tsx` 에 `answerRevisions` 타입과 목록을 더한다.
- 계약 시험이 DB 의 가림 종류·칸 목록(함수 원문에서 뽑음)과 TS enum·라벨 키가 같은지 대조한다.

## 6. 답변 템플릿
- **관리 화면**: 관리자 고객지원 화면의 '답변 템플릿' 탭
  - 목록, 추가, 수정, 숨김, 순서, 카테고리 선택
  - 권한은 Q8 결정을 따른다.
  - 저장은 서버 액션으로 한다: 가드 → 서버 키 → `revision` 비교 → 작업 기록(요청 정보 포함)
- **[템플릿 넣기]**: 답변 칸 위에 둔다. 그 문의의 카테고리 템플릿을 먼저 보인다. 쓰던 글이 있으면 바꾸기 전에 확인한다.
- **자리표시**
  - 코드에 정한 세 가지만 채운다: `{사이트이름}`(`site_brand.name`), `{문의제목}`, `{접수일}`
  - 회원 개인정보 자리표시는 두지 않는다. 답변 글에 개인정보가 복사되면 가림 대상이 늘기 때문이다.
  - 템플릿을 저장할 때 모르는 `{…}` 가 있으면 거부한다(`pricing-page-content.ts` 55~59행과 같은 방식).
- **빈칸**
  - 사람이 채울 곳은 `○○`(DB 값)로 둔다. 미리보기에서 색으로 표시한다.
- **순수 함수**: `src/lib/support-reply-template.ts` 에 자리표시 채우기와 빈칸 찾기를 둔다.

## 7. 숨긴 카테고리 복구
- **되살리기 API**: `POST /api/admin/support/categories/[id]/restore`
  - `deleted_at = NULL`, `is_active = true` 로 바꾼다. 순서(`sort_order`)는 그대로 둔다.
- **화면**
  - 카테고리 목록을 '사용 중'과 '숨김'으로 나눈다.
  - 숨긴 카테고리에 [다시 사용] 버튼을 둔다. 누르면 확인 창이 뜬다.
  - 숨긴 카테고리를 '사용' 체크로 켜려 하면 서버가 거부하고 [다시 사용]을 안내한다.
- **작업 기록**: 카테고리 추가·수정·숨김·복구를 남긴다. 요청 정보도 함께 남긴다.
- **slug 지키기**(Q11)
  - DB 에서 막는다(4-2 의 5): 직원이 세션으로 직접 UPDATE 해도 막힌다.
  - 화면에서는 문의가 달린 카테고리의 slug 칸을 잠그고, 오류 `SUPPORT_CATEGORY_SLUG_LOCKED` 를 안내한다. (2판)

## 8. 회원 정보 열람 기록
### 8-1. 기록 단위와 원칙
- **1행의 단위**
  - 서버가 회원 개인정보를 브라우저로 내려보낸 요청 1번이 1행이다.
  - 목록이면 그 응답에 실린 회원 id 를 모두 남긴다. 200명을 넘으면 200명씩 나눠 여러 행으로 남긴다(`context.part`). (2판)
  - 회원이 0명이면 남기지 않는다. 관리자 계정끼리 보는 것은 대상이 아니다.
- **순서**: 기록을 먼저 남기고, 그다음에 데이터를 돌려준다.
  - 기록에 실패하면 Q4 를 따른다. 권장안은 개인정보를 가려서 보이고 `admin_events` 로 대표에게 알리는 것이다(같은 화면은 1시간에 1번만).
- **한 곳에서만 부른다**
  - `src/lib/admin-member-access-log-server.ts` 의 `recordMemberAccess({ access, screen, memberIds, fields, context, reason })`
  - IP·기기는 `withdrawalRequestMeta` 를 공용 함수 `adminRequestMeta` 로 옮겨 쓴다. route 는 `request` 를, 서버 컴포넌트는 `headers()` 를 넘긴다.
- **화면 키**: `ADMIN_MEMBER_ACCESS_SCREENS`(`src/lib/admin-member-access-log.ts`) (2판)
  - `users.list`, `users.detail`
  - `support.list`, `support.ticket`
  - `orders.payments`, `orders.market`
  - `refunds.list`, `credits.list`, `member_search`
  - `reviews.list`, `dashboard`, `audit_log`
  - 꺼진 기능(questions·ai 실행 기록)은 다시 켤 때 키를 더한다(계약 시험 허용 목록에 사유와 함께 둔다).
- **탈퇴 보관함 열람**은 지금처럼 `withdrawn_record_view` 로 남긴다(사유 필수). 대표 조회 화면에서 함께 볼 수 있게만 한다.
- **사유 입력 칸**(Q3 나): 200자까지, "개인정보를 적지 마세요"라는 안내를 둔다.

### 8-2. 줄이기와 경로 정리 (2판·3판)
**원칙: 행은 세션, 연락처만 서버 키** (3판)
- 행 쿼리(문의·환불·자료 환불의 목록·건수·연결 문의)는 **지금처럼 세션으로 둔다.** 탈퇴 회원 행은 RLS(4-6 뒤에는 판정 함수)가 계속 빼 준다. 탈퇴 회원 요약을 따로 붙이는 지금 방식도 그대로다.
- 세션 쿼리에서 바꾸는 것은 `profiles` 끼워 읽기(`profiles!…(email, phone)`)를 빼는 것뿐이다.
- 이메일·전화는 응답에 실린 `user_id` 로 서버 키에서 한 번에 읽어 붙인다. 공용 함수는 `attachMemberContacts({ access, screen, rows, userIdOf, fields, shape })` 이다(`admin-member-access-log-server.ts`). 이 함수가 그때 열람 기록을 남긴다.
  - 지금 화면이 받는 모양을 그대로 채운다. 문의는 `profiles: { email, phone }`, 환불은 `user: { email, display_tag }` 다. `display_tag` 도 서버 키에서 함께 읽는다. 기록의 `fields` 에는 보이는 연락처(email·phone)만 적는다. (3판)
  - 서버 키로 읽은 연락처 가운데 탈퇴 회원(`withdrawn_at IS NOT NULL`)은 붙이지 않고, 열람 기록 `member_ids` 에서도 뺀다. 세션 행에는 원래 탈퇴 회원이 없지만, 경합(읽는 사이 탈퇴)에 대비한다.
- 이 방식이면 서버 키로 옮긴 행 쿼리가 없으므로, 탈퇴 제외 조건을 새로 맞출 곳이 생기지 않는다.

**경로별**
- **문의 목록**(`support/page.tsx`)
  - `TICKET_COLUMNS` 에서 `profiles` 를 빼고, 이메일만 `attachMemberContacts(screen 'support.list', fields ['email'])` 로 붙인다. 목록 행과 `?ticket=` 연결 문의(`linkedTicket`) 모두에 붙인다. 전화는 목록에 싣지 않는다. (3판)
  - 72행 이메일 검색(세션 `profiles.ilike`)은 서버 키 함수로 바꾼다. 맞는 회원 id 만 돌려주고, 기록은 결과 행의 연락처를 붙일 때 남는다. 탈퇴 회원 id 는 돌려주지 않는다.
  - 문의 상세 전화번호는 회원 요약 응답(서버 키, 탈퇴면 이미 404)으로 받고 `support.ticket` 으로 기록한다.
- **환불 화면**(`refunds/page.tsx`) (3판에서 사실 고침)
  - 세션으로 읽는 것은 **자료 환불뿐**이다. 이 쿼리의 `profiles` 끼워 읽기를 빼고 `attachMemberContacts` 로 붙인다.
  - 충전 환불·수동 확인 주문은 이미 서버 키로 이메일을 읽는다(authenticated 는 `refund_requests` 조회 권한이 아예 없다). 이 둘도 `attachMemberContacts` 로 바꾸거나 `recordMemberAccess` 로 기록한다.
  - 세 목록 모두 응답에 실린 회원을 `refunds.list` 로 기록한다. 쪽 나눔이 없으므로 8-1 의 200명씩 나눠 기록하기를 쓴다.
  - 탈퇴 회원 자료 환불은 지금처럼 `readWithdrawnMarketRefundRequests` 가 이메일 없이 따로 붙인다.
- **`api/admin/stats`**: 세션으로 `profiles` 를 세는 쿼리를 서버 키로 바꾼다(가드 뒤, 건수만 — 개인정보 없음, 기록 대상 아님).
- **지급 창 회원 찾기**: 브라우저가 DB 를 직접 읽지 않게 서버 route `GET /api/admin/users/search` 로 옮긴다. 가드는 `credits.grant`, 서버 키, 탈퇴 회원 제외, 돌려주기 전에 `member_search` 로 기록한다.
- 위 네 가지가 M3 의 조건이다(`c_code_deployed`).

**전화번호 가리기**(Q3 가)
- 회원 목록·문의 목록에서는 서버가 가린 값(`maskPhone`, 순수 함수)만 보낸다.
- 전화번호 검색은 서버에서 비교하므로 그대로 된다.

### 8-3. 대표 조회 화면
- `/admin/audit-log` 에 '개인정보 열람' 탭을 둔다(대표 전용).
- 필터: 기간(한국 날짜), 처리자, 화면, 회원
  - 회원 필터에는 회원 상세의 [이 회원 열람 기록] 링크로 들어온다. 이 링크는 대표에게만 보인다.
- 줄 하나에 보이는 것: 시각, 처리자 아이디, 화면 이름, 회원 수와 앞 3명의 표시 이름(링크), 항목, 사유, IP 앞부분
  - 이메일은 다시 펼치지 않는다.
- 이 탭을 연 것도 `audit_log` 로 기록한다.
- 쪽 나눔은 서버에서 한다.

### 8-4. 처리방침·법령·한계
- **이 묶음 파일은 처리방침 본문을 바꾸지 않는다.** 01-11 시행 전까지는 지금 1절("접속 기록 관리")과 10절("관리자 작업 기록")로 설명된다.
- ~~**2027-01-11 시행 뒤 다음 개정 때 더할 것** (2판)~~ → **2026-11-26 대표 결정으로 01-11 시행 개정에 넣었다**(10번 스크립트 `p_pairs`·`ip_pairs`·`c_privacy_note`, 지문은 15번 10절 5단계).
  - (검증 반영 2차) 범위는 8-1 의 실제 동작(연락처를 보여 주는 관리자 화면)으로 좁혔다. SQL 편집기·대시보드 같은 DB 직접 조회는 기록되지 않으므로 처리방침에 단정하지 않고 런북·내부 관리계획에 둔다(8-4 한계).
  - (최종 문장, 10번 스크립트와 같음 — 2026-11-26 4차)
  - 1절: "개인정보 오남용 방지와 부정 이용 확인을 위한 관리자 작업 기록과 관리자의 회원 연락처 열람 기록 관리"
  - 2절: "관리자 작업 기록: 처리한 관리자, 처리 일시, 대상 회원(회원 식별 번호), 처리 내용과 사유(일부 작업은 관리자의 접속 IP·기기 정보)" / "관리자의 회원 연락처 열람 기록(회원의 이메일·휴대폰 번호를 보여 주는 관리자 화면을 열 때): 열람한 관리자, 열람 일시, 대상 회원(회원 식별 번호), 열람한 화면과 항목, 화면 정보(관련 문의 번호·쪽 등), 열람 사유(적은 경우), 관리자의 접속 IP·기기 정보"
  - 3절: "관리자 작업 기록(회원에 관한 처리의 내용·사유·처리자·일시)과 관리자의 회원 연락처 열람 기록은 개인정보의 안전성 확보(개인정보 보호법 제29조, 같은 법 제15조제1항제2호)와 부정 이용 확인(회사의 정당한 이익, 같은 법 제15조제1항제6호)을 위해 기록한 날부터 2년 동안 보관한 뒤 파기하며, 회원이 탈퇴한 뒤에도 이 기간 동안 남습니다. 다만 결제·크레딧·환불·탈퇴 처리에 관한 관리자 처리 내역(관리자 결제 처리 기록 포함)은 위 결제 기록·탈퇴 처리 기록의 보관 기간이 끝날 때까지(관련 기록이 없으면 기록한 날부터 2년) 보관합니다. 열람 기록에는 회원의 이메일·휴대폰 번호를 남기지 않고 회원 식별 번호로 기록합니다."
  - 10절: "회원의 이메일·휴대폰 번호를 보여 주는 관리자 화면을 열면 열람한 관리자, 일시, 대상 회원, 화면, 열람 항목, 접속 IP·기기를 기록하고, 이 기록을 월 1회 이상 점검합니다. 관리자 작업 기록에는 처리한 관리자와 일시를 남기며, 일부 작업은 접속 IP·기기도 함께 남깁니다."
  - 그래서 01-11 까지 M0·8절 기록과 런북 10-9 월 점검이 운영에 있어야 한다(15절 일정). 10번 스크립트 apply 는 `admin_member_access_log`·`record_admin_member_access` 가 없거나 `support_page_content.admin.accessLogRetentionYears` 가 처리방침의 '기록한 날부터 N년'과 다르면 멈춘다.
- **변호사 질문**(대표 할 일 6절에 '(13번)'으로 더한다)
  - ① 이 기록의 항목(계정, 일시, IP, 대상 회원, 수행 업무), 보관 기간, 월 1회 점검이 8조를 채우는지
    - 작업 기록 가운데 지급·환불 같은 기존 쓰기 기록에 IP 가 없는 점도 함께 묻는다(14절).
  - ② 목록 화면을 '실린 회원 전부'로 기록하는 방식이 충분한지
  - ③ 직원의 IP·기기를 남긴다는 것을 직원에게 어떻게 알려야 하는지(계정을 발급할 때 주는 안내문)
  - ④ Q14 의 남는 한계를 내부 관리계획에 적어 두는 것으로 충분한지 (3판)
  - ① 에 함께 묻는다: 열람 기록은 같은 DB 의 추가 전용 표라, DB 소유자 권한으로는 바꿀 수 있고 백업 보관은 요금제를 따른다(Pro 전환은 대표 할 일). 이것으로 위·변조 방지 요건이 충분한지. (3판)
  - ⑤ 탈퇴·완전 삭제한 회원의 uuid 가 열람 기록에 남는 것이 괜찮은지
- **한계**(Q14) (2판)
  - (가)를 해도 직원은 이메일이 없는 주문·환불 행을 회원 id 로 DB API 에서 읽을 수 있다. (가-2)를 하지 않으면 문의 본문도 읽을 수 있다. (3판)
  - 열람 기록 자체는 DB 소유자(postgres) 권한으로는 바꿀 수 있다. 가드 트리거는 service_role 까지만 막는다. (3판)
  - (나)면 이메일·전화까지 읽을 수 있다.
  - 이 내용은 런북(RB-9 옆 '관리자 계정 위험' 한 줄)과 월 점검에 적는다.
  - Supabase API 로그는 무료 플랜에서 오래 남지 않는다. 그래서 보완책으로 쓰지 않는다.

### 8-5. 런북
- **10-9 를 넓힌다**: 이름을 "개인정보 열람 기록 월 1회 점검"으로 바꾸고, 다음을 본다.
  - 처리자별 건수
  - 회원 상세를 많이 연 날
  - 업무 시간 밖에 본 것
  - 열람 기록 전체 행 수가 지난달 점검 때보다 줄지 않았는지 (3판)
  - 문의·주문과 이어지지 않는 회원 상세 열람
- **RB-9**: "열람 기록은 지우지 않는다"를 더한다.
- **RB-8**: 템플릿, 빈칸, 수정 방법을 적는다.
- **10-10**: "13번을 먼저 되돌린다"를 더한다.
- **12절**: 답변 문구 원본은 관리자 템플릿이라고 적는다. 메일·배너용 문구만 런북에 남긴다.

## 9. 고객지원 안내 문구 DB화
- **읽기**
  - `src/lib/support-page-content.ts` 가 서버 키로 읽는다. 캐시는 `site-logo-server.ts` 19행처럼 `unstable_cache(…, { tags: ['support_page_content'] })` 이고, 저장 뒤 `revalidateTag('support_page_content', { expire: 0 })` 를 한다. 읽기 실패는 캐시하지 않고 예외로 올린다. (3판)
  - `page.tsx` 는 `generateMetadata` 로 바꾸고, `pageTitle`·`pageDescription` 을 쓴다. (2판)
- **키를 필수·선택으로 나눈다** (2판·3판)
  - 기준은 10-1 표의 '필수/선택' 칸 하나다. 코드에는 필수 키 이름 목록만 규칙으로 둔다(`SUPPORT_PAGE_REQUIRED_KEYS`). 저장 검사, 마이그레이션 VERIFY, 화면 해석 함수가 이 목록을 같이 쓴다.
  - (2026-11-26) 저장 검사는 `admin.accessLogRetentionYears` 가 지금 값과 다르면 거부한다(관리자 화면에서 고치지 않는 키, 4-2).
  - 행이 없음·JSON 이 깨짐·필수 키가 비거나 없음 → 모두 오류 화면으로 간다(지금 카테고리·문의를 읽지 못했을 때 `throw` 하는 것과 같다). 선택 키가 비면 그 칸만 숨긴다.
  - 저장할 때 필수 키 빈 값을 거부하므로, 운영에서 오류 화면이 나는 것은 읽기 실패뿐이다.
  - 코드에 기본 문구를 두지 않는다(하드코딩 금지).
- **코드에 남기는 것**
  - 상태 이름(대기중·처리중·답변완료·종료): 상태 코드와 짝인 규칙이다.
  - 서버가 돌려준 오류 메시지를 그대로 보이는 부분(메시지 글자 자체는 서버가 준다)
- **옮기는 것**: 1-5 의 나머지 전부다. 서버가 메시지를 주지 않았을 때의 실패 알림(124·133·148·155·200·207행)과 아이콘의 화면 낭독용 글자(418·428행)도 옮긴다. 화면 낭독 글자는 `editIconTitle`·`deleteIconTitle` 을 같이 쓴다. (3판)
- **관리자 화면**: 고객지원 화면의 '안내 문구' 탭
  - 항목별 칸, 글자 수, 미리보기(저장소 없이 회원 화면 부품을 그린다)
  - `revision` 이 충돌하면 최신 값을 다시 읽는다.
  - 권한은 Q9 결정을 따른다.
  - 저장 순서: 서버 액션 → 가드 → 서버 키 → 작업 기록 → `revalidateTag`

## 10. 문구 초안(대표 확인, 최종은 나중에 관리자 화면에서)
### 10-1. `support_page_content.member`
| 무리 | 필수/선택 | 키와 초안 |
|---|---|---|
| 안내 | 선택: `pageDescription`·`formNotice`·`responseTimeNote`·`defaultCategoryHelp`·`historyIntro`·`emptyDescription` / 필수: 나머지 | `pageTitle` 고객지원 · `pageDescription` 1:1 문의를 남기고 답변을 확인합니다. · `formTitle` 1:1 문의하기 · `formNotice` 답변은 이메일로 보내지 않습니다. 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요. · `responseTimeNote` (비움, 예: 평일 10~18시에 답변하며 보통 영업일 1~2일 안에 답변드립니다.) · `defaultCategoryHelp` 선택한 문의 유형에 맞춰 내용을 적어 주세요. · `historyTitle` 문의 내역 · `historyIntro` 남겨 주신 문의와 답변을 확인하실 수 있습니다. · `emptyTitle` 아직 문의하신 내역이 없습니다 · `emptyDescription` 궁금한 점이 있으시면 언제든지 문의해 주세요. |
| 입력 | 필수(`defaultSubjectPlaceholder`·`defaultMessagePlaceholder` 는 선택) | `categoryLabel` 문의 카테고리 · `categoryPlaceholder` 문의 유형을 선택해 주세요 · `subjectLabel` 제목 · `messageLabel` 내용 · `defaultSubjectPlaceholder` 문의 제목을 입력해 주세요 · `defaultMessagePlaceholder` 문의 내용을 자세히 적어 주세요 · `submitLabel` 문의 등록하기 · `submittingLabel` 접수 중… · `uncategorizedLabel` 미분류 |
| 수정 폼 | 필수 | `editCategoryLabel` 문의 카테고리 수정 · `editSubjectLabel` 제목 수정 · `editMessageLabel` 내용 수정 · `editSubjectPlaceholder` 제목을 입력하세요 · `editMessagePlaceholder` 내용을 입력하세요 · `cancelLabel` 취소 · `saveEditLabel` 수정 완료 · `editIconTitle` 문의 수정 · `deleteIconTitle` 문의 내역 삭제 |
| 알림·창 | 필수 | `needCategoryToast` 문의 카테고리를 선택해 주세요. · `needContentToast` 제목과 내용을 모두 입력해 주세요. · `deletedToast` 문의 내역이 삭제되었습니다. · `updatedToast` 문의 내용이 수정되었습니다. · `submittedTitle` 문의가 등록되었습니다 · `submittedDescription` 빠른 시일 내에 답변드리겠습니다. 답변은 이메일로 보내지 않으니, 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요. · `deleteConfirmTitle` 문의 내역을 삭제할까요? · `deleteConfirmDescription` 삭제하면 내 문의 내역에서 사라지고 되돌릴 수 없습니다. 처리에 필요한 기록은 개인정보 처리방침에 따라 보관될 수 있습니다. · `deleteConfirmLabel` 삭제 · `submitFailedToast` 문의 등록에 실패했습니다. · `updateFailedToast` 수정에 실패했습니다. · `deleteFailedToast` 삭제에 실패했습니다. (3판) |
| 답변 | 필수(`answerEditedLabel` 은 선택 — 비면 수정 표시를 숨김) | `answerLabel` 관리자 답변 · `answerEditedLabel` 수정됨 · `answerCreatedNotificationTitle` 문의하신 내용에 답변이 등록되었습니다.(Q15) · `answerCreatedNotificationMessage` 제목: {문의제목}\n\n답변을 확인해보세요. · `answerEditedNotificationTitle` 문의 답변이 수정되었습니다. · `answerEditedNotificationMessage` 제목: {문의제목}\n\n수정된 답변을 확인해 보세요. |
- 삭제 확인 문구를 고친 이유: 지금 문구 "삭제한 내역은 복구할 수 없습니다."는 실제와 어긋나 보일 수 있다. 회원이 지워도 관리자 쪽에는 읽기 전용으로 남고, 탈퇴할 때 보존될 수 있기 때문이다. 대표가 확인한다.
- `admin.answerEditReasonGuide` 초안: 회원에게 보이지 않는 내부 기록입니다. 왜 고쳤는지 짧게 적어 주세요. 계좌·전화 같은 개인정보는 적지 마세요.

### 10-2. 답변 템플릿 첫 값
런북 12절에서 옮긴다. `써머썬 연구소` 는 `{사이트이름}` 으로 바꾼다. 모두 14개다.
- 결제 후 크레딧 미반영(접수·처리 완료·결제 없음) 3개 → `credit_error` 에 연결
- 환불 접수·계좌 환불 안내 2개 → `market_refund`·`credit_refund` 에 연결
- 환불 완료(결제 취소·계좌 송금·자료 문제) 3개 → `market_refund`·`credit_refund` 에 연결
- 환불 거절 1개 → `market_refund`·`credit_refund` 에 연결
  - 런북 12-5 의 "구매 후 7일" 예시는 8번 이후 기준인 30일로 고친다.
- 잘못 지급한 크레딧 회수(안내·완료) 2개
- 영수증 1개
- 비밀번호 분실(카카오·이메일) 2개 → `account` 에 연결

## 11. 작업 기록(`src/lib/admin-audit-log.ts` 에 더한다)
| 종류 | 이름 | 남기는 곳 |
|---|---|---|
| `support_ticket_reply` | 문의 답변(이미 있음) | 이제 DB 함수 안에서 |
| `support_ticket_reply_edit` | 문의 답변 수정 | DB 함수 안에서(사유 원문은 넣지 않음) |
| `support_category_create`·`_update`·`_hide`·`_restore` | 문의 카테고리 추가·수정·숨김·다시 사용 | route |
| `support_reply_template_save`·`_hide` | 답변 템플릿 저장·숨김 | 서버 액션 |
| `support_page_content_update` | 고객지원 안내 문구 수정 | 서버 액션 |
- 새 기록에는 모두 details `request`(IP·기기)를 넣는다. (2판)
- 열람은 작업 기록이 아니라 `admin_member_access_log` 에 남긴다. 행 수가 많고, 하루 지급 한도를 합산하는 표와 섞지 않기 위해서다.

## 12. 시험
### 12-1. 계약 시험
- **새 시험 `tests/bundle13-cs-tools-contract.test.mjs`**
  - 답변 route 가 `.update(` 를 쓰지 않고 `save_support_ticket_answer` 를 부르는지. 빈칸 표시를 읽지 못하면 저장을 막는지.
  - (2판) `src/app/(admin)`·`src/app/api/admin`·`src/lib` 전체에서 `profiles` 의 email·phone 을 select 하거나 조인하는 곳을 찾는다. 판정은 파일이 아니라 **쿼리 단위**다(3판). 이메일·전화를 고르는 쿼리마다 다음 셋 중 하나여야 한다.
    - 그 결과가 `attachMemberContacts` 나 `recordMemberAccess` 를 거친다
    - 관리자 계정끼리 보는 곳
    - 꺼진 기능(사유 포함)
  - 관리자 클라이언트 컴포넌트가 `@/lib/supabase/client` 로 `profiles` 를 읽지 않는지
  - (3판) 같은 범위에서 세션 클라이언트(server·client 둘 다)로 `profiles` 를 읽는 모든 형태(`from('profiles')`, `profiles!fk(`, `alias:profiles…`, `profiles:col (`)는 고르는 칸과 상관없이 자기 행 조회(`eq('id', user.id)` 등)이거나 꺼진 기능 허용 목록이어야 한다. M3 의 `c_code_deployed` 는 이 시험이 통과한 커밋이 배포됐다는 확인이다.
  - (3판) 연락처를 붙이는 곳은 모두 `attachMemberContacts` 를 쓰고, 탈퇴 회원을 붙이지 않으며 `member_ids` 에서도 뺀다(실행 시험 포함).
  - 문의 목록 쿼리에 `phone` 이 없는지
  - `support-view.tsx` 에 1-5 의 옛 문구 가운데 9절이 '코드에 남기는 것'으로 정한 것(상태 이름)을 뺀 나머지가 하나도 남지 않았는지. 필수 키 목록이 10-1 표와 같은지. 자리표시가 코드에 정한 세 개뿐인지. (3판)
  - 가림 종류·칸 목록이 DB 와 TS 에서 같은지(5-1)
  - 새 작업 기록 종류가 목록에 있는지
- **새 시험 `tests/bundle13-cs-tools-db-contract.test.mjs`**
  - M0 의 가드와 권한, 되돌리기 파일이 없다는 주석
  - M1 의 지문 사전 점검 5개와 VERIFY(필수 문구 키 포함), 새 표 2개의 REVOKE·RLS·가드, slug 트리거가 정책에서 목록을 읽는지, 4-4 의 (가)(나)(다)
  - M2·M3 에 `DROP TRIGGER` 가 없는지
  - (3판) M3: 사전 점검이 탈퇴 가림 정책 4개의 지금 식을 대조하는지, 판정 함수 2개가 SECURITY DEFINER·STABLE·search_path 고정인지, 정책 식을 바꾼 **뒤에** profiles 정책을 좁히는지, M3 down 이 원래 식으로 되돌린 뒤 함수를 지우는지
  - (3판) 적용 뒤 상태 기준: 모든 정책 식 안에서 `profiles` 나 `support_tickets` 를 직접 읽는 하위 조회는 자기 행 조건(`auth.uid()`)뿐인지(리허설 확인 조회와 같은 식). 판정 함수 이름은 `private.` 을 붙여 본다
  - (3판) slug 트리거가 `NEW.slug IS DISTINCT FROM OLD.slug` 일 때만 검사하고 SECURITY DEFINER·search_path 고정인지
  - 되돌리기 파일의 멈춤 조건
- **실행 시험**
  - 자리표시 채우기, 빈칸 찾기, 모르는 자리표시를 거부하는지
  - `maskPhone`
  - 열람 기록 인자 만들기: 중복 제거, 200명씩 나누기, 빈 목록이면 부르지 않기
- **고칠 기존 시험**
  - `support-tickets-privilege-contract`
  - `admin-support-u2-3-contract`
  - `support-category-api-ui-contract`
  - `bundle10-member-withdrawal-contract`
  - `admin-audit-log-contract`
  - (2판) `admin-guard-coverage-contract`: 새 route·액션마다 권한을 적는다. 복구·이전 답변은 `support.manage`, 회원 찾기는 `credits.grant`, 열람 기록 탭은 owner, 안내 문구는 Q9 결정을 따른다.
  - (2판) `admin-rls-by-permission-contract`: 템플릿 SELECT 정책, M3 의 profiles·문의·다운로드 기록 정책

### 12-2. 리허설(운영 DB, BEGIN…ROLLBACK, 새벽)
**목표**: 운영 데이터 위에서 적용·되돌리기·다시 적용이 깨지지 않는지 본다. 답변 이력과 profiles 좁히기가 다른 화면을 조용히 깨지 않는지 본다.
- **언제 돌리나**: 칸을 더하는 동안 `support_tickets` 가 잠기므로 새벽에 짧게 돌린다. **12번 M(`20261214100000`)이 적용된 상태**에서 돌린다.
- **경우 A**: M0·M1 의 VERIFY 가 통과하는지. 재정의 4개의 새 지문, `anonymize_member` 지문이 그대로인지.
- **경우 B(답변)**
  - 행위자: 문의 권한이 있는 staff, 없는 staff, owner, 관리자가 아닌 계정
  - 첫 답변
  - 수정: 이력 1행, 작업 기록 1행(사유 원문 없음, request 있음), `redaction_reviewed_at` 비움
  - 충돌, 재요청(`replayed = true`, 이력·작업 기록·알림 0건 추가), 사유 없음, 같은 글, 회원이 삭제한 문의 (3판)
- **경우 C(탈퇴)**
  - 시험 회원의 답변과 사유에 긴 숫자를 넣고 고친다 → facts 가 이력 항목(`previous_response`·`reason`)을 내놓는다 → 가림 → 확인
  - 고친 뒤 익명화하면 `last_ticket_event_at = response_edited_at` 인지 본다. (2판)
  - 문의를 보존하지 않으면 이력이 연쇄로 지워지고, 보존하면 남는다.
  - 탈퇴 뒤 저장하면 `MEMBER_WITHDRAWN` 이 나온다.
  - `read_withdrawn_member_ticket` 결과에 `answerRevisions` 가 있다.
  - 12번 트리거가 함께 돌아도 통과한다.
- **경우 D(잠금)**
  - staff claims 로 `admin_response`·`status` 를 직접 UPDATE → 거부된다.
  - service_role 로 직접 UPDATE → `SUPPORT_ANSWER_RPC_ONLY` 가 나온다.
  - 가림 경로와 익명화의 상태 닫기 → 통과한다.
  - staff claims 로 카테고리 slug 를 직접 UPDATE(문의가 있는 카테고리, 정책에 든 slug) → 거부된다. 문의 없는 카테고리 → 통과한다. (2판)
  - (3판) slug 는 그대로 두고 이름만 바꾸는 저장(slug 를 같은 값으로 함께 보냄) → 통과한다.
  - (3판) 거래 안에서 시험 회원을 탈퇴 상태로 만든 뒤, 그 회원 문의만 달린 카테고리의 slug 변경 → 거부된다.
- **경우 E(열람 기록)**
  - 거부되어야 하는 것: 관리자가 아닌 행위자, 빈 배열, 201개
  - UPDATE·DELETE·TRUNCATE 는 service_role 도 거부된다.
  - anon·authenticated 는 조회할 수 없다.
- **경우 G(M3)** (2판·3판)
  - staff claims 로 `profiles` 를 세면 1(자기 행)이고, owner claims 로 세면 전체다.
  - **탈퇴 가림**(3판): 거래 안에서 시험 회원 하나에 문의·회원 수정 이력·충전 환불·자료 환불 행을 만들고 `withdrawn_at` 을 채운다(가림 우회 설정으로). 그다음 표를 둘로 나눠 본다.
    - 세션 조회 권한이 있는 두 표(`support_tickets`, `market_refund_requests`): staff claims(문의 권한 있음)와 owner claims 로 조회하면 그 회원 행이 0건이다. M3 적용 전 결과와 같다.
    - 세션 조회 권한이 없는 두 표(`support_ticket_revisions`, `refund_requests`): 세션 조회가 지금처럼 권한 없음(42501)인지 본다. 판정 함수 결과(`private.is_withdrawn_ticket_member`·`private.is_withdrawn_member` = true)와 정책 식(`pg_get_expr`)이 바뀌었는지는 직접 확인한다.
  - 탈퇴하지 않은 회원의 문의·주문·환불 조회 건수는 owner 와 문의 권한 있는 staff 에서 적용 전과 같다. 문의 권한 없는 staff 는 문의 0건이다((가-2)).
  - 작업 요약(`admin-work-summary-server.ts`)이 쓰는 두 건수 조회를 staff claims 로 돌려 적용 전과 같은지 본다.
  - 판정 함수를 anon 으로 부르면 거부된다. 일반 회원 claims 로 DB API RPC(`/rpc/is_withdrawn_member`)를 부르면 함수를 찾지 못한다(`private` 스키마는 열려 있지 않음). (3판)
- **경우 F(되돌리기)**
  - M3 → M2 → M1 순으로 되돌리면 10번 원문 지문과 탈퇴 가림 정책 원래 식으로 돌아가는지 (3판)
  - M0 표는 남는지
  - 다시 적용이 통과하는지
  - 이력 행이 있으면 down 이 멈추는지
- **원칙**: 끝나고 남은 것이 0건인지 확인 조회로 본다.

### 12-3. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost 는 운영 DB 를 쓰므로 **쓰기 없이** 본다: 템플릿 넣기와 빈칸 표시, 수정 창(저장하지 않음), 안내 문구 미리보기, 숨김 목록, 열람 기록 탭
- 열람 기록은 localhost 에서도 실제로 쌓이고, 지울 수 없다. 그래서 대표 계정으로 짧게 확인하고, 대표에게 미리 알린다.
- 배포 뒤에는 운영 주소에서 시험 staff 계정(CS 기본)으로 확인한다.
  - 답변·수정·템플릿·복구가 되는지
  - 권한 밖 탭이 보이지 않고, 직접 호출하면 403 인지
  - 회원 상세를 열면 열람 기록에 1행이 생기는지
  - M3 뒤에 화면 이메일이 빈 칸으로 나오는 곳이 없는지
  - 문의·환불 목록과 연결 문의(`?ticket=`)에 탈퇴 회원 행이 섞이지 않는지(운영 탈퇴 회원 0명이라 리허설 경우 G 로 대신 확인한다) (3판)
- 알려진 한계(8-4)는 시험이 실패한 것으로 보지 않는다. 예: 주문·환불 행을 DB 에서 직접 조회하는 것

## 13. 검증 관점(계획·구현 모두, PASS 까지 반복)
1. **개인정보·탈퇴 가림**
   - 답변 이력과 사유가 가림·보존·보존 기간 기준·삭제 규칙을 비켜 가지 않는지
   - 열람 기록이 8조 요소를 갖추는지, 빠지는 경로가 없는지(12-1 전수 시험)
   - Q14 한계를 대표가 알고 정했는지
2. **DB·RLS·마이그레이션**
   - 권한, 트리거, 행위자 확인
   - 재정의에서 바뀐 줄이 4-4 에 적은 것뿐인지
   - M3 가 조용히 깨는 화면이 없는지, **탈퇴 가림 정책이 profiles 조회 권한에 기대지 않게 바뀌었는지**(3판)
   - 잠금, 되돌리기 순서, 12번과의 순서
3. **회원 화면 코드**
   - 문구 키 무리(9절)와 실패 동작
   - 수정 표시, 10번 가림 코드 갱신(5-1), 연락처 붙이기(8-2)의 탈퇴 회원 제외
4. **관리자 보안·CS 운영**
   - 경로 전수 조사, 지급 창 서버 이전, 권한 가드 시험
   - 직원이 실제로 쓰는 흐름과 충돌 안내

## 14. 범위 밖(후속)
- 회원 단위 관리자 메모(12번). 문의 단위 내부 메모, 미답변 경과 시간, 이어지는 대화(U4-1·U4-3 의 나머지, 출시 뒤)
- 기간이 지난 열람 기록을 지우는 함수(가장 이른 만료 전에 만든다). 예외 목록(확정, 2026-11-26): 처음 만들 때 DB 정책 값(`system_settings` 새 키 `admin_record_retention_policy` 의 `paymentLinkedActions`, 코드에 상수로 두지 않음)으로 넣는다. 첫 값 = `credit_grant`·`credit_revoke`·`market_refund_approve`·`market_refund_reject`·`market_refund_exception`·`market_refund_owner_settle`·`point_charge_source_hold`·`point_charge_source_release`·`member_withdraw`·`member_withdraw_request`·`member_withdraw_request_reply`·`member_withdraw_request_cancel`·`member_text_redact`·`member_text_reviewed`·`withdrawn_held_order_close`·`withdrawn_member_event`, 그리고 `payment_admin_actions` 전부. 이 행들은 관련 결제 기록·탈퇴 처리 기록의 보관 기간이 끝날 때까지 남기고, 관련 기록이 없으면 2년으로 본다. `withdrawn_record_view`(보관 기록 열람)는 열람 기록과 같은 성격이라 2년 쪽이다. 결제 이력이 없는 회원의 결제 시도 기록은 '관련 기록'이 아니다(그 회원의 관리자 처리 내역은 2년 쪽). 새 작업 종류를 더할 때 어느 쪽인지 그 묶음 계획에서 정한다. 01-11 시행 처리방침 3절이 관리자 작업 기록(회원에 관한 것)도 2년으로 적었으므로 `admin_audit_log`·`payment_admin_actions` 정리도 함께 만든다. **마감 2028-11-11 전**(가장 이른 행: `payment_admin_actions` 2026-11-11, `admin_audit_log` 2026-11-19). 추가 전용 가드와 함께 설계하고, **예외**로 결제·환불·탈퇴 처리에 관한 관리자 처리 내역(`payment_admin_actions` 전부, `market_refund_approve`·`withdrawn_held_order_close`·`member_withdraw` 등)은 결제 기록·탈퇴 처리 기록의 기간(5년)까지 남긴다(01-11 시행 처리방침 3절). 작업 순서표 13번 비고에도 적음. 10번 후속의 '보존 기간 지난 문의 자동 파기'에 답변 이력도 넣는다.
- 기존 쓰기 작업 기록(지급·환불·상품 등)에 IP·기기 남기기(변호사 ① 답을 보고)
- 주문·충전 환불·자료 환불의 관리자 조회를 권한 키 기준으로 좁히기. 먼저 세션으로 읽는 경로(`refunds/page.tsx`, `admin-work-summary-server.ts` 의 자료 환불 건수 등)를 조사해야 한다. 문의는 Q14 (가-2)로 이번에 좁힌다. (3판)
- 옛 마이페이지(`site_legacy_mypage`)를 다시 켜면 옛 문의 화면에 수정 표시가 없다. 다시 켤 때 고친다. (3판)
- CSV 내보내기(23번): 사유를 받고 열람 기록 `export` 로 남긴다.
- 알림 문구 관리(16번). ~~처리방침 문구 보완(2027-01-11 뒤, 8-4).~~ (01-11 시행 개정에 넣음, 8-4)

## 15. 배포 순서
1. 계획 검증 4관점 PASS → 0절 답 반영
2. 구현 → 계약 시험 → 독립 검증 PASS(13절)
3. 12번 DB 적용 뒤 리허설(12-2, 새벽) 통과
4. **M0·M1 적용**(새벽, 승인)
   - 추가만 하므로 옛 코드가 그대로 돈다(옛 답변 route 의 세션 UPDATE 도 아직 허용).
5. 로컬 확인(나 → 대표, 쓰기 없음) → push·배포. 5-1 과 8-2 경로 이전이 이 배포에 들어간다.
6. **M2 적용**(승인): 새 코드가 함수로만 쓰는지 운영에서 확인한 뒤에 한다.
7. **M3 적용**(Q14 가, 승인): 운영 화면 표본을 대표 계정과 시험 staff 계정으로 본 뒤에 한다.
- 4단계부터 7단계 사이에는 직원에게 문의 권한을 주지 않는다.
8. 시험 staff 계정으로 12-3 운영 확인 → 런북 갱신 커밋 → **Q14 조건 확인**((가)면 M3 적용 완료, (나)면 변호사 ④ 답) → 대표가 CS 계정 발급
- 일정: 15번 게시(12-10 안)와 12번 적용이 끝난 뒤에 한다. **마감: M0·8절 기록 코드·런북 10-9 를 2027-01-10까지 운영 반영한다. 못 하면 01-11 시행일을 미룬다**(01-11 시행 처리방침이 이 기록을 설명하고, 10번 스크립트 apply 가 멈춘다). 13번은 약관·동의 항목·탈퇴 정책 키를 건드리지 않으므로 고지 기간 잠금과 충돌하지 않는다.

## 16. 12번 묶음(회원 정지·메모)과 겹치는 곳 (2판: 12번 1판 사실로 고침)
- **함수 재정의는 겹치지 않는다**
  - 12번(`20261214100000_member_suspension.sql`)은 `anonymize_member` 를 고치지 않고 지문만 확인한다. 그리고 `profiles` 에 AFTER UPDATE OF withdrawn_at 트리거를 더한다.
  - 13번도 `anonymize_member` 를 고치지 않고 지문만 확인한다(4-2 사전 점검).
- **순서**
  - 12번이 먼저 적용한다. 13번 파일 시각은 그 뒤다.
  - 13번 리허설 경우 C(익명화)는 12번 트리거가 적용된 상태에서 돈다.
  - 되돌릴 때는 13번부터 한다.
- **회원 상세 화면 파일**: 두 묶음 모두 `/admin/users/[id]` 를 고친다. 13번은 열람 기록 호출과 [이 회원 열람 기록] 링크만 더한다. 먼저 들어간 쪽 뒤에 이어 붙인다.
- **12번 메모**: 회원 상세에 메모를 보이면 `users.detail` 기록의 `fields` 에 `memo` 를 더한다.
- **M3 와의 관계**
  - 12번 화면이 세션으로 다른 회원의 `profiles` 를 읽으면 M3 뒤에 빈 값이 된다. 12번 구현이 서버 키로 읽는지 12-1 전수 시험이 함께 본다.
  - 12번이 RLS 정책 식 안에서 `profiles` 나 `support_tickets` 를 직접 읽는 하위 조회를 새로 만들면, 탈퇴 가림과 같은 문제가 생긴다. 판정은 SECURITY DEFINER 함수(4-6 의 `private.is_withdrawn_member` 를 같이 쓸 수 있음)로 해야 한다. 12-1 DB 계약 시험이 함께 본다. (3판)
  - 12번의 정지 판정이 `profiles` 를 읽는다면 SECURITY DEFINER 이거나 자기 행이어야 한다.
- **문의 단위 내부 메모**: 두 묶음 모두 만들지 않는다.

## 17. 검증 반영
### 17-1. 1판 검증 반영
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 법률 major | 답변 저장·카테고리·템플릿·문구 쓰기에 IP·기기가 없음 | 4-3 `p_request_meta`, 11절 details `request`. 기존 쓰기에 IP 가 없는 점은 14절·변호사 ① |
| 법률·보안 major | 개인정보 경로가 빠짐(지급 창, 후기, 작업 기록, questions·ai) | 1-4 표 전수, 8-1 화면 키, 12-1 전수 시험. questions·ai 는 꺼진 기능(대표에게도 404)이라 허용 목록에 사유와 함께 둠 |
| 보안 major | 지급 창이 브라우저 세션으로 profiles 를 읽음 | 8-2 서버 route `GET /api/admin/users/search` + `member_search` 기록, 12-1 클라이언트 금지 시험 |
| 법률·DB major | 수정 사유 원문이 가릴 수 없는 작업 기록에 들어감 | 작업 기록에는 길이만(4-3의 7). 사유는 이력 표에만 두고 가림 칸·LONG_NUMBER·가드 예외에 `reason` 을 더함(4-2, 4-4), 안내 문구 |
| 법률·DB major | `last_ticket_event_at` 에 수정 시각이 빠짐 | 4-4 (다), 경우 C |
| 법률 major | 직원의 DB 직접 조회 한계를 조건 없이 발급 | 0절 Q14, M3(4-6) 권장, 15절 8단계 조건, 8-4 한계, 런북 |
| DB major | slug 잠금이 서버에만 있어 세션 직접 UPDATE 로 피해 감 | 4-2 의 5 DB 트리거, 경우 D |
| DB major·회원 blocker | 10번 가림 TS 코드에 새 종류가 없어 패널이 깨지고 탈퇴가 막힘 | 5-1(같은 배포), 12-1 DB↔TS 대조 |
| DB major | 열람 기록 표를 남기는 down 뒤 다시 적용하면 사전 점검에서 멈춤 | M0 로 떼어 되돌리기 없음(4-1), 경우 F |
| 회원 major | 확인 창 제목 같은 필수 문구가 비면 쓸 수 없음 | 9절 키 두 무리, 저장 거부와 VERIFY, 읽기 실패 땐 오류 화면(기본 문구 없음) |
| 회원 major | 옮길 문구 목록·metadata 가 덜 적힘 | 1-5 전체 목록, 10-1 키 무리, `generateMetadata` |
| DB minor | 재요청 확인에 `request_id` 인덱스가 없음 | 문의 잠금 뒤 action·target_id·request_id 로 좁혀 확인(4-3의 4) |
| DB minor | M2 가 `status`·`updated_at` 칸 권한과 정책을 남김 | 4칸 회수, 정책 DROP, down 에서 다시 줌 |
| DB minor | 지문 계산식과 전체 값, 12번 사실 | 1-3 계산식·32자리, 16절 고침, 파일 시각을 12번 뒤로 |
| DB minor | down 이 템플릿·문구 고친 값을 그냥 지움 | `c_export_confirmed`, 지울 객체 목록(4-7) |
| 법률 minor | 12번 순서 | 16절 |
| 법률 minor | 처리방침 개정 목록, uuid 잔존, 사유 칸 | 8-4 목록·질문 ⑤, 8-1 사유 200자·안내 |
| 회원 minor | 수정 표시 모양, 알림 type·자리표시, 첫 답변 알림 문구 | 5절 회원 화면·알림, Q15 |
| 회원 minor | 옛 화면에서 수정 표시 없이 보임 | 옛 화면을 `/mypage/support` 로 넘김(5절). 3판에서 이미 닫혀 있음을 확인해 작업을 지움(17-2) |
| 보안 minor | 문의 조회도 `is_admin()` 기준 | 1-1, 4-6 남는 한계, 14절, 12-3 '알려진 한계' |
| 보안 minor | 환불 화면이 200명을 넘을 수 있음 | 8-1 200명씩 나눠 기록 |
| 보안 minor | 빈칸 표시를 바꾸면 템플릿과 어긋남 | 표시는 관리자 화면에서 고치지 않음(4-2의 4) |
| 보안 minor | 권한 가드·RLS 계약 시험 | 12-1 기존 시험 2개 추가 |

### 17-2. 2판 검증 반영 (3판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 법률·DB·보안 blocker | M3 가 profiles 를 좁히면 탈퇴 가림 RESTRICTIVE 정책 4개의 `NOT EXISTS(profiles …)` 가 직원에게 늘 참이 되어 탈퇴 회원 기록이 보임 | 4-6: 판정 함수 2개(SECURITY DEFINER·STABLE·search_path 고정)로 정책 식을 먼저 바꾸고 그다음 좁힘, 사전 점검에 지금 식 대조, down 은 원래 식으로, '영향을 받지 않는 것' 고쳐 씀, 경우 G 에 탈퇴 상태 시험 회원, 12-1 '정책 식의 profiles 하위 조회는 자기 행뿐' |
| 법률·DB·보안 major | 행 쿼리를 서버 키로 옮기면 RLS 탈퇴 가림이 빠짐 | 8-2 원칙: 행 쿼리는 세션 유지, `profiles` 끼워 읽기만 빼고 `attachMemberContacts` 로 연락처를 서버 키에서 붙이며 기록, 탈퇴 회원은 붙이지 않고 `member_ids` 에서도 뺌, 12-1·12-3 시험 |
| DB major | slug 트리거가 이름만 고쳐도 걸리고, RLS 아래에서 문의를 덜 셈 | 4-2 의 5: `NEW.slug IS DISTINCT FROM OLD.slug` 일 때만, SECURITY DEFINER·search_path 고정, 회원 삭제·탈퇴 회원 문의 포함, 경우 D 두 경우 추가 |
| DB·보안 minor | `market-refunds.ts` 1071행이 세션이라는 근거가 틀림 | 1-4 에서 고침(1054행 `createAdminClient()`). 세션으로 문의를 읽는 곳 목록을 적고, 이를 근거로 문의 조회 좁히기를 Q14 (가-2)로 이번 범위에 넣음 |
| DB minor | 되돌리기 순서가 옛 코드와 맞지 않음 | 4-7: M3 down → M2 down → 코드 → M1 down, 런북 10-10 같게 |
| 법률 minor | 다운로드 기록의 회원 IP 도 `is_admin()` 으로 보임 | 1-4, Q14 (가-3)(세션 경로 0건 확인 뒤), 8-4 한계·변호사 ④ |
| 보안 minor | 세션으로 profiles 를 읽는 형태 전수 시험이 좁음 | 12-1 에 모든 형태(`from`·`!fk(`·별칭·`col (`)와 자기 행 조건, `c_code_deployed` 연결 |
| 회원 minor | 재요청 때 알림이 또 감 | 4-3 결과 `replayed`, 5절 알림 안 보냄, 경우 B 확인 |
| 회원 minor | 옛 문구 시험과 '코드에 남기는 것'이 어긋남, 실패 알림·화면 낭독 글자 | 12-1 대상에서 상태 이름 뺌, 실패 알림 키 3개 더함, 화면 낭독은 `editIconTitle`·`deleteIconTitle` 같이 씀 |
| 회원 minor | 필수/선택 표시가 표에 없음 | 10-1 표에 '필수/선택' 칸, 9절 필수 키 목록 하나를 저장 검사·VERIFY·해석이 같이 씀, 실패 동작 한 줄 |
| 회원 minor | 옛 화면은 이미 닫혀 있음 | 1-1 사실 정정, 5절 redirect 작업 지움, 14절 알려진 한계 |
| 회원 minor | `cacheTag` 는 이 저장소에서 쓰지 않음 | 9절 `unstable_cache` + 태그, 저장 뒤 `revalidateTag(…, { expire: 0 })`, 실패는 캐시하지 않음 |

### 17-3. 3판 검증 반영(모두 minor, 같은 판에서)
| 관점 | 반영 |
|---|---|
| 법률·DB·보안 | 판정 함수를 `private` 스키마로(USAGE·EXECUTE 는 authenticated·service_role, 정책 식에 스키마 이름), 경우 G 를 세션 권한 있는 두 표/없는 두 표로 나눔·일반 회원 RPC 확인, 하위 조회 검사에 `support_tickets` 포함, 정책은 `ALTER POLICY` 로 식만 바꾸고 역할·명령 대조, (가-3) 넣음(세션 경로 0건 확인), M3 되돌릴 때 직원 권한 처리, 열람 기록 위·변조 한계와 월 점검 줄, 환불 화면 사실 정정(세션은 자료 환불뿐, 셋 모두 기록)·허용 목록을 쿼리 단위로, `attachMemberContacts` 가 `display_tag` 까지 화면 모양대로 채우고 연결 문의에도 적용. 판정 함수 본문에서 부른 사람을 제한하는 안은 `private` 스키마로 RPC 길이 없어져 넣지 않음 |
