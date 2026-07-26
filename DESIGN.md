# Design

## Source of truth

이 문서는 Studio Design System의 제품·브랜드·시각·상호작용 결정에 대한 최상위 기준이다. 신규 UI를 만들거나 기존 화면을 Studio로 전환할 때 먼저 이 문서를 확인하고, 구현된 primitive와 pattern은 `/preview/design-system`에서 함께 검증한다. 문서와 구현이 다르면 임의로 새 규칙을 만들지 않고 이 문서의 결정을 우선 적용하며, 결정 변경이 필요하면 문서와 관련 계약 테스트를 같은 작업에서 갱신한다.

## Brand

Studio는 교사가 자료를 빠르게 만들고 관리할 수 있게 돕는 신뢰감 있는 교육 작업 공간이다. 주요 행동과 선택의 강조색은 purple 계열의 brand action color로 통일한다. 영어와 국어 같은 과목 정체성은 행동색과 분리해 blue와 emerald 계열로 표현한다. 과목색은 맥락과 구분을 제공하지만 주요 CTA의 의미를 대신하지 않는다.

## Product goals

- 지문 등록, 문제 생성, 문제은행 관리, 시험지 조립과 내보내기의 다음 행동을 즉시 이해할 수 있게 한다.
- 반복되는 목록·필터·상세·상태 화면을 같은 시각 문법으로 제공해 학습 비용을 낮춘다.
- 고밀도 교육 자료를 다루면서도 정보 위계, 읽기 흐름, 작업 상태를 선명하게 유지한다.
- 기존 기능과 접근성을 보존하면서 실제 운영 화면에 점진적으로 적용할 수 있게 한다.

## Personas and jobs

- 교사와 콘텐츠 제작자는 자료를 찾고, 문제를 생성·검토하고, 시험지를 조립·내보내야 한다. 이들에게는 빠른 스캔, 예측 가능한 작업 순서, 명확한 완료·오류 상태가 중요하다.
- 운영 관리자는 문제 유형, AI 설정, 사용자, 결제와 콘텐츠를 정확하게 관리해야 한다. 이들에게는 조밀한 정보에서도 비교 가능한 구조와 안전한 destructive action 구분이 중요하다.
- 신규 사용자는 제품의 핵심 흐름과 현재 위치를 빠르게 이해해야 한다. 이들에게는 일관된 용어, 단계적 안내, 복구 가능한 빈 상태가 중요하다.

## Information architecture

정보 구조는 제품의 실제 작업 흐름을 따른다. 상위 영역은 생성, 문제은행·자료실, 시험지, 마이페이지와 관리자 기능으로 구분한다. 각 페이지는 가능한 경우 `페이지 맥락과 제목 → 주요 행동 → 필터·탐색 → 결과·콘텐츠 → 페이지네이션 또는 보조 행동` 순서를 유지한다. 도메인 상태, URL state와 data fetching은 페이지 consumer가 소유하고 디자인 시스템은 시각 구조와 명시적 slot만 제공한다.

## Design principles

1. 다음 행동이 가장 먼저 보이게 한다. brand action purple은 실제 주요 행동과 선택에만 사용한다.
2. 의미와 장식을 분리한다. 과목 blue/emerald, 성공, 경고, 오류 상태는 서로의 역할을 대체하지 않는다.
3. 기존 패턴을 재사용한다. 새 시각 표현보다 기존 shadcn primitive와 검증된 Studio pattern을 우선한다.
4. 고밀도 화면에서도 위계를 유지한다. 제목, 설명, 도구, 결과를 공간과 typography로 구분한다.
5. 점진적으로 채택한다. 기존 global semantic token과 consumer 동작을 바꾸지 않는 additive 변경을 기본으로 한다.

## Visual language

Studio는 light-only 경험으로 운영한다. 기본 배경과 surface는 밝고 중립적으로 유지하고, ink·text·muted 단계로 정보 위계를 만든다. 주요 행동은 Studio primary token을 사용하는 purple, 과목 정체성은 blue/emerald semantic token 또는 기존 subject theme로 표현한다. content container의 최대 너비는 1200px이며 작은 viewport에서는 일관된 responsive gutter를 사용한다. radius와 shadow는 control·card 역할별 Studio token을 사용하고, core color·width·radius·shadow를 raw hex나 임의 값으로 반복하지 않는다. 글꼴은 별도 asset이 도입되기 전까지 system Korean font fallback stack을 사용한다.

