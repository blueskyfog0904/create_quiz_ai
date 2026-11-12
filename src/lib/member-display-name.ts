// 회원 표시 이름: 이메일 앞 4글자 + '#' + profiles.display_tag(가입 때 DB가 정해 저장한 영문 대문자·숫자 4글자).
// 이메일 전체는 드러나지 않아 공개 화면(리뷰 작성자 등)에도 쓸 수 있다.
export function formatMemberDisplayName(email: string | null | undefined, displayTag: string | null | undefined) {
  const prefix = (email ?? '').split('@')[0].trim().slice(0, 4) || '회원'
  return displayTag ? `${prefix}#${displayTag}` : prefix
}
