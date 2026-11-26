// 18번 8절: 빠진 항목 칩·[같은 구성으로 다음 상품]이 그 입력칸으로 이동해 초점을 준다. 접힌 칸(<details>) 안이면 펼친다.
export function focusProductField(targetId: string) {
  const element = document.getElementById(targetId)
  if (!element) return false
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.focus({ preventScroll: true })
  return true
}

// 상태가 바뀐 뒤 그려진 화면에서 초점을 준다(다음 그리기 뒤).
export function focusProductFieldAfterRender(targetId: string) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      focusProductField(targetId)
    })
  })
}
