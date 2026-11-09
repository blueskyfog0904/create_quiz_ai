# 서울 이전 본 전환 런북 (P-11, 출력용)

근거: `docs/supabase-seoul-migration-plan.md` 8절(C-0~C-9)·9절(되돌리기)·14절(H-10 실측). 이 런북과 계획서가 다르면 **멈추고 AI에게 묻는다**.

- 옛 DB = 싱가포르 `kzcweelnzhcmiuvjgeyi` (`old`, 확인 입력 `old-singapore`)
- 새 DB = 서울 `xsvmbrgixgfqijneikjl` (`new`, 확인 입력 `new-seoul`)
- Vercel 프로젝트 `create-quiz-ai` (팀 `blueskyfogs-projects`)
- 작업 폴더: **리허설 때 쓴 `~/supabase-migration/20261104`** (Storage 기준 시각이 여기에 있음)
- 표시: **[대표]** 대표가 터미널·대시보드에서 실행 / **[AI]** AI가 MCP로 확인 / **[함께]** AI가 확인 후 "다음"이라고 말하면 진행
- AI 도구 한계: 새 DB MCP는 **읽기 전용**(SELECT만, `net.http_*` 불가). 옛 DB MCP는 쓰기 가능하지만 운영 DB라 **쓰기는 대표 승인 뒤에만**.

## 0. 한눈에

### 시간 예산 (H-10 실측 기준)

| 단계 | 실측·예상 | 예산 | 누적 예산 |
|---|---|---|---|
| C-1 입구 차단·쓰기 중지 | Firewall 1분 + 확인 3분 + cron·동결 3분 | 10분 | 10분 |
| C-2 최종 덤프·스냅샷 | 덤프 73초 + AI 스냅샷 5분 | 10분 | 20분 |
| C-3 재적재 | 30초 + AI 확인 5분 | 10분 | 30분 |
| C-4 파일 차이 반영 | 2분 15초 | 10분 | 40분 |
| C-5 검증 V-1~V-5 | AI 10분 | 15분 | 55분 |
| C-6 Vercel 값 교체·재배포·캐시 비우기 | 값 입력 5분 + 빌드 | 15분 | 70분 |
| C-7 대사 cron | 다음 5분 주기 대기 포함 | 15분 | 85분 |
| C-8 확인 | 15분 | 15분 | 100분 |
| C-9 차단 해제 | 5분 | 5분 | 105분 |
| (실패 시) R-2 + R-1 | cron 2개를 차례로 켜며 5분 주기 2번 대기 | 25분 | 130분 |

→ **공지 점검 시간은 2시간 30분**(예: 평일 22:00~00:30). 시작은 cron 실행 직후 **:01**(예: 22:01, 늦어도 :03). 넘으면 공지를 연장한다.

### 중단 기준 (하나라도 해당하면 되돌리기)

1. 같은 단계가 **2번 실패**
2. **C-5 끝까지 60분 초과**(C-6 전이면 되돌리기가 가장 쉬움)
3. C-5 검증 불일치가 원인 불명
4. C-8에서 **옛 DB 스냅샷이 C-2와 다름**(쓰기 유입), **새 경보가 생김**, 또는 로그인·파일·관리자 화면 오류

되돌리기는 맨 아래 **R-1(C-6 전)**, **R-2(C-6 뒤)**. 되돌린 뒤 재시도는 **R-3**.

### 절대 하지 말 것 (점검 중)

- **git push 금지**: 저장소에 아직 배포 안 된 코드 커밋이 있다(운영 배포 커밋 `24d5f7e` 뒤). push하면 자동 배포가 새 코드를 섞고 직전 배포 롤백도 깨진다.
- **C-1부터 C-6 새 배포 연결 확인까지 대표도 운영 사이트 사용 금지**(허용 IP라 옛 DB에 쓰기가 들어갈 수 있음). 확인용 접속은 런북이 시킬 때만.
- 점검 중 `CRON_SECRET` 변경 금지, 기존 미해소 경보 해소 금지(계획 C-7).
- 비밀번호·키를 AI에게 붙여 넣지 않는다(해시 앞자리만 예외, C-7).

