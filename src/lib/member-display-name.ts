// 회원 표시 이름: 이메일 앞 3글자 + 회원 id(무작위 UUID)의 끝 4글자. 같은 회원은 항상 같은 이름이 나온다.
// 이메일 전체는 드러나지 않아 공개 화면(리뷰 작성자 등)에도 쓸 수 있다. 회원 이름은 저장하지 않는다.
export function formatMemberDisplayName(email: string | null | undefined, userId: string) {
  const prefix = (email ?? '').split('@')[0].trim().slice(0, 3) || '회원'
  const suffix = userId.replace(/-/g, '').slice(-4)
  return `${prefix}${suffix}`
}
