// 19번 5절: 장바구니 줄 이름 겹침 정리(순수 함수 — 서버 모듈·표시 설정을 가져오지 않는다. 장바구니·결제 경로는 설정을 읽지 않음).
// 줄 위 꼬리표(구성 이름 또는 '전체 패키지')와 줄 이름(전체구매 표시명)이 같으면 줄 이름을 한 번만(꼬리표로만) 보인다.
// 겹침 정리는 묶음 줄에만 한다(개별 자료 줄은 지금 그대로). 빈 줄 이름은 지금처럼 숨긴다. 돌려준 값이 null 이면 줄 이름 줄을 그리지 않는다.
export function resolveCartLineOptionTitle(
  targetKind: string,
  tag: string | null | undefined,
  optionTitle: string | null | undefined,
): string | null {
  if (targetKind !== 'bundle') return optionTitle || null
  const title = optionTitle?.trim()
  if (!title) return null
  if (tag?.trim() === title) return null
  return title
}
