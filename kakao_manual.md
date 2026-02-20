# Kakao OAuth 연동 매뉴얼 (범용 템플릿)

> 목적: 향후 새 프로젝트에서 카카오 간편가입/로그인을 빠르고 안전하게 붙이기 위한 실행 체크리스트
>
> 기준: 현재 프로젝트(Next.js + Supabase Auth) 기준으로 작성. 다른 프로젝트에 맞게 도메인/변수명만 치환해서 사용.

---

## 0) 개요

카카오 로그인은 보통 **Kakao Developers App** + **Supabase OAuth Provider** 조합으로 구현한다.

흐름은 아래 3단계:

1. 사용자 클릭 → Supabase OAuth 시작 (`/auth/signin` or `/login` 페이지에서 `signInWithOAuth`)
2. 카카오 인증 완료 후 Supabase 콜백(`https://<project>.supabase.co/auth/v1/callback`)으로 리디렉트
3. 앱의 콜백 라우트(`/auth/callback`)에서 세션 확인 후 최종 화면으로 이동

---

## 1) 오케스트레이션(omx 팀) 재현용 매뉴얼

이 프로젝트에서 카카오 연동처럼 다단계 작업을 할 때 팀 기반으로 병렬/검증하려면 다음처럼 진행.

### 1-1. 사전 조건
- tmux에서 실행
- Node/NPM 및 `omx` 설치
- `.omx` 상태 경로 접근 가능

### 1-2. 팀 시작
```bash
./scripts/kakao-auth-team.sh start
```

### 1-3. 권장 팀 역할
- planner: 요구사항 정리(성공/실패 시나리오, 리스크, DB 영향)
- architect: 인증 아키텍처/보안 설계
- executor: 코드 구현
- verifier: 기능/보안/운영 검증
- critic: 위험성 최종 리뷰

### 1-4. 상태 확인/관리
```bash
./scripts/kakao-auth-team.sh status
./scripts/kakao-auth-team.sh watch
./scripts/kakao-auth-team.sh summary
```

### 1-5. 종료/정리
```bash
./scripts/kakao-auth-team.sh shutdown
```

### 1-6. 체크포인트
- 팀이 안 떠오를 때: `teams.txt.tmp`/`teams.txt`/`.omx/state/team/<team-name>` 상태 정리
- 특정 팀이 죽었거나 무응답일 때: 로그 확인 후 `shutdown` 후 재시작
- 동일 이름 팀 중복 실행 오류 시: 기존 팀 정리 후 재시작

> 참고: tmux 권한/세션 이슈로 팀 생성 실패(=권한으로 TMUX 연결 실패)가 나올 수 있음. 이 경우 먼저 `tmux` 세션 자체 문제 해결 후 재시도.

---

## 2) 공통 사전준비

### 2-1. 필수 환경 변수
```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### 2-2. 권장 환경 변수
- `KAKAO_REST_API_KEY` : 앱에서 직접 Kakao REST API를 추가로 쓰는 경우에만.
- 현재 패턴(Supabase OAuth 직접 처리)에서는 필수 아님.

### 2-3. DB/도메인 준비
- 프로젝트 URL(개발/운영)을 정리
- 로컬: `http://localhost:4000`(또는 사용 포트)
- 운영: 실제 HTTPS 도메인

---

## 3) Kakao Developers 설정

