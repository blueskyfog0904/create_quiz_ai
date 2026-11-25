# 15번 묶음(먼저 할 부분) 계획 · 공지 팝업(정식 오픈 전 안내·약관 변경 30일 전 고지)

작성일: 2026-11-25
판: 6 (5판 검증 반영, 다시 검증 전)
- 1판은 법률·DB·화면 세 관점 모두 FAIL 이었다(반영은 15절 표). 2판은 화면 PASS, 법률·DB FAIL(16절 표), 3판은 법률·화면 PASS, DB FAIL(17절 표), 4판·5판은 DB FAIL(18절·19절 표)이었다. 6판에서 리허설 절(11-2)은 목표·경우·원칙으로 줄였다.
- 고친 곳은 문단 끝에 `(2판)`~`(6판)` 으로 표시했다. 시행일을 바꾼 데 따른 날짜 수정은 표시하지 않았다.
- 작업 순서표 15번 '로그인 공지 팝업'(노출 기간, 대상, 다시 보지 않기) 가운데 이번 고지에 필요한 부분을 먼저 만든다. 나머지는 15번 본 작업으로 미룬다(14절).

## 0. 대표 결정
**2026-11-25 첫 결정**
1. 사이트는 아직 정식 오픈 전이다. 그런데 판매 스위치가 2026-11-11 부터 켜져 있었고, 11-17~11-22 에 실회원 4명이 페이앱으로 결제했다.
2. 판매는 '조용한 출시'로 계속한다(B안). 회원에게는 대표가 이메일로 직접 알린다(C안).
3. 10번 묶음(회원 탈퇴)의 약관 변경(탈퇴 때 크레딧 소멸 등)은 회원에게 불리한 변경이다. 그래서 약관 제3조②에 따라 **30일 전에 고지**한다.
4. 팝업의 용도는 두 가지다.
   - (1) 베타 안내: 정식 오픈 전이다. 약관은 미리 알린 뒤에만 바꾼다.
   - (2) 약관 변경 예고: 바뀌는 내용 요약, 시행일, '자세히 보기'
5. 문구는 DB 에 두고 관리자 화면에서 고친다. 최종 문구는 나중에 대표가 클라이언트와 정한다. 지금은 초안(9절)을 넣는다.

**2026-11-25 새 결정(1판 검증 뒤)**
6. **시행일을 2027-01-11(월)로 미룬다.** (2판)
   - 고지(이메일·팝업)는 **2026-12-10 이 끝나기 전(한국 시각)** 에 시작한다.
   - 기간은 첫날을 넣지 않고 센다. 12-10 에 고지하면 12-11 부터 세어 시행일 전날(01-10)까지 31일이다.
   - 12월 초 완성을 목표로 제대로 만든다. 1판의 '11-27 최소 범위'와 '코드 없는 대안'은 걷어 냈다.
   - 이메일 초안은 `docs/notice-2027-01-terms-change.md` 다.
   - 10번 스크립트의 시행일 고정 값과 날짜 계산도 2027-01-11 기준으로 한다(4-3).
7. **'시행일 전 탈퇴(현행 약관 적용)' 처리 절차는 지금 만들지 않는다.** 대표는 요청이 거의 없을 것으로 본다. (2판)
   - 런북 RB-11 10-3 앞에 한 줄을 넣었다. 요청이 오면 접수 안내만 하고, 대표가 그때 처리 방법을 정해 요청일부터 10일 안에 처리한다. 익명화 기능(`anonymize_member`)은 이 기간에 쓰지 않는다.
   - 그래서 1판 법률 blocker 는 '대표 결정으로, 별도 절차 없이 런북 한 줄로 대응'으로 정리한다.
   - 시행 스크립트 0번의 'pending 요청 있으면 멈춤' 검사와 충돌하지 않게, 고지 기간 요청은 `member_withdrawal_requests` 에 기록하지 않는다. 시행 직전에 열린 요청이 0건인지 확인한다(10절 8단계).
   - 팝업·이메일의 '시행일 전까지 탈퇴 요청 가능' 안내는 그대로 둔다. 요청 방법(결제 이력이 있으면 고객센터 이메일·전화)을 함께 적는다.
8. 실회원이 있으므로 DB 적용과 리허설은 새벽에 짧게 한다. localhost 는 운영 DB 를 쓰므로, 쓰기 없이 확인하는 방법을 정한다(10-1, 11-3). (2판)

## 1. 지금 상태(코드·운영 DB 확인, 2026-11-25)
- **설정 행**
  - `system_settings` 에 공지 팝업 키가 없다.
  - 하단 정보(`site_footer_content`)의 '추가 안내 문구'(`extraNotices`)는 비어 있다. 하단은 이 값을 `<p>{notice}</p>` 글로만 그려서 링크가 되지 않는다(`solvook-footer.tsx`). (2판)
- **설정 쓰기 막기**: 중요한 키는 키마다 RESTRICTIVE 정책(`system_settings_<키>_no_client_write`)으로 브라우저 쪽 쓰기를 막는다. 막지 않은 키는 `system_settings_owner_update` 로 대표 세션이 직접 고칠 수 있다.
  - 이 표에는 충전 정책·구매 정책·하단·약관이 함께 들어 있고, 요청마다 읽힌다. 그래서 표 전체를 잠그는 문장(CREATE POLICY 등)은 새벽에 짧게만 돌린다(11번 계획 5-5 와 같은 규칙). (2판)
- **탈퇴 화면 막힘 문구**(3판): 10번 코드는 스위치가 꺼져 있으면 결제 회원의 탈퇴 요청과 결제 시도만 있는 비결제 회원의 익명화를 409(DISABLED)로 막는다(`src/app/api/auth/withdraw/route.ts`). 그때 보이는 운영 문구 `member_withdrawal_policy.texts.blockReasons.DISABLED` 는 "지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요."다. 이 정책 문구를 고치는 관리자 화면은 없다(DB 만).
- **상호**(3판): 하단 정보 `companyName` 은 '써머썬연구소'(띄어 쓰지 않음), 사이트 이름 `site_brand.name` 은 '써머썬 연구소'다. 고지 글의 회사 이름은 상호를 쓴다.
- **가입 동의 항목**(3판): `signup_consent_items` 에는 이미 `guard_signup_consent_item_update` 트리거가 있다. 10번 시행 스크립트는 terms·privacy 의 판·본문 md5, required·is_active·policy_slug 와 탈퇴 정책 문구 세 줄(`w_paths`)을 실행 직전 값으로 다시 대조한다.
- **약관 본문**: 세 문서 본문 md5 가 10번 스크립트의 사전 값과 같다.
  - 환불 `158f1163…`, 이용약관 `75271f98…`, 처리방침 `ddcc8ba5…`
  - 탈퇴 스위치 `selfAnonymizeEnabled` 는 꺼져 있다.
- **지금 약관의 탈퇴 조항**: 12조②는 "남은 크레딧과 환불은 취소/환불정책을 따릅니다"뿐이다. 환불정책에는 탈퇴 조항이 없다. 고지 기간의 탈퇴 요청은 0절 7번(대표 결정)대로 대표가 그때 정한다. (2판)
- **10번 스크립트의 모양**
  - 바뀔 전문을 통째로 들고 있지 않다. 지금 본문에서 [옛 조각, 새 조각] 쌍을 바꿔 새 본문을 만든다.
  - 시행일 문장(`v_date`)은 **실행한 날**로 들어간다.
  - 0번 사전 점검이 '처리 대기 탈퇴 요청이 있으면 멈춤'이다.
  - 같은 실행에서 가입 동의 항목 terms·privacy 새 판(본문 `it_pairs`·`ip_pairs`, 변경 안내 `c_terms_note`·`c_privacy_note`)도 만든다.
  - 끝의 확인 조회는 `details.bundle = 'bundle10_policy_text'` 기록이 2건이라고 기대한다.
- **약관 지문 규칙**: 사본 표 `policy_document_snapshots` 는 `encode(sha256(convert_to(content, 'UTF8')), 'hex')` 를 쓴다. 이번에도 같은 규칙을 쓴다.
- **게시된 약관의 고지 약속**
  - 이용약관 제3조②: "시행일과 변경 내용·사유를 시행일 7일 전부터 서비스 화면에 알리고, 회원에게 불리하거나 중요한 변경은 30일 전부터 알리며 회원에게 다시 동의를 받습니다."
  - 처리방침 14절: "시행 7일 전부터 서비스 화면에 알리고, … 중요한 변경은 30일 전부터 알립니다."
  - 다시 동의 받기는 시행일 스크립트가 맡는다(가입 동의 terms·privacy 새 판 → 다음 접속 때 `/consent`).
- **레이아웃**
  - 회원 화면 틀은 `src/app/(solvook)/layout.tsx` 다. `/checkout`·`/pricing` 의 layout 이 이것을 그대로 다시 내보낸다.
  - 약관 화면은 `src/app/terms/layout.tsx` 가 같은 헤더·하단을 따로 그린다.
  - 로그인·가입·동의 화면은 `(auth)` layout, 관리자는 `(admin)/admin/layout.tsx` 다.
  - 생성·문제은행 화면(`[workspaceSubject]`·`(dashboard)`)은 기능이 꺼져 있다.
  - 루트 `src/app/template.tsx` 가 `LoginCompleteDialog` 를 띄운다(`login=success`·`logout=success`). 상품 상세는 그 값을 보고 로그인 뒤 담기를 이어 간다.
- **공용 Dialog**
  - `src/components/ui/dialog.tsx` 는 바깥(어두운 배경)을 눌러도 닫히지 않는다(대표 결정 2026-11-23).
  - 판은 `fixed top-1/2 translate-y-1/2 grid` 이고, 높이 제한·`motion-reduce` 처리가 없다. (2판)
  - 높이 제한 선례: `market-checkout-confirm-dialog.tsx` 가 `StudioDialogPanel className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]"` 로 쓴다. (2판)
  - 기본 X 버튼의 화면 읽기 이름이 영어 "Close" 라서, 이번 팝업은 X 를 쓰지 않는다.
  - 시험 `tests/studio-dialog-contract.test.mjs` 는 회원 팝업 파일에서 날 `DialogContent` 사용을 막는다. (2판)
- **경로 규칙 예**: 동의 관문 `src/lib/consent-gate.ts` 가 '판정하지 않는 경로' 목록을 순수 함수로 두고 시험한다.
- **충전 흐름**
  - `/pricing`(상품 고르기) → `/checkout` → 같은 탭으로 페이앱 결제창 → `/checkout/payapp/result`
  - 결과 화면의 '충전 상품으로 돌아가기'는 `/pricing` 으로 간다. `/checkout` 의 '환불정책 전문 보기'는 같은 탭에서 `/terms/refund` 로 간다. (2판)
- **관리자 화면**
  - '사이트 기본 정보'(`/admin/footer`, 권한 `site.manage`)의 '가입 동의 항목' 카드는 대표에게만 보인다.
  - 그 서버 액션은 `assertAdminActionPermission('owner')` 로 막고, DB 함수(`save_signup_consent_item`)도 행위자가 대표인지 다시 본다.
  - 작업 기록 종류 이름은 `src/lib/admin-audit-log.ts` 에 있다. `admin_audit_log` 는 추가만 받는다.
  - 시험 `admin-guard-coverage-contract` 는 관리자 'use server' 파일 목록과 권한표가 같아야 통과한다. `revalidateTag` 는 이 저장소에서 `revalidateTag(KEY, { expire: 0 })` 로 쓴다(next 16 형식). (2판)
- **상품 상세 조회 기록**: 상세를 열면 `POST /api/market/items/{id}/view` 가 운영 DB 에 조회 기록을 쓴다. 그래서 localhost 화면 시험에서는 상세를 열지 않는다(11-3). (2판)
- **10번 코드**: 아직 push 전이다. 로컬 main 이 origin 보다 3개 앞선다(`51b7373` 10번 코드, `25f01b6` 10번 문서·문구 스크립트, `6a1add7` 작업 기록 종류 `member_withdrawal_policy_update` 등록·시행일 결정 기록). `KAKAO_ADMIN_KEY` 는 2026-11-25 Production 에 등록됐다. 15번 커밋은 이 셋 위에 쌓인다. (2판·5판)

## 2. 목표
1. 회원 화면에 처음 들어오면 공지 팝업이 뜬다. 비로그인 방문자에게도 뜬다. 관리자 화면과 결제·충전 흐름(`/pricing`·`/checkout`·`/cart`)에는 뜨지 않는다. (2판)
2. 팝업 문구(제목, 본문, 링크, 노출 시작·끝, 켜기·끄기)는 DB 에 있다. 대표만 관리자 화면에서 고친다.
3. [닫기]와 [오늘 하루 보지 않기]가 있다. 문구가 바뀌면 다시 보인다.
4. 시행일 전에도 **바뀌는 부분(변경 전 → 변경 후)과 바뀔 전문**을 `/terms/upcoming` 에서 본다. (2판)
   - 다시 동의를 받을 가입 동의 항목의 새 글도 함께 본다.
   - 이 글은 시행일 스크립트가 넣을 글과 글자까지 같다. 다르면 시행일 스크립트가 멈춘다.
5. 팝업을 닫은 회원도 언제든 찾아갈 수 있다. (2판)
   - 하단 정책 링크 옆에 '변경 예정 약관' 링크가 생긴다.
   - 지금 약관 화면, 약관 목록, 가입·동의 화면, 충전·장바구니 화면 위에 '바뀝니다 · 바뀌는 부분 보기' 한 줄이 나온다.
6. 고지 기간에 탈퇴 화면도 고지와 같은 말을 한다(고객센터 요청 안내, 4-6). (3판)
7. 30일 전 고지의 증빙이 DB 에 남는다. 팝업 노출 시작 시각, 팝업 문구 원문·지문, 변경 예정 글 원문·지문, 시행 때 대조 결과가 남는다. 시행 스크립트가 고지 시작이 마감일 안이었는지 DB 기록으로 확인한다. (2판)

## 3. 이번 범위와 일정
**넣는 것**
1. **10번 배포 전 작은 스크립트**(4-6): 탈퇴 화면 막힘 문구(`blockReasons.DISABLED`)를 고지 기간 문구로 바꾼다. 15번 없이도 돈다. (3판)
2. DB: 팝업 설정 행, 저장 함수(대표만, 작업 기록 함께), 쓰기 막기 정책 2개, 고지 기간 잠금 트리거 3개(약관 문서·동의 항목·탈퇴 정책)(4절)
3. 10번 스크립트 고치기(4-3)
   - '게시'·'시행' 실행 방식
   - 변경 대조(`changes`)·변경 전 전문·동의 항목 새 글 게시
   - 고지 시작 확인
   - 동의 항목 terms 새 본문과 변경 안내를 12조②에 맞춤(3판)
4. 회원 화면 팝업(5절)
5. `/terms/upcoming` 과 '바뀝니다' 한 줄 안내, 하단 링크(6절)
6. 관리자 '사이트 기본 정보' 안 대표 전용 '공지 팝업' 카드(7절)
7. 개발 전용 미리보기(10-1), 시험(11절)
8. 구현 때 함께 고칠 문서(8-4)

**미루는 것(15번 본 작업)**: 14절

**일정(목표와 마지막 날)** (3판)
| 단계 | 목표 | 마지막 날 |
|---|---|---|
| 계획 검증 PASS | 11-28 | 12-01 |
| 4-6 작은 스크립트 작성 → 독립 검증 → 리허설 경우 E(새벽) → notice 실행(짧은 행 잠금만) | 10번 push 직전 | 10번 push 직전 |
| 구현·계약 시험·독립 검증 PASS | 12-03 | 12-05 |
| 리허설 1차(11-2, 새벽 03~04시) | 구현 PASS 다음 새벽(12-04) | 구현 PASS 다음 새벽 |
| 다시 리허설(실패했거나 스크립트 상수를 고친 경우, 새벽) | 12-06 | 12-07 |
| DB 적용(마이그레이션만, 새벽 10분 안) | 12-05 | 12-08 |
| 로컬 확인(나 → 대표, 쓰기 없음) → push·배포 | 12-06 | 12-09 |
| 게시 스크립트 → 운영 확인 | 12-07 | 12-09 |
| 팝업 켜기 → 이메일 발송 → 기록 | 12-08 | 12-10 낮(23:59 KST 전) |
- 마지막 날을 넘기면 다음 단계를 당겨 쓰지 않는다. 고지를 12-10 안에 시작할 수 없으면 시행일을 미룬다(13절 6번).
- **10번을 먼저 따로 내보내기로 하면**(13절 5번): 4-6 스크립트 작성 → 독립 검증 → 리허설 경우 E(새벽) → notice 실행 → 10번 push 를 15번 구현과 따로 먼저 한다. 그 경우 R4 리허설은 이미 고지 문구인 상태에서 시작한다(11-2). (4판)
- **대표 일정을 미리 잡는다**(4판): 로컬 승인 시각(마지막 날 12-09 오전 안)과 켜기·이메일 시각(12-10 낮). 12-09 에 새벽 창과 대표 확인이 겹치지 않게, 로컬 승인은 DB 적용 다음 날 오전으로 잡는다.

## 4. DB 변경(마이그레이션 `20261205100000_site_notice_popup.sql`)
- 마이그레이션 끝의 VERIFY 는 이 저장소 관례대로 둔다. 다만 RESTRICTIVE 정책 2개가 `pg_policies` 에 있는지 보는 검사는 **이름 붙인 별도 DO 블록**(`$verify_site_notice_popup_policies$`)에 따로 둔다. 리허설의 '정책 뺀 사본'은 `CREATE POLICY` 2개와 이 블록 하나를 뺀 것이다(11-2 원칙 5). (6판)
### 4-1. 팝업 설정 행 `site_notice_popup`
```
{
  "enabled": false,
  "title": "…",            // 한 줄, 1~60자
  "body": "…",             // 여러 줄, 1~1200자, 서식 없는 글(줄바꿈만)
  "linkUrl": "/terms/upcoming",   // 비우거나, '/' 로 시작하는 사이트 안 주소만
  "linkLabel": "…",        // 링크가 있으면 1~20자
  "startsAt": null,        // 없으면 켠 때부터
  "endsAt": "2027-01-12T00:00:00+09:00",
  "contentSha256": "…",    // 4-2 규칙, 저장 함수가 채움
  "revision": 1            // 저장할 때마다 +1(낙관적 잠금)
}
```
- 마이그레이션이 9절 초안을 **꺼진 상태**로 넣는다(`ON CONFLICT (key) DO NOTHING`). `contentSha256` 은 4-2 함수로 계산한다.
- 본문 상한은 1200자다. 9절 초안이 약 1010자라서 여유를 두려고 1판의 1000자보다 늘렸다. (2판)
- 켜져 있으면 `endsAt` 이 반드시 있어야 한다.

### 4-2. 지문 규칙과 저장 함수
- **내용 지문** `site_notice_popup_content_sha256(title, body, link_url, link_label)` (STABLE — 안의 `convert_to` 가 STABLE 이라서) (3판)
  - `encode(sha256(convert_to('site_notice_popup:v1' || LF || title || LF || coalesce(link_url,'') || LF || coalesce(link_label,'') || LF || body, 'UTF8')), 'hex')`
  - 제목·링크·링크 이름에는 줄바꿈을 받지 않으므로 글자 경계가 섞이지 않는다.
  - 노출 시작·끝과 켜기는 지문에 넣지 않는다. 끝 날짜만 고쳐도 다시 뜨지 않게 하려는 것이다.
  - 이 지문이 브라우저 저장 키(5-3)와 고지 기록(8절)에 같이 쓰인다. 지문은 DB 에서만 계산한다. 코드는 읽기만 하므로 TS·SQL 이 어긋날 일이 없다.
