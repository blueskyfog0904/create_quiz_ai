# 장바구니 계획 최종 검증 기록

- 최종 판정: **PLAN PASS**
- 종료일: 2026-09-29 KST
- 대상: [구현 계획](./cart-implementation-plan.md)
- 이 판정은 분석·구현 계획의 완결성이다. 애플리케이션 구현, DDL 적용, 실제 DB 동시성/권한/Storage 쓰기 검증을 수행한 것으로 간주하지 않는다.

## 검증 loop

| 순서 | 판정 | 발견·조치 |
|---|---|---|
| DB·코드 감사 | 기존 구현을 반복 호출하는 장바구니 출시는 불가 | HTTP 보상 구매, FK 범위, 환불 원자성, 실제 스키마 drift를 확인 |
| 자체 검토 v1 | FAIL | 종료된 batch, 부분 보유 bundle 정책, legacy 재구매, upgrade 기준 주문, 잠금 역전 등을 v2에서 보완 |
| 독립 R1 / v2 | PLAN FAIL | B1~B6: 탈퇴 경합, direct 계약, 전체 선택, Storage 검증, legacy coverage, 정보 미반환 기준 |
| v3 보완 | 재검증 요청 | 원자 DB 정리+Auth 복구 job, direct quote/필수 키, 전체 50행 snapshot, Storage ACL/실접근 gate, exact-kind, T34~40 추가 |
| 독립 R2 / v3 | **PLAN PASS** | B1~B6 종료 및 기존 원자성·멱등성·복합 FK·환불·잠금 계약 유지 확인 |

- [R1 원문](./cart-plan-review-r1.md)
- [R2 원문](./cart-plan-review-r2.md)
- R2 담당 작업: `task_0857b407da5e`, dispatch `ctx_4ec5f6a68e6f`.

## 전달본과 검증 입력의 일치

R2가 검증한 계획 전체 SHA-256:

`a2224de1eb3947d9a5afcbb701f2b2d25104f0a7f45eb0439106f1344b514f46`

최종 전달본 SHA-256:

`cf036d1600998a202d31519479492baa1d96c40e8858451b4cebc47bc3e4f09a`

차이는 **상단 상태 1줄과 검증 표 결과 1줄**뿐이다. R2 대기를 PLAN PASS로 바꾸고 R2 링크를 넣었다. 두 줄을 되돌렸을 때 검증 입력 해시가 복원되는지 명령으로 확인했다. 기능·DB 모델·권한·HTTP·단계·테스트 계약은 재검증 이후 변경하지 않았다.

- R2 보고서 해시: `971a728daad99c127de429a65a6a75f4f5692f9c7dc08959dcacdc48e0bc6f61`
- Preflight SQL 해시: `c7ffbb4527f5132956533737cb1f53330018a8d52ddbc5235838fdaabc109fa7`

## 이번 작업에서 실제 수행한 검증

- 솔북 상품 PC 1440px/모바일 390px, 모바일 옵션 sheet, cart 인증 전환 관찰. 외부 cart 추가/주문/결제는 실행하지 않음.
- 실제 연결 DB의 OpenAPI·테이블 exact count·부모 관계·order consumption 합계/소유자·권한/환불 상태를 읽기 전용으로 확인.
- `market-files`의 비공개 설정과 금융/권한 테이블의 익명 HEAD 0행 확인.
- 계획에 테스트 T01~T40이 중복 없이 있고, 문서 내부 상대 링크 대상이 존재함을 확인.
- JSON 증거 파일 파싱, 문서 해시, `git diff --check` 확인.
- 코드·DB 감사 및 독립 R1/R2 검토. 이번 분석 작업이 만든 저장소 파일은 문서·읽기 전용 SQL·익명 집계 JSON뿐이다. 기존 dirty 소스는 보존했다.

## 아직 실행하지 않은 구현 gate

- 실제 pg_catalog의 FK/CHECK/UNIQUE/RLS/GRANT/function body/trigger/default ACL·migration history 대조.
- 인증된 사용자별 실제 Storage GET/list/sign 차단 및 object/path 정합성 SQL 실행.
- 신규 migration, quote/checkout/withdraw RPC, 동시성·실패 주입·실제 UI 구현 검증.

위 항목은 구현 Phase 0~4의 필수 gate다. 특히 DB 접근 권한/격리 환경이 준비되지 않으면 Phase 0을 PASS로 처리하거나 후속 DDL을 적용하지 않는다.

## 협업 실행 기록

Orca orchestration의 실제 task/dispatch로 DB 감사·코드 감사·독립 검증을 분리했다. 일부 worker의 완료 메시지는 sandbox runtime 연결 문제로 전달되지 않았다. 코디네이터가 각 보고서와 worker의 최종 TUI 판정을 확인한 뒤 `recovery:true`로 작업 완료 상태를 복구했다. 실패 verdict를 통과로 바꾸거나 worker_done을 대리 전송한 것이 아니다. R1은 FAIL, R2는 해당 검토자의 PASS 판정을 그대로 보존한다.