1. [Kakao Developers](https://developers.kakao.com) 로그인
2. 앱 생성 또는 기존 앱 선택
3. **카카오 로그인** 제품 추가
4. **Web 플랫폼 등록**
   - `http://localhost:4000`
   - `https://your-prod-domain.com` (운영)
5. **Redirect URI** 등록 (중요)
   - 앱에서 쓰는 Supabase 프로젝트 도메인 콜백을 등록
   - 보통: `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`
   - 만약 custom domain을 쓰면 해당 도메인 기준 callback URL 사용
6. 동의항목 설정
   - 최소: 프로필 닉네임/이름, 프로필 사진, 이메일
7. `REST API Key` 및 `Client Secret` 발급/확인

---

## 4) Supabase 설정

### 4-1. Kakao Provider 활성화
- **Authentication → Providers → Kakao**
- Enable ON
- 카카오의 **REST API Key**를 Client ID로 입력
- 필요 시 Client Secret 입력

### 4-2. URL Configuration
- **Site URL**: 앱 기본 URL
  - 예: `http://localhost:4000`
- **Additional Redirect URLs**
  - `http://localhost:4000/auth/callback`
  - `https://your-prod-domain.com/auth/callback`

### 4-3. 권장: 로그/세션 정책 확인
- `auth.signUp` / `signInWithOAuth` 사용 시 쿠키/세션 도메인 정책 점검
- 로컬/스테이징은 각각 별도 세션 도메인 영향 확인

---

## 5) 코드 구현 체크리스트 (Next.js App Router)

### 5-1. 로그인 페이지
- Kakao 버튼 클릭 시
  ```ts
  await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo: `${window.location.origin}/auth/callback?${callbackQuery}`,
    },
  })
  ```
- `next` 파라미터를 넘겨서 인증 후 되돌아올 경로 지정
- 로그인 에러코드(`error`,`error_description`) 표시

### 5-2. `/auth/callback` API Route
- query에서 `code`, `error`, `error_code`, `error_description` 파싱
- `code`가 있으면 `exchangeCodeForSession(code)` 호출
- 실패 시 `/login?error=...&error_description=...&next=...`로 리다이렉트
- `next`는 반드시 경로 검증(오픈 리다이렉트 방지)

### 5-3. `next` 안전 처리(필수)
- 허용되는 값은 `/`로 시작하는 내부경로만 허용
- `https://`, `//` 등 외부 URL은 `/`로 정규화

### 5-4. 에러 UX
- `access_denied`, `user_cancelled`, `server_error` 등 카카오 공통 에러 매핑
- `callback_error`, `exchange_failed` 같은 내부 분기 메시지 표기

---

## 6) DB/회원정보 매핑 보강

카카오 OAuth 메타데이터가 형태/필드명 변경되면 회원가입 프로필 저장이 깨질 수 있다.

### 기본 권장 SQL
- `public.handle_new_user()` Trigger 함수에서
  - provider fallback (`raw_app_meta_data.provider`, `raw_user_meta_data.provider`)
  - kakao_id fallback (`kakao_id`, `provider_id`, `provider_uid`, `sub`)
  - kakao_email fallback (`kakao_email`, `email`)
  - birthdate 안전 파싱
- `profiles(provider, kakao_id)` 인덱스 권장

### 적용 순서
```bash
# 예시: Supabase SQL 편집기 실행
# migration 생성 후 db push
```

---

## 7) 마이그레이션 관리

1. migration 파일 생성
2. migration 적용
3. 타입이 바뀌면 `supabase gen types` 재생성
4. 변경사항 커밋

---

## 8) 테스트 시나리오 (반드시 실행)

### 8-1. 성공 시나리오
- 신규 가입: 카카오 계정 동의 후 `/` 또는 `next` 경로 이동
- 기존회원: 로그인 후 기존 계정으로 정상 전환

### 8-2. 실패 시나리오
- 사용자 동의 취소 (`access_denied`)
- 코드 미수신/만료 (`callback_error`)
- 코드 교환 실패 (`exchange_failed`)
- 이메일 미동의 / 약관 동의 누락 대응

### 8-3. 보안/운영 확인
- `next` open redirect 차단
- 실패 메시지 민감정보 노출 없음
- 카카오 키 로그 출력 금지
- 운영 환경 HTTPS 강제

---

## 9) 운영 배포 체크리스트

- Kakao Developers Redirect URI에 운영 도메인 callback 등록
- Supabase URL Configuration에 운영 callback 등록
- `.env` 운영값 배포
- DB Trigger가 운영 환경에도 반영됐는지 확인
- RLS/세션 정책 검증
- 에러 모니터링 로그 경로 정비

---

## 10) 자주 발생하는 문제

### Q1. `signInWithOAuth` 직후 바로 로그인 실패/빈 화면
- callback URL 불일치(카카오, Supabase, 앱 routes 불일치)
- 카카오 동의항목 누락/권한 정책 제한

### Q2. 콜백에서 `callback_error`
- Supabase Auth `redirectTo`와 허용 URL mismatch
- `code` 미전달(브라우저 팝업/차단/중간 프록시)

### Q3. 새 유저 프로필 일부 필드 null
- `handle_new_user()`에서 kakao 메타데이터 key 변경
- migration 적용 미반영

### Q4. omx 팀이 멈춤
- `tmux` 권한 확인
- 팀 종료 후 재시작
- `team-ops` 로그/`tasks` 정합성 확인

---

## 11) 안전/보안 주의

- Kakao/서비스 키는 클라이언트에 노출 금지
- REST API 사용 시 서버 전용(`SUPABASE_SERVICE_ROLE_KEY`처럼) 또는 익명 노출 없는 위치에만 저장
- 웹사이트 URL/redirect URL은 HTTPS 운영 필수
- 실패 로그에서 사용자 토큰/세션 값 출력 금지

---

## 12) 재사용 템플릿

### 12-1. 프로젝트별 치환 변수
- `PROJECT_NAME`
- `SUPABASE_PROJECT_REF`
- `LOCAL_URL`
- `PROD_URL`
- `KAKAO_APP_KEY`
- `KAKAO_CLIENT_SECRET`

### 12-2. 팀 시작 한 줄 템플릿
```bash
PROJECT_NAME=<your-project> ./scripts/<your-task>-team.sh start
```

---

## 13) 완료 체크리스트

- [ ] Kakao 앱 등록 및 Redirect URI 등록
- [ ] Supabase Kakao Provider 등록
- [ ] Supabase URL Redirect 설정
- [ ] `/login` 카카오 버튼 + 에러 노출 구현
- [ ] `/auth/callback` 안전 검증 + 에러 분기
- [ ] DB `handle_new_user` 매핑 보강 및 마이그레이션 적용
- [ ] 성공/실패 수동 테스트 완료
- [ ] 운영 전환 전 점검(https, env, redirect)
- [ ] 감사 로그 및 모니터링 점검

---

## 14) 마지막에 남기는 한 줄

이 문서는 “카카오 OAuth는 앱/콘솔/DB/앱 라우트 모두 동기화해야 동작한다”는 점을 전제로 한다.
Kakao 앱 설정 1개, Supabase Auth 1개, 리다이렉트 경로 2개(개발/운영)만 정확히 맞추면 새 서비스에서도 동일 패턴으로 바로 재사용 가능하다.