---

## C-0. 전날 (또는 당일 시작 2시간 전까지)

- [ ] **[대표·AI] Firewall 사전 시험(H-10(d) 보류분)** — 통과하지 않으면 **본 전환 날짜를 미룬다**(API 쓰기를 막는 유일한 수단)
  1. [대표] 대시보드 https://vercel.com/blueskyfogs-projects/create-quiz-ai/firewall → 규칙 추가: Name `fwtest-0`, If **Request Path · Starts with · `/__fw-test`**, Then **Log** → Save → Review Changes → Publish
  2. [AI] `get_firewall_config`가 404가 아님 확인 → (대표 승인) 시험 규칙 3개로 교체: ① `/__fw-test/reconcile` + POST → bypass ② `/__fw-test` 시작 + 대표 IP → bypass ③ `/__fw-test` 시작 → deny
  3. 시험

| 누가 | 요청 | 기대 |
|---|---|---|
| [AI] 대표 PC에서 curl | GET `/__fw-test/a` | 404(앱) — 통과 |
| [대표] 휴대폰 **Wi-Fi 끄고 모바일 데이터** | `https://www.summersuninst.com/__fw-test/a` | **Vercel 403 차단 화면** |
| [AI] 옛 DB `net.http_post`(대표 승인, `net` 큐만 씀) | POST `/__fw-test/reconcile` | 404/405(앱) — 통과 |
| [AI] 옛 DB `net.http_get`(대표 승인) | GET `/__fw-test/reconcile` | **403 차단**(POST만 허용) |

  4. [AI] 규칙 모두 삭제 → `get_firewall_config`가 **404가 아니라 빈 규칙**으로 나옴 확인(C-1 ①에서 API를 쓸 수 있다는 뜻) → 계획 14절 기록
- [ ] **[대표·AI] 재적재 리허설 한 번 더(계획 C-0 "H-10 재실행", 약 10분)** — 11-09 뒤 쌓인 데이터로도 되는지

```bash
cd ~/supabase-migration/20261104 && S=~/Documents/project/create_quiz_ai/scripts/supabase-seoul-migration
bash $S/h1-dump.sh --data-only      # 옛 DB 비밀번호
bash $S/reload-data.sh              # 새 DB 비밀번호 → 'rehearsal' 입력 → new-seoul 입력
```

  [AI] V-1은 **옛 DB 덤프 시작 시점 기준**으로 일치(옛 DB는 운영 중이라 대사 기록이 계속 늘어남, 14절 H-10(c)과 같은 판정)·V-1b 고아 0·시간 기록
- [ ] **[AI]** V-4·V-5·V-6 두 DB 일치(리허설 뒤 스키마 변경 없음), 새 DB `cron.job` 0·`vault.secrets` 0
- [ ] **[AI] 결제 전제조건**(옛 DB): `kakaopay_accepts_new_orders`·`payapp_accepts_new_orders` 둘 다 false, 대사 backlog 0, 종결되지 않은 주문 0. **하나라도 아니면 날짜를 미룬다**(점검 중 결제 통보가 막히므로)
- [ ] **[AI]** 미해소 경보 목록 기록(2026-11-09: `PAYAPP_FEEDBACK_ORDER_NOT_FOUND` 1건 — 사이트 밖 결제 통보, 점검 중 해소하지 않음)
- [ ] **[대표]** 새 프로젝트가 일시정지되지 않았는지 대시보드 방문(무료, 7일 활동 적으면 정지)
- [ ] **[대표]** 사전 공지 게시 확인(점검 2시간 30분·"점검 뒤 다시 로그인 필요")
- [ ] **[AI]** 전환 전 production 배포 ID 기록 → `__________________` (2026-11-09 기준 `dpl_3dY34E4KR6nX3dr41K3zeTCEpyHT`, 커밋 `24d5f7e`)와 그 배포의 빌드 시간
- [ ] **[대표]** 넣을 값 준비(화면에 띄워 두기만, AI에게 주지 않음)

