# 서울 이전 리허설 스크립트

계획: `docs/supabase-seoul-migration-plan.md` (단계 ID는 계획서와 같음). 본 전환(C-0~C-9)은 출력용 런북 `docs/supabase-seoul-cutover-runbook.md`(P-11, H-10 뒤 작성)를 따른다.

## 규칙

- **대표 터미널에서만 실행**한다. 비밀번호·키는 스크립트가 실행할 때 `read -s`로 묻는다(화면·명령줄·파일에 남지 않음). AI에게 알려 주지 않는다.
- 작업 폴더 `~/supabase-migration/<날짜>/`에서 실행한다(저장소·iCloud 밖). 스크립트가 다른 위치면 멈춘다.
- 덤프 폴더에는 비밀번호 해시·개인정보가 들어 있다. 다른 곳에 복사하지 않고 계획 A-1 시점에 삭제한다.
- 옛(싱가포르) DB에는 **읽기만** 한다. 쓰기·삭제는 새(서울) DB에만 한다(`freeze.sh old …`는 본 전환 전용).
- 각 단계가 끝나면 AI에게 알린다. AI가 MCP로 두 DB를 SELECT해 비교한 뒤 다음 단계로 간다.

## 처음 한 번

```bash
mkdir -p ~/supabase-migration/$(date +%Y%m%d) && cd ~/supabase-migration/$(date +%Y%m%d)
S=~/Documents/project/create_quiz_ai/scripts/supabase-seoul-migration
```

첫 실행 때 ref 두 개와 Session pooler URL 두 개(비밀번호 부분을 뺀 것)를 묻고 `migration.env`에 저장한다. URL은 대시보드 → Connect → Session pooler에서 복사한 뒤 `:[YOUR-PASSWORD]` 부분을 지운다.

## 순서

| 단계 | 누가 | 할 일 |
|---|---|---|
| P-1~P-3, P-5, P-6, P-8 | 대표 | 계획 5절(리허설 시작하는 날). P-8 MCP 항목은 AI가 `.mcp.json`에 추가하고 대표가 Claude Code를 다시 연결 |
| H-0 | AI | `sql/verify.sql`의 V-0을 두 DB에서 실행·기록 |
| H-1·H-2 | 대표 | `bash $S/h1-dump.sh` (옛 DB 비밀번호) |
| H-3~H-5 | 대표 | `bash $S/h3-h5-restore.sh` (새 DB 비밀번호, 새 ref 입력 확인) → 디스크 사용량 알림 |
| H-6 | 대표 | `bash $S/storage-sync.sh` (DB 비밀번호 2개 + 옛 service_role 키 + 새 secret 키) |
| H-7 | 대표·AI | 새 프로젝트 SQL Editor에서 `sql/h7-cron-vault-test.sql` 1~2단계 → 5~10분 뒤 AI가 403 확인 → 4~5단계 정리 |
| H-8 | AI | V-1~V-6 비교, 판정 기록 |
| P-7 | 대표 | Resend 가입·가비아 DNS·새 프로젝트 SMTP 설정(H-9 전, AI가 단계 안내) |
| H-9 | 대표·AI | 로컬 앱 시험(계획 H-9 ①~⑤). ⑤는 `bash $S/storage-sync.sh` → 새 쪽에만 있는 파일 목록 확인 → `bash $S/storage-sync.sh --apply-delete` |
| H-10 | 대표·AI | (a) `bash $S/freeze.sh new on` → 쓰기 실패 시험 (b) `bash $S/freeze.sh new off` (c) `bash $S/reload-data.sh` → AI V-1 (d) Vercel Firewall log 규칙 시험 (e) 시간 기록 |

## 스크립트

| 파일 | 계획 단계 | 대상 |
|---|---|---|
| `lib.sh` | 공통(작업 폴더·URL·비밀번호 처리) | — |
| `h1-dump.sh [--data-only]` | H-1·H-2, 본 전환 C-2(`--data-only`) | 옛 DB 읽기 |
| `h3-h5-restore.sh` | H-3·H-4·H-5 | 새 DB(비어 있을 때만) |
| `storage-sync.sh [--apply-delete]` + `storage-sync.mjs` | H-6, C-4 | 옛 Storage 읽기 → 새 Storage 쓰기 |
| `reload-data.sh` | H-10(c), C-3 | 새 DB |
| `freeze.sh <old\|new> on\|off\|status\|cron-off\|cron-on <jobname>` | H-10(a)(b), C-1, 9절 | 지정한 DB(ref 직접 입력 확인) |
| `sql/h7-cron-vault-test.sql` | H-7 | 새 프로젝트 SQL Editor |
| `sql/verify.sql` | H-0, V-1~V-6 | AI가 MCP로 두 DB(읽기 전용) |

## 멈췄을 때

스크립트는 오류가 나면 `[중단]`을 출력하고 멈춘다. 복원·재적재는 한 트랜잭션이라 중간에 실패해도 새 DB가 반쯤 바뀐 상태로 남지 않는다. 출력 마지막 몇 줄을 AI에게 붙여 주면 된다(비밀번호는 출력되지 않음). CLI가 로그인(`supabase login`)을 요구하면 진행하지 말고 알린다.
