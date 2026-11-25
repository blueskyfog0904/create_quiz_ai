'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  StudioDialogDescription,
  StudioDialogFooter,
  StudioDialogHeader,
  StudioDialogPanel,
  StudioDialogTitle,
} from '@/components/design-system/studio-dialog'
import {
  hasAuthCompleteQuery,
  isNoticePopupDismissed,
  isNoticePopupExcludedPath,
  isNoticePopupInWindow,
  markNoticePopupClosed,
  markNoticePopupHiddenToday,
  type ActiveSiteNoticePopup,
  type StorageGetter,
} from '@/lib/site-notice-popup'

export interface SiteNoticePopupContent {
  title: string
  body: string
  linkUrl: string | null
  linkLabel: string | null
}

interface SiteNoticePopupDialogProps {
  open: boolean
  content: SiteNoticePopupContent
  preview?: boolean
  // [닫기]·Esc
  onClose: () => void
  // [오늘 하루 보지 않기]
  onHideToday: () => void
  // 링크를 누름(닫기로 친다). 관리자 미리보기는 event.preventDefault() 로 이동을 막는다.
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void
}

// 표시 전용(저장소를 쓰지 않음). 회원 화면 팝업과 관리자 카드 [미리보기]가 같이 쓴다.
// 판의 직계 자식은 정확히 3개(머리·가운데 칸·버튼 줄): 높이 제한 grid 가 깨지지 않게 한다.
export function SiteNoticePopupDialog({ open, content, preview = false, onClose, onHideToday, onLinkClick }: SiteNoticePopupDialogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  const updateOverflow = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    setOverflowing(element.scrollTop + element.clientHeight < element.scrollHeight - 1)
  }, [])

  useEffect(() => {
    if (!open) return
    const element = scrollRef.current
    if (!element) return
    updateOverflow()
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open, content, updateOverflow])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <StudioDialogPanel
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
        onOpenAutoFocus={(event) => {
          // 처음 초점은 가운데 칸(처음부터 읽고 키보드로 바로 스크롤).
          event.preventDefault()
          scrollRef.current?.focus()
        }}
      >
        <StudioDialogHeader>
          {preview ? (
            <p className="mx-auto w-fit rounded-full bg-[var(--studio-background-sunken)] px-2 py-0.5 text-xs font-semibold text-[var(--studio-muted)]">
              개발 미리보기
            </p>
          ) : null}
          <StudioDialogTitle>{content.title}</StudioDialogTitle>
        </StudioDialogHeader>

        <div className="relative min-h-0">
          <div
            ref={scrollRef}
            tabIndex={0}
            onScroll={updateOverflow}
            className="h-full overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <StudioDialogDescription className="text-left">{content.body}</StudioDialogDescription>
            {content.linkUrl && content.linkLabel ? (
              <p className="mt-3 text-sm">
                <Link
                  href={content.linkUrl}
                  onClick={onLinkClick}
                  className="inline-flex min-h-11 items-center font-semibold text-[var(--studio-primary)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  {content.linkLabel}
                </Link>
              </p>
            ) : null}
          </div>
          {overflowing ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--studio-surface,#fff)] to-transparent"
            />
          ) : null}
        </div>

        <StudioDialogFooter>
          <Button type="button" variant="brandOutline" onClick={onHideToday}>
            오늘 하루 보지 않기
          </Button>
          <Button type="button" variant="brand" onClick={onClose}>
            닫기
          </Button>
        </StudioDialogFooter>
      </StudioDialogPanel>
    </Dialog>
  )
}

// 저장소 꺼내기는 effect·눌림 처리 안(try 안)에서만 한다. 사이트 데이터를 막으면 getter 가 던진다.
const sessionStorageGetter: StorageGetter = () => window.sessionStorage
const localStorageGetter: StorageGetter = () => window.localStorage

// 회원 화면 공지 팝업. 화면이 브라우저에 붙은 뒤·경로가 바뀔 때만 띄울지 판단한다(쿼리만 바뀌면 열지 않음).
export function SiteNoticePopup({ popup }: { popup: ActiveSiteNoticePopup | null }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // 마지막으로 판단한 '경로 + 지문'. layout 이 다시 그려져(router.refresh 등) popup 객체만 새로 와도 경로가 같으면 다시 열지 않는다(5-2).
  const judgedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!popup) return
    const judgedKey = `${pathname}\n${popup.contentSha256}`
    if (judgedRef.current === judgedKey) return
    judgedRef.current = judgedKey
    const excluded = isNoticePopupExcludedPath(pathname, popup.linkUrl)
    // 열린 채 빼는 경로로 오면 내린다(닫은 것으로 치지 않음). 판단은 다음 회원 화면에서 다시 한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 경로가 바뀐 뒤 브라우저 저장소를 보고 정하는 값이다.
    if (excluded) { setOpen(false); return }
    if (hasAuthCompleteQuery(window.location.search)) return
    const now = Date.now()
    if (!popup.preview && !isNoticePopupInWindow(popup, now)) return
    if (isNoticePopupDismissed(popup.contentSha256, now, { session: sessionStorageGetter, local: localStorageGetter })) return
    setOpen(true)
  }, [pathname, popup])

  if (!popup) return null

  const close = () => {
    markNoticePopupClosed(popup.contentSha256, { session: sessionStorageGetter })
    setOpen(false)
  }

  return (
    <SiteNoticePopupDialog
      open={open}
      content={popup}
      preview={popup.preview}
      onClose={close}
      onLinkClick={close}
      onHideToday={() => {
        markNoticePopupHiddenToday(popup.contentSha256, Date.now(), { local: localStorageGetter })
        setOpen(false)
      }}
    />
  )
}