- **저장 함수** `save_site_notice_popup(p_actor_id, p_expected_revision, p_enabled, p_title, p_body, p_link_url, p_link_label, p_starts_at, p_ends_at)` → jsonb
  - SECURITY DEFINER, `search_path` 고정. `REVOKE … FROM PUBLIC, anon, authenticated` 뒤 service_role 에만 EXECUTE 를 준다.
  - 행위자가 대표(`is_admin AND admin_role = 'owner'`)가 아니면 `NOTICE_POPUP_ACTOR_NOT_OWNER`
  - 행을 `FOR UPDATE` 로 잠근다. `revision` 이 다르면 `NOTICE_POPUP_REVISION_CONFLICT`
  - 입력을 다듬고(앞뒤 공백, CRLF→LF) 검사한다. 어기면 `NOTICE_POPUP_INPUT_INVALID`
    - 제목 1~60자·한 줄, 본문 1~1200자
    - 링크는 `'/'` 로 시작하고 `'//'`·`'/\'`·공백·제어문자가 없는 200자 이하. 밖 주소·`javascript:` 는 받지 않는다.
    - 링크가 있으면 링크 이름 필수
    - 둘 다 있으면 `endsAt > startsAt`. 켤 때는 `endsAt` 필수이고 `endsAt > now()`
  - 지문을 계산하고 `revision + 1` 로 저장한다.
  - **같은 거래 안에서** 작업 기록을 남긴다(`record_admin_audit`, action `site_notice_popup_save`). 기록이 실패하면 저장도 실패한다.
    - details: `revision_before/after`, `before`·`after`(값 전체), `content_sha256_before/after`, `content_changed`, `visible_before`, `visible_after`, `exposure_starts_at`, `saved_at`
    - `saved_at` 은 `clock_timestamp()` 다. 한 거래 안의 여러 저장도 순서가 생긴다(4-3 끊김 판정). (3판)
- **고지 끊김 판정 함수** `policy_upcoming_notice_continuity(p_effective_date date DEFAULT NULL, p_notice_deadline date DEFAULT NULL)` → jsonb `{ok, s_id, last_id, reason}` (4판·5판)
  - 시행일과 고지 마감일은 **게시 행의 `effectiveDate`·`noticeDeadline`** 을 읽는다. 인자를 받으면 행 값과 같은지만 대조하고, 다르면 `ok = false`(reason `ARG_MISMATCH`)를 돌려준다. 시행 스크립트는 상수를 넘겨 대조하고, 관리자 카드·런북은 인자 없이 부른다. 카드 코드에 날짜 상수를 두지 않는다. (5판)
  - STABLE, 읽기만 한다. service_role·postgres 만 EXECUTE.
  - 판정 순서는 4-3 '고지가 끊김 없이 이어졌는지 확인' 그대로다. 시행 스크립트와 런북 읽기 조회(`notice_continuity_check`)는 **이 함수만** 부른다. 같은 규칙을 두 번 구현하지 않으려는 것이다.
  - 관리자 카드 경고(7-2)는 같은 '좋은 기록' 규칙을 순수 함수 `isNoticeRecordGood(after, upcoming)`(`src/lib/site-notice-popup.ts`)로 옮긴 것이다. 두 쪽에 같은 예시 묶음을 돌린다(11-1·11-2).
    - `visible_*` = 켜짐이고 `startsAt ≤ now() < endsAt`(시작이 미래면 false)
    - `exposure_starts_at` = 켜짐이면 `GREATEST(now(), startsAt)`, 아니면 NULL. 고지 증빙의 '노출 시작 시각'이다.
  - 바뀐 것이 없으면 저장·기록하지 않고 그대로 돌려준다. 그래서 초안 그대로 꺼진 채 저장해도 기록이 생기지 않는다. 원문은 켜기 저장 기록의 `before`·`after` 에 남는다(10절 6단계). (2판)

### 4-3. 변경 예정 글 `policy_upcoming_documents` (10번 스크립트 고치기)
10번 스크립트(`supabase/scripts/20261126_bundle10_policy_text.sql`)를 이 계획의 범위로 고친다. 파일은 구현 때 고치고, 여기에는 고칠 내용만 적는다. 같은 [옛, 새] 쌍과 같은 계산으로 게시와 시행을 모두 하므로, 고지한 글과 시행일에 들어갈 글이 어긋날 수 없다.

**상수(머리)**
- `c_mode`: `'publish_upcoming'`(게시) 또는 `'apply'`(시행). 기본 NULL 이고, NULL 이면 멈춘다.
- `c_effective_date date := DATE '2027-01-11'`
  - `v_date` 는 실행한 날이 아니라 이 값으로 만든다("2027년 1월 11일"). (2판)
- `c_notice_deadline date := DATE '2026-12-10'`: 고지를 시작해야 하는 마지막 한국 날짜 (2판)
- `c_apply_last_date date := DATE '2027-01-11'`: 시행을 실행할 수 있는 마지막 한국 날짜. 기본은 시행일 당일만이다(13절 7번). (2판)
- 상수 검사: `c_notice_deadline <= c_effective_date - 32`, `c_apply_last_date >= c_effective_date` 가 아니면 멈춘다. 첫날을 넣지 않고 30일을 채우는 규칙과 같다. 시행일만 고치고 마감을 잘못 두는 실수를 막는다. (3판)

**동의 항목 글을 12조②·처리방침에 맞춘다** (3판·4판)
- 게시하면 동의 항목 새 글도 30일 고지 원문이 된다. 그래서 게시 **전에** 고친다. 게시 뒤에 고치면 다시 게시하고 30일을 처음부터 세야 한다.
- `it_pairs` 새 조각의 굵은 줄을 다음처럼 고친다.
  ```
  - **탈퇴하면 남은 크레딧(유료·무상)은 소멸하며 환불되지 않습니다.** 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다(이용약관 제12조).
  ```
- `c_terms_note`
  ```
  이용약관 제12조(계약 해지와 탈퇴)를 바꿨습니다. 결제 이력이 있는 계정도 탈퇴 화면에서 탈퇴를 요청할 수 있고, 탈퇴하면 남은 크레딧(유료·무상)은 소멸하며 환불되지 않습니다. 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 취소/환불정책에 '8-2. 회원 탈퇴와 크레딧'을 더했습니다.
  ```
- `c_privacy_note`: 지금 글 끝에 한 문장을 더한다. "결제 이력이 없어도 결제 시도 기록과 탈퇴할 때 보존에 동의한 문의는 정한 기간 동안 보관하며, 탈퇴 요청 기록을 새로 수집합니다."
- **privacy 동의 항목 본문에 수집 항목 줄을 더한다**(4판). 변경 안내가 '새로 수집'이라고 하는데 동의 본문의 수집 항목에 없으면 서로 다른 말을 하게 된다. 그래서 `ip_pairs` 에 `insert` 쌍 하나를 더한다.
  - 옛 조각(운영 본문, 2026-11-25 읽기 조회로 확인): `- 이용 중 생성: 접속 기록, 결제 기록`
  - 더할 줄: `- 회원 탈퇴 때: 탈퇴 요청 기록(접수 경로·일시·본인 확인 결과), 탈퇴 안내 원문, 대리인이 요청한 경우 대리인의 이름·연락처와 위임 확인 자료(목적: 회원 탈퇴 처리와 결과 안내, 탈퇴 뒤 분쟁 대응)`
  - 처리방침 1·2절(`p_pairs`)이 더하는 목적·항목과 같은 말이다. 근거(동의인지, 계약 이행인지)는 변호사 질문 12-4 에 묻는다. 게시 전에만 고칠 수 있다.
- 숫자 검사 `c_num_checks` 의 `TRNX`('기간이 끝난 뒤 N일 동안') 최소 건수를 3에서 5로 올린다. 지금 3곳(약관 12조②, 환불 8-2②, 막힘 문구)에 동의 항목 본문과 변경 안내가 더해진다. 새 문장이 빠지면 멈추게 하려는 것이다.
- 고친 스크립트는 다시 리허설한다(11-2 R4).
- **탈퇴 정책 잠금 목록**(4판): 게시 행에 `lockedWithdrawalPaths` 배열을 넣는다. 값은 `w_paths` 세 경로, `c_num_checks` 가 쓰는 숫자 키 전부(`paymentRetentionYears`·`payerTicketRetentionYears`·`payerRefundTicketRetentionYears`·`nonPayerTicketRetentionYears`·`attemptRecordRetentionYears`·`consentRecordRetentionYears`·`withdrawalRecordRetentionYears`·`selfWithdrawOrderQuietDays`·`withdrawRefundDeadlineBufferDays`), `termsConsentItemKey`, `texts.notice.termsVersion` 이다. 스크립트가 이 목록을 만든다(트리거 안에 상수로 두지 않음, 4-4).

**쌍에 이름을 붙인다** (2판)
- 각 쌍을 `[옛 조각, 새 조각, 표시 이름, 표시 방식]` 으로 늘린다. 배열이 직사각형이 되게 모두 4칸으로 한다.
  - 표시 방식 `replace`: 변경 전 = 옛 조각, 변경 후 = 새 조각
  - 표시 방식 `insert`: 변경 전 = "(없음 — 새로 생김)", 변경 후 = 새 조각에서 옛 조각을 뺀 부분(앞뒤 줄바꿈 정리). 옛 조각이 새 조각에 정확히 1번 들어 있어야 하며, 스크립트가 확인한다.
- 예
  - 이용약관 12조 전체: `replace`, '제12조(계약 해지와 탈퇴)'
  - 부칙: `replace`, '부칙 시행일'
  - 환불 8-2: `insert`, '8-2. 회원 탈퇴와 크레딧(신설)'
  - 처리방침 1절 목적 줄: `insert`, '1절 처리 목적(추가)'
  - 처리방침 2절: `insert`, '2절 수집 항목(회원 탈퇴 추가)'
  - 처리방침 3절: `replace`, '3절 보유 기간'
  - 처리방침 머리: `replace`, '시행일'
  - 처리방침 6·7·10절: `replace`
- 이 값에서 문서별 `changes` 배열을 만든다(`v_date` 를 넣은 뒤의 글 그대로).

**게시(`publish_upcoming`)**
- 0번 사전 점검
  - "10번 DB 적용·스위치 꺼짐"을 확인한다.
  - **15번 마이그레이션이 적용됐는지**도 확인한다: `to_regprocedure('public.save_site_notice_popup(…)')`, `pg_policies` 의 두 정책, `pg_trigger` 의 잠금 트리거 3개. 없이 넣은 게시 행은 대표 세션이 고칠 수 있어서다. (3판)
- 1번(잠금·문서 사전 md5·동의 항목 사전 md5)과 2번(쌍이 정확히 1번씩·새 본문·새 동의 항목 본문 계산)은 그대로 한다.
- 대표 확인 값(`c_confirmed_count`·`c_confirmed_members_md5`) 확인과 pending 요청 검사는 게시 때 하지 않는다. 시행 때 한다.
- **게시 때 VERIFY 처리표**(4판). 계약 시험이 이 표대로 분기를 본다. 블록 전체를 `c_mode = 'apply'` 로 감싸지 않는다.
  | VERIFY | 게시 때 |
  |---|---|
  | 5-3 옛 표현 0건, 5-4 새 절 위치·시행일 문장·12조 ①~④, 5-5 보존 기간 숫자 = DB 값 | **저장 전 새 본문 변수로 돌림**. 5-5 의 `X` 는 `v_wpolicy_new` |
  | 5-7-3 고지 원문에 새 ticketsPayer 가 들어감 | **자리표시 검사만**(5판). `w_paths[3][3]` 의 자리표시자를 정책 값으로 채운 뒤 `{…}` 가 남지 않고 비어 있지 않은지만 본다(함수가 NULL 을 돌려주는 조건과 같음). `member_withdrawal_notice_text` 는 정책을 인자로 받지 않고 DB 값을 읽으므로 게시 때 같은 글을 만들 수 없다. 조립 규칙을 스크립트에 다시 쓰지 않는다. 실제 함수 대조는 시행 VERIFY(5-7-3·5-7-4)가 그대로 하고, 리허설 R4 (가)가 실제 함수로 확인한다 |
  | 5-1 저장 본문 = 새 본문, 5-2 동의 항목 판 +1, 5-6 사본 3행, 5-7 작업 기록 3건, 5-7-2 탈퇴 정책 저장, 5-7-4 회원별 고지, 5-8 고지 원문의 약관 판, 5-9 재동의 대상 | **건너뜀**(저장한 뒤의 DB 상태를 보는 검사라 게시에는 뜻이 없음) |
- 약관 본문·동의 항목·탈퇴 정책 문구는 **바꾸지 않는다**.
- `policy_upcoming_documents` 행을 넣는다.
  ```
  { "status": "upcoming", "effectiveDate": "2027-01-11", "effectiveDateLabel": "2027년 1월 11일", "noticeDeadline": "2026-12-10",   // noticeDeadline = c_notice_deadline (5판)
    "publishedAt": clock_timestamp(), "appliedAt": null, "revertedAt": null,
    "heading": "…", "intro": "…",                       // 화면 머리말(9절 초안)
    "bannerText": "…", "bannerLinkLabel": "…", "footerLinkLabel": "…",   // 한 줄 안내·하단 링크(9절 초안)
    "statusTexts": {"applied": "…", "revertedAfterApply": "…", "withdrawn": "…", "historyLinkLabel": "…"},   // 6-1·6-2 상태별 줄(9절 초안)
    "labels": {…},                                      // 6-1 화면 글(9절 초안) (4판)
    "lockedWithdrawalPaths": [ … ],                     // 4-4 트리거 3 이 막는 탈퇴 정책 경로 (4판)
    "baseMd5": {세 문서 지금 본문 md5},
    "documents": [ {"key":"serviceTerms","slug":"service","title":"이용약관","content":"…","sha256":"…",
                    "beforeContent":"…", "beforeSha256":"…",
                    "changes":[{"label":"…","mode":"replace","before":"…","after":"…"}], "changesSha256":"…"},
                   {"key":"refundPolicy",…}, {"key":"privacyPolicy",…} ],
    "consentItems": [ {"key":"terms","label":"…","version":2,"content":"…","note":"…","sha256":"…","contentSha256":"…"},
                      {"key":"privacy",…} ],
    "superseded": [] }
  ```
  - 문서 제목·slug 는 지금 `site_footer_content.policyDocuments` 값을 그대로 복사한다.
  - `beforeContent` 는 바꾸기 전 지금 본문이다. 시행 뒤에도 '이전 판 전문'을 보이기 위해서다(6-1). (3판)
  - `changesSha256` = `changes` 를 정해진 순서로 이은 글(`label LF mode LF before LF after` 를 `LF LF` 로 이음)의 sha256
  - 동의 항목 `sha256` = `label LF version LF note LF content` 의 sha256. 이름·판·변경 안내까지 묶는다. `contentSha256` 은 본문만의 sha256 이다. (3판)
  - 화면 글 `labels`(4판): `/terms/upcoming` 의 링크·칸 이름도 게시 행 DB 값으로 둔다(6-1, 9절 초안).
  - `publishedAt` 은 `clock_timestamp()` 로 채운다. 한 거래 리허설에서도 기록 사이 순서가 생기게 하려는 것이다. (3판)
- 작업 기록 `policy_upcoming_publish` 를 남긴다. (2판)
  - details: `bundle = 'bundle15_policy_upcoming'`, **행 전체(documents·changes·consentItems·heading·intro 원문 포함)**, `documents_sha256`, `base_md5`, `effective_date`
  - 원문이 추가 전용 표에 남으므로, 행이 나중에 바뀌어도 "그때 무엇을 보였나"를 DB 에서 바로 꺼낸다.
  - 10번 확인 조회의 `bundle10_policy_text` 건수에는 섞이지 않는다.
- 행이 이미 있을 때 (3판)
  - `status = 'applied'` 면 멈춘다.
  - `upcoming` 이고 문서·동의 항목 지문이 모두 같으면 머리말·한 줄 안내·상태별 줄만 바꾼다. `publishedAt` 은 그대로 둔다(기록은 남김).
    - (6판 검증 반영) '같은 지문'은 문서 sha256 3개, `changesSha256` 3개, 동의 항목 sha256 2개가 모두 같은 경우다. 이 경로에서는 heading·intro·bannerText·bannerLinkLabel·footerLinkLabel·statusTexts·labels 만 바꾼다. `changes`·`lockedWithdrawalPaths` 가 달라지면 아래 '지문이 다르면' 경로(사유 필요)로 보낸다. 확인 조회에 `changesSha256` 앞 12자리를 함께 보이고, 11-1 계약 시험·R4 (다)에 '표시 이름만 바뀐 다시 게시 → 사유 없으면 멈춤'을 더한다.
  - `upcoming` 이고 지문이 하나라도 다르거나, `reverted` 면 `c_republish_reason`(기본 NULL)이 있어야만 진행한다.
    - 앞 행의 지문·`publishedAt`·`appliedAt`·`revertedAt` 을 `superseded` 배열에 옮긴다(원문은 이미 게시 기록 details 에 있음).
    - `status = 'upcoming'`, 새 `publishedAt` 으로 새로 시작한다. 고지 기간을 처음부터 다시 센다(13절 6번).
- 끝의 확인 조회는 `c_mode` 에 따라 다른 것을 보인다. 게시 때는 상태·문서 지문 3개·동의 항목 지문 2개·변경 건수다. (2판)

**시행(`apply`)**
- **검사 순서**(6판). 앞 검사에서 멈추면 뒤 검사는 하지 않는다. 멈춤 이유가 늘 같은 자리에서 나오게 하려는 것이다.
  1. 상수 검사(마감 ≤ 시행일 − 32, `c_apply_last_date` ≥ 시행일)와 **날짜**(한국 날짜가 `c_effective_date`~`c_apply_last_date`)
  2. **15번 마이그레이션**: 저장·판정 함수, 잠금 트리거 3개, 정책 2개(`pg_policies`)
  3. **10번 0번**: 10번 DB 적용, 스위치 꺼짐, pending 탈퇴 요청 0건, 대표 확인 값(`c_confirmed_count`·md5)과 대상 목록
  4. **고지 끊김 판정**(아래, 판정 함수)
  5. **지문**: 새 본문·동의 항목·`changes` 를 계산해 게시 행과 비교
  - 게시도 같은 검사 묶음을 쓴다. 게시는 1(상수 검사만, 날짜 범위는 보지 않음) → 2 → 3(10번 DB 적용·스위치 꺼짐만. pending·대표 확인 값은 보지 않음) 순서이고, 4·5 는 하지 않는다. (6판)
