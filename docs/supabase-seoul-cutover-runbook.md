# 서울 이전 본 전환 런북 (P-11, 출력용)

근거: `docs/supabase-seoul-migration-plan.md` 8절(C-0~C-9)·9절(되돌리기)·14절(H-10 실측). 이 런북과 계획서가 다르면 **멈추고 AI에게 묻는다**.

- 옛 DB = 싱가포르 `kzcweelnzhcmiuvjgeyi` (`old`, 확인 입력 `old-singapore`)
- 새 DB = 서울 `xsvmbrgixgfqijneikjl` (`new`, 확인 입력 `new-seoul`)
- Vercel 프로젝트 `create-quiz-ai` (팀 `blueskyfogs-projects`)
- 작업 폴더: **리허설 때 쓴 `~/supabase-migration/20261104`** (Storage 기준 시각이 여기에 있음)
- 표시: **[대표]** 대표가 터미널·대시보드에서 실행 / **[AI]** AI가 MCP로 확인 / **[함께]** AI가 확인 후 "다음"이라고 말하면 진행

## 0. 한눈에

### 시간 예산 (H-10 실측 기준)

| 단계 | 실측·예상 | 예산 | 누적 예산 |
|---|---|---|---|
| C-1 입구 차단·쓰기 중지 | Firewall 1분 + cron·동결 3분 | 10분 | 10분 |
| C-2 최종 덤프·스냅샷 | 덤프 73초 + AI 스냅샷 5분 | 10분 | 20분 |
| C-3 재적재 | 30초 + AI 확인 5분 | 10분 | 30분 |
| C-4 파일 차이 반영 | 2분 15초 | 10분 | 40분 |
| C-5 검증 V-1~V-5 | AI 10분 | 15분 | 55분 |
| C-6 Vercel 값 교체·재배포 | 값 입력 5분 + 빌드 | 15분 | 70분 |
| C-7 대사 cron | 다음 5분 주기 대기 포함 | 15분 | 85분 |
| C-8 확인 | 15분 | 15분 | 100분 |
| C-9 차단 해제 | 5분 | 5분 | 105분 |

→ **공지 점검 시간은 2시간**(예: 평일 22:00~24:00). 시작은 cron 실행 직후(**매 5분의 :01~:04**, 예: 22:01).

### 중단 기준 (하나라도 해당하면 되돌리기)

1. 같은 단계가 **2번 실패**
2. **C-5 끝까지 60분 초과**(C-6 전이면 되돌리기가 가장 쉬움)
3. C-5 검증 불일치가 원인 불명
4. C-8에서 **옛 DB 스냅샷이 C-2와 다름**(쓰기 유입) 또는 로그인·결제 화면 오류

되돌리기는 맨 아래 **R-1(C-6 전)**, **R-2(C-6 뒤)**. 되돌린 뒤 재시도는 **C-1부터 새 덤프로**(R-3).

### 절대 하지 말 것 (점검 중)

- **git push 금지**: 저장소에 아직 배포 안 된 코드 커밋이 있다(운영 배포 커밋 `24d5f7e` 뒤). push하면 자동 배포가 새 코드를 섞고 직전 배포 롤백도 깨진다.
- **C-1~C-5 동안 대표도 운영 사이트 사용 금지**(허용 IP라 쓰기가 들어갈 수 있음).
- 점검 중 `CRON_SECRET` 변경 금지(계획 C-7).
- 비밀번호·키를 AI에게 붙여 넣지 않는다.

---

## C-0. 전날 (또는 당일 시작 2시간 전까지)

- [ ] **[대표·AI] Firewall 사전 시험(H-10(d) 보류분)** — 대시보드에서 `fwtest-0` 규칙(경로 `/__fw-test` 시작 → **Log**) 1개를 만들어 Publish → AI가 시험 규칙 3개로 바꿔 시험 → 삭제. 계획 14절 "Firewall 사전 시험" 줄. **이게 통과하지 않으면 본 전환 날짜를 미룬다**(쓰기를 막는 유일한 수단).
- [ ] **[AI]** V-4·V-5·V-6 두 DB 일치, V-1·V-2는 H-8 기준(리허설 뒤 스키마 변경 없음)
- [ ] **[AI]** 새 DB `cron.job` 0개, `vault.secrets` 0개
- [ ] **[대표]** 새 프로젝트가 일시정지되지 않았는지 대시보드 방문(무료, 7일 활동 적으면 정지)
- [ ] **[대표]** 사전 공지 게시 확인(점검 시간·"점검 뒤 다시 로그인 필요")
- [ ] **[AI]** 전환 전 production 배포 ID 기록 → `__________________` (2026-11-09 기준 `dpl_3dY34E4KR6nX3dr41K3zeTCEpyHT`)
- [ ] **[대표]** 넣을 값 준비(화면에 띄워 두기만, AI에게 주지 않음)

