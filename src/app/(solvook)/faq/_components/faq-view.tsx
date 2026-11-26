'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SiteBoardPostBody } from '@/components/site-board/site-board-post-body'
import { sameFaqPageHashId } from '@/lib/site-board'

// 14번 8절: FAQ 분류 탭(클라이언트에서 거름)과 질문 펼치기. 게시 글이 0개인 분류 탭은 서버가 이미 뺐다.
// 주소에 #id 가 있으면 '전체' 탭으로 두고 그 질문을 펼친 뒤 그 자리로 스크롤하고 초점을 둔다. 같은 화면 안 링크(hashchange)에도 같이 한다.
// next/link(답 안 링크 버튼·상단 메뉴)는 해시만 바뀌는 이동을 pushState 로 처리해 hashchange 가 일어나지 않는다. 그래서 문서 전체의
// 클릭을 캡처 단계에서 먼저 받아, 같은 화면 /faq#id(이 화면에 있는 질문)면 기본 이동을 막고 history.pushState 로 주소만 바꾼 뒤 바로 펼친다.
// pushState 는 Next 가 감싸 내부 상태(__NA)를 붙이므로 다른 화면에 갔다가 뒤로 오면 FAQ 화면이 다시 그려진다(location.hash 대입은 Next 밖 기록이 됨).
// 캡처 단계라 다른 클릭 처리기보다 먼저 돈다 — 같은 화면 FAQ 질문 링크에 자체 preventDefault 동작을 붙이면 이 처리기와 부딪힌다.
export interface FaqViewGroup {
  key: string
  label: string
  posts: { id: string; title: string; body: string; linkUrl: string | null; linkLabel: string | null }[]
}

const ALL = '__all__'

const tabClassName = (active: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
    active
      ? 'border-[var(--studio-primary)] bg-[var(--studio-primary)] text-white'
      : 'border-[var(--studio-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] hover:text-[var(--studio-primary)]'
  }`

export function FaqView({ groups, allLabel }: { groups: FaqViewGroup[]; allLabel: string }) {
  const [active, setActive] = useState<string>(ALL)
  const ids = useMemo(() => new Set(groups.flatMap((group) => group.posts.map((post) => post.id))), [groups])

  useEffect(() => {
    let frame = 0
    const openFromHash = () => {
      let id = ''
      try {
        id = decodeURIComponent(window.location.hash.slice(1)).toLowerCase()
      } catch {
        return
      }
      if (!ids.has(id)) return
      setActive(ALL)
      // '전체' 탭이 그려진 뒤 펼치고 옮긴다.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const element = document.getElementById(id)
        if (!(element instanceof HTMLDetailsElement)) return
        element.open = true
        element.scrollIntoView({ block: 'start' })
        element.querySelector('summary')?.focus({ preventScroll: true })
      })
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self')) return
      const id = sameFaqPageHashId(anchor.href, window.location.href)
      if (!id || !ids.has(id)) return
      event.preventDefault()
      if (window.location.hash.slice(1).toLowerCase() !== id) window.history.pushState(null, '', `#${id}`)
      openFromHash()
    }
    const first = requestAnimationFrame(openFromHash)
    window.addEventListener('hashchange', openFromHash)
    document.addEventListener('click', onClick, true)
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(frame)
      window.removeEventListener('hashchange', openFromHash)
      document.removeEventListener('click', onClick, true)
    }
  }, [ids])

  const visible = active === ALL ? groups : groups.filter((group) => group.key === active)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={active === ALL} className={tabClassName(active === ALL)} onClick={() => setActive(ALL)}>
          {allLabel}
        </button>
        {groups.map((group) => (
          <button
            key={group.key}
            type="button"
            aria-pressed={active === group.key}
            className={tabClassName(active === group.key)}
            onClick={() => setActive(group.key)}
          >
            {group.label}
          </button>
        ))}
      </div>

      {visible.map((group) => (
        <section key={group.key} aria-labelledby={`faq-group-${group.key}`} className="flex flex-col gap-3">
          <h2 id={`faq-group-${group.key}`} className="text-lg font-bold text-[var(--studio-ink)]">{group.label}</h2>
          <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
            {group.posts.map((post) => (
              <details key={post.id} id={post.id} className="group scroll-mt-24 border-b border-[var(--studio-border)] last:border-b-0">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)] sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 break-keep [overflow-wrap:anywhere]">{post.title}</span>
                  <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-[var(--studio-muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-5 sm:px-6">
                  <SiteBoardPostBody body={post.body} linkUrl={post.linkUrl} linkLabel={post.linkLabel} />
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