- 날짜: 한국 날짜가 `c_effective_date` 이상 `c_apply_last_date` 이하가 아니면 멈춘다. 본문 시행일 문장은 상수로 고정이라, 당일 안에 다시 실행해도 지문이 같다. (2판)
- **고지가 끊김 없이 이어졌는지 확인**(DB 기록으로, 판정 순서 그대로) (3판). 이 판정은 마이그레이션의 `policy_upcoming_notice_continuity` 함수 하나로 하고, 시행 스크립트는 그 함수를 불러 `ok` 가 아니면 멈춘다(4-2). (4판)
  1. 게시 행 `status = 'upcoming'`, `publishedAt`(한국 날짜) ≤ `c_notice_deadline`
  2. 대상 기록: `site_notice_popup_save` 가운데 `details.saved_at > publishedAt` 인 것. `details.saved_at`(=`clock_timestamp()`), `id` 순으로 줄 세운다.
  3. 기록마다 '좋은 기록'인지 본다. 아래를 모두 채워야 한다.
     - `after.enabled = true`
     - `after.linkUrl = '/terms/upcoming'`
     - `after.endsAt >= c_effective_date 00:00 KST`(경계 같음은 통과, 13절 1번 대안과 맞춤)
     - `after.body` 에 게시 행 `effectiveDateLabel`('2027년 1월 11일')이 들어 있음
     - `after.startsAt` 이 없거나 그 기록의 `saved_at` 이하. 다만 아래 S 기록에서는 미래 시작도 받는다.
  4. **마지막 기록부터 거꾸로** 보면서 좋은 기록이 이어지는 가장 앞 기록 S 를 찾는다. 마지막 기록이 좋은 기록이 아니면 멈춘다.
  5. `GREATEST(S.saved_at, S.after.startsAt)`(한국 날짜) ≤ `c_notice_deadline` 이어야 한다.
  6. 지금 팝업 행의 `revision` = 마지막 기록의 `revision_after` 이어야 한다(기록 밖에서 바뀌지 않았음).
  - 이렇게 하면 켬→끔→다시 켬, 시작을 미래로 둔 저장, 끝을 시행일 앞으로 당겼다가 다시 늘린 저장, 링크를 다른 곳으로 바꾼 저장, 본문에서 시행일을 뺀 저장이 모두 '끊김'으로 걸린다.
  - 팝업 저장은 새 코드의 관리자 카드로만 하므로, 노출 기록은 새 코드가 운영에 있을 때 생긴다. 코드를 되돌린 기간은 DB 가 알 수 없으므로 10절 '되돌리기' 규칙(먼저 팝업을 꺼 기록을 남김)으로 막는다.
  - 런북 읽기 조회(`notice_continuity_check`)는 같은 함수를 부른다. 10절 6단계 직후, **켠 뒤 팝업을 저장할 때마다**, 8단계에서 돌린다. 시행 날에 처음 드러나지 않게 하려는 것이다. (4판)
- 새 본문·새 동의 항목 글·`changes` 를 계산해 게시 행과 비교한다. 동의 항목은 시행 때 쓸 이름(지금 항목 이름)·판(+1)·스크립트의 변경 안내로 같은 식을 다시 계산한다. 행이 없거나, 문서 sha256·`changesSha256`·동의 항목 sha256 이 하나라도 다르면 멈춘다. (3판)
- 같으면 **먼저** 게시 행을 `status = 'applied'`, `appliedAt = clock_timestamp()` 로 바꾼다(4-4 잠금 트리거 3개가 풀리게). 그 뒤 지금 스크립트의 3~5번(저장·동의 항목 새 판·탈퇴 문구·VERIFY)을 같은 거래에서 한다. (2판)
- 작업 기록 `policy_upcoming_apply`(bundle `bundle15_policy_upcoming`, 지문 일치, 판정 S 기록 id·마지막 기록 id)를 남긴다.
- VERIFY 5-6 에 한 줄을 더한다: 사본 표 최신 지문 = 게시 행 지문.
- 탈퇴 정책의 `blockReasons.DISABLED`(4-6 이 바꾼 값)는 사전 대조 대상(`w_paths` 세 줄)이 아니다. 4-2 단계는 정책 행 전체를 다시 쓰지만, 시작할 때 읽은 값 위에 세 줄만 바꾸므로 4-6 의 값이 그대로 남는다. 리허설 거래 C 에서 확인한다. (3판)

**고지 그만두기(`withdraw_upcoming`)** (4판)
- 시행 전에 고지를 그만둘 때 쓴다. 손으로 상태를 바꾸지 않는다.
- 조건: 게시 행 `status = 'upcoming'`. 사유 상수 `c_withdraw_reason`(기본 NULL)이 있어야 한다.
- 하는 일: `status = 'reverted'`, `revertedAt = clock_timestamp()`, 작업 기록 `policy_upcoming_withdraw`(사유, 앞 지문, `publishedAt`).
- 그 뒤 6-1 은 `withdrawn` 문구를 보이고, 다시 고지하려면 '행이 이미 있을 때'의 `reverted` 규칙으로 게시한다.
- **그만둘 때의 순서**(5판). 같은 날 한 번에 한다.
  1. `withdraw_upcoming` 실행(게시 행 `reverted`, 기록)
  2. 관리자 카드에서 팝업을 끄거나 '변경을 시행하지 않기로 했다'는 안내 문구로 바꿔 저장한다. 끄지 않으면 회원이 '1월 11일부터 바뀝니다'를 계속 본다.
  3. 4-6 `restore` 로 탈퇴 막힘 문구를 원래대로 되돌린다(1월 11일 기준 안내가 남지 않게).
  - 런북 '공지 팝업' 절에 같은 순서를 둔다. 리허설 R4 (다)에서 1→3 이 도는지 본다.

**머리 주석과 되돌리기**
- 머리 주석의 "바로 시행 전제" 설명을 30일 고지 경로로 고친다.
- 되돌리기 블록은 게시 행을 `status = 'reverted'`, `revertedAt = clock_timestamp()` 로 바꾸는 줄을 더한다. `upcoming` 으로 돌리지 않는다. (2판)
- 고친 스크립트는 다시 리허설한다(11-2).

### 4-4. 쓰기 막기·권한·고지 기간 잠금
- RESTRICTIVE 정책 두 개를 만든다. 둘 다 UPDATE 에 `key <> …` 방식이다.
  - `system_settings_site_notice_popup_no_client_write`
  - `system_settings_policy_upcoming_documents_no_client_write`
  - 이 정책은 되돌리기(4-5)가 일부러 남긴다. 그래서 마이그레이션은 `DO` 블록에서 `pg_policies` 에 없을 때만 `CREATE POLICY` 한다(DROP 없이). 되돌린 뒤 다시 적용해도 'already exists' 로 멈추지 않는다. `site_notice_popup` 정책은 그냥 만든다. (6판)
- **고지 기간 잠금 트리거**: 게시 행이 `upcoming` 일 때만 막고, 행이 없거나 다른 상태면 그대로 둔다. 막을 때 오류는 `POLICY_UPCOMING_LOCKED` 다. 게시 행은 같은 표라 읽지 못할 일이 없고, 한 거래 안에서 판정하므로 경합이 없다.
  1. 트리거 `lock_policy_documents_during_notice` / 함수 `lock_policy_documents_during_notice_fn()`(system_settings BEFORE UPDATE, `NEW.key = 'site_footer_content'`) (2판)
     - 게시 행 `documents[].key` 에 든 문서만 `content`·`slug`·`title`·`enabled` 가 OLD 와 다를 때(IS DISTINCT FROM) 막는다. 키 목록을 트리거 안에 상수로 두지 않는다(6판 검증 반영, 11-1 계약 시험 '문서 키는 게시 행에서 읽음').
     - 다른 칸(사업자 정보, 추가 안내 문구 등) 저장은 그대로 된다.
  2. 트리거 `lock_consent_items_during_notice` / 함수 `lock_consent_items_during_notice_fn()`(signup_consent_items BEFORE UPDATE, 기존 `guard_signup_consent_item_update` 옆) (3판)
     - 게시 행 `consentItems` 의 key(terms·privacy) 행에서 `content`·`label`·`version`·`required`·`is_active`·`policy_slug` 가 바뀌면 막는다.
     - 관리자 '가입 동의 항목' 카드 저장도 이 트리거로 막힌다. 카드는 `POLICY_UPCOMING_LOCKED` 를 받아 7-3 과 같은 안내를 보이고, 게시 행이 `upcoming` 일 때 카드 위에 미리 안내한다.
  3. 트리거 `lock_withdrawal_texts_during_notice` / 함수 `lock_withdrawal_texts_during_notice_fn()`(system_settings BEFORE UPDATE, `NEW.key = 'member_withdrawal_policy'`) (3판·4판)
     - 게시 행 `lockedWithdrawalPaths` 의 경로(4-3: `w_paths` 세 줄, 보존 기간·일수 숫자 키 전부, `termsConsentItemKey`, `texts.notice.termsVersion`)가 OLD 와 다르면 막는다. 목록을 트리거 안에 상수로 두지 않는다.
     - `selfAnonymizeEnabled` 를 false→true 로 바꾸는 것도 막는다.
     - `blockReasons.DISABLED`(4-6)와 다른 값은 막지 않는다.
  - 시행 스크립트는 같은 거래에서 상태를 먼저 `applied` 로 바꾼 뒤 세 곳을 저장하므로 막히지 않는다(4-3). 리허설 R3·R4 (가)에서 순서를 실제 트리거로 확인한다.
- 두 행은 서버 키로만 읽는다. 내용은 공개 글이라 읽기 정책은 그대로 둔다.
- 잠금: `CREATE/DROP POLICY` 와 **`DROP TRIGGER`** 는 표에 ACCESS EXCLUSIVE(읽기도 막음)를, `CREATE TRIGGER` 는 SHARE ROW EXCLUSIVE(쓰기만 막고 읽기는 막지 않음)를 잡는다. 그래서 `SET LOCAL lock_timeout = '3s'`, `statement_timeout = '60s'` 를 걸어 잡지 못하면 전체를 취소하고, 새벽에 적용한다. 리허설에서 읽기까지 막는 문장(POLICY·DROP)은 거래 A 에만 둔다(11-2). (4판·5판)
- 마이그레이션은 새 트리거라 **`DROP TRIGGER IF EXISTS` 없이 `CREATE TRIGGER` 만** 쓴다. 10번 마이그레이션의 'DROP IF EXISTS → CREATE' 관례를 따르지 않는다. 따르면 리허설에서 트리거를 만드는 거래의 사본이 표 읽기를 거래 내내 막기 때문이다. 계약 시험이 '마이그레이션에 DROP TRIGGER 없음'을 본다. (5판)

### 4-5. 되돌리기(`supabase/rollback/20261205100000_site_notice_popup_down.sql`)
- 코드를 먼저 되돌린 뒤에만 한다.
- `DROP TRIGGER`·`DROP POLICY` 가 표 읽기를 막으므로 **새벽에** `SET LOCAL lock_timeout = '3s'`, `statement_timeout = '30s'` 를 걸고 돌린다. 잡지 못하면 전체가 취소된다. (5판)
- 지우는 순서(4판): 잠금 트리거 3개 → 트리거 함수 3개(`lock_*_fn`) → 팝업 함수 2개와 판정 함수 1개 → `site_notice_popup` 정책 → `site_notice_popup` 행. `DROP TRIGGER` 는 함수를 지우지 않으므로 함수도 따로 지운다. 그래야 다시 적용(CREATE FUNCTION)이 'already exists' 로 멈추지 않는다.
- `policy_upcoming_documents` 행과 그 쓰기 막기 정책(`…_policy_upcoming_documents_no_client_write`)은 **남긴다**. 행을 증빙으로 남기므로 대표 세션 쓰기에 열리지 않게 짝으로 둔다. (3판)
- 고지를 그만두면 4-3 `withdraw_upcoming` 으로 `status = 'reverted'` 를 표시한다(시행 전이라 `appliedAt` 은 null, 6-1 문구가 다름). (4판)
- 작업 기록은 추가 전용이라 남는다.

### 4-6. 10번 배포 전 작은 스크립트: 탈퇴 화면 막힘 문구 (3판)
**왜 필요한가**
- 10번 코드가 배포되면, 스위치(`selfAnonymizeEnabled`)가 꺼진 동안 결제 회원의 탈퇴 요청과 '결제 시도만 있는 비결제 회원'의 익명화가 409(DISABLED)가 된다.
- 그때 화면 문구(`member_withdrawal_policy.texts.blockReasons.DISABLED`, 운영 값)는 "지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요."다.
- 이 문구는 기다리라는 뜻으로 읽힌다. 기다리면 시행일이 지나 새 12조②가 적용된다. 그래서 고지가 약속한 '시행일 전 탈퇴(지금 약관)'와 어긋난다.
- 10번 push 가 15번보다 먼저일 수 있으므로(13절 5번), 이 문구 변경은 15번 없이 따로 돈다.

**파일**: `supabase/scripts/20261205_bundle15_withdraw_disabled_text.sql`(마이그레이션이 아님, 적용 이력에 넣지 않음). 실행 방식 상수 `c_mode` 가 둘이다.
- `'notice'`(10번 push·배포 **전**에 실행)
  - `member_withdrawal_policy` 행을 `FOR UPDATE` 로 잠근다.
  - 지금 `blockReasons.DISABLED` 가 위 운영 값과 글자까지 같아야 한다(다르면 멈춤).
  - 그 한 경로만 아래 고지 기간 문구로 바꾼다. 다른 값은 그대로인지 확인한다(바꾼 경로를 되돌린 값 = 처음 값).
    ```
    지금은 이 화면에서 탈퇴를 받을 수 없습니다. 고객센터(이메일·전화)로 탈퇴를 요청해 주세요. 요청일부터 10일 안에 처리해 이메일로 알려 드립니다. 2027년 1월 11일 전에 요청하시면 바뀌기 전 약관(2026년 11월 23일 시행)이 적용됩니다.
    ```
    - '지금 약관' 대신 날짜가 박힌 '바뀌기 전 약관(2026년 11월 23일 시행)'을 쓴다. 시행일 뒤에 읽어도 뜻이 바뀌지 않게 하려는 것이다. 10번 옛 표현 검사(5-3)는 탈퇴 정책 문구를 보지 않으므로 이 날짜가 시행을 멈추지 않는다. (4판)
    - '요청일부터 10일 안 처리'는 스위치가 꺼진 동안 내내 지킨다. 런북 RB-11 의 '켠 뒤 10일 안 처리' 줄을 고친다(8-4). (4판)
    - 날짜는 스크립트 상수(`c_effective_date`, `c_current_terms_date`)로 만든다. 시행일을 미루면 상수를 고쳐 다시 돌린다(13절 6번). (4판)
    - **진행 기준**(5판·6판): 지금 `DISABLED` 값이 (1) 원래 운영 문구이거나 (2) `member_withdrawal_policy_update` 기록 가운데 bundle `bundle15_withdraw_disabled_text` 인 **마지막 기록의 `details->>'after'`** 와 글자까지 같을 때만 진행한다. '마지막 기록'은 `ORDER BY details->>'saved_at' DESC` 로 고른다. `created_at` 은 거래 시작 시각이고 `id` 는 무작위라 한 거래 안의 순서를 가리지 못하기 때문이다. 둘 다 아니면 멈춘다. 옛 날짜 문구를 스크립트가 다시 만들지 않아도 되고, 정규식처럼 비슷한 손 수정을 받아 버리지도 않는다.
  - 작업 기록 `member_withdrawal_policy_update`(details: `bundle = 'bundle15_withdraw_disabled_text'`, `changed_paths`, `before`, `after`, `saved_at`)를 남긴다. `before`·`after` 는 `DISABLED` 문자열 하나다(10번 스크립트처럼 배열이 아님). `saved_at` 은 `clock_timestamp()` 다. (6판) 기록자는 10번 스크립트와 같이 '가장 최근에 로그인한 대표 계정'이다.
- `'restore'`(스위치를 켤 때, 런북 RB-11 10-2 5번과 같은 창)
  - 지금 값이 위 (2) 기준(마지막 기록의 `after`)과 같을 때만 원래 문구로 되돌린다. 기록을 남긴다. (5판)
  - 스위치를 켜면 DISABLED 가 더 보이지 않지만, 문구를 원래대로 두어 다음 정지 때 오해가 없게 한다.
- 잠금은 행 잠금뿐이라 낮에 돌려도 되지만, 실회원이 적은 새벽에 돌린다. 거래는 몇 밀리초다.
- 리허설: 운영 DB `BEGIN … ROLLBACK`(마지막 줄만 ROLLBACK 인 사본)으로 notice → restore 를 한 번씩 돌려 값·기록을 본다(11-2 경우 E).
- 10번 시행 스크립트와 충돌하지 않는다(4-3 끝, 11-2 R4 (가)에서 확인).
- 이 문구는 탈퇴 화면 `/mypage/withdraw` 에서만 보인다. 10번 배포 뒤 S13(11-3)으로 읽기만 해서 확인한다.

## 5. 회원 화면 팝업
### 5-1. 붙일 곳과 빼는 경로
- **붙일 곳**: `src/app/(solvook)/layout.tsx`, `src/app/terms/layout.tsx` 두 곳만이다. 관리자·`(auth)`·옛 화면 layout 에는 붙이지 않는다.
  - 두 layout 이 서버에서 `getActiveSiteNoticePopup()`(새 파일 `src/lib/site-notice-popup-server.ts`)을 다른 읽기와 함께 읽고, 결과를 새 클라이언트 부품 `SiteNoticePopup`(`src/components/notice/site-notice-popup.tsx`)에 넘긴다.
  - 읽기는 `unstable_cache` 60초, 태그 `site_notice_popup`. 저장하면 `revalidateTag('site_notice_popup', { expire: 0 })` 로 바로 바뀐다. (2판)
  - 읽지 못하면 팝업 없이 화면을 그린다.
- **빼는 경로**: 순수 함수 `isNoticePopupExcludedPath(pathname, linkUrl)`(`src/lib/site-notice-popup.ts`)로 판정한다. 과목 접두(`stripWorkspacePrefix`)를 뗀 경로도 본다.
  - `/admin`, `/dashboard/admin` — 관리자(붙이지 않지만 한 번 더 막음)
  - `/pricing`, `/checkout` 아래 전부(페이앱·카카오페이 결과 포함), `/cart` — 충전·결제 흐름. 이 화면에는 대신 '바뀝니다' 한 줄이 나온다(6-2). (2판)
  - 팝업 링크가 가리키는 경로(DB 의 `linkUrl` 에서 쿼리·`#` 을 뗀 경로). 대표가 링크를 바꿔도 링크 화면 위에 팝업이 뜨지 않는다. (2판)
    - 그 경로와 **정확히 같은 경로만** 뺀다(아래 경로는 빼지 않음). `linkUrl` 이 `/` 면 빼지 않는다. 홈에서 팝업이 사라지지 않게 하려는 것이다. (3판)
  - `/terms/upcoming`(링크가 다른 곳이어도 늘 뺌)
  - `/consent`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth`, `/preview`
  - 빼는 경로에서는 띄우지 않을 뿐, 닫은 것으로 치지 않는다. 다음에 다른 회원 화면으로 가면 뜬다.
- `/checkout` 에서 '환불정책 전문 보기'로 `/terms/refund` 에 가면 팝업이 뜬다. 바뀌는 정책을 알리는 자리라 의도한 것이다. 한 번 닫으면 그 탭에서는 다시 뜨지 않는다. (2판)

### 5-2. 언제 띄우나
- 서버는 `enabled` 이고 `지금 < endsAt` 이며 `contentSha256` 이 64자 16진수일 때 행을 넘긴다. 아니면 `null` 이다.
  - 시작이 미래인 행도 넘기고, 브라우저가 시작·끝을 모두 본다. 그래서 열어 둔 탭에서도 시작 시각이 지나면 다음 화면 이동 때 뜬다. (2판)
  - 서버 layout 에서 `Date.now()` 를 쓴다. 관리자 layout 의 eslint 예외 주석 방식을 따른다.
- 부품은 화면이 브라우저에 붙은 뒤(useEffect) 저장소를 읽고 연다. 서버 그림에는 팝업이 없다.
- 여는 판단은 **처음 붙을 때와 경로(`usePathname`)가 바뀔 때만** 한다. 쿼리만 바뀔 때는 열지 않는다.
- 쿼리는 `useSearchParams` 대신 effect 안에서 `window.location.search` 로 읽는다. 그래서 Suspense 경계가 필요 없다. (2판)
- 그 판단 때 주소에 `login=success` 나 `logout=success` 가 있으면 이번에는 열지 않는다.
  - 로그인 완료 창과 로그인 뒤 담기 결과 창 위에 겹치지 않게 하려는 것이다.
  - 로그인 완료 창이 쿼리를 지우는 것은 경로 변화가 아니므로 거기서 열리지 않는다. 다음 화면 이동 때 연다.
- 팝업이 열린 채 빼는 경로로 옮기면(뒤로 가기로 `/cart` 등) 팝업을 **내린다**. 닫은 것으로 치지 않고, 다음 회원 화면에서 다시 판단한다. (4판)

### 5-3. 닫기와 저장
- 키는 내용 지문으로 만든다. 문구 판이 바뀌면 키가 바뀌어 다시 보인다.
- **[닫기]**: sessionStorage `site-notice-popup:closed:{지문}` = `'1'`.
  - 같은 탭 안에서는 화면을 옮기거나 새로고침해도 다시 뜨지 않는다.
  - 새 탭·새 방문이면 다시 뜬다. 상품을 새 탭 여러 개로 열면 탭마다 한 번씩 뜬다. 고지를 놓치지 않는 쪽을 고른 것이다. 바꿀지는 대표가 정한다(13절 4번). (2판)
  - Esc 로 닫아도 [닫기]와 같다.
- **[오늘 하루 보지 않기]**: localStorage `site-notice-popup:hide-today:{지문}` = 한국 날짜 `YYYY-MM-DD`.
  - 저장된 날짜가 오늘(한국 날짜)이면 띄우지 않는다. 한국 자정이 지나면 다시 뜬다.
  - 한국 날짜는 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })` 로 만든다.
  - 쓸 때 다른 지문의 `site-notice-popup:` 키는 지운다.