| 무엇 | 어디서 | 쓰는 단계 |
|---|---|---|
| 옛 DB 비밀번호 | 대표 보관 | C-1, C-2, C-4, R-1 |
| 새 DB 비밀번호 | 대표 보관 | C-3, C-4 |
| 옛 service_role 키(legacy) | 옛 프로젝트 Settings → API Keys → Legacy | C-4 |
| 새 secret 키 | 새 프로젝트 Settings → API Keys (H-6·C-4 리허설 때 넣은 것과 같은 종류) | C-4 |
| 새 URL·anon·service_role(**legacy JWT `eyJ…`**) | 작업 폴더 `env.local.seoul-h9`(H-9에서 검증한 값과 같은 종류) | C-6 |
| `CRON_SECRET` 값 | 옛 DB SQL Editor `select decrypted_secret from vault.decrypted_secrets where name = 'payment_reconcile_cron_secret';` (Vercel 값은 sensitive라 화면에서 안 보임) | C-7 |

- [ ] **[대표]** 대표 공인 IP 확인: `curl -s https://api.ipify.org; echo` → `__________________` (2026-11-09: `119.149.110.63`, 유동 IP라 C-1 직전에 다시)

---

## 당일

### 준비 (시작 10분 전)

```bash
cd ~/supabase-migration/20261104
S=~/Documents/project/create_quiz_ai/scripts/supabase-seoul-migration
curl -s https://api.ipify.org; echo        # 대표 IP 재확인 → AI에게 알림
```

- [ ] 사이트 점검 공지 표시 확인 / 시작 시각 `____:____` (매 5분의 :01~:04)

### C-1. 입구 차단·쓰기 중지 (예산 10분)

- [ ] **① [AI] Firewall 규칙 적용**(대표 "적용해"라고 승인 후, 사전 시험으로 설정이 있어 API로 가능). 위에서부터 순서대로:

| 순서 | 조건 | 동작 |
|---|---|---|
| 1 | 경로 = `/api/internal/payments/reconcile` **그리고** 메서드 = POST | bypass |
| 2 | IP = 대표 IP | bypass |
| 3 | 경로가 `/`로 시작(전부) | **deny** |

  API가 안 되면 대표가 대시보드(Firewall → Add Rule, 위 표 그대로 → Review Changes → Publish).
- [ ] **[AI]** 확인: 대표 PC에서 사이트 열림, 외부(새 DB `net.http_get`)에서 403. 페이앱 결제 통보(`/api/payments/webhooks/payapp`)도 이 동안 막힌다(계획 C-1 그대로).
- [ ] **② [대표]** 옛 DB cron 끄기

```bash
bash $S/freeze.sh old cron-off      # 옛 DB 비밀번호 → old-singapore 입력 → 두 작업 active=f 확인
```

- [ ] **③④⑤ [대표]** 옛 DB 쓰기 중지

```bash
bash $S/freeze.sh old on            # 읽기 전용 + 연결 종료 + backend_start 확인 → freeze-old-at.txt 생성
```

- [ ] **[AI]** 옛 DB: 읽기 전용 저장 설정 true, cron 2개 비활성, 기준 시각 이전 연결 0 → "다음"

실패 시: ①이 안 되면 **여기서 멈추고 날짜를 미룬다**(옛 DB는 아직 그대로라 되돌릴 것 없음, cron을 껐다면 R-1의 cron 재활성만). ②~⑤ 실패 → R-1.

### C-2. 최종 덤프·스냅샷 (예산 10분)

- [ ] **[AI]** 옛 DB V-1·V-2 스냅샷 저장(C-8 비교용) → "덤프 시작"
- [ ] **[대표]**

```bash
bash $S/h1-dump.sh --data-only      # 옛 DB 비밀번호. 리허설 73초
```

- [ ] **[AI]** COPY 93개·덤프 시작 시각이 `freeze-old-at.txt` 이후 → "다음"

