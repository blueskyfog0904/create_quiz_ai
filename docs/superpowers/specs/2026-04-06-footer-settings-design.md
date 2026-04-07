# Footer 설정 설계

## 목표
- 사이트 공통 footer 정보를 관리자에서 관리할 수 있게 한다.
- 관리자 사이드바에 `footer 설정` 메뉴를 추가한다.
- 고정 필드(사업자/고객센터 정보)는 값 + 활성화 여부를 가진다.
- 추가 안내 문구는 제목 없는 문장 리스트로 추가/삭제/수정 가능하다.

## 저장 전략
- subject 분리 없이 사이트 공통 설정 1세트만 관리한다.
- 새 테이블 대신 `system_settings`에 JSON 1건으로 저장한다.
- key: `site_footer_content`

## 데이터 구조
- `fixedFields`
  - companyName
  - representativeName
  - businessAddress
  - businessRegistrationNumber
  - mailOrderRegistrationNumber
  - privacyOfficer
  - customerCenter
  - orderEmail
  - csHours
- 각 고정 필드는 `{ label, value, enabled }`
- `extraNotices`: string[]

## UI
- 관리자 사이드바에 `footer 설정` 추가
- 관리자 페이지에서:
  - 고정 필드 입력 + 활성화 스위치
  - 추가 안내 문구 리스트 추가/삭제/수정
  - 저장 버튼

## 렌더링
- 비활성화되었거나 값이 비어 있는 고정 필드는 출력하지 않는다.
- 추가 안내 문구는 빈 문자열을 제외하고 리스트 순서대로 출력한다.
- footer는 여러 줄의 정보 블록 + 추가 문구 + 저작권 문구로 구성한다.

## 검증
- eslint / typecheck / 관련 node tests 통과
- footer 설정 메뉴가 관리자 사이드바에 노출
- 관리자 페이지 저장 후 Footer 렌더링 로직이 새 설정 키를 읽음
- 추가 안내 문구 리스트 추가/삭제 UI와 고정 필드 활성화 UI가 존재함