- **링크**를 누르면 [닫기]로 치고 이동한다.
- **저장이 실패해도 동작한다.**
  - 모든 읽기·쓰기를 try/catch 로 감싼다(사생활 보호 모드, 차단된 사이트 데이터, 용량 초과).
  - **저장소 객체 접근(`window.localStorage`·`window.sessionStorage` getter)부터 try 안에서** 한다. 사이트 데이터를 막으면 getter 에서 SecurityError 가 나기 때문이다. 모듈 머리나 렌더 중에는 꺼내지 않고, effect 안에서만 꺼낸다. 저장소 도우미는 storage 를 인자로 받는 순수 함수로 둔다. (3판)
  - 실패하면 모듈 안 메모리(같은 탭 JS 수명)에 닫은 지문을 둔다. 그래서 화면을 옮겨도(layout 이 바뀌어도) 다시 뜨지 않는다. 새로고침하면 다시 뜨는 것은 받아들인다.
  - 읽기 실패는 '저장 없음'으로 본다. 그래서 팝업은 뜬다.
- 서버 저장은 하지 않는다. 로그인 회원별 저장은 15번 본 작업으로 미룬다.
- 열린 직후 잘못 누르는 것을 막으려고 버튼을 잠시 막지는 않는다. 화면 읽기 프로그램에 '사용할 수 없음'으로 읽혀 더 헷갈리기 때문이다. 팝업은 화면이 붙은 뒤에 한 번만 뜨고, 무엇을 눌러도 닫히기만 한다. (2판)

### 5-4. 모양과 접근성
- `Dialog` + `StudioDialogPanel`(`showCloseButton={false}`)을 쓴다. 날 `DialogContent` 는 쓰지 않는다. 바깥을 눌러도 닫히지 않는 공용 규칙을 그대로 따른다. (2판)
- **너비**: 판에 `sm:max-w-lg`(512px)를 준다. 기본 400px 로는 본문이 30줄을 넘어 PC 에서도 마지막 문단이 첫 화면에 보이지 않는다. (3판)
- **높이 제한**(2판): 판에 선례와 같은 `max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]` 를 준다.
  - 판의 **직계 자식은 정확히 3개**다: 머리(`StudioDialogHeader`), 가운데 칸, 버튼 줄. 개발 미리보기 표시도 머리 안, 제목 위에 둔다. 자식이 늘면 칸이 밀려 높이 제한이 깨지기 때문이다. (3판)
  - 가운데 칸은 본문·링크이고 `min-h-0 overflow-y-auto` 다.
  - 화면이 낮아도(가로 휴대폰, 확대 200%) 제목과 두 버튼은 늘 화면 안에 있고, 가운데 칸만 줄어 스크롤된다.
  - 가운데 칸이 넘칠 때는 아래 가장자리에 옅은 그림자를 둔다(꾸밈용, `aria-hidden`). 아래에 글이 더 있다는 것을 보이게 하려는 것이다. 끝까지 내리면 사라진다. (3판)
  - 가운데 칸 구조(4판): 판의 둘째 자식 = `relative min-h-0` 감싸는 칸. 그 안에 스크롤 칸(`h-full overflow-y-auto`, `tabIndex={0}`, 처음 초점 대상)과 그림자(`pointer-events-none absolute inset-x-0 bottom-0`)를 둔다. 그림자가 글과 함께 스크롤되지 않고 칸 아래에 붙게 하려는 것이다.
- **움직임 줄이기**(3판): 판에 `motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none` 을 붙인다.
  - 열린 상태의 `data-[state=open]:animate-in` 과 같은 특이도이고 media 안이라 이긴다. 2판의 `motion-reduce:animate-none` 은 특이도가 낮아 실제로는 움직임을 끄지 못한다(컴파일해 확인됨).
  - 어두운 배경(공용 `DialogOverlay`)의 흐려짐은 그대로 둔다. 확대가 아니라 투명도만 바뀌고, 공용 부품을 바꾸면 다른 모든 팝업에 영향이 가기 때문이다.
- 구성
  - 머리: 제목(`StudioDialogTitle`). 개발 미리보기일 때만 제목 위에 작은 '개발 미리보기' 표시
  - 가운데 칸: 본문(`StudioDialogDescription`, 줄바꿈 유지, 왼쪽 정렬) + 링크(`next/link`, 링크 이름은 DB 값)
    - 키보드로 스크롤할 수 있게 `tabIndex={0}` 과 초점 테두리를 둔다.
    - 이 칸에는 따로 이름이나 역할을 붙이지 않는다. 본문이 `aria-describedby` 로 이미 읽히므로, 이름을 붙이면 같은 글을 두 번 읽게 된다. (2판)
  - 버튼 줄(`StudioDialogFooter`): [오늘 하루 보지 않기](brandOutline) → [닫기](brand)
    - PC 는 한 줄에 같은 너비, 모바일은 위아래, 높이 48px 이상
- 버튼 이름 '닫기'·'오늘 하루 보지 않기'는 화면 부품 글자라 코드에 둔다(다른 Dialog 의 '확인'·'취소'와 같음). 공지 내용은 모두 DB 값이다.
- 접근성
  - Radix 가 `role="dialog"`, `aria-modal="true"`, 제목→`aria-labelledby`, 본문→`aria-describedby` 를 붙인다.
  - 초점은 창 안에 갇히고, 닫으면 열기 전 초점으로 돌아간다.
  - 처음 초점은 가운데 칸에 둔다(`onOpenAutoFocus`). 화면 읽기 프로그램이 처음부터 읽고 키보드로 바로 스크롤할 수 있게 하려는 것이다.
  - Tab 순서: 가운데 칸 → 링크 → [오늘 하루 보지 않기] → [닫기] → 다시 가운데 칸

## 6. 변경 예정 글 화면과 한 줄 안내
### 6-1. `/terms/upcoming`
- 새 파일 `src/app/terms/upcoming/page.tsx`. 고정 경로라 `[documentSlug]` 보다 먼저 잡힌다. 지금 문서 slug 는 service·privacy·refund 라 겹치지 않는다.
- 약관 layout 안이라 헤더·하단이 같다.
  - 동의 관문이 `/terms` 를 빼므로 재동의 전인 회원도 볼 수 있다.
  - 미들웨어가 카카오 가입 미완료 회원에게도 `/terms` 를 열어 둔다.
- 데이터는 `policy_upcoming_documents` 만 읽는다(캐시 60초, 태그). 행이 없으면 404 다.
- 서버가 문서마다 `sha256(content)` 를 다시 계산해 저장된 값과 비교한다. 다르면 그 문서 대신 "확인 중" 안내를 보이고 오류를 남긴다.
- 화면 구성(위에서 아래로) (2판)
  1. 머리말(`heading`·`intro`, DB), 시행일, 게시일(`publishedAt` 한국 시각)
  2. 목차: 문서 세 개, '다시 동의를 받을 항목'
  3. 문서마다
     - 제목
     - **바뀌는 부분**: `changes` 를 하나씩 '이름 / 변경 전 / 변경 후' 칸으로 보인다. 변경 전·후는 같은 크기의 두 칸으로 놓는다(모바일은 위아래). 변경 전 칸은 회색 바탕, 변경 후 칸은 강조 테두리다. 색만으로 구분하지 않고 '변경 전'·'변경 후' 글자를 칸 머리에 둔다.
     - "지금 시행 중인 {제목} 보기(변경 전 전문)" 링크 → `/terms/{slug}`
     - 접어 보는 **바뀐 뒤 전문**(`<details>`, 기존 `PolicyDocumentContent`)
     - 링크·칸 이름('지금 시행 중인 {제목} 보기(변경 전 전문)', '지금 시행 중인 {제목}', '바뀐 뒤 전문', '이전 판 전문', '다시 동의를 받을 항목', '변경 전'·'변경 후', 지문이 다를 때의 '확인 중' 안내)은 게시 행 `labels` 의 DB 값이다(9절 초안). `{제목}` 자리는 코드가 채운다. (4판)
  4. **다시 동의를 받을 항목**: `consentItems` 의 이름, 변경 안내(`note`), 새 본문. 본문은 재동의 화면과 같은 `splitConsentLines`·`ConsentTextLine`(`src/components/auth/consent-checklist.tsx`)으로 그린다. `**…**` 강조가 시행일 동의 화면과 똑같이 보이게 하려는 것이다. (4판) "시행일 뒤 처음 접속하면 이 항목에 다시 동의하는 화면이 나옵니다. 동의 전에는 충전과 자료 구매를 할 수 없습니다"는 `intro` 에 적는다(9절).
- 상태별 (3판)
  - `upcoming`: 위 그대로. 링크 이름은 "지금 시행 중인 {제목} 보기(변경 전 전문)"다.
  - `applied`: 맨 위에 `statusTexts.applied`("{시행일}부터 시행 중입니다")와 지금 약관 링크를 보인다.
    - 문서마다 링크 이름을 "지금 시행 중인 {제목}"으로 바꾼다. 이제 그 링크는 새 전문을 열기 때문이다.
    - 접힌 칸에 **이전 판 전문**(`beforeContent`)을 더한다. 시행 뒤에도 회원이 변경 전후를 비교할 수 있게 하려는 것이다.
  - `reverted` 이고 `appliedAt` 이 있음: `statusTexts.revertedAfterApply`("이 변경은 시행 뒤 되돌려졌습니다")와 지금 약관 링크만 보인다.
  - `reverted` 이고 `appliedAt` 이 없음(시행 전에 고지를 그만둠): `statusTexts.withdrawn`("예정했던 이 변경은 시행하지 않기로 했습니다. 지금 약관이 그대로 적용됩니다")과 지금 약관 링크만 보인다.
  - 상태별 줄은 모두 게시 행의 DB 값이다.
- 이메일의 '변경 전후 전문' 링크는 `{사이트 주소}/terms/upcoming` 이다(이메일 초안에 반영함).

### 6-2. '바뀝니다' 한 줄 안내와 하단 링크 (2판)
- 새 서버 부품 `UpcomingPolicyNotice`(`src/components/legal/upcoming-policy-notice.tsx`)를 만든다.
  - 게시 행이 `upcoming` 일 때만 `bannerText` + `bannerLinkLabel`(→ `/terms/upcoming#문서`)을 한 줄로 보인다. 글은 모두 DB 값이다.
  - 색 대비를 지키는 옅은 안내 띠이고, 아이콘은 꾸밈용(`aria-hidden`)이다.
- 붙일 곳
  - 지금 약관 화면 `/terms/[slug]`: 바뀌는 문서일 때 제목 위. 앵커는 그 문서
  - 약관 목록 `/terms`: '변경 예정 약관' 카드를 목록 맨 위에 더함
  - 가입 `/signup`(카카오 가입 단계 포함)과 동의 `/consent`: 동의 목록 위. 고지 기간에 새로 가입하는 회원이 지금 약관에 동의하면서 곧 바뀐다는 것을 보게 하려는 것이다.
  - 충전 `/pricing`·`/checkout`, 장바구니 `/cart`: 결제 칸 위. 팝업을 빼는 대신 이 줄이 나온다.
  - 동의 문구(구매 고지·충전 확인)는 **고치지 않는다**. 그 글은 동의 기록 지문에 들어가므로, 판이 바뀌어 결제 중인 화면이 409 로 다시 동의하게 되는 일을 피하려는 것이다.
- **하단 링크**: `getSolvookFooterData` 가 게시 행이 `upcoming` 이면 정책 링크 끝에 `footerLinkLabel`(→ `/terms/upcoming`)을 더한다. 시행·되돌리기 뒤에는 저절로 사라진다. 그래서 1판의 '하단 추가 안내 한 줄'은 쓰지 않는다.
- **시행 뒤 '이전 판과 바뀐 부분 보기'**(4판): `applied` 상태에서는 `/terms/[slug]`(바뀐 세 문서) 제목 아래와 `/terms` 목록 카드에 `statusTexts.historyLinkLabel`(→ `/terms/upcoming#문서`)을 남긴다. 다음 개정을 게시할 때까지 둔다. 처리방침은 변경 전후를 계속 볼 수 있게 두는 것이 안전하기 때문이다. 하단 링크·한 줄 안내는 시행과 함께 사라진다.
- **읽기 실패와 가벼운 읽기**(3판)
  - `getSolvookFooterData` 는 회원 화면 layout 세 곳과 `/checkout` 이 부른다. 그래서 변경 예정 글 읽기가 실패하면 null 로 보고 하단 링크·한 줄 안내만 그리지 않는다. 화면은 그대로 그리고, 오류만 남긴다.
  - layout·하단·한 줄 안내용으로는 `status`·`effectiveDate`·`bannerText`·`bannerLinkLabel`·`footerLinkLabel`·문서 key 목록만 고르는 가벼운 캐시 읽기(`getUpcomingPolicySummary`)를 따로 둔다. 전체 행(전문·대조·동의 항목)은 `/terms/upcoming` 과 관리자 카드만 읽는다.

## 7. 관리자 화면
### 7-1. 위치와 권한
- '사이트 기본 정보'(`/admin/footer`) 위쪽 카드 묶음에 **'공지 팝업'** 카드를 더한다(새 파일 `notice-popup-admin.tsx`·`notice-popup-actions.ts`).
- 가입 동의 카드처럼 **대표에게만 보인다**(`access.role === 'owner'`). `site.manage` 만 가진 직원에게는 카드가 없다.
- 서버 액션은 `requireAdmin()` → `assertAdminActionPermission('owner')` → DB 함수(4-2)를 부른다. DB 함수도 대표인지 다시 본다.
- 저장하면 `revalidateTag('site_notice_popup', { expire: 0 })`, `revalidatePath('/admin/footer')` 를 한다. (2판)

### 7-2. 카드 내용
- 편집 항목
  - 켜기(스위치)
  - 제목(한 줄)
  - 본문(여러 줄, 글자 수 표시)
  - 링크 주소, 링크 이름
  - 노출 시작·끝: `datetime-local`, **한국 시각**으로 읽고 `+09:00` 으로 보낸다. 시작은 비울 수 있다.
- 지금 상태 한 줄: "지금 회원에게 보임 / 꺼짐 / 시작 전 / 끝남", 현재 지문 앞 12자리, 판(revision), 마지막 저장 시각
- **[미리보기]**: 입력 중인(저장 전) 값으로 회원 화면과 같은 표시 부품(`SiteNoticePopupDialog`, 저장소를 쓰지 않음)을 연다. DB 에 쓰지 않는다.
- **[저장]**: 확인 창을 띄운다.
  - 지문이 바뀔 때: "내용이 바뀌어 이미 닫은 회원에게도 다시 보입니다"
  - 꺼짐→켜짐일 때: "지금부터 회원에게 보입니다"
  - 게시 행이 `upcoming` 인데 저장 뒤 값이 4-3 '좋은 기록'을 깨면 경고한다(3판). "이렇게 저장하면 30일 고지가 끊긴 것으로 기록되어 시행일 스크립트가 멈춥니다."
    - 판정은 순수 함수 `isNoticeRecordGood`(4-2) 하나로 한다. 링크는 `/terms/upcoming` 과 **글자까지 같아야** 한다(`#`·쿼리·끝 `/` 가 붙어도 경고). 5-1 의 '경로만 비교' 규칙과 다르다. (4판)
    - 저장 뒤에는 카드가 `notice_continuity_check` 결과를 바로 보여 준다(런북과 같은 함수). (4판)
    - 끄기
    - 끝을 시행일 00:00(한국) 앞으로 당기기
    - 시작을 지금보다 뒤로 두기
    - 링크를 `/terms/upcoming` 이 아닌 곳으로 바꾸기
    - 본문에서 시행일 글자(`effectiveDateLabel`)를 빼기
  - 판 충돌이면 최신 값을 다시 읽어 보여 준다.
- **변경 예정 글 상태(읽기만)**: 상태, 시행일, 게시 시각, 문서·동의 항목 지문 앞 12자리, 바뀌는 부분 건수, `/terms/upcoming` 링크. 이 카드에서는 고치지 않는다(4-3, 글은 스크립트로만).

### 7-3. 고지 기간 약관 저장
- 막기는 DB 트리거(4-4)가 한다. `saveSiteFooterContentAction` 은 `POLICY_UPCOMING_LOCKED` 를 받아 이렇게 알린다: "변경 예정 약관을 고지하는 중이라 시행일까지 약관 문서(본문·이름·주소·켜기)를 바꿀 수 없습니다. 고쳐야 하면 고지를 다시 해야 합니다(런북)." (2판)
- 하단 정보 화면 약관 칸 위에도 같은 안내를 미리 보인다(게시 행이 `upcoming` 일 때).
- 같은 안내를 '가입 동의 항목' 카드에도 둔다. terms·privacy 저장은 트리거(4-4 의 2)로 막히고, 카드는 `POLICY_UPCOMING_LOCKED` 를 받아 같은 문구를 보인다. (3판)

### 7-4. 작업 기록 이름(`src/lib/admin-audit-log.ts`)
- `site_notice_popup_save`: '공지 팝업 저장'
- `policy_upcoming_withdraw`: '변경 예정 약관 고지 그만둠' (4판)
- `member_withdrawal_policy_update`: 커밋 `6a1add7` 에서 이미 등록했다('회원 탈퇴 안내 문구 변경'). 이름을 그대로 쓰고 다시 더하지 않는다. 4-6 스크립트도 이 종류로 기록한다. (5판)
- `policy_upcoming_publish`: '변경 예정 약관 게시'
- `policy_upcoming_apply`: '변경 예정 약관 시행'

## 8. 고지 기록(증빙)과 10번 7절 연결
### 8-1. DB 에 남는 것(모두 추가 전용 `admin_audit_log`)
1. 변경 예정 글 게시: 시각, **행 원문 전체**, 지문(`policy_upcoming_publish`). 다시 게시해도 앞 게시 원문이 그대로 남는다. 행의 `superseded` 에 앞 지문·시각이 있다. (2판)
2. 팝업 저장마다: 원문 전체(`before`·`after`), 내용 지문, `exposure_starts_at`, 저장 시각(`site_notice_popup_save`). 켠 뒤 끄지 않았다는 것은 그 뒤 `visible_after = false` 기록이 없다는 것으로 보인다.
3. 시행: 시각, 지문 일치, 판정 S 기록 id·마지막 기록 id(`policy_upcoming_apply`), 사본 표 최신 지문
4. 고지 그만두기: 시각, 사유(`policy_upcoming_withdraw`) (4판)
5. 탈퇴 화면 막힘 문구 변경·되돌리기: `member_withdrawal_policy_update`(bundle `bundle15_withdraw_disabled_text`, 앞뒤 문구) (3판)