실패 시: 한 번 더 실행. 두 번째도 실패 → R-1.

### C-3. 재적재 (예산 10분)

- [ ] **[대표]**

```bash
bash $S/reload-data.sh              # 새 DB 비밀번호 → new-seoul 입력. 리허설 10초(전체 30초)
```

  `freeze-old-at.txt`가 있으므로 `rehearsal` 질문은 나오지 않는다(나오면 멈춤 — C-1 ③ 누락).
- [ ] **[AI]** V-1 행 수 일치, V-1b 고아 0, cron 0, 이력 110 → "다음"
- [ ] **[대표]** 새 프로젝트 디스크 사용량 확인(80% 넘으면 멈춤)

실패 시: 한 트랜잭션이라 새 DB는 그대로. 한 번 더 → 두 번째도 실패 → R-1.

### C-4. 파일 차이 반영 (예산 10분)

- [ ] **[대표]**

```bash
bash $S/storage-sync.sh             # DB 비밀번호 2개 + 옛 service_role 키 + 새 secret 키. 리허설 2분 15초
```

- [ ] 출력의 "새 쪽에만 있는 파일"이 **0개가 아니면** AI에게 목록을 보여 주고, AI가 확인하면 `bash $S/storage-sync.sh --apply-delete`
- [ ] **[AI]** V-3 (이름·크기) 해시 일치 → "다음"

### C-5. 검증 (예산 15분)

- [ ] **[AI]** V-1·V-1b·V-2·V-3·V-4·V-5 옛·새 일치 → 결과 한 줄 보고 → "다음"
- [ ] **[함께]** 누적 시간 확인: **60분 넘었으면 R-1**

### C-6. 앱 전환 (예산 15분)

- [ ] **[대표]** Vercel → `create-quiz-ai` → Settings → Environment Variables. **Production 환경의 3개만**(2026-11-09 확인: 세 값 모두 Production에만 있고 Supabase 연동 관리 값 아님). 이름은 그대로, 값만:

| 이름 | 새 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xsvmbrgixgfqijneikjl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 새 프로젝트 **legacy anon** 키(`eyJ…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | 새 프로젝트 **legacy service_role** 키(`eyJ…`) |

- [ ] **[대표]** Deployments → 현재 Production 배포(C-0에 적은 ID) → ⋯ → **Redeploy** → **"Use existing Build Cache" 체크 해제** → Redeploy. **1회만**(push로 배포하지 않는다 — 배포 안 된 코드가 섞임).
- [ ] **[AI]** 새 배포 Ready, 운영 도메인이 새 배포 ID를 가리킴, 배포 커밋이 C-0 배포와 같음 → 새 배포 ID `__________________` → "다음"

실패 시(빌드 오류 등) → R-2.

### C-7. 대사 cron (예산 15분)

- [ ] **[대표]** 새 프로젝트 SQL Editor(새 쿼리 탭):

```sql
select vault.create_secret('https://www.summersuninst.com', 'payment_reconcile_origin');
select vault.create_secret('<C-0에서 확인한 CRON_SECRET 값>', 'payment_reconcile_cron_secret');
select public.configure_payment_reconciliation_http_cron();
```

- [ ] **[대표]** 실행 뒤 그 SQL Editor 쿼리(스니펫) **삭제**
- [ ] **[AI]** 다음 5분 실행에서 `net._http_response` **200**, `payment_reconciliation_scheduler.last_succeeded_at` 갱신 → "health 등록"
- [ ] **[대표]**

```sql
select cron.schedule('payment-reconciliation-health-5m', '*/5 * * * *', 'SELECT public.enforce_payment_reconciliation_health();');
```

- [ ] **[AI]** `cron.job` 2개, 미해소 경보 0 → "다음"

오류 시: `create_secret` 오류 → 잘못 만든 vault 항목 삭제 후 같은 값 다시 정확히 입력(계획 C-7). 403이면 secret 값 불일치 → 같은 처리. **secret을 새로 만들지 않는다.** 두 번 실패 → R-2.

### C-8. 확인 (예산 15분)

- [ ] **[대표]** 대표 IP로 운영 사이트(일반 창 새로 열기, 이전 로그인은 풀려 있음):
  - [ ] 이메일 로그인 · [ ] 카카오 로그인
  - [ ] 메인 배너·상품 목록 이미지 · [ ] 상품 상세 샘플 미리보기 · [ ] 구매한 파일 다운로드
  - [ ] 관리자 화면 · [ ] 관리자 계정 화면 · [ ] 크레딧 잔액
- [ ] **[AI]** 새 DB: 방금 로그인 `last_sign_in_at` 갱신, health 1회 이상 실행 뒤 미해소 경보 0
- [ ] **[AI]** **옛 DB V-1·V-2 = C-2 스냅샷**(쓰기 유입 0) → "통과"

하나라도 다르면 **실패** → R-2 → R-3(C-1부터 재시도).

### C-9. 차단 해제 (예산 5분)

- [ ] **[AI]** Firewall 규칙 3개 삭제(대표 승인) → 설정 비었음 확인 → 외부에서 사이트 200
- [ ] **[대표]** 점검 공지 내리고 "다시 로그인해 주세요" 안내
- [ ] **이 시점부터 되돌리지 않는다.** 문제는 새 DB에서 고친다. 전환 전 배포로 Instant Rollback·Promote **금지**(조용히 옛 DB를 씀).
- [ ] **[AI]** 계획 14절에 당일 기록(단계별 실제 시간), 전환 후 할 일(계획 10절 A-1~A-11) 안내

---

## 되돌리기

### R-1. C-6 전 실패 (앱은 아직 옛 DB)

```bash
bash $S/freeze.sh old off                                   # 읽기 전용 해제 + 연결 재종료
```

1. [ ] **[대표]** 대표 IP로 운영 사이트 로그인 → **[AI]** 옛 DB `last_sign_in_at` 갱신 확인(쓰기 됨)
2. [ ] **[대표]** `bash $S/freeze.sh old cron-on payment-reconciliation-http-5m` → **[AI]** 다음 실행 성공 확인
3. [ ] **[대표]** `bash $S/freeze.sh old cron-on payment-reconciliation-health-5m` → **[AI]** 미해소 경보 확인(생겼으면 메모와 함께 해소)
4. [ ] **[AI]** Firewall 규칙 삭제(대표 승인) → 공지 내림

### R-2. C-6 뒤 실패 (앱이 새 DB)

1. [ ] **[대표]** 새 DB SQL Editor: `select cron.unschedule(jobname) from cron.job;` → **[AI]** 0개 확인
2. [ ] **[대표]** Vercel → Deployments → C-0 배포 → **Instant Rollback**. 그리고 환경변수 3개를 **옛 값으로 원복**(작업 폴더 `env.local.prod`의 값. 다음 배포가 새 DB를 보지 않게)
3. [ ] **[AI]** 운영 도메인이 C-0 배포 ID인지 확인
4. [ ] R-1 전체(옛 DB 다시 열기 → 쓰기 확인 → cron → Firewall 해제)

### R-3. 재시도

- 옛 DB를 다시 열었거나 Firewall을 해제했다면 → **C-1부터, 새 덤프로**(예전 덤프는 되돌린 사이의 쓰기를 잃음)
- 옛 DB가 계속 동결된 채 C-3~C-5에서 실패 → C-3부터
- 공통: 새 DB cron 0, vault 2개 삭제(`delete from vault.secrets where name in ('payment_reconcile_origin','payment_reconcile_cron_secret');`)
- Instant Rollback을 했다면 재시도 C-6에서 **Undo Rollback 또는 Promote로 새 배포를 운영 도메인에 연결**하고 배포 ID 확인. 다시 실패했는데 직전 배포가 C-0 배포가 아니면 Instant Rollback 대신 **환경변수 원복 + 재배포**

---

## 전환 후 바로 (계획 10절 요약)

- A-2 개발 도구의 옛 ref 갱신(`.env.local` ← `env.local.seoul-h9`, `.mcp.json`, `supabase link` 등) — AI가 목록대로
- A-3 1주 뒤 카카오 Redirect URI에서 옛 주소 삭제
- A-5 24시간 관찰(cron 288회 성공, 경보 0, Vercel 오류)
- A-1 옛 프로젝트 2주 보관 → 일시정지, 덤프 폴더 삭제
- A-10 공무원맛집가이드 재개는 옛 프로젝트 일시정지 **뒤**(2027-02-02 전)
- 확인 메일 한국어 템플릿(W3-7b), Pro 전환 뒤 Leaked password protection(A-11)
