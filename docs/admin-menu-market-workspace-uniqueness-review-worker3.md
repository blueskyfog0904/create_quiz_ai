# `/admin/menu-management?subject=korean` market 메뉴 생성 500 조사 (worker-3)

## 결론
- `market_menu_entries`는 원래 테이블 생성 시 `entry_key`, `slug`에 **전역 unique** 를 걸어두었습니다.
- 이후 bilingual migration이 `workspace_subject` 컬럼과 `(workspace_subject, entry_key)`, `(workspace_subject, slug)` **스코프 unique index** 를 추가했지만, 기존 전역 unique 제약은 제거하지 않았습니다.
- 현재 관리자 생성 경로는 `workspace_subject = 'korean'`, `entry_key = slug = 'mock-exams'` 같은 payload를 그대로 `insert` 하므로, 영어 row가 이미 있으면 **낡은 전역 unique** 에 먼저 막혀 server action이 throw 되고 `/admin/menu-management`에서 500으로 보입니다.

## 정확한 root cause

### 1) 스키마가 아직 전역 unique 를 유지함
초기 테이블 정의:
- `supabase/migrations/20260317050500_create_market_menu_entries.sql:3-16`
  - `entry_key text not null unique`
  - `slug text not null unique`

workspace_subject 도입 migration:
- `supabase/migrations/20260331091000_add_workspace_subject_foundation.sql:53-55`
  - `workspace_subject` 추가
- `supabase/migrations/20260331091000_add_workspace_subject_foundation.sql:135-139`
  - `(workspace_subject, entry_key)`
  - `(workspace_subject, slug)` unique index 추가

문제는 위 migration에 **기존 전역 unique 제거가 없습니다**. 즉, 실제 제약은 아래처럼 중복 상태입니다.
- 전역 unique: `entry_key`, `slug`
- 스코프 unique: `(workspace_subject, entry_key)`, `(workspace_subject, slug)`

이 상태에서는 서로 다른 workspace라도 같은 slug/entry_key를 재사용할 수 없습니다.

### 2) create 경로가 같은 값을 `entry_key`와 `slug`에 함께 넣음
- `src/lib/market-menu-server.ts:260-287`
  - `workspace_subject: workspaceSubject`
  - `entry_key: normalized.slug`
  - `slug: normalized.slug`
  - `.insert(payload)`

따라서 영어 workspace에 `mock-exams`가 이미 있으면, 국어 workspace에서 같은 slug를 생성할 때 의도상 허용되어야 하지만 실제로는 낡은 전역 unique 에 걸립니다.

### 3) server action이 예외를 그대로 올려 500이 됨
- `src/app/(admin)/admin/menu-management/actions.ts:280-287`
  - `createMarketMenuEntryAction()`이 `createMarketMenuEntry()` 예외를 잡지 않고 그대로 throw

그래서 DB unique violation이 사용자 입장에서는 `/admin/menu-management?subject=korean` 생성 시 500처럼 보입니다.

## 왜 `mock-exams`에서 바로 터지나
- payload에서 `entry_key === slug === 'mock-exams'` 입니다.
- 영어 row가 이미 `mock-exams`를 사용 중이면, 국어 row 삽입은 스코프 unique 기준으로는 정상이어야 합니다.
- 하지만 전역 `entry_key`/`slug` unique 가 남아 있어 둘 중 하나가 먼저 `23505`를 발생시킵니다.
- 어떤 constraint 이름이 찍히는지는 Postgres가 어느 unique index를 먼저 검사하느냐에 따라 달라질 수 있습니다.

## backfill / upsert 추가 리스크

### 1) backfill conflict target이 아직 전역 key 기준임
- `src/lib/market-menu-server.ts:392-438`
- 현재 코드: `.upsert(payload, { onConflict: 'entry_key' })`

이 코드는 bilingual 이후 의도와 맞지 않습니다.

#### 리스크 A: 전역 unique 가 남아 있으면
- 영어 `entry_key = 'mock-exams'` row가 있을 때 국어 backfill이 같은 key로 들어오면,
- conflict target이 전역 `entry_key`를 잡아 **영어 row를 국어 payload로 merge/update** 할 가능성이 있습니다.
- 즉 “국어 row 추가”가 아니라 “영어 row 덮어쓰기”로 이어질 수 있습니다.

#### 리스크 B: 전역 unique 를 제거해도 onConflict가 잘못되면
- 남는 unique target은 `(workspace_subject, entry_key)` 인데,
- 코드가 계속 `onConflict: 'entry_key'` 를 쓰면 upsert target이 schema와 맞지 않아 실패할 수 있습니다.

## 최소 수정안

### 필수 1) 전역 unique 제거
새 migration에서 `market_menu_entries`의 기존 전역 unique 제약을 제거해야 합니다.

의도:
- 제거: 전역 `entry_key`, 전역 `slug`
- 유지: `(workspace_subject, entry_key)`, `(workspace_subject, slug)`

Postgres 기본 이름을 따른다면 보통 아래 constraint가 대상입니다.
- `market_menu_entries_entry_key_key`
- `market_menu_entries_slug_key`

### 필수 2) backfill upsert conflict target 수정
- `src/lib/market-menu-server.ts`
- 변경 전: `onConflict: 'entry_key'`
- 변경 후: `onConflict: 'workspace_subject,entry_key'`

이렇게 해야 workspace별 동일 key를 안전하게 upsert 할 수 있습니다.

### 권장 3) unique violation 에러를 사용자 친화적으로 변환
현재 `normalizeMarketMenuEntriesWriteError()`는 missing-table만 특수 처리합니다.
다음도 같이 처리하는 편이 좋습니다.
- `error.code === '23505'`
- constraint/details에 `slug` / `entry_key` 포함 시
- 메시지 예: `선택한 작업공간에 같은 slug의 문제마켓 메뉴가 이미 있습니다.`

이건 root cause 해결은 아니지만, 이후 동일 류 충돌을 500 대신 정상 오류 메시지로 보여줍니다.

## verification plan
1. **DDL 확인**
   - `market_menu_entries`에 전역 unique 가 없어졌는지 확인
   - `(workspace_subject, entry_key)`, `(workspace_subject, slug)`만 남았는지 확인
2. **create 재현 확인**
   - 영어 workspace에 `slug = 'mock-exams'` row 유지
   - 국어 workspace에서 같은 slug 생성
   - 기대 결과: 성공, 두 row 모두 존재
3. **subject 분리 조회 확인**
   - `listMarketMenuEntriesForAdmin('english')` → 영어 row 유지
   - `listMarketMenuEntriesForAdmin('korean')` → 국어 row 별도 조회
4. **backfill 확인**
   - `backfillMarketMenuEntriesAction('korean')` 실행
   - 기대 결과: 영어 row가 바뀌지 않고 국어 row만 insert/update
5. **회귀 확인**
   - `/market/mock-exams`가 영어/국어 workspace에서 각자 정상 resolve 되는지 확인

## 범위 내 추가 메모
- 동일한 migration 패턴(초기 전역 unique + 나중에 workspace scoped unique 추가)이 `generate_menu_entries`에도 보입니다.
- 이번 incident의 직접 원인은 `market_menu_entries`지만, generate 쪽 `onConflict: 'entry_key'`도 별도 점검 대상입니다.