### 8-2. 사람이 남기는 것
- 대표: 이메일 보낸 일시, 받는 사람 수, 받는 사람 목록 md5. 보낸 메일은 메일함에 둔다.
  - **받는 사람**(4판): 10번 스크립트 머리 조회와 같은 조건의 목록(재동의 대상)에서 대표가 시험 계정으로 표시한 것만 뺀 것이다. '대표가 아는 실이용자'로 고르지 않는다. 발송 직전에 이 목록을 뽑아 인원·md5(정렬한 회원 id)를 8-3 칸에 적는다(10절 7단계).
- 나: 켠 직후 운영 주소에서 팝업·`/terms/upcoming`·하단 링크가 보이는 화면을 시각이 보이게 찍어 둔다.
- 배포 기록(Vercel 배포 시각)이 '켠 때 코드가 운영에 있었다'는 근거가 된다.

### 8-3. 10번 계획 7절에 더할 칸(구현 때)
```
- 30일 전 고지(15번 계획 8절, 시행일 2027-01-11, 고지 마감 2026-12-10 KST):
  · 이메일 발송 ____(일시) · ____명 · 목록 md5 ____ (대표가 적음)
  · 시행 직전 추가 발송(고지 기간 새 가입자) ____(일시) · ____명
  · 팝업 노출 시작 ____ (site_notice_popup_save 의 exposure_starts_at, 기록 id ____)
  · 변경 예정 글 게시 ____ (policy_upcoming_publish, 문서 지문 앞 12자리 ____ / ____ / ____)
```
- 이메일 초안 '보내기 전에 확인할 것'의 마지막 줄이 이 칸을 가리킨다.

### 8-4. 구현 때 함께 고칠 문서 (2판)
- 런북 RB-11 10-2
  - 2번: '바로 시행 전제' → 30일 고지 경로(게시·시행 두 방식, 대표 확인 값은 시행 직전에 채움)
  - 3번: '배포 직후 같은 작업 창', '시행일에는 실행한 날이 들어갑니다' → 시행일 상수 고정, 실행 가능 날짜는 `c_effective_date`~`c_apply_last_date`
  - 시행일 당일 재시도 절차(10절 9단계)
  - 고지 기간 약관 문서 수정 금지(트리거로 막힘)와, 고쳐야 할 때의 다시 고지 절차(13절 6번)
  - 4-6 작은 스크립트: 10번 배포 전 notice, 스위치를 켤 때 restore(5번과 같은 창) (3판)
- 런북 RB-11 10-2 끝 '스위치를 켜기 전에는 대표 처리도 하지 않고 접수 안내만, 켠 뒤 10일 안에 처리' 문단(지금 940줄 근처): 고지 기간 요청에는 10-3 앞 줄이 우선한다고 적는다. 시행 뒤 스위치가 꺼진 동안 받은 요청도 요청일부터 10일 안에 처리하거나, 10일 안에 사유·예정일·이의제기 방법을 알린다고 고친다(4-6 화면 약속과 맞춤). (4판)
- 런북 RB-11 10-3 앞 '고지 기간 탈퇴 요청' 줄: 시행일 전에 받은 요청이 시행일까지 남으면 시행 뒤에도 접수일 기준 지금 약관으로 처리하고 `anonymize_member` 화면 경로는 쓰지 않는다는 문장을 더한다. (3판)
- 런북 새 절 '공지 팝업': 켜기·끄기, 8-1 꺼내 보는 조회, 고지 끊김 판정 조회(`notice_continuity_check`), 시행 전 확인(10절 8단계), 고지 기간 수정 금지 목록(약관 문서·가입 동의 terms·privacy·탈퇴 정책 문구 — 트리거로 막힘), 고지 기간 코드 되돌리기 규칙(먼저 팝업 끄기) (3판). 켠 뒤 팝업을 저장할 때마다 `notice_continuity_check` 를 돌린다는 줄, 고지 그만두기(`withdraw_upcoming`) (4판)
- `.gitignore`: 15번 구현 커밋에 `/output/` 을 더한다. 지금 `output/` 은 추적하지 않을 뿐 무시 목록에 없어서, `git add -A` 로 미리보기 JSON·리허설 결과가 섞일 수 있다. 커밋은 파일을 골라 올린다. (4판)
- 10번 계획 7절: 8-3 칸
- 작업 순서표: 11번(결제 화면 단순화)의 시작 조건 '10번 약관 스크립트까지'가 2027-01-11 뒤로 밀린다는 줄. 11번을 그 전에 할지는 11번 계획에서 다시 정한다.

### 8-5. 꺼내 보는 조회(런북에 둠, 읽기만)
```sql
SELECT id, created_at, action,
       details ->> 'exposure_starts_at' AS 노출_시작,
       details ->> 'visible_after' AS 보임,
       details ->> 'content_sha256_after' AS 팝업_지문,
       details -> 'after' ->> 'title' AS 제목,
       details -> 'after' ->> 'body' AS 본문,
       details -> 'documents_sha256' AS 문서_지문
  FROM public.admin_audit_log
 WHERE action IN ('site_notice_popup_save', 'policy_upcoming_publish', 'policy_upcoming_apply', 'policy_upcoming_withdraw')
    OR (action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text')
 ORDER BY created_at;
```
- 보존: 작업 기록은 지우지 않는다. 보존 기간은 변호사 답(12절 6번)을 따른다.

## 9. 문구 초안(대표 확인, 최종은 나중에 관리자 화면에서)
- 날짜·내용은 이메일 초안(`docs/notice-2027-01-terms-change.md`)과 맞춘다. 시행일이 바뀌면 팝업 본문·게시 행 글·스크립트 날짜를 함께 고친다. 시행일 문장이 본문에 직접 들어 있어서다(자리표시자를 쓰지 않음). 시행 때 팝업 본문에 `effectiveDateLabel` 이 들어 있는지도 확인한다(4-3).
- 요약은 실제 시행 본문(10번 스크립트의 쌍)보다 회원 권리를 좁게 적지 않는다. 3조②의 '불리하거나 중요한 변경은 30일 전부터'도 그대로 옮긴다(4판). 이 원칙은 팝업뿐 아니라 이메일, 게시 행 `intro`, 동의 항목 새 글과 변경 안내(4-3)에도 똑같이 적용한다. (3판)
  - 법정 환불 예외, 일부 쓴 충전 건, 탈퇴 제한(3일, 결제 이력 없는 계정의 7일, 진행 중 결제·환불), 비결제 회원의 보관 기록, 새 수집 항목, 재동의를 모두 적는다.
- 회사 이름은 약관·처리방침의 상호 **'써머썬연구소'**(하단 정보 `companyName`, 띄어 쓰지 않음)로 쓴다. (3판)
- 팝업에도 변경 사유를 한 줄 넣는다. 약관 3조②가 '변경 내용·사유'를 서비스 화면에 알리라고 하기 때문이다. (3판)

**팝업 제목**: 정식 오픈 전 안내와 약관 변경 안내

**팝업 본문**(약 1010자, 상한 1200자)
```
써머썬연구소는 아직 정식 오픈 전이라 기능과 화면을 다듬고 있습니다. 약관을 바꿀 때는 이용약관 제3조에 따라 미리 알려 드리고, 회원님께 불리하거나 중요한 변경은 30일 전부터 알리며 다시 동의를 받습니다.

회원 탈퇴 절차와 탈퇴 뒤 기록 보관 기준을 정비하기 위해 2027년 1월 11일(월)부터 이용약관·취소/환불정책·개인정보처리방침이 바뀝니다.
- 결제 이력이 있는 계정은 탈퇴 화면에서 탈퇴를 요청하고, 회사가 확인한 뒤 요청일부터 10일 안에 처리합니다.
- 결제 이력이 없는 계정은 바로 탈퇴되지만, 최근 7일 안에 결제 시도가 있으면 7일이 지난 뒤 탈퇴할 수 있습니다. 진행 중인 결제·환불이 있으면 끝난 뒤 탈퇴할 수 있습니다.
- 탈퇴하면 남은 크레딧(유료 충전·자료 환불로 다시 받은 크레딧·무상)은 소멸하며 환불되지 않습니다. 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다.
- 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안도 탈퇴할 수 없습니다.
- 탈퇴하면 구매한 자료를 내려받을 수 없고, 받지 않은 자료의 환불은 탈퇴 전에 신청해야 합니다. 후기·추천은 삭제되고 답변을 기다리던 문의는 닫히며, 같은 계정으로 다시 가입해도 크레딧·구매 내역은 이어지지 않습니다.
- 탈퇴 뒤 보관하는 기록과 기간(결제 이력이 없어도 결제 시도 기록, 보존에 동의한 문의 등), 새로 받는 탈퇴 요청 기록을 개인정보처리방침에 적었습니다.
- 시행일 뒤 접속하면 바뀐 약관에 다시 동의하는 화면이 나오며, 동의 전에는 충전과 자료 구매를 할 수 없습니다.

시행일 전까지는 지금 약관이 그대로 적용되고, 충전하신 크레딧과 구매하신 자료도 지금처럼 이용하실 수 있습니다. 바뀐 약관에 동의하지 않으시면 시행일 전까지 탈퇴를 요청하실 수 있습니다. 결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면 고객센터(이메일·전화)로 요청해 주세요.
```
**링크**: `/terms/upcoming`, 링크 이름 "바뀌는 부분 보기"
**노출**: 시작 비움(켠 때부터), 끝 `2027-01-12 00:00`(한국 시각, 시행일 하루 포함, 13절 1번)

**게시 행 글(스크립트 상수)**
- `heading`: 2027년 1월 11일 시행 예정 약관·정책
- `intro`: 회원 탈퇴 절차를 정비하고 탈퇴 뒤 기록 보관 기준을 분명히 하기 위해 이용약관 제12조와 부칙, 취소/환불정책 8-2절(신설), 개인정보처리방침 머리말과 1·2·3·6·7·10절이 바뀝니다. 아래에 바뀌는 부분(변경 전 → 변경 후)과 시행일부터 적용될 전문, 시행일에 다시 동의를 받을 항목을 적었습니다. 시행일 전까지는 지금 약관이 적용됩니다. 시행일 뒤 처음 접속하시면 바뀐 이용약관·개인정보 수집·이용 동의에 다시 동의하는 화면이 나오고, 동의 전에는 충전과 자료 구매를 할 수 없습니다. 크레딧 내역·구매 내역·자료 보관함·문의 화면은 동의 전에도 볼 수 있습니다. 바뀐 약관에 동의하지 않으시면 시행일 전까지 탈퇴를 요청하실 수 있으며, 결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면 고객센터(이메일·전화)로 요청해 주세요. (3판)
- `bannerText`: 2027년 1월 11일(월)부터 이용약관·취소/환불정책·개인정보처리방침이 바뀝니다.
- `bannerLinkLabel`: 바뀌는 부분 보기
- `footerLinkLabel`: 변경 예정 약관
- `statusTexts` (3판)
  - `applied`: 2027년 1월 11일부터 시행 중입니다.
  - `revertedAfterApply`: 이 변경은 시행 뒤 되돌려졌습니다. 지금 시행 중인 약관은 아래 링크에서 보실 수 있습니다.
  - `withdrawn`: 예정했던 이 변경은 시행하지 않기로 했습니다. 지금 약관이 그대로 적용됩니다.
  - `historyLinkLabel`: 이전 판과 바뀐 부분 보기 (4판)
- `labels` (4판): `currentLinkUpcoming` "지금 시행 중인 {제목} 보기(변경 전 전문)", `currentLinkApplied` "지금 시행 중인 {제목}", `afterFull` "바뀐 뒤 전문", `beforeFull` "이전 판 전문", `consentSection` "다시 동의를 받을 항목", `before` "변경 전", `after` "변경 후", `checking` "이 문서는 확인 중입니다. 잠시 뒤 다시 열어 주세요."
- 동의 항목 terms 새 본문·변경 안내: 4-3 '동의 항목 글을 12조②에 맞춘다'

## 10. 배포 순서
**원칙**
- DB 변경 → 코드 배포 → 글 게시 → 문구 켜기 순서로 한다.
- localhost 도 운영 DB 를 쓰므로, localhost 에서는 저장 버튼을 누르지 않고 상품 상세도 열지 않는다.
- 실회원이 있으므로 DB 적용·리허설은 새벽에 짧게 한다.

0. **10번 push·배포 전(15번과 따로)**: 4-6 작은 스크립트 `c_mode = 'notice'` → 확인 조회로 문구와 작업 기록 1건을 본다. 10번을 15번과 함께 내보내도, 먼저 따로 내보내도 이 단계가 먼저다. (3판)
1. **계획 검증 PASS** → 구현 → 계약 시험(11-1) → 독립 검증 PASS → 리허설(11-2) PASS
2. **(대표 승인) 새벽 DB 창, 03~04시, 10분 안**: 마이그레이션만 적용한다.
   - 팝업 행은 꺼져 있고 게시 행이 없어 트리거도 잠그지 않는다. 회원 화면에 변화가 없고, 옛 코드는 새 키를 읽지 않는다.
   - 적용 직후 읽기 조회로 행·정책·트리거·함수를 확인한다.
3. **로컬 확인(push 전, 쓰기 없음)**
   - 대표가 localhost:4000 을 미리보기 값으로 다시 띄운다(10-1). 나는 `.env` 파일을 고치지 않는다. (3판)
   - 나: 11-3 화면 시험을 Claude in Chrome 으로 모두 본다. 이때 게시 행은 아직 없으므로, `/terms/upcoming` 과 한 줄 안내는 리허설에서 뽑아 둔 게시 행 JSON(`output/b15-upcoming-preview.json`, 11-2 R4 (나))으로 그린다. 운영 DB 에 넣지 않는다.
   - 대표: 직접 보고 승인한다.
   - **미리보기 파일이 리허설에서 나오지 않았으면 push 하지 않는다.** 이 파일 없이는 `/terms/upcoming`·한 줄 안내·관리자 경고를 로컬에서 볼 수 없기 때문이다. (5판)
4. **push·배포**
   - `git log origin/main..HEAD` 를 확인한다. 15번 커밋은 10번 커밋(`51b7373`·`25f01b6`·`6a1add7`) 위에 쌓인다. (5판) 10번이 아직 안 나갔으면 함께 나간다(13절 5번). 10번은 스위치가 꺼진 채 나가고, 약관 스크립트는 시행일에 돈다. `KAKAO_ADMIN_KEY` 가 Production 에 있는지 다시 본다. (2판)
   - 0단계(4-6 notice)가 끝났는지 다시 본다. 안 끝났으면 push 하지 않는다. (3판)
   - 배포 직후 운영 주소에서 `/terms/upcoming` 이 404, 팝업·한 줄 안내·하단 링크가 없음을 본다(아직 게시 전·꺼짐).
5. **게시(새벽이 아니어도 됨, 짧음)**: 고친 10번 스크립트를 `c_mode = 'publish_upcoming'` 으로 실행한다. 게시 행만 넣고, 약관 행에는 잠깐 행 잠금만 잡는다.
   - 확인 조회로 상태 `upcoming`·지문 5개·변경 건수를 본다.
   - 지문이 리허설 R4 (나)에서 뽑아 이 칸에 적어 둔 값과 같은지 본다. 다르면 멈추고 원인을 찾는다. 12-10 안에 다시 리허설할 창이 없으면, 원인만 확인하고 시행일을 미룰지 대표가 정한다(13절 6번). (4판)
     - 리허설 값: 이용약관 ____ / 환불 ____ / 처리방침 ____ / 동의 terms ____ / 동의 privacy ____ (앞 12자리, 리허설 때 적음) (3판)
   - 운영 주소에서 `/terms/upcoming`, 약관 화면 한 줄, 하단 링크를 본다.
6. **문구 켜기(운영 관리자 카드, 대표 계정)**
   1. 9절 초안(또는 대표가 고친 문구)으로 켜기 저장 → 8-5 조회로 `before`·`after` 원문, `exposure_starts_at` 을 본다. (2판)
   2. 고지 끊김 판정 조회(`notice_continuity_check`, 4-3)를 돌려 '좋은 기록 S'가 오늘 날짜로 잡히는지 본다. (3판)
   3. 시크릿 창으로 운영 홈에 들어가 팝업을 확인하고 화면을 찍는다(8-2).
   - 켜기는 회원 화면을 멈추지 않으므로 새벽이 아니어도 된다. 다만 이메일과 같은 날 하고, **12-10 23:59 KST 전에** 한다.
7. **대표가 이메일을 보낸다**. 발송 직전에 받는 사람 목록을 8-2 정의대로 뽑아(재동의 대상 − 시험 계정) 인원·md5 를 8-3 칸에 적고, 그 목록에 보낸다. (4판)
8. **시행 전 확인(2027-01-10 밤)** (3판)
   - **고지 기간에 받은 탈퇴 요청**(고객센터 메일함·대표 메모)이 모두 처리됐는지 확인한다. 고지 기간 요청은 0절 7번대로 DB 에 기록하지 않으므로, DB 조회가 아니라 메일함에서 확인한다.
     - 남은 요청(예: 01-08 에 받은 요청)은 시행 뒤에도 **바뀌기 전 약관(2026년 11월 23일 시행)** 으로, 런북 한 줄의 방법으로 처리한다. `anonymize_member` 화면 경로는 쓰지 않는다. 런북 RB-11 그 줄에도 같은 내용을 적는다(8-4).
   - 처리 대기 탈퇴 요청이 DB 에도 0건인지 본다(`SELECT count(*) FROM member_withdrawal_requests WHERE status = 'pending'`). 시행 스크립트 0번이 이것 때문에 멈추지 않게 하려는 것이다.
   - 8-3 칸의 이메일 발송 일시가 12-10 이하인지 본다. 아니면 시행을 미룬다(13절 6번).
   - 고지 끊김 판정 조회를 다시 돌린다. 끊김이 나오면 시행하지 않고 13절 6번으로 간다.
   - 재동의 대상 목록(10번 스크립트 머리 조회)과 이메일 받는 사람 목록을 대조한다. 이 대조는 **발송 뒤 새로 가입한 회원**을 찾는 용도다(기존 회원은 7단계에서 이미 같은 정의로 보냄). 그 회원에게는 가입 화면 한 줄 안내(6-2)에 더해 이메일도 보낸다. 다만 받은 날부터 30일을 채우지 못하므로, 이 회원들에 대한 효력은 변호사 질문(12절 3번)으로 묻는다.
   - 대표가 대상 목록을 확인하고 `c_confirmed_count`·`c_confirmed_members_md5` 를 채운다(런북 RB-11 10-2).
9. **시행일 2027-01-11 새벽 03시**
   1. 시행 스크립트를 `BEGIN … ROLLBACK` 판으로 한 번 돌려 VERIFY 가 통과하는지 본다(마지막 줄만 ROLLBACK 인 사본, 쓰기 없음). (2판)
   2. 통과하면 COMMIT 판을 실행한다 → 확인 조회 → `/terms/upcoming` 이 '시행 중'으로 바뀌고, 한 줄 안내·하단 링크가 사라졌는지 본다.
   3. **멈추면 당일 재시도**: 대상 목록이 바뀌었으면(새 가입·탈퇴) 다시 확인해 두 값을 고치고, 잠금 시간 초과면 몇 분 뒤 다시 돌린다. 1월 11일 안에 끝낸다. 본문 날짜는 상수라 다시 돌려도 지문이 같다.
   4. 당일을 넘기면 13절 7번에서 정한 대로 한다. 기본안은 시행일을 미루고 다시 고지하는 것이다. 이때 팝업 `endsAt` 을 늘리고 문구의 날짜를 고치며, **탈퇴 막힘 문구 날짜도 4-6 상수를 고쳐 다시 바꾼다**. (4판)
   - 팝업은 01-12 00:00 에 저절로 꺼진다.
   - 스위치(`selfAnonymizeEnabled`)는 10번 순서대로 켠다(변호사 답 반영 뒤). **같은 창에서 4-6 `c_mode = 'restore'` 로 막힘 문구를 원래대로 되돌린다.** (3판)
   - **시행일에 스위치를 켜지 못하면**(변호사 답 대기 등) 4-6 문구를 그대로 둔다. 날짜가 박힌 문장이라 시행 뒤에도 맞다. 같은 창에서 탈퇴 화면을 읽기만 해 문구를 다시 보고(S13), 그동안 받은 요청은 런북 고친 줄(8-4)대로 요청일부터 10일 안에 처리한다. (4판)