## Components

기존 `src/components/ui`의 shadcn primitive를 우선 사용하고, Studio는 필요한 semantic token, additive variant, domain-independent pattern과 page frame만 더한다. 공통 abstraction은 showcase를 제외한 실제 consumer가 두 곳 이상 확인된 경우에만 만든다. 두 consumer의 props, 상태 소유권과 정보 필드가 대응하지 않으면 local markup으로 유지한다. 승인된 landing/detail page frame은 새 페이지 구성 계약을 제공하는 template 예외이며 domain data나 router를 직접 소유하지 않는다.

## Accessibility

모든 interactive target은 최소 44×44px의 hit area를 제공한다. keyboard만으로 주요 흐름, Dialog, Select, pagination과 닫기 행동을 수행할 수 있어야 한다. focus-visible 상태는 Studio focus-ring token으로 명확히 보이고 배경과 충분히 구분되어야 한다. 색상만으로 상태나 과목을 전달하지 않으며 label, text 또는 icon 의미를 함께 제공한다. semantic HTML과 기존 Radix 접근성 동작을 유지하고, portal 내부 content에도 동일한 Studio semantic alias와 hit-area 기준을 적용한다.

## Responsive behavior

1200px content width 안에서 desktop 정보 밀도를 유지하고, viewport가 좁아지면 gutter와 column 수를 줄인다. 768px 전후에서는 toolbar와 복합 layout이 wrap 또는 stack될 수 있어야 하며, 320px에서는 가로 overflow 없이 핵심 작업을 완료할 수 있어야 한다. table 중심 정보는 mobile에서 정보 손실 없이 card/list 표현으로 전환할 수 있고, action은 시각 순서와 keyboard 순서를 일치시킨다.

## Interaction states

interactive component는 default, hover, focus-visible, active/selected, disabled 상태를 구분한다. 비동기 작업은 loading, success, empty, error 상태를 명시하고 기존 콘텐츠를 오해하게 만드는 갑작스러운 layout shift를 피한다. destructive action은 일반 brand action과 분리하고 결과와 복구 가능성을 설명한다. disabled 상태는 클릭을 막는 것뿐 아니라 이유를 인접한 문맥에서 이해할 수 있게 한다.

## Content voice

문구는 짧고 구체적인 한국어를 기본으로 하며 사용자가 하려는 작업을 동사 중심으로 표현한다. 버튼은 `확인`처럼 맥락이 약한 말보다 `문제 생성`, `시험지 저장`처럼 결과를 예측할 수 있는 말을 우선한다. 빈 상태와 오류는 책임을 사용자에게 돌리지 않고 현재 상황, 가능한 원인, 다음 행동 순으로 안내한다. 내부 구현 용어와 불필요한 영어 혼용은 피한다.

## Implementation constraints

- 기존 global `--primary`와 subject theme는 변경하지 않고 `--studio-*` semantic token을 additive하게 사용한다.
- Studio core color, content width, radius, shadow와 font를 raw hex 또는 임의 literal로 consumer에 작성하지 않는다.
- light-only를 전제로 하며 Studio 작업에서 별도 dark theme를 만들지 않는다.
- 기존 shadcn primitive와 Radix 동작을 우선하고 새 base UI library나 dependency를 추가하지 않는다.
- 공통 abstraction은 실제 2-consumer gate를 통과해야 하며 showcase는 consumer 수에 포함하지 않는다.
- domain data, URL/router state, API 호출은 consumer에 남기고 공통 component는 명시적 props와 slot으로만 받는다.
- 기존 consumer 호환성을 위해 variant와 token은 additive하게 확장하고 기존 default 값을 바꾸지 않는다.

## Open questions

- Korean system font fallback을 대체할 self-hosted font asset과 성능 예산은 별도 검토가 필요하다.
- Studio 적용 범위를 preview와 market pilot 이후 어떤 운영 route로 확장할지는 사용성·회귀 검증 결과를 보고 정한다.
- 두 번째 실제 consumer가 없는 section heading, material card와 sticky action panel은 local pattern으로 유지하며 승격 시점을 추후 판단한다.
