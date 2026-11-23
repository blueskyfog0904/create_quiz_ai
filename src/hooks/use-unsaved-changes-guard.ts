'use client'

import { useEffect } from 'react'

export const UNSAVED_CHANGES_LEAVE_MESSAGE = '저장하지 않은 변경이 있습니다. 이 화면을 떠나면 변경이 사라집니다. 떠날까요?'

// 지금 저장 안 한 변경을 지키는 화면 수. 버튼 + router.push 로 옮기는 곳(과목 전환, 알림 열기 등)은
// 링크가 아니라 아래 click 검사가 잡지 못하므로, 이동 전에 confirmLeaveIfUnsaved() 를 부른다.
let activeGuardCount = 0

export function confirmLeaveIfUnsaved() {
  if (activeGuardCount === 0) return true
  return window.confirm(UNSAVED_CHANGES_LEAVE_MESSAGE)
}

// 저장 안 한 변경이 있을 때 창 닫기·새로고침(beforeunload)과 화면 안 링크(<a>, 사이드바 Link) 이동을 한 번 확인한다.
export function useUnsavedChangesGuard(hasUnsavedChanges: boolean, message = UNSAVED_CHANGES_LEAVE_MESSAGE) {
  useEffect(() => {
    if (!hasUnsavedChanges) return
    activeGuardCount += 1

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const nextUrl = new URL(anchor.href, window.location.href)
      if (nextUrl.origin !== window.location.origin) return
      if (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleClick, true)
    return () => {
      activeGuardCount -= 1
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleClick, true)
    }
  }, [hasUnsavedChanges, message])
}