**되돌리기**
- 팝업만 끄기: 관리자 카드에서 끄고 저장한다(바로 반영). 고지 기간에 끄면 시행 스크립트가 멈춘다(4-3).
- **고지 기간에 15번 코드를 되돌리면 고지가 끊긴 것으로 본다.** (3판)
  - 되돌리기 **전에** 관리자 카드에서 팝업을 끄고 저장한다. 끈 기록(`after.enabled = false`)이 남아 시행이 멈추게 하려는 것이다. DB 는 코드가 운영에 있었는지 알 수 없기 때문이다.
  - 그 뒤 13절 6번으로 다시 고지할지 정한다. 런북 '공지 팝업' 절에도 같은 줄을 둔다.
- 코드 되돌리기(고지 기간 밖): 팝업·`/terms/upcoming`·한 줄 안내·하단 링크가 사라진다. DB 행은 남아도 해가 없다.
- DB 되돌리기: 4-5. 코드를 먼저 되돌린 뒤에만 한다.
- 고지를 처음부터 다시 해야 하면: 13절 6번

### 10-1. 개발 전용 미리보기(켜기 전 확인, 쓰기 없음)
- 목적: 운영 팝업은 꺼져 있고 localhost 도 운영 DB 를 쓴다. 그래서 **운영 DB 에 쓰지 않고** 회원 화면에 붙은 실제 팝업(빼는 경로, 저장소, 초점, 높이)과 `/terms/upcoming`·한 줄 안내를 본다.
- **켜지는 조건(셋 다, 서버에서 판정)**
  1. `process.env.NODE_ENV === 'development'`
  2. `process.env.VERCEL` 이 없음
  3. `process.env.NOTICE_POPUP_PREVIEW === '1'`
- **켜는 법**(3판): 대표가 터미널에서 localhost 를 다시 띄운다. `.env` 파일은 고치지 않는다.
  ```
  NOTICE_POPUP_PREVIEW=1 NOTICE_POPUP_PREVIEW_UPCOMING_FILE=output/b15-upcoming-preview.json npm run dev
  ```
  - `npm run dev` 는 이미 포트 4000 을 쓴다. 확인이 끝나면 값 없이 다시 띄운다.
- 조건을 채우면
  - 팝업: layout 이 `enabled`·노출 기간을 보지 않고 저장된 초안 행을 넘긴다(`preview: true`). 닫기 저장 규칙은 그대로 돈다.
  - 변경 예정 글: `NOTICE_POPUP_PREVIEW_UPCOMING_FILE` 이 가리키는 JSON 을 운영 행 대신 읽는다. 운영 행이 있으면 운영 행을 쓴다.
    - 가벼운 읽기(`getUpcomingPolicySummary`)와 전체 읽기 모두, 그리고 관리자 카드 경고·'변경 예정 글 상태'·약관 칸과 가입 동의 카드의 미리 안내도 이 파일을 쓴다. 로컬에서 7-2 경고를 볼 수 있게 하려는 것이다(저장은 누르지 않음). (4판)
- **미리보기 파일 위치**(3판·4판): 저장소 안 `output/`(지금 추적하지 않는 폴더. 15번 구현 커밋에서 `.gitignore` 에 `/output/` 을 더함, 8-4). 세션이 바뀌어도 남게 하려는 것이다. 커밋하지 않는다. 지문 5개는 10절 5단계 칸에도 적는다.
- 관리자 카드의 [미리보기]는 이 조건과 상관없이 쓸 수 있다(표시 전용, 운영에서도 안전).
- 계약 시험이 조건 셋과 `next.config` 에 `allowDevelopmentBuild` 가 없음을 확인한다(11번 계획 10-1 과 같은 이유).

## 11. 시험
### 11-1. 계약 시험 `tests/bundle15-notice-popup-contract.test.mjs`(node --test)
- **빼는 경로**
  - 뺌: `/admin`·`/admin/footer`·`/dashboard/admin/x`·`/pricing`·`/checkout`·`/checkout/payapp/result?orderId=…`·`/checkout/kakaopay/result`·`/cart`·`/terms/upcoming`·`/consent`·`/login`·`/signup`·`/auth/callback`·`/preview/x`
  - 링크 경로(3판): `linkUrl` 에서 쿼리·`#` 을 뗀 경로와 **정확히 같은 경로만** 뺀다(아래 경로는 빼지 않음). `linkUrl = '/terms/service?x=1#a'` 면 `/terms/service` 만 빼고 `/terms/service/x` 는 띄운다. `linkUrl = '/'` 면 아무것도 빼지 않는다(홈에서 팝업이 사라지지 않게).
  - 띄움: `/`·`/items/1`·`/categories/2`·`/search`·`/library`·`/mypage`·`/mypage/withdraw`·`/terms`·`/terms/refund`
  - 과목 접두 경로(`/english/cart` 등)도 같은 판정. `/checkoutx`·`/cartoon` 처럼 앞부분만 같은 경로는 띄움
- **노출 판정**: 꺼짐·시작 전(브라우저가 시작 뒤에 엶)·끝(경계: `now = startsAt` 보임, `now = endsAt` 안 보임)·지문 형식 틀림
- **오늘 하루**: 한국 날짜 경계(UTC 14:59:59 → 전날, 15:00:00 → 다음 날), 어제 날짜면 보임, 다른 지문 키는 지움
- **저장소 실패**(3판)
  - `getItem`·`setItem` 이 던져도 예외 없음, 메모리로 같은 탭 안에서 다시 안 뜸, 읽기 실패 → 뜸
  - **저장소 객체 접근부터 던지는 경우**: `Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError') } })`(sessionStorage 도 같음)에서도 예외 없음
  - 저장소 도우미가 storage 를 인자로 받는 순수 함수이고, 부품은 `window.localStorage` 를 effect 안 try 안에서만 꺼냄(모듈 머리·렌더 중 접근 없음)
- **쿼리 규칙**: 경로 변화 없이 쿼리만 바뀌면 열지 않음, `login=success`·`logout=success` 면 이번에는 열지 않음, `useSearchParams` 를 쓰지 않음
- **열린 채 빼는 경로로 이동**: 팝업을 내리고 닫은 것으로 치지 않음(4판)
- **리허설 파일**(5판·6판): 사본은 생성기로 만들고, 원본과 다른 줄은 구현 때 정한 목록과 같음(계약 시험으로 고정). 결과는 임시 표와 마지막 SELECT 로 받고, `RAISE EXCEPTION` 문자열은 요약만 담음. 미리보기 추출은 별도 거래 파일에만 있음. 정책 VERIFY 는 이름 붙인 별도 블록이고, `policy_upcoming_documents` 정책 생성은 존재 확인 조건 안에 있음. 4-6 기록에 `saved_at` 이 있고 '마지막 기록'을 그것으로 고름. 시행 방식의 검사 순서(4-3)
- **좋은 기록 판정**(4판): `isNoticeRecordGood` 와 SQL `policy_upcoming_notice_continuity` 에 같은 예시 묶음을 돌린다. `/terms/upcoming` 통과, `/terms/upcoming#a`·`/terms/upcoming?x=1`·`/terms/upcoming/` 실패, 본문 '2027. 1. 11.' 실패, `endsAt` = 시행일 00:00 KST 통과·1초 앞 실패, 꺼짐 실패. 시행 스크립트와 런북 조회가 이 함수를 부르는지도 본다.
- **입력 검사**(TS 화면 검사 = DB 규칙과 같은 예시 묶음): 제목 줄바꿈·61자, 본문 1201자, 링크 `//evil.com`·`https://…`·`javascript:alert(1)`·`/\x`·공백 포함 거절, `/terms/upcoming` 통과, 켤 때 끝 없음 거절, 끝 ≤ 시작 거절
- **팝업 판**(3판)
  - 가운데 칸 구조: 둘째 자식이 `relative min-h-0`, 그 안에 스크롤 칸 `h-full overflow-y-auto`(tabIndex 0)와 그림자 `pointer-events-none absolute inset-x-0 bottom-0`(4판)
  - `StudioDialogPanel` 에 `showCloseButton={false}`, `sm:max-w-lg`, `max-h-[calc(100dvh-2rem)]`, `grid-rows-[auto_minmax(0,1fr)_auto]`, `motion-reduce:data-[state=open]:animate-none`, `motion-reduce:data-[state=closed]:animate-none`
  - 판의 직계 자식이 3개(머리·가운데 칸·버튼 줄), 개발 미리보기 표시는 머리 안
  - 가운데 칸 `min-h-0 overflow-y-auto`, 넘침 그림자 `aria-hidden`
  - 날 `DialogContent` 없음
- **문구 대조**(3판·4판): 글마다 요구 표현을 표로 둔다. '|' 는 둘 중 하나면 된다는 뜻이다. 숫자(10일·7일·3일)는 10번 스크립트 새 조각과 같아야 한다.
  | 글 | 요구 표현 |
  |---|---|
  | 팝업 초안 본문, 이메일 초안 | '법령에 따른 환불', '일부를 썼으면\|일부를 쓴', '끝난 뒤 3일', '불리하거나 중요한', '후기·추천', '이어지지 않습니다', '고객센터' |
  | `it_pairs` 새 조각, `c_terms_note` | '법령에 따른 환불', '일부를 썼으면\|일부를 쓴', '끝난 뒤 3일' |
  | 게시 행 `intro` | '시행일 전까지', '탈퇴를 요청', '고객센터', '동의 전에는 충전과 자료 구매' |
  | `c_privacy_note` | '결제 시도 기록', '탈퇴 요청 기록' |
  | privacy 동의 항목 새 본문(`ip_pairs`) | '탈퇴 요청 기록', '회원 탈퇴 처리' |
  | 4-6 막힘 문구 | '고객센터', '10일 안에', '바뀌기 전 약관(2026년 11월 23일 시행)' |
  - 팝업 초안·이메일의 '7일'은 '결제 이력이 없는 계정'과 같은 문장에 있다. 회사 이름은 '써머썬연구소'다. 시행일 글자 '2027년 1월 11일'이 모두 같다.
  - 동의 전 이용 범위 문장은 '크레딧 내역'(화면)으로 적고 '크레딧은 이용할 수 있습니다'로 적지 않는다.
- **마이그레이션**
  - RESTRICTIVE 정책 2개
  - `DROP TRIGGER` 문이 없음(새 트리거는 CREATE 만)(5판)
  - 잠금 트리거 3개(키 조건, `upcoming` 일 때만, 막는 칸 목록, `DISABLED` 는 막지 않음)
  - 지문 함수가 `STABLE`(`convert_to` 가 STABLE 이라서)(3판)
  - 저장 함수 SECURITY DEFINER·`search_path`, service_role 만 EXECUTE, `saved_at = clock_timestamp()`
  - 대표 확인, revision 비교, 같은 함수 안에서 `record_admin_audit`(details 키 목록)
  - 초안 행이 `enabled: false` 이고 `ON CONFLICT (key) DO NOTHING`
  - `lock_timeout`·`statement_timeout`
  - 되돌리기 파일이 `policy_upcoming_documents` 정책을 지우지 않음
- **10번 스크립트**
  - `c_mode` NULL 이면 멈춤, `v_date` 가 `c_effective_date` 로 만들어짐, 날짜 상수 세 개와 상수 검사(`- 32`, `>=`)(3판)
  - 쌍이 모두 4칸, `insert` 방식 확인 문장, `TRNX` 최소 건수 5(3판)
  - 게시 방식은 `site_footer_content`·동의 항목·탈퇴 정책을 UPDATE 하지 않음, 15번 마이그레이션 확인 검사(함수·정책·트리거)가 있음, 게시 VERIFY 처리표대로 분기(4판), `lockedWithdrawalPaths` 를 만듦(4판), `withdraw_upcoming` 방식(4판), 기록 bundle 이 `bundle15_policy_upcoming`, 다시 게시 규칙(`reverted` 포함), `publishedAt = clock_timestamp()`
  - 동의 항목 지문이 `label LF version LF note LF content`
  - 시행 방식은 날짜 범위·고지 끊김 판정·지문 비교 뒤에만 저장하고, 상태를 본문 저장보다 먼저 `applied` 로 바꿈
  - 되돌리기 블록이 `reverted` 를 씀
- **4-6 작은 스크립트**: `c_mode` NULL 이면 멈춤, notice 는 지금 값이 운영 원래 문구 또는 앞 고지 문구와 같을 때만, 날짜 상수로 문구를 만듦(4판), `DISABLED` 한 경로만 바꿈, 기록 bundle `bundle15_withdraw_disabled_text`, restore 는 고지 문구와 같을 때만 (3판)
- **붙일 곳**: 두 layout 에만 `SiteNoticePopup` 이 있고 `(admin)` layout·`template.tsx` 에는 없음. `UpcomingPolicyNotice` 가 6-2 의 곳에 있고 동의 문구 키는 바꾸지 않음
- **읽기 실패**(3판): 변경 예정 글 가벼운 읽기가 던져도 `getSolvookFooterData` 가 값을 돌려주고(하단 링크만 없음), `UpcomingPolicyNotice` 는 아무것도 그리지 않음. 가벼운 읽기는 상태·라벨 칸만 고름
- **관리자**: 카드 코드에 날짜 상수(`2026-12-10`·`2027-01-11`)가 없고 판정 함수를 인자 없이 부름(5판), 카드가 대표 조건 안에서만 그려짐, 액션이 `assertAdminActionPermission('owner')`, `revalidateTag(…, { expire: 0 })`, `POLICY_UPCOMING_LOCKED` 안내(약관 저장·가입 동의 항목 저장 둘 다), 7-2 경고 조건 다섯 가지
- **미리보기 조건**: 10-1 의 세 조건, `allowDevelopmentBuild` 없음, 켜지면 회원 화면·관리자 카드의 변경 예정 글 읽기가 모두 미리보기 파일을 씀(4판)
- **붙일 곳 더하기**(4판): `/terms/upcoming` 이 `ConsentTextLine` 을 import, `/consent` 의 `UpcomingPolicyNotice` 는 동의 목록 위에 있음(동의를 마친 계정은 `/consent` 에서 넘어가므로 화면 시험 대신 이 시험으로 확인), applied 상태의 '이전 판과 바뀐 부분 보기' 링크
- **고칠 기존 시험**(2판)
  - `tests/admin-guard-coverage-contract.test.mjs`: `ACTION_REQUIREMENTS` 에 `notice-popup-actions.ts` → `'owner'`
  - `tests/studio-dialog-contract.test.mjs`: `memberDialogSources` 에 새 팝업 부품 추가
  - `tests/admin-audit-log-contract.test.mjs`: 새 마이그레이션 파일과 새 스크립트(4-6, 10번 스크립트의 새 종류)를 읽어 DB 가 적는 종류 대조에 넣음. 새 종류 `policy_upcoming_publish`·`policy_upcoming_apply`·`policy_upcoming_withdraw`·`site_notice_popup_save` 를 목록에 더한다(지금 이 시험은 21/21 통과, `6a1add7` 이후)(5판)
  - `output/` 아래 파일이 커밋 목록에 없음(4판)
  - `tests/bundle10-member-withdrawal-contract.test.mjs`: 10번 스크립트를 고치므로 그 시험의 스크립트 대조를 새 판에 맞춤(3판)
- 기존 시험(`footer-content`·`policy-document-history`·`signup-consent`·`bundle10-member-withdrawal`)이 그대로 통과하는지 함께 돌린다.

### 11-2. 리허설(운영 DB, postgres 접속, 새벽 03~04시) (6판: 목표·경우·원칙으로 줄임)
1판~5판은 리허설의 거래 나누기, 사본 diff, 실행 순서까지 계획에서 정하려다 회차마다 새 구멍이 나왔다. 6판은 **무엇을 증명할지(목표)**, **어떤 경우를 볼지(경우 목록)**, **지킬 원칙**만 정한다. 세부(사본별 diff 줄, 실행 순서, 경우별 사전 상태, 도우미 함수 모양)는 구현 때 실제 리허설을 돌려 확정하고, 구현 검증에서 본다. (6판)

**목표**
- 15번 마이그레이션이 운영 DB 에서 그대로 적용되고, 되돌린 뒤 다시 적용된다.
- 쓰기 막기 정책과 잠금 트리거 3개가 막을 것만 막는다. 시행 스크립트의 순서(상태를 먼저 `applied` 로 바꾸고 저장)는 실제 트리거와 함께 통과한다.
- 팝업 저장 함수가 대표만 받고, 지문·판·작업 기록을 정해진 대로 남긴다.
- 고친 10번 스크립트가 게시·시행·고지 그만두기를 정해진 대로 하고, 멈춰야 할 때 멈춘다. 게시한 글과 시행한 글의 지문이 같다.
- 실제 시행일 값으로 게시 행을 뽑아 미리보기 파일과 대조 지문을 얻는다.
- 4-6 작은 스크립트가 notice·restore 를 기준대로 한다.

**경우 목록과 기대 결과**
| 경우 | 기대 결과 |
|---|---|
| R1 마이그레이션 적용 | 행·정책 2개·트리거 3개·함수(팝업 2, 판정 1, 트리거 함수 3)·권한이 정해진 대로 |
| R2 저장 함수 | 대표 성공(지문·revision +1·기록 1건·details 키), 직원·없는 계정 거절, 판 충돌, 입력 오류 종류별 거절, 바뀐 것 없음 → 기록 0건, 시작이 과거·미래일 때 `exposure_starts_at`·`visible_after` |
| R3 쓰기 막기·잠금 | authenticated 로 두 키 UPDATE 0행(postgres 로는 1행), 약관 문서·동의 항목·`lockedWithdrawalPaths`·스위치 변경 → `POLICY_UPCOMING_LOCKED`, 관계없는 칸·`DISABLED` 변경 → 통과, `applied` 먼저 → 저장 성공·순서를 바꾸면 막힘 |
| R4 (가) 성공 경로 | 게시 → 좋은 팝업 저장 → 시행 성공(실제 트리거 있음), 사본 표 최신 지문 = 게시 지문, 동의 항목 2판 = 게시 행, `applied`, 작업 기록, `DISABLED` 고지 문구 유지. 이어서 10번 되돌리기 블록 → `reverted`(R5-1) |
| R4 (나) 실제 값 뽑기 | 실제 시행일 상수로 게시 → 게시 행 JSON·지문 5개 받음. 같은 값의 시행은 날짜 검사로 멈춤 |
| R4 (다) 멈춤 경우 | 쌍 한 글자 바뀜·동의 항목 쌍·`c_terms_note` 바뀜 → 지문 불일치. 고지 끊김(기록 없음, 켬→끔→켬이고 마지막 켬이 마감 뒤, 시작이 미래인 저장만, 끝을 당겼다 늘림, 링크 바꿈, 본문에서 시행일 뺌) → 멈춤. `endsAt` 같음 통과·1초 앞 멈춤. 상수 검사 위반 → 멈춤. pending 탈퇴 요청 → 멈춤. 판정 함수 인자 불일치 → `ARG_MISMATCH`. 같은 지문 다시 게시 → 머리말만, 다른 지문·사유 없음 → 멈춤, 사유 있음 → `superseded`. `reverted` 뒤 게시는 사유가 있어야. `applied` 뒤 게시 → 멈춤 |
| R4 (다) 성공 경우 | 켬→끔→켬이고 마지막 켬이 마감 안 → 통과. `withdraw_upcoming` 사유 있음 → `reverted`·기록, 그 뒤 4-6 restore 가 돎 |
| R5-2 되돌리기 | 4-5 down → 지울 것 0건, `policy_upcoming_documents` 정책·행은 남음 → 다시 적용 성공(그 정책은 1개) → R1 과 같은 값 |
| E 4-6 작은 스크립트 | notice → restore, 지금 값이 다르면 멈춤, 시행일 상수를 바꾼 두 번째 notice → restore |

