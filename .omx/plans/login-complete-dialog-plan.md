# 로그인 완료 팝업 구현 계획

## 1. 요구사항 요약

- 로그인 성공 후 사용자가 도착한 페이지에서 로그인 완료 메시지를 팝업으로 표시한다.
- 이메일 로그인과 카카오 로그인 모두 동일한 완료 UX를 제공한다.
- 팝업 디자인은 기존 앱에서 사용하는 완료 다이얼로그 패턴과 통일한다.
- 일반적인 로그인 완료 문구를 함께 적용한다.
- 계획 수립에는 멀티에이전트 오케스트레이션을 사용하고, designer 에이전트를 반드시 포함한다.

## 2. 멀티에이전트 분석 결과

### designer 에이전트

- `src/app/(auth)/login/page.tsx`의 현재 이메일 로그인은 `toast.success('로그인이 되었습니다.')` 직후 `window.location.assign(next)`로 이동해 메시지를 놓칠 수 있다고 분석했다.
- `src/app/auth/callback/route.ts`의 카카오 로그인 성공 흐름은 바로 `next`로 리다이렉트하므로 성공 메시지 신호가 없다고 분석했다.
- 기존 `src/app/(dashboard)/market/[slug]/market-purchase-complete-dialog.tsx`의 중앙 성공 다이얼로그 패턴을 재사용하는 것을 권장했다.
- 권장 문구: 제목 `로그인 완료`, 본문 `로그인이 완료되었습니다.`, 버튼 `확인`.

### critic 에이전트

- 핵심 리스크는 로그인 성공 신호를 어디에 전달하고 언제 제거할지라고 분석했다.
- `?login=success` 같은 일회성 URL 파라미터는 표시 후 제거해야 새로고침/뒤로가기에서 반복 표시되지 않는다.
- 카카오 간편가입(`signup=1`) 흐름에서는 로그인 완료 팝업을 띄우지 않는 편이 자연스럽다고 권장했다.
- 기존 `next` 경로의 pathname/query/hash 보존을 수용기준에 포함해야 한다고 지적했다.

## 3. 설계 결정

### 선택안

로그인 성공 시 도착 URL에 `login=success` 파라미터를 붙이고, 전역 클라이언트 컴포넌트가 이를 감지해 중앙 Dialog 팝업을 한 번 표시한다. 팝업이 닫히면 URL에서 `login` 파라미터를 제거한다.

### 선택 이유

- 이메일 로그인과 카카오 로그인 모두 하나의 표시 컴포넌트로 처리할 수 있다.
- 리다이렉트 이후에도 팝업이 안정적으로 표시된다.
- 기존 완료 팝업 디자인과 통일할 수 있다.
- 각 페이지에 개별 코드를 추가하지 않아도 된다.

### 제외 범위

- 결제 페이지의 기존 `redirect` 파라미터 불일치 개선은 별도 이슈로 둔다. 이번 변경은 현재 로그인 페이지가 이미 사용하는 `next` 흐름에 집중한다.
- 회원가입 완료 UX는 기존 가입 흐름을 유지하고, `signup=1` 카카오 콜백에는 로그인 완료 팝업을 표시하지 않는다.

## 4. 구현 단계

1. 회귀 테스트 추가
   - 로그인 페이지가 이메일 로그인 성공 시 즉시 toast를 띄우지 않고 `login=success`가 포함된 목적지로 이동하는지 계약 테스트를 추가한다.
   - 카카오 콜백 성공 리다이렉트에 `login=success`가 추가되고, `signupMode`에서는 추가되지 않는지 계약 테스트를 추가한다.
   - 전역 로그인 완료 다이얼로그 컴포넌트가 기존 Dialog 패턴, 문구, URL 파라미터 제거 로직을 포함하는지 계약 테스트를 추가한다.

2. 전역 로그인 완료 다이얼로그 컴포넌트 추가
   - 파일: `src/components/auth/login-complete-dialog.tsx`
   - `useSearchParams`, `useRouter`, `usePathname`을 사용해 `login=success`를 감지한다.
   - 기존 완료 팝업과 같은 `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Button`, `CheckCircle2` 패턴을 사용한다.
   - 문구는 `로그인 완료` / `로그인이 완료되었습니다.` / `확인`으로 적용한다.
   - 닫을 때 `login` 파라미터만 제거하고 기존 query/hash는 보존한다.

3. Root Template에 전역 다이얼로그 연결
   - 파일: `src/app/template.tsx`
   - `Suspense fallback={null}`로 `LoginCompleteDialog`를 감싸 전역 배치한다.
   - 기존 `Toaster`는 유지한다.

4. 이메일 로그인 성공 이동 수정
   - 파일: `src/app/(auth)/login/page.tsx`
   - 세션 확인 성공 시 `toast.success`를 제거하고, 목적지 URL에 `login=success`를 추가한 뒤 이동한다.
   - hash가 있는 next 경로도 보존한다.

5. 카카오 콜백 성공 이동 수정
   - 파일: `src/app/auth/callback/route.ts`
   - 세션 교환 성공 후 `signupMode`가 아닐 때만 `login=success`를 추가한다.

## 5. 수용 기준

- 이메일 로그인 성공 후 목적지 URL에 `login=success`가 포함되고, 도착 페이지에서 로그인 완료 팝업이 보인다.
- 카카오 로그인 성공 후에도 동일하게 로그인 완료 팝업이 보인다.
- 카카오 가입 모드(`signup=1`)에서는 로그인 완료 팝업 신호를 추가하지 않는다.
- 팝업 문구는 다음과 같다.
  - 제목: `로그인 완료`
  - 본문: `로그인이 완료되었습니다.`
  - 버튼: `확인`
- 팝업 디자인은 기존 성공 완료 Dialog와 같은 중앙 모달, emerald 성공 아이콘, 확인 버튼 구조를 사용한다.
- 팝업 닫기 후 URL에서 `login=success`가 제거되어 새로고침 시 반복 표시되지 않는다.
- 기존 `next` 경로의 query/hash를 보존한다.

## 6. 검증 계획

- `node --test` 계약 테스트 실행.
- 변경 파일 대상 ESLint 실행.
- `npm run build` 실행.
- 가능하면 브라우저에서 `/?login=success` 접속 후 팝업 표시와 확인 버튼 클릭 후 URL 정리 여부를 확인한다.
- 전체 `npm run lint`는 현재 저장소의 기존 unrelated lint 오류가 있으면 변경 파일 대상 lint 결과와 분리해 보고한다.