| 무엇 | 형식 | 어디서 | 쓰는 단계 |
|---|---|---|---|
| 옛 DB 비밀번호 | — | 대표 보관 | C-1, C-2, C-4, R-1 |
| 새 DB 비밀번호 | — | 대표 보관 | C-3, C-4 |
| 옛 service_role 키 | legacy `eyJ…` | 옛 프로젝트 Settings → API Keys → Legacy | C-4 |
| 새 secret 키 | **`sb_secret_…`** (C-6 키와 다름) | 새 프로젝트 Settings → API Keys | C-4 |
| 새 URL·anon·service_role | **legacy JWT `eyJ…`** | 작업 폴더 `env.local.seoul-h9`(H-9에서 검증한 값) | C-6 |
| `CRON_SECRET` 값 | 64자 | 옛 DB SQL Editor `select decrypted_secret from vault.decrypted_secrets where name = 'payment_reconcile_cron_secret';` (Vercel 값은 sensitive라 화면에서 안 보임. 옛 대사 응답 200 기록으로 Vercel 값과 같음 확인됨) | C-7 |
| 되돌리기용 옛 값 3개 | — | 작업 폴더 `env.local.prod`(운영 `.env.local`과 같음 확인됨) | R-2 |

- [ ] **[대표]** 대표 공인 IP 확인: 터미널 `curl -s https://api.ipify.org; echo` **그리고** 확인용으로 쓸 브라우저로 `https://api.ipify.org` 열기 → 둘이 같아야 함(Safari iCloud 비공개 릴레이·VPN이면 다름 → 끄거나 Chrome 사용) → `__________________` (2026-11-09: `119.149.110.63`). 사이트에 IPv6(AAAA) 주소가 없어 IPv4 하나만 허용하면 된다(계획 C-0의 IPv6 확인은 해당 없음).

---

## 당일

### 준비 (시작 10분 전)

```bash
cd ~/supabase-migration/20261104
S=~/Documents/project/create_quiz_ai/scripts/supabase-seoul-migration
curl -s https://api.ipify.org; echo        # 대표 IP 재확인(브라우저도) → AI에게 알림
```

- [ ] 사이트 점검 공지 표시 확인 / 시작 시각 `____:____` (:01)

### C-1. 입구 차단·쓰기 중지 (예산 10분)

- [ ] **① [AI] Firewall 규칙 적용**(대표 "적용해" 승인 후 API로). 위에서부터 순서대로:

| 순서 | 조건 | 동작 |
|---|---|---|
| 1 | 경로 = `/api/internal/payments/reconcile` **그리고** 메서드 = POST | bypass |
| 2 | IP = 대표 IP | bypass |
| 3 | 경로가 `/`로 시작(전부) | **deny** |

  API가 안 되면 대표가 대시보드에서 위 표 그대로 추가 → Review Changes → Publish.
- [ ] **[함께] 차단 확인**
  - [대표] 휴대폰 모바일 데이터로 사이트 → **Vercel 403 화면**
  - [대표] PC 브라우저로 사이트 → 열림(이후 C-6 확인 전까지 쓰지 않음)
  - [AI] (대표 승인) 옛 DB `net.http_post`로 reconcile에 **인증 없이** POST → 그 요청 id의 `net._http_response`가 JSON `{"error":"Forbidden"}`(= Firewall 통과, 앱이 DB 접근 없이 거절). Vercel 차단 화면(HTML)이면 규칙 1 오류. 옛 DB에 남는 것은 `net` 큐·응답 행뿐(덤프·검증 대상 아님)
  - 점검 동안 페이앱 결제 통보(`/api/payments/webhooks/payapp`, 공용 계정이라 사이트 밖 결제 포함)도 403을 받는다(계획 C-1 그대로). C-0 전제조건으로 사이트 주문은 없음.
- [ ] **② [대표]** 옛 DB cron 끄기