**원칙**
1. **경우마다 격리한다.** 한 경우가 남긴 상태가 다른 경우를 깨지 않게 한다. 성공 경우도 하위 블록 안에서 돌리고, 확인 값은 PL/pgSQL 변수와 로그에 남긴 뒤, 표지 예외(예: `RH_ISOLATE`)로 그 블록의 변경을 되돌린다. 각 경우는 필요한 사전 상태를 자기 블록 안에서 만든다.
2. **미리보기 추출(R4 나)은 별도의 짧은 거래로 한다.** 다른 경우의 실패에 끌려가 미리보기 파일이 사라지지 않게 하려는 것이다. 미리보기 파일이 나오지 않으면 push 하지 않는다(10절 3단계).
3. **결과는 `ON COMMIT DROP` 임시 표와 파일 끝의 마지막 SELECT 로 받고 ROLLBACK 한다.** 10번 리허설(`supabase/scripts/20261126_bundle10_rehearsal.sql`)과 같은 방식이다. 긴 값(게시 행 JSON)은 표의 칸에 둔다. 이 CLI 는 오류 메시지를 약 1000자에서 자르므로, 예외 메시지에는 900자 안의 요약만 둔다. 리허설 날 전에 쓰기 없는 묶음으로 마지막 SELECT 가 돌아오는지 확인한다.
4. **표 잠금 문장은 새벽의 짧은 거래에만 둔다.** 읽기까지 막는 `CREATE/DROP POLICY`·`DROP TRIGGER` 는 R1·R3·R5-2 거래에만 둔다. 다른 거래는 `CREATE TRIGGER`(쓰기만 막음)까지만 쓴다. 거래마다 `lock_timeout = '3s'`, `statement_timeout` 을 건다. 롤백 뒤 변화가 없는지 읽기 조회로 본다.
5. **사본은 생성기로 만들고, 원본과 다른 줄은 계약 시험으로 고정한다.** 손으로 고친 사본을 돌리지 않는다. 바뀐 줄의 종류와 수는 구현 때 실제 리허설로 정한다. 실제 적용 파일의 검사는 사본 때문에 약해지지 않아야 한다.
- 결과 파일과 뽑은 값은 `output/`(추적하지 않는 폴더)에 둔다. 실패하거나 스크립트 상수를 고치면 3절의 '다시 리허설' 날에 다시 돈다.

### 11-3. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost 는 10-1 미리보기로 본다. 운영 DB 에 쓰지 않는다. 저장 버튼을 누르지 않고, 상품 상세를 열지 않는다(조회 기록이 운영 DB 에 쓰임). 화면 이동은 홈·카테고리·검색·약관·마이페이지로 한다. (2판)
- 10절 5·6단계에서 운영 주소로 S1·S3·S6·S8·S12 를 한 번 더 본다.
- S1 비로그인 홈: 화면이 뜬 뒤 팝업, 처음 초점이 가운데 칸, Tab 이 창 안에서 돎, Esc 로 닫힘, 어두운 바깥을 눌러도 안 닫힘, 화면 읽기 이름 = 제목
- S2 [닫기] → 카테고리·약관·검색으로 이동하고 새로고침해도 안 뜸 → 새 탭에서는 뜸
- S3 [오늘 하루 보지 않기] → 새로고침·새 탭에서 안 뜸 → 저장값을 어제 날짜로 바꾸면 뜸
- S4 사이트 데이터 차단(Chrome 설정)·시크릿 창: 뜨고, 닫히고, 화면을 옮겨도 다시 안 뜸
- S5 저장된 키의 지문을 다른 값으로 바꾸면 뜸(문구 판이 바뀐 경우 흉내)
- S6 빼는 경로(4판: 팝업이 열린 채 뒤로 가기로 `/cart` 에 가면 팝업이 내려감도 확인): `/pricing`, `/checkout`, `/checkout/payapp/result?orderId=없는값`(읽기만), `/cart`, `/terms/upcoming`, `/login`, `/admin`(관리자 로그인 상태)에서 안 뜸 → 그 뒤 홈으로 가면 뜸
- S7 로그인 복귀: 로그인 → 로그인 완료 창만 뜸 → 닫은 뒤 다른 화면(마이페이지)으로 가면 팝업. 상품 상세의 로그인 뒤 담기는 계약 시험으로 대신한다.
- S8 [바뀌는 부분 보기] → `/terms/upcoming`, 팝업은 닫힌 것으로 침. 바뀌는 부분 칸(변경 전·후), 접힌 전문, 다시 동의할 항목(굵은 줄이 재동의 화면과 같은 강조, 4판), '변경 전 전문' 링크, 시행일·게시일·목차가 보임
- S9 **크기**(2판): 375×667, 360×640, 가로 667×375, 1366×768, PC 확대 200%. 모든 경우 제목과 두 버튼이 화면 안에 있고 눌리며, 가운데 칸만 스크롤된다. 모바일은 버튼이 위아래로 놓인다. 1366×768 에서 판 너비가 512px 이고, 넘칠 때 아래 그림자가 보인다(3판).
- S10 움직임 줄이기(`prefers-reduced-motion: reduce` 흉내): 판의 계산된 스타일 `animation-name` 이 `none` 이다(3판). 배경 흐려짐은 남아도 된다.
- S11 관리자 카드(대표 계정은 대표가 로그인, 비밀번호는 내가 넣지 않음): 카드 보임, [미리보기]가 입력 중인 값으로 뜸, 한국 시각 입력이 그대로 보임, 7-2 경고 다섯 가지가 조건대로 뜸(저장은 누르지 않고 확인 창까지만). 직원 계정 확인은 계약 시험으로 대신한다.
- S12 한 줄 안내·하단 링크(2판): `/terms/service`·`/terms/refund`·`/terms/privacy` 제목 위 한 줄과 앵커, `/terms` 카드, `/signup` 동의 목록 위(`/consent` 는 계약 시험으로 대신, 4판), `/pricing`·`/checkout`·`/cart` 위, 하단 '변경 예정 약관' 링크. 결제 버튼은 누르지 않는다.
- S13 탈퇴 화면 막힘 문구(3판, 10번 배포 뒤 운영 주소, 읽기만): 시험 계정 가운데 결제 이력이 있거나 결제 시도만 있는 계정으로 `/mypage/withdraw` 를 열어 4-6 고지 기간 문구가 보이는지 본다. 대표가 로그인하고, 탈퇴 버튼은 누르지 않는다.
- 약관·동의 항목 잠금은 운영 DB 쓰기라 화면 시험에서 하지 않는다. 리허설 R3 과 계약 시험으로 대신한다.

## 12. 변호사 확인 질문(대표 할 일 6절 변호사 목록에 '(15번)'으로 더함)
1. 닫을 수 있는 접속 팝업 + 변경 전후 대조 화면 + 약관 화면·하단의 상시 안내 + 이메일 개별 통지가 30일 전 고지로 충분한지
   - 기준: 약관 제3조②('서비스 화면에 알림'), 약관규제법, 전자상거래·콘텐츠 표준약관의 '불리한 변경은 30일 이상 두고, 개정 전후를 비교해 알기 쉽게 표시하며, 전자우편 등으로 개별 통지' 취지
   - 10번 계획 13절 9번(재동의 필요성)·15번(고지 기간)과 이어진다.
2. 30일 셈법: 2026-12-10 고지 → 2027-01-11 시행(첫날 불산입)이 충분한지
3. 개별 통지 범위
   - 이메일을 받지 못한 회원(반송, 카카오 가입자의 카카오 이메일만 있는 경우)과 결제하지 않은 회원에게도 필요한지, 반송 때 할 일
   - 고지 기간에 새로 가입한 회원(가입 화면 한 줄 안내 + 시행 직전 이메일)에게 새 약관을 시행일에 그대로 적용할 수 있는지
4. 처리방침 변경(14절 '중요한 변경 30일 전')을 같은 팝업·이메일로 함께 알려도 되는지. 탈퇴 요청 기록을 새로 수집하는 근거를 동의로 볼지(privacy 동의 항목에 줄을 더함, 4-3), 계약 이행 등 다른 근거로 볼지 (4판)
5. 고지 기간의 탈퇴 요청 처리(0절 7번 대표 결정: 별도 절차 없이 대표가 그때 정함)
   - 지금 약관 12조②('취소/환불정책을 따른다')에 따라, 남은 유료 크레딧을 어떻게 처리해야 하는지(환급 범위, 무상분, 위약금)
   - 10번 계획 13절 14번(바뀐 약관에 동의하지 않은 회원의 해지)과 같은 답을 쓴다. 답이 오면 런북 한 줄을 구체화한다.
6. 고지 증빙으로 작업 기록(팝업·게시 원문, 지문, 노출 시작 시각)과 이메일 발송 기록(일시·인원·목록 md5)이 충분한지, 보존 기간
7. 고지 기간 중 변호사 답 때문에 바뀔 글(특히 12조② 소멸)을 고치면 고지를 처음부터 다시 해야 하는지
8. '정식 오픈 전' 안내가 법적 의미를 가지는지. 문구는 '약관은 제3조에 따라 미리 알린 뒤 바꾼다'로 적었다. 일반적인 변경 유보로 읽히지 않는지 확인한다.
9. 시행일 당일 실행이 늦어질 때 (2판)
   - 본문에 '1월 11일부터 시행'이 적힌 채 다음 날 실행해도 되는지(회원에게 불리하지 않은지, 재동의 시작일과 어긋나도 되는지)
   - 안 된다면 당일을 넘기면 시행일을 미루고 다시 고지한다(지금 기본안).
10. 고지 기간에 탈퇴 화면이 결제 회원·결제 시도 회원의 탈퇴를 받지 않고 '고객센터로 요청'을 안내하는 것(4-6)이 해지권 제한(약관규제법 9조), 개인정보 보호법 38조④(요구 방법·절차가 수집 방법보다 어렵지 않을 것), 36조·시행령 43조(10일 안 처리)에 어긋나지 않는지. 대표 할 일 6절에 옮길 때도 같은 조문으로 적는다. (4판) 대표가 요청일부터 10일 안에 처리한다는 전제다. (3판)

## 13. 대표가 정할 것
1. **팝업 노출 끝**: 기본안 `2027-01-12 00:00`(시행일 하루 포함). 시행일 전날 밤에 끄려면 `2027-01-11 00:00`.
2. **문구 초안(9절) 승인**: 켠 뒤 고치면 판마다 다시 보이고 기록이 남는다. 오탈자 수정도 다시 보인다. 시행 스크립트는 켠 뒤 끈 기록이 있으면 멈추므로, 고칠 때는 끄지 말고 켜진 채 저장한다.
3. **팝업 빼는 곳**: 기본안은 `/pricing`·`/checkout`·`/cart` 에서 띄우지 않고 한 줄 안내로 대신한다. 충전 상품 화면(`/pricing`)에서도 팝업을 띄우려면 빼는 목록에서 지운다. (2판)
4. **[닫기]의 범위**: 기본안은 같은 탭만(새 탭마다 한 번씩 뜸). 다른 안은 '닫은 뒤 몇 시간 동안 모든 탭에서 안 뜸'(localStorage 에 닫은 시각)이다. (2판)
5. **push 묶음**: 대표 결정 대기(아래 진행 기본값 5). (가) 10번 커밋 3개(`51b7373`·`25f01b6`·`6a1add7`)를 먼저 따로 내보낸다(5판). 이때 4-6 스크립트를 먼저 마친다(3절). (나) 15번과 함께 내보낸다(스위치 꺼짐, 카카오 키 등록 확인). 15번을 origin/main 위로 다시 쌓는 길은 추가 작업·재시험이 들어 권하지 않는다. (4판)
6. **고지 뒤 글을 고쳐야 할 때의 규칙**(변호사 답 등)
   - 기본안: 시행일을 그날부터 30일 넘게 뒤로 미룬다. 스크립트의 쌍과 날짜 상수를 고치고 리허설한 뒤, `c_republish_reason` 을 넣어 다시 게시한다. 앞 게시 원문은 작업 기록과 `superseded` 에 남는다.
   - 팝업 문구·이메일을 새 날짜로 다시 내보낸다.
7. **시행일 당일 실패 때**: 기본안은 당일 재시도, 당일을 넘기면 시행일을 미루고 다시 고지하는 것이다(`c_apply_last_date = c_effective_date`). 변호사 답(12절 9번)이 '다음 날 실행 가능'이면 `c_apply_last_date` 를 하루 이틀 늘릴 수 있다. (2판)

**13절 진행 기본값(2026-11-25, 2판)** — 문구는 초안으로 넣고 최종은 대표가 클라이언트와 정해 관리자 화면에서 고친다는 결정에 따라 아래 기본안으로 진행한다. 바꾸려면 구현 전에 알려 주면 된다.
- 1 노출 끝 2027-01-12 00:00 KST / 2 문구 초안 그대로(켠 뒤에는 끄지 말고 켜진 채 저장) / 3 `/pricing`·`/checkout`·`/cart` 에서 띄우지 않음 / 4 [닫기]는 같은 탭만 / 6 고지 뒤 글을 고치면 시행일을 미루고 다시 고지 / 7 시행일 당일 실패는 당일 재시도, 넘기면 다시 고지
- 5 **대표 결정 대기**: 10번 커밋 3개(`51b7373`·`25f01b6`·`6a1add7`)를 먼저 따로 push 할지(나의 권장 — 탈퇴 스위치가 꺼져 있어 회원에게 불리한 변화가 없고, 팝업 배포와 섞이지 않음), 15번과 함께 내보낼지

## 14. 범위 밖(15번 본 작업으로)
- 노출 대상 고르기(회원·비회원, 결제 회원 등), 로그인한 때만 띄우기
- 여러 공지 동시 운영·우선순위·순서, 예약해 둔 다음 판
- 이미지·서식(굵게·링크 여러 개)
- '다시 보지 않기(영구)', 로그인 회원의 닫기 기록 서버 저장(기기 사이 공유)
- 노출·클릭 수 통계
- 관리자 메뉴 분리, 공지 목록·판 이력 화면(지금은 작업 기록 화면으로 봄)
- 14번 공지 게시판과 연결(팝업에서 게시글로)
- 변경 예정 글을 관리자 화면에서 고치기(지금은 스크립트로만)
- 고지 기간 탈퇴 요청의 별도 처리 절차(0절 7번, 대표 결정으로 만들지 않음). 탈퇴 화면 문구만 고객센터 안내로 바꾼다(4-6).
- 공용 Dialog 어두운 배경의 움직임 줄이기 처리(다른 팝업에도 영향이 가서 따로 정함)
- 4번 묶음 후속 과제 '재동의 확인 창의 알리는 수단 문구 교체'(공지 게시판이 생긴 뒤)

## 15. 1판 검증 반영
| 관점 | 등급 | 지적 | 2판 반영 |
|---|---|---|---|
| 법률 | blocker | 시행일 전 탈퇴(현행 약관) 약속을 지킬 경로가 없다 | 0절 7번 대표 결정: 별도 절차 없이 런북 RB-11 한 줄로 대응(대표가 그때 정해 10일 안 처리, 익명화 안 씀). 고지 기간 요청은 DB 에 기록하지 않고, 시행 전 pending 0건 확인(10절 8단계). 팝업·이메일에 요청 방법을 적음(9절). 크레딧 처리는 변호사 질문 12-5 |
| 법률 | major | 현행 약관과 함께 바뀌는 곳을 알기 쉽게 볼 곳이 없다, 하단 한 줄은 링크가 안 된다 | 게시 행 `changes`(변경 전→후)와 화면(6-1), 지금 약관 화면·목록·가입·충전 위 한 줄과 하단 링크(6-2). 하단 추가 안내는 쓰지 않음 |
| 법률 | major | 팝업 요약이 본문보다 권리를 좁게 적는다 | 9절 팝업·게시 행 글과 이메일 초안을 고침(법정 환불 예외, 일부 쓴 건, 3일·7일·진행 중 제한, 비결제 기록·새 수집 항목, 재동의·동의 전 제한). 문구 대조 계약 시험 |
| 법률 | major | 11-27 일정에 코드 없는 대안이 없다, 11-28 은 여유가 아니다 | 0절 6번 대표 결정으로 시행일 2027-01-11·고지 마감 12-10. 최소 범위·대안을 걷고 일정표(3절)와 마감 뒤 규칙(13절 6번) |
| 법률 | minor | 게시 원문이 남지 않는다, 하단 줄·수신자 기록이 없다 | 게시 기록 details 에 행 전체, `superseded`, 이메일 목록 md5(8절). 하단 줄은 없앰 |
| 법률 | minor | 고지 기간 새 가입자·바로 충전하는 회원 | 가입·동의·충전·장바구니 한 줄 안내(6-2), 시행 전 대상 목록과 이메일 목록 대조·추가 발송(10절 8단계), 변호사 질문 12-3 |
| 법률 | minor | 동의 항목 2판 본문이 게시되지 않는다 | 게시 행 `consentItems`, 시행 때 대조, 화면 '다시 동의를 받을 항목'(4-3, 6-1) |
| 법률 | minor | 이메일 초안 머리의 '실행한 날 자동 기입' | 이메일 초안 머리를 고침(시행일 상수 고정) |
| 법률 | minor | 시행일 당일 실패 절차가 없다 | 날짜 범위 상수, 당일 재시도(10절 9단계), 대표 결정 13-7, 변호사 질문 12-9 |
| 법률 | minor | 베타 안내가 일반 변경 유보로 읽힌다 | 9절 첫 문단을 '제3조에 따라 미리 알리고 30일 전·재동의'로, 크레딧·자료는 '시행일 전까지 지금처럼'으로 |
| 법률 | minor | 15번 커밋이 10번 위에 쌓인다는 전제가 없다 | 1절·10절 4단계·13절 5번 선택지 고침 |
| DB | major | 리허설이 표 잠금을 낮에 오래 잡는다 | 11-2 를 새벽, 짧은 거래 A·B·C 로 나눔, 결과는 예외로 받음 |
| DB | major | R4 성공 경로가 지문 불일치로 나올 수 없다 | R4 를 (가) 날짜를 모두 리허설 날로 둔 성공 경로, (나) 실제 값 뽑기, (다) 멈춤 경우로 나눔. 시행일 당일 BEGIN…ROLLBACK 판 먼저(10절 9단계) |
| DB | major | 11-28 이 여유가 아니다, 고지 시작을 DB 가 확인하지 않는다 | 고지 마감 상수, 시행 때 게시 시각·팝업 노출 기록·끈 기록 없음·`endsAt` 확인(4-3) |
| DB | major | 고지 기간 탈퇴 요청과 pending 검사 충돌 | 0절 7번, 10절 8단계. 날짜 검사는 범위로 바꿔 당일 재실행 가능(4-3) |
| DB | minor | 초안 그대로 꺼진 채 저장하면 기록이 0건 | 그 단계를 지우고 켜기 저장의 before·after 로 확인(4-2, 10절 6단계) |
| DB | minor | 되돌리기가 upcoming 으로 돌린다, 행을 지운다, 머리말 재게시 때 publishedAt | `reverted`·`revertedAt`, 행은 지우지 않음, `superseded`, 머리말만 바꿀 때 `publishedAt` 유지 |
| DB | minor | 약관 저장 막기가 원자적이지 않고 slug 등을 안 본다 | DB 트리거로 바꿈(content·slug·title·enabled), 시행 스크립트는 상태를 먼저 applied 로(4-4) |
| DB | minor | 동의 항목 새 글이 게시·대조되지 않는다 | `consentItems`(위와 같음) |
| DB | minor | 확인 조회 건수가 섞인다, R3 이 거짓 통과한다 | bundle 값 `bundle15_policy_upcoming`, `c_mode` 별 확인 조회, R3 은 두 행이 있는 상태에서 postgres 1행과 함께 대조 |
| DB | minor | 런북·이메일 머리·11번 시작 조건이 틀린 글이 된다 | 8-4 에 고칠 문서 목록. 이메일 머리는 고침 |
| 화면 | major | 팝업 높이 제한이 없어 닫기 버튼이 화면 밖으로 나간다 | 선례 클래스, 가운데 칸만 스크롤(5-4), S9 크기 늘림, 계약 시험 |
| 화면 | major | 11-27 일정이 안 된다 | 0절 6번 대표 결정으로 일정 다시 잡음(3절) |
| 화면 | minor | `/pricing`·`/terms/refund`·링크 경로 | `/pricing` 뺌(13-3), `/terms/refund` 는 의도, 링크 경로를 DB 값으로 뺌(5-1) |
| 화면 | minor | 움직임 줄이기가 없다, 가운데 칸 이름 | `motion-reduce:animate-none`, 이름을 붙이지 않는 이유(5-4), S10 |
| 화면 | minor | 고칠 기존 시험·`revalidateTag` 형식 | 11-1 '고칠 기존 시험', `{ expire: 0 }` |
| 화면 | minor | Suspense·시작이 미래인 판 | `window.location.search` 로 읽음, 시작이 미래여도 행을 넘기고 브라우저가 시작·끝을 봄(5-2) |
| 화면 | minor | 하단 줄 링크, 시행 뒤 치우기, 시행 실패 때 | 하단 링크·한 줄 안내는 상태로 저절로 사라짐(6-2), 시행 실패 때 13-7 |
| 화면 | minor | [닫기]가 새 탭마다 다시 뜬다, 잘못 누름 | 의도라고 적고 대표 선택지(13-4), 버튼을 막지 않는 이유(5-3) |
| 화면 | minor | 로그인 상태 화면 시험이 조회 기록을 쓴다 | localhost 에서 상품 상세를 열지 않음(11-3) |