```bash
bash $S/freeze.sh old cron-off      # 옛 DB 비밀번호 → old-singapore → 두 작업 active=f 확인
```

- [ ] **[AI]** 진행 중인 대사 없음: 옛 DB `payment_reconciliation_scheduler.lease_owner` NULL, **cron이 보낸** 마지막 http 요청(AI 시험 요청과 구분)의 `net._http_response` 도착 → "동결". lease가 남아 있으면 `lease_expires_at`이 지날 때까지(최대 4분) 기다려 다시 확인, 그래도 남으면 멈춤
- [ ] **③④⑤ [대표]** 옛 DB 쓰기 중지

```bash
bash $S/freeze.sh old on            # 읽기 전용 + 연결 종료 + backend_start 확인 → freeze-old-at.txt 생성
```

- [ ] **[AI]** 옛 DB: 읽기 전용 저장 설정 true, cron 2개 비활성, 기준 시각 이전 연결 0 → "다음"

실패 시: ①이 안 되거나 차단 확인이 기대와 다르면 **여기서 멈추고 날짜를 미룬다** — 적용한 규칙이 있으면 [AI]가 삭제하고 빈 규칙 확인(R-1 4단계), ②를 했다면 R-1 2·3단계도. ②~⑤는 한 번 더 실행, 두 번째도 실패 → R-1.

### C-2. 최종 덤프·스냅샷 (예산 10분)

- [ ] **[AI]** 옛 DB 스냅샷 저장(C-8 비교용): `verify.sql`의 **V-1·V-2·V-2b**(public 전부, cron 기록 테이블 2개도 **빼지 않음**), **Storage**(`storage.objects` 개수·`max(updated_at)`), **미해소 경보 목록** → "덤프 시작"
- [ ] **[대표]**

```bash
bash $S/h1-dump.sh --data-only      # 옛 DB 비밀번호. 리허설 73초
```

- [ ] **[AI]** COPY 93개·덤프 시작 시각이 `freeze-old-at.txt` 이후 → "다음"

실패 시: 한 번 더 실행. 두 번째도 실패 → R-1.

### C-3. 재적재 (예산 10분)

- [ ] **[대표]**

```bash
bash $S/reload-data.sh              # 새 DB 비밀번호 → new-seoul. 리허설 10초(전체 30초)
```

  `freeze-old-at.txt`가 있으므로 `rehearsal` 질문은 나오지 않는다(나오면 멈춤 — C-1 ③ 누락).
- [ ] **[AI]** V-1 행 수 일치, V-1b 고아 0, cron 0, 이력 110 → "다음"
- [ ] **[대표]** 새 프로젝트 디스크 사용량 확인(80% 넘으면 멈춤)

실패 시: 한 트랜잭션이라 새 DB는 그대로. 한 번 더 → 두 번째도 실패 → R-1.

### C-4. 파일 차이 반영 (예산 10분)

- [ ] **[대표]**

```bash
bash $S/storage-sync.sh             # 옛·새 DB 비밀번호 + 옛 service_role(eyJ…) + 새 secret(sb_secret_…). 리허설 2분 15초
```

- [ ] 출력의 "새 쪽에만 있는 파일"이 **0개가 아니면** AI에게 목록을 보여 주고, AI가 확인하면 `bash $S/storage-sync.sh --apply-delete`
- [ ] **[AI]** V-3 (이름·크기) 해시 일치 → "다음"

### C-5. 검증 (예산 15분)

- [ ] **[AI]** V-1·V-1b·V-2·V-2b·V-3·V-4·V-5 옛·새 일치 → 결과 한 줄 보고 → "다음"
- [ ] **[함께]** 누적 시간 확인: **60분 넘었으면 R-1**

### C-6. 앱 전환 (예산 15분)

- [ ] **[대표]** Vercel → `create-quiz-ai` → Settings → Environment Variables. **Production 환경의 3개만**(2026-11-09 확인: 세 값 모두 Production에만 있고 Supabase 연동 관리 값 아님). 이름은 그대로, 값만:

| 이름 | 새 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xsvmbrgixgfqijneikjl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 새 프로젝트 **legacy anon** 키(`eyJ…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | 새 프로젝트 **legacy service_role** 키(`eyJ…`) |

- [ ] **[대표]** Deployments → 현재 Production 배포(C-0에 적은 ID) → ⋯ → **Redeploy** → **"Use existing Build Cache" 체크 해제** → Redeploy. **1회만**(push로 배포하지 않는다).
- [ ] **[AI]** 새 배포 Ready, 운영 도메인이 새 배포 ID를 가리킴, 커밋이 C-0 배포와 같음 → 새 배포 ID `__________________`
- [ ] **[대표] 데이터 캐시 비우기**(Vercel 데이터 캐시는 배포가 바뀌어도 남아서, 비우지 않으면 로고·메인 배너(60초)·샘플 미리보기(1시간)가 **옛 Supabase 주소**로 나가 C-8을 잘못 통과시킨다):
  1. 프로젝트 왼쪽 메뉴 **CDN** → **Caches**
  2. **Purge cache** 칸에서 **All content**
  3. **From which cache layer?** → **Runtime and Data Cache** (기본값 그대로 두면 안 됨)
  4. **Purge** → 확인 창에서 확인
  5. **Purge history**에 runtime cache purge 기록이 생겼는지 확인
  팀 전체 캐시가 함께 비워진다(무해).
- [ ] → "다음"

실패 시(빌드 오류 등) → R-2.

### C-7. 대사 cron (예산 15분)

- [ ] **[대표]** **새 프로젝트(summersun)** SQL Editor, 새 쿼리 탭. 한 줄씩 실행:

```sql
select vault.create_secret('https://www.summersuninst.com', 'payment_reconcile_origin');
select vault.create_secret('<C-0에서 확인한 CRON_SECRET 값>', 'payment_reconcile_cron_secret');
```

- [ ] **[대표]** 같은 탭에서 값 대조용 해시(값은 안 보임):

```sql
select length(trim(decrypted_secret)), left(encode(sha256(convert_to(trim(decrypted_secret), 'UTF8')), 'hex'), 12)
  from vault.decrypted_secrets where name = 'payment_reconcile_cron_secret';
```

  → 결과(64, 12자)만 AI에게 → **[AI]** 옛 DB 같은 값과 일치 확인
- [ ] **[대표]**

```sql
select public.configure_payment_reconciliation_http_cron();
```

- [ ] **[대표]** 그 SQL Editor 쿼리(스니펫) **삭제**
- [ ] **[AI]** 다음 5분 실행에서 `net._http_response` **200**, `payment_reconciliation_scheduler.last_succeeded_at` 갱신 → "health 등록"
- [ ] **[대표]** (새 프로젝트 SQL Editor)

```sql
select cron.schedule('payment-reconciliation-health-5m', '*/5 * * * *', 'SELECT public.enforce_payment_reconciliation_health();');
```

- [ ] **[AI]** 새 DB `cron.job` 2개, 미해소 경보 = **C-2 목록과 같음(새 경보 0)** → "다음"

오류 시(모두 **새 프로젝트** SQL Editor. 옛 DB는 읽기 전용이라 실패할 가능성이 높지만 SQL Editor 경로는 미검증 → 아래 SQL에 안전 검사를 넣음):
- `create_secret` 오류 또는 해시 불일치: [AI]가 새 DB `select name from vault.secrets`로 남은 항목 확인 → 잘못된 항목만 아래처럼 삭제(옛 DB에서 실행하면 멈추는 검사 포함 — 옛 DB는 cron 2개, 새 DB는 이 시점 0~1개) → 같은 값을 다시 정확히 입력 → 해시 대조

```sql
do $$ begin
  if (select count(*) from cron.job) >= 2 then raise exception 'STOP: 옛 DB일 수 있습니다(cron 2개).'; end if;
  delete from vault.secrets where name = '<그 이름>';
end $$;
```

- `configure` 오류 `PAYMENT_RECONCILIATION_VAULT_SECRETS_MISSING`·`…_ORIGIN_INVALID`·`…_CRON_SECRET_INVALID`: 같은 처리
- 다음 실행이 403(`{"error":"Forbidden"}`): secret 불일치 → 아래 실행 → 해시 대조

```sql
do $$ begin
  if (select count(*) from cron.job) >= 2 then raise exception 'STOP: 옛 DB일 수 있습니다(cron 2개).'; end if;
  perform vault.update_secret((select id from vault.secrets where name = 'payment_reconcile_cron_secret'), '<정확한 값>');
end $$;
```

- **secret을 새로 만들지 않는다.** 두 번 실패 → R-2.

### C-8. 확인 (예산 15분)

- [ ] **[대표]** 대표 IP 브라우저, 새 창(이전 로그인은 풀려 있음):
  - [ ] 이메일 로그인 · [ ] 카카오 로그인
  - [ ] 상단 로고·메인 배너·상품 목록 이미지 → 이미지 우클릭 → 이미지 주소 복사 → 주소가 **`xsvmbrgixgfqijneikjl.supabase.co`**인지 눈으로 확인(주소를 AI에게 붙여 넣지 않음, 서명 토큰 포함). 옛 주소(`kzcweelnzhcmiuvjgeyi`)가 보이면: 10초 뒤 새로고침해 다시 확인 → 그래도 옛 주소면 Purge history 확인 후 C-6 퍼지 1회 더 → 그래도 옛 주소면 실패
  - [ ] 상품 상세 샘플 미리보기(같은 방법으로 주소 확인) · [ ] 구매한 파일 다운로드
  - [ ] 관리자 화면 · [ ] 관리자 계정 화면 · [ ] 크레딧 잔액 · [ ] 크레딧 충전 화면 **열기만**(결제하지 않음)
- [ ] **[AI]** 새 DB: 방금 로그인 `last_sign_in_at` 갱신, health 1회 이상 실행 뒤 미해소 경보 = C-2 목록(새 경보 0)
- [ ] **[AI]** **옛 DB V-1·V-2·V-2b·Storage(개수·`max(updated_at)`)·미해소 경보 = C-2 스냅샷**(쓰기 유입 0) → "통과"

하나라도 다르면 **실패** → R-2 → R-3.

### C-9. 차단 해제 (예산 5분)

- [ ] **[AI]** Firewall 규칙 3개 삭제(대표 승인) → 빈 규칙 확인 → [대표] 휴대폰 모바일 데이터로 사이트 열림
- [ ] **[대표]** 점검 공지 내리고 "다시 로그인해 주세요" 안내
- [ ] **이 시점부터 되돌리지 않는다.** 문제는 새 DB에서 고친다. 전환 전 배포로 Instant Rollback·Promote **금지**(조용히 옛 DB를 씀).
- [ ] 참고: 점검 중 403을 받은 페이앱 통보는 대사 cron이 보정하지 않고 **페이앱 재통보에만** 의존한다. 사이트 밖 결제 재통보는 새 DB에 ignored 이벤트로 기록되고, 같은 code의 미해소 경보가 이미 있어 경보가 늘지 않을 수 있다. [AI]가 다음 날 새 DB 웹훅 이벤트를 확인한다.
- [ ] **[AI]** 계획 14절에 당일 기록(단계별 실제 시간), 전환 후 할 일 안내

---

## 되돌리기

### R-1. C-6 전 실패 (앱은 아직 옛 DB)

```bash
bash $S/freeze.sh old off                                   # 읽기 전용 해제 + 연결 재종료
```

1. [ ] **[대표]** 대표 IP로 운영 사이트 로그인 → **[AI]** 옛 DB `last_sign_in_at` 갱신 확인(쓰기 됨)
2. [ ] **[대표]** `bash $S/freeze.sh old cron-on payment-reconciliation-http-5m` → **[AI]** 다음 실행에서 `last_succeeded_at` 갱신(200만으로는 부족 — lease를 못 얻은 실행도 200)
3. [ ] **[대표]** `bash $S/freeze.sh old cron-on payment-reconciliation-health-5m` → **[AI]** 미해소 경보 = C-2 목록(새로 생긴 것만 메모와 함께 해소)
4. [ ] **[AI]** Firewall 규칙 삭제(대표 승인) → 공지 내림

### R-2. C-6 뒤 실패 (앱이 새 DB)

1. [ ] **[대표]** **새 프로젝트(summersun)** SQL Editor(옛 DB는 이때 cron 2개가 모두 꺼져 있으므로, 꺼진 작업이 있으면 멈춤):

```sql
do $$ begin
  if exists (select 1 from cron.job where not active) then raise exception 'STOP: 꺼진 cron이 있습니다. 옛 DB일 수 있습니다.'; end if;
  perform cron.unschedule(jobname) from cron.job;
end $$;
```

   → **[AI]** 새 DB cron 0, **옛 DB cron 2개 그대로** 확인
2. [ ] **[대표]** Vercel → Deployments → C-0 배포 → **Instant Rollback**. 그리고 환경변수 3개를 **옛 값으로 원복**(작업 폴더 `env.local.prod`의 값. 다음 배포가 새 DB를 보지 않게) → C-6과 같은 방법으로 데이터 캐시 비우기(서울 주소가 남지 않게)
3. [ ] **[AI]** 운영 도메인이 C-0 배포 ID인지 확인
4. [ ] R-1 전체(옛 DB 다시 열기 → 쓰기 확인 → cron → Firewall 해제)

### R-3. 재시도

- 옛 DB를 다시 열었거나 Firewall을 해제했다면 → **C-1부터, 새 덤프로**(예전 덤프는 되돌린 사이의 쓰기를 잃음)
- 옛 DB가 계속 동결된 채 C-3~C-5에서 실패 → C-3부터
- 공통: 새 DB vault 정리. **[대표] 새 프로젝트(summersun) SQL Editor**에서(옛 DB에서 실행하면 운영 대사가 멈추므로 안전 검사 포함):

```sql
do $$ begin
  if (select count(*) from cron.job) <> 0 then
    raise exception 'STOP: cron 작업이 있습니다. 옛 DB이거나 새 DB cron 정리(R-2 1단계) 전입니다.';
  end if;
  delete from vault.secrets where name in ('payment_reconcile_origin', 'payment_reconcile_cron_secret');
end $$;
```

  → **[AI]** 새 DB vault 0, **옛 DB vault 2개·cron 2개 그대로** 확인
- Instant Rollback을 했다면 재시도 C-6에서 **Undo Rollback 또는 Promote로 새 배포를 운영 도메인에 연결**하고 배포 ID 확인, Vercel 화면에서 롤백 후보가 C-0 배포인지 눈으로 확인한 뒤 C-7. 다시 실패했는데 직전 배포가 C-0 배포가 아니면 Instant Rollback 대신 **환경변수 원복 + 재배포**

---

## 전환 후 바로 (계획 10절 요약)

- A-2 개발 도구의 옛 ref 갱신(`.env.local` ← `env.local.seoul-h9`, `.mcp.json`, `supabase link` 등) — AI가 목록대로
- 관리자 샘플 업로드 1건 → 삭제(서명 업로드 `createSignedUploadUrl` 경로는 H-9에서 생략해 아직 미확인)
- A-3 1주 뒤 카카오 Redirect URI에서 옛 주소 삭제
- A-5 24시간 관찰(cron 288회 성공, 새 경보 0, Vercel 오류)
- A-1 옛 프로젝트 2주 보관 → 일시정지, 덤프 폴더 삭제
- A-10 공무원맛집가이드 재개는 옛 프로젝트 일시정지 **뒤**(2027-02-02 전)
- 확인 메일 한국어 템플릿(W3-7b), Pro 전환 뒤 Leaked password protection(A-11)