## 16. 2판 검증 반영
| 관점 | 등급 | 지적 | 3판 반영 |
|---|---|---|---|
| 법률 | major | 고지 기간 탈퇴 화면 막힘 문구('잠시 후 다시')가 고지 약속과 어긋남 | 4-6 작은 스크립트(10번 배포 전, 15번 없이 돎)로 `DISABLED` 를 고객센터 안내로 바꿈, 작업 기록, 시행 스크립트와 충돌 없음을 거래 C 에서 확인, 스위치 켤 때 restore(10절 0·9단계). 팝업 마지막 문장을 '결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면'으로 넓힘(9절). S13 |
| 법률 | major | 동의 항목 terms 2판 본문·`c_terms_note` 가 12조②보다 좁음 | 4-3 '동의 항목 글을 12조②에 맞춘다'(법정 환불 예외, 일부 쓴 건, 3일), `c_privacy_note` 한 문장, `TRNX` 최소 5, 다시 리허설, 문구 대조 계약 시험 범위 넓힘(11-1) |
| 법률 | minor | pending 조회는 늘 0, 고지 기간 요청 확인 단계가 없음 | 10절 8단계에 메일함 확인, 남은 요청은 접수일 기준 지금 약관으로 처리(anonymize_member 안 씀), 런북 줄(8-4) |
| 법률 | minor | 시행 확인이 링크·본문 변경, 코드 되돌리기, 이메일 지연을 못 거름 | 4-3 끊김 판정(모든 좋은 기록이 `/terms/upcoming`·시행일 글자 포함), 10절 되돌리기 규칙(먼저 끄기), 8단계 이메일 일시 확인 |
| 법률 | minor | 동의 항목·탈퇴 정책 문구가 고지 기간에 고쳐질 수 있음 | 잠금 트리거 2개 더함(4-4), 관리자 카드 안내 |
| 법률 | minor | 시행 뒤 '변경 전 전문' 링크가 새 전문을 열고, 이전 판이 없음 | 상태별 링크 이름, `beforeContent` 게시·접힌 칸(4-3, 6-1) |
| 법률 | minor | 7일 제한 대상, '크레딧 이용' 표현, 변경 사유, 상호 | 9절·이메일 초안 고침('결제 이력이 없는 계정', '크레딧 내역 화면', 사유 한 줄, '써머썬연구소') |
| 화면 | minor | `motion-reduce:animate-none` 이 실제로 못 이김 | 같은 data 변형 클래스, 배경 흐려짐은 그대로 두는 이유, S10 계산된 스타일 확인(5-4) |
| 화면 | minor | 변경 예정 글 읽기 실패 때 처리, 큰 행을 요청마다 읽음 | 6-2 실패하면 그리지 않음, 가벼운 읽기 따로, 계약 시험 |
| 화면 | minor | 저장소 객체 접근 자체가 던짐 | 5-3 getter 부터 try 안, 순수 도우미, 계약 시험 |
| 화면 | minor | 시행 전 reverted 문구가 사실과 다름, 다시 고지 길이 없음 | 6-1 `appliedAt` 로 문구 나눔(DB 값), 4-3 reverted 뒤 다시 게시 |
| 화면 | minor | 시행 확인을 깨는 저장 경고가 끄기뿐, `endsAt` 경계 | 7-2 경고 다섯 가지, 4-3 `>=`, R4 (다) 경계값, 5-1 링크 경로는 정확히 같은 경로만·'/' 는 빼지 않음 |
| 화면 | minor | 동의 항목 note 가 지문에 없음 | 동의 항목 지문 `label LF version LF note LF content`(4-3), R4 (다) |
| 화면 | minor | 판 너비 400px, 넘침 표시, 미리보기 표시가 4번째 자식 | `sm:max-w-lg`, 아래 그림자, 직계 자식 3개(5-4), 계약 시험 |
| 화면 | minor | 미리보기 파일이 scratchpad, `.env.local`, 다시 리허설 창 | `output/` 에 둠, 대표가 환경값을 붙여 다시 띄움(10-1), 3절 일정표에 마지막 날·다시 리허설 날 |
| DB | major | R5 의 down·다시 적용(표 잠금)이 긴 거래 C 안에 있음 | R5 를 둘로 나눔: R5-1(10번 되돌리기 블록, 거래 C) / R5-2(4-5 down → 다시 적용, 거래 A). 거래 B·C 머리에 'DDL 없음' 확인(11-2) |
| DB | minor | 고지 시작 판정의 범위·순서가 정해지지 않음, 같은 시각 | 4-3 판정 순서(거꾸로 이어지는 좋은 기록 S), `clock_timestamp()`, 읽기 조회를 6·8단계에 돌림, R4 (다) 경우 |
| DB | minor | 동의 항목 note·label 대조 없음 | 위 동의 항목 지문 |
| DB | minor | 동의 항목·`w_paths` 잠금 없음 | 4-4 트리거 2·3, 거래 A R3 |
| DB | minor | 게시 0번이 15번 마이그레이션을 안 봄, down 뒤 증빙 행이 열림 | 게시 0번 검사(4-3), down 은 `policy_upcoming_documents` 정책을 남김(4-5) |
| DB | minor | reverted 뒤 다시 고지할 길이 없음 | 4-3 사유가 있으면 superseded 로 옮기고 새로 시작 |
| DB | minor | `c_notice_deadline` 을 따로 적어 엇나갈 수 있음 | 상수 검사 `<= c_effective_date - 32`, `c_apply_last_date >= c_effective_date`, 계약 시험 |
| DB | minor | 고지 기간 코드 되돌리기가 DB 증빙에 안 남음 | 10절 되돌리기: 먼저 팝업을 끄고 저장 |
| DB | minor | 거래 C 에 함수가 없음, 트리거와 시행 순서가 리허설 안 됨, 결과 파일 위치 | 거래 C 머리에서 함수·행 먼저, 거래 A R3 에 시행 순서, `output/` |
| DB | minor | 지문 함수 IMMUTABLE 표기 | STABLE(4-2, 11-1) |

## 17. 3판 검증 반영
| 관점 | 등급 | 지적 | 4판 반영 |
|---|---|---|---|
| DB | major | 게시 0번의 15번 마이그레이션 확인 때문에 거래 C 의 R4 가 모두 0번에서 멈춤 | 거래 C 머리에서 정책만 뺀 마이그레이션 사본으로 함수·판정 함수·**잠금 트리거 3개**까지 만듦(트리거는 읽기를 막지 않음). 읽기까지 막는 POLICY DDL 만 거래 A. 게시 사본의 diff 는 상수 줄·끝 예외·ROLLBACK 과 '0번 `pg_policies` 두 정책 검사 한 줄 건너뜀'뿐이고 계약 시험으로 고정. 실제 적용 파일의 검사는 그대로. R4 (가)는 실제 트리거가 있는 상태의 시행 성공, (다)에 순서를 바꾸면 막힘. 다시 리허설이 마이그레이션 뒤면 만들기를 건너뜀(11-2) |
| DB | minor | 끊김 판정이 스크립트·런북에 두 번 구현됨 | 마이그레이션의 판정 함수 `policy_upcoming_notice_continuity` 하나로, 스크립트·런북·관리자 카드 결과가 그것만 부름(4-2, 4-3) |
| DB | minor | 게시 때 VERIFY 처리가 정해지지 않음 | 4-3 게시 VERIFY 처리표(돌림 / 변수로 돌림 / 건너뜀), 계약 시험 |
| DB | minor | 탈퇴 정책 숫자 키·`termsConsentItemKey`·`termsVersion` 이 잠기지 않음 | 게시 행 `lockedWithdrawalPaths` 로 트리거 3 이 판정(상수 아님), R3 숫자 키 변경 → 막힘 |
| DB | minor | down 이 트리거 함수를 지우지 않음 | 트리거 함수 이름 3개, down 순서, R5-2 확인(함수 6개 0건)(4-4, 4-5) |
| DB | minor | 4-6 문구가 시행 뒤 뜻이 바뀜, 시행일 연기 때 날짜를 못 바꿈 | 날짜 박힌 '바뀌기 전 약관(2026년 11월 23일 시행)', 날짜 상수, notice 가 앞 고지 문구도 받음, 10절 9-4 에 문구 날짜 바꾸기 |
| DB | minor | 고지 기록 이름 `member_withdrawal_policy_update` 가 목록에 없어 지금도 시험 실패 | 7-4 에 이름 더함, 11-1 고칠 기존 시험에 적음 |
| DB | minor | 시행 전 고지 그만두기를 손으로 함 | 10번 스크립트 `withdraw_upcoming` 방식, 작업 기록 `policy_upcoming_withdraw`(4-3, 7-4, 8-1, R4 (다)) |
| DB | minor | 10번을 먼저 내보내면 거래 C 의 4-6 notice 가 멈춤 | 거래 C 머리: 원래 문구면 적용, 고지 문구면 건너뜀, 둘 다 아니면 멈춤 |
| 법률 | minor | 4-6·10절 8단계의 '지금 약관', 런북 940줄과 충돌, 스위치를 못 켤 때 | 날짜 박힌 표현(4-6, 10절 8단계, 이메일), 8-4 에 940줄 고치기(시행 뒤 스위치 꺼짐 동안에도 10일 안 처리), 10절 9단계 '스위치를 못 켜면' 줄 |
| 법률 | minor | privacy 동의 본문에 새 수집 항목·목적이 없음 | `ip_pairs` 에 '회원 탈퇴 때' 수집 항목 줄(목적 포함) 더함, 근거는 변호사 질문 12-4, 문구 대조(4-3, 11-1) |
| 법률 | minor | 문구 대조 기준이 초안과 안 맞음 | 11-1 글마다 요구 표현 표('일부를 썼으면\|일부를 쓴' 둘 다 허용) |
| 법률 | minor | 시행 뒤 비교 화면으로 가는 길이 사라짐 | applied 상태에서 약관 화면·목록에 '이전 판과 바뀐 부분 보기'(DB 값 `historyLinkLabel`)(6-2) |
| 법률 | minor | '불리한' 만 적음, 12조③ 줄 빠짐, 크레딧 괄호 | 팝업·이메일 '불리하거나 중요한 변경은 30일 전부터', 팝업에 후기·추천 삭제·문의 닫힘·재가입 줄, 크레딧 괄호를 '유료 충전·자료 환불로 다시 받은 크레딧·무상'으로(9절) |
| 법률 | minor | 이메일 받는 사람 정의가 둘 | 재동의 대상 − 시험 계정으로 하나로 정의, 발송 직전에 뽑아 기록(8-2, 10절 7단계, 이메일 초안 머리) |
| 법률 | minor | 조문 인용 | 12절 10번을 38조④·36조·시행령 43조로 고침 |
| 화면 | minor | 카드 경고와 SQL 판정이 따로 | 순수 함수 `isNoticeRecordGood`, 링크는 글자까지 같게, 같은 예시 묶음(7-2, 11-1), 저장 뒤 판정 결과 바로 보임 |
| 화면 | minor | 미리보기가 관리자 쪽 읽기에 적용되는지 불분명, `/consent` 확인 불가 | 10-1 관리자 카드·약관 칸·가입 동의 카드도 미리보기 파일, `/consent` 는 계약 시험으로 대신 |
| 화면 | minor | `output/` 이 무시 목록에 없음 | 표현 고침, 15번 구현 커밋에 `.gitignore` `/output/`, 파일을 골라 커밋(8-4, 11-1) |
| 화면 | minor | 동의 항목 강조가 재동의 화면과 다르게 보임 | `splitConsentLines`·`ConsentTextLine` 으로 그림(6-1), S8 |
| 화면 | minor | 열린 채 빼는 경로로 이동 | 팝업을 내리고 닫은 것으로 치지 않음(5-2), 계약 시험·S6 |
| 화면 | minor | 13절 5번과 진행 기본값의 권장이 반대, 4-6 순서 | 13-5 를 '대표 결정 대기'로 맞춤, 3절에 10번을 먼저 낼 때의 순서 |
| 화면 | minor | `/terms/upcoming` 화면 글이 코드에 남음 | 게시 행 `labels`(9절 초안, 6-1) |
| 화면 | minor | 넘침 그림자 위치 | 5-4 가운데 칸 구조(`relative min-h-0` 감싸는 칸 + 스크롤 칸 + 그림자), 계약 시험 |
| 화면 | minor | 일정 여유 | 리허설 1차를 '구현 PASS 다음 새벽'으로, 대표 일정 미리 잡기, 게시 지문이 다를 때 할 일(3절, 10절 5단계) |

## 18. 4판 검증 반영
| 관점 | 등급 | 지적 | 5판 반영 |
|---|---|---|---|
| DB | major | CLI 가 오류 메시지를 약 1000자에서 잘라, 게시 행 JSON·경우별 결과를 예외 메시지로 받을 수 없음 | 10번 리허설 파일과 같은 방식: `ON COMMIT DROP` 임시 표 `_rh_log`(긴 값은 `payload`)에 쌓고, 파일 끝 `SELECT … ; ROLLBACK;` 으로 받음. 예외 메시지는 900자 안 요약만. 리허설 날 전 쓰기 없는 묶음으로 확인. 미리보기 파일은 마지막 SELECT 의 `payload` 에서 꺼냄. 미리보기 파일이 리허설에서 나오지 않으면 push 하지 않음(10절 3단계). 계약 시험(11-1, 11-2) |
| DB | minor | 사본 diff 규정과 이어 돌리기·멈춤 경우가 충돌 | 사본 종류별 diff 표(생성기로 만들고 계약 시험으로 고정), 멈춤 경우는 `pg_temp.try_sql` 하위 블록(11-2) |
| DB | minor | 판정 함수 인자 마감일을 카드·런북이 받을 곳이 없음 | 게시 행 `noticeDeadline`, 판정 함수는 행 값을 읽고 인자는 대조만, 카드에 날짜 상수 없음(4-2, 4-3, 11-1) |
| DB | minor | 게시 VERIFY 5-7-3 이 조립 규칙을 다시 쓰게 함 | 게시 때는 자리표시 검사만, 실제 함수 대조는 시행 VERIFY 와 R4 (가)(4-3 처리표) |
| DB | minor | `DROP TRIGGER` 는 ACCESS EXCLUSIVE | 4-4 잠금 줄 고침, 마이그레이션은 CREATE 만(계약 시험), 거래 C 머리 'POLICY DDL·DROP 문 없음', down 은 새벽·`lock_timeout`(4-5) |
| DB | minor | 고지 그만두기 뒤 팝업·막힘 문구 순서, 8-5 조회 | 그만두기 → 팝업 끄기(또는 안내 문구) → 4-6 restore 순서(4-3), 8-5 조회에 `policy_upcoming_withdraw`·4-6 기록, R4 (다) |
| DB | minor | 4-6 notice·restore 의 '앞 고지 문구' 판정 기준이 없음 | 원래 문구 또는 bundle `bundle15_withdraw_disabled_text` 마지막 기록의 `after` 와 같을 때만(4-6), 거래 E 에 두 번째 notice·restore |
| DB | minor | `member_withdrawal_policy_update` 는 `6a1add7` 에서 이미 등록됨, 커밋 수 | 7-4 를 '이미 등록함, 이름 그대로'로, 11-1 실패 설명 지움, 커밋 목록 3개(1절, 10절 4단계, 13절 5번) |

## 19. 5판 검증 반영
| 관점 | 등급 | 지적 | 6판 반영 |
|---|---|---|---|
| DB | major | 한 거래 안의 성공 경우가 상태를 남겨 서로를 깸, 미리보기 추출이 다른 실패에 끌려감 | 방향을 바꿔 11-2 를 목표·경우·원칙으로 줄임. 원칙 1 경우마다 격리(성공 경우도 하위 블록 + 표지 예외로 되돌림, 확인 값은 변수·로그), 원칙 2 미리보기 추출은 별도 짧은 거래. 사본별 diff·실행 순서·경우별 사전 상태는 구현 때 실제 리허설로 확정하고 구현 검증에서 봄 |
| DB | minor | 마이그레이션 VERIFY 가 '정책 뺀 사본'을 멈춤, 거래 B·C 설명이 다름 | 정책 검사는 이름 붙인 별도 DO 블록(`$verify_site_notice_popup_policies$`), '정책 뺀 사본' = CREATE POLICY 2개 + 그 블록 1개를 뺀 것(4절 머리). 거래 나누기 서술은 11-2 원칙으로 통일 |
| DB | minor | 남긴 `policy_upcoming_documents` 정책 때문에 다시 적용이 멈춤 | `pg_policies` 에 없을 때만 CREATE POLICY(4-4), R5-2 기대 결과에 '그 정책 1개' |
| DB | minor | 4-6 '마지막 기록'을 한 거래 안에서 고를 수 없음, `after` 모양 | details 에 `saved_at = clock_timestamp()`, `ORDER BY details->>'saved_at' DESC`, `after` 는 문자열 하나(4-6) |
| DB | minor | 시행 방식의 검사 순서·게시와의 관계가 없음 | 4-3 시행에 검사 순서(상수·날짜 → 15번 마이그레이션 → 10번 0번 → 끊김 판정 → 지문), 게시는 1~3 의 일부만 씀 |
