'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  ADMIN_ALERT_POLL_MS,
  ADMIN_ALERT_SAFETY_POLL_MS,
  ADMIN_ALERT_TOAST_BATCH_MS,
  countNewEvents,
  isLoudAlertEvent,
  summarizeToastBatch,
  type AdminAlertEvent,
  type AdminAlertSummary,
} from '@/lib/admin-alerts'

interface AdminAlertContextValue {
  // 아직 불러오지 못했으면 null
  summary: AdminAlertSummary | null
  // 가장 최근 조회가 실패했다. 이때 summary는 옛 값이므로 현재 값처럼 보여 주지 않는다.
  loadFailed: boolean
  realtimeDown: boolean
  soundOn: boolean
  toggleSound: () => void
  // 처리 동작(답변·환불 처리 등)이 끝난 뒤 불러 처리 대기 숫자를 바로 맞춘다.
  refresh: () => void
  openLink: (link: string) => void
}

const AdminAlertContext = createContext<AdminAlertContextValue | null>(null)

const soundStorageKey = (adminId: string) => `admin-alert-sound:${adminId}`

function readSoundOn(adminId: string) {
  try {
    return window.localStorage.getItem(soundStorageKey(adminId)) !== 'off'
  } catch {
    return true
  }
}

// 관리자 영역 전체에서 알림 조회·실시간 구독을 한 번만 한다(종과 메뉴 배지가 같은 값을 본다).
// renderedAt: 서버 레이아웃이 그려질 때마다 바뀌는 값. router.refresh()·서버 액션의 재검증으로
// 레이아웃이 다시 그려지면(= 관리자가 무언가 처리한 뒤) 요약도 다시 읽는다.
export function AdminAlertProvider({
  adminId,
  renderedAt,
  children,
}: {
  adminId: string
  renderedAt: number
  children: ReactNode
}) {
  const router = useRouter()
  const [summary, setSummary] = useState<AdminAlertSummary | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [realtimeDown, setRealtimeDown] = useState(false)
  const [soundOn, setSoundOn] = useState(() => readSoundOn(adminId))
  const summaryRef = useRef<AdminAlertSummary | null>(null)
  // 조회 요청 순번: 늦게 도착한 옛 응답이 새 응답을 덮지 않게 한다.
  const requestSeqRef = useRef(0)
  const soundOnRef = useRef(soundOn)
  const audioRef = useRef<AudioContext | null>(null)
  const batchRef = useRef<{ events: AdminAlertEvent[]; timer: ReturnType<typeof setTimeout> | null }>({ events: [], timer: null })
  // 탭이 숨겨진 동안 온 알림 수와, 원래 문서 제목
  const hiddenRef = useRef<{ count: number; title: string | null }>({ count: 0, title: null })

  const openLink = useCallback((link: string) => {
    // 사이트 안 경로만 연다.
    if (link.startsWith('/') && !link.startsWith('//') && !link.includes('\\')) {
      router.push(link)
    }
  }, [router])

  const refresh = useCallback(async (fromPoll = false) => {
    const seq = ++requestSeqRef.current
    try {
      const response = await fetch('/api/admin/alerts/summary', { cache: 'no-store' })
      if (!response.ok) throw new Error('ADMIN_ALERT_SUMMARY_FAILED')
      const next: AdminAlertSummary = await response.json()
      if (seq !== requestSeqRef.current) return
      // 실시간으로 받지 못한 알림(끊김·재연결·안전 폴링)은 목록에 처음 보이는 이벤트 수로 한 번 알린다.
      const added = fromPoll ? countNewEvents(summaryRef.current?.events, next.events) : 0
      if (added > 0) {
        toast(`새 알림 ${added}건`, { description: next.events?.[0]?.title })
      }
      summaryRef.current = next
      setSummary(next)
      setLoadFailed(false)
    } catch {
      // 실패를 0건처럼 보이지 않게 표시하고, 다음 조회에서 다시 시도한다.
      if (seq === requestSeqRef.current) setLoadFailed(true)
    }
  }, [])

  const playBeep = useCallback(() => {
    const context = audioRef.current
    // 페이지에서 한 번도 클릭하지 않았으면 브라우저가 소리를 막는다.
    if (!context) return
    try {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.2, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.3)
    } catch {
      // 소리를 내지 못해도 알림 자체는 화면에 남는다.
    }
  }, [])

  const restoreTitle = useCallback(() => {
    if (hiddenRef.current.title !== null) {
      document.title = hiddenRef.current.title
    }
    hiddenRef.current = { count: 0, title: null }
  }, [])

  const announce = useCallback((event: AdminAlertEvent) => {
    // 5초 안에 온 이벤트는 같은 토스트(id)를 고쳐 써서 하나로 묶는다.
    const batch = batchRef.current
    batch.events.push(event)
    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        batchRef.current = { events: [], timer: null }
      }, ADMIN_ALERT_TOAST_BATCH_MS)
    }
    const { title, description, link } = summarizeToastBatch(batch.events)
    toast(title, {
      id: `admin-alert-${batch.events[0].id}`,
      description,
      action: { label: '열기', onClick: () => openLink(link) },
    })

    if (isLoudAlertEvent(event)) {
      // 한 묶음에 소리는 한 번만
      if (soundOnRef.current && batch.events.filter(isLoudAlertEvent).length === 1) {
        playBeep()
      }
      // 권한은 종 패널의 버튼으로만 요청한다. 여기서는 이미 허용된 경우에만 띄운다.
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const notification = new Notification(title, { body: description, tag: 'admin-alert' })
          notification.onclick = () => {
            window.focus()
            openLink(link)
          }
        } catch {
          // 브라우저 알림을 띄우지 못해도 토스트·목록에는 남는다.
        }
      }
    }

    if (document.hidden) {
      const hidden = hiddenRef.current
      hidden.title ??= document.title
      hidden.count += 1
      document.title = `(${hidden.count}) ${hidden.title}`
    }

    void refresh()
  }, [openLink, playBeep, refresh])

  // 첫 조회 + 서버 레이아웃이 다시 그려질 때마다 조회
  useEffect(() => {
    void refresh()
  }, [refresh, renderedAt])

  // 탭이 다시 보일 때 조회
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return
      restoreTitle()
      void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      restoreTitle()
      if (batchRef.current.timer) clearTimeout(batchRef.current.timer)
      batchRef.current = { events: [], timer: null }
    }
  }, [refresh, restoreTitle])

  // 실시간 구독: 관리자 세션으로 admin_events INSERT를 받는다.
  useEffect(() => {
    const supabase = createClient()
    let active = true
    let wasDown = false
    const channel = supabase
      .channel('admin-events')
      .on<AdminAlertEvent>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_events' },
        (payload) => {
          if (active) announce(payload.new)
        }
      )

    // 채널에 들어가기 전에 로그인 세션의 토큰을 Realtime에 실어 둔다(조회 정책 is_admin()이 이 토큰으로 판정된다).
    void supabase.realtime.setAuth().catch(() => undefined).then(() => {
      if (!active) return
      channel.subscribe((status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          setRealtimeDown(false)
          // 끊긴 동안 놓친 알림을 채우고, 있으면 토스트로 알린다.
          if (wasDown) void refresh(true)
          wasDown = false
        } else {
          // CHANNEL_ERROR / TIMED_OUT / CLOSED
          wasDown = true
          setRealtimeDown(true)
        }
      })
    })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [announce, refresh])

  // 폴링은 항상 돈다: 구독이 끊긴 동안에는 30초, 연결돼 있어도(조용히 안 오는 경우 대비) 5분마다.
  useEffect(() => {
    const timer = setInterval(() => void refresh(true), realtimeDown ? ADMIN_ALERT_POLL_MS : ADMIN_ALERT_SAFETY_POLL_MS)
    return () => clearInterval(timer)
  }, [realtimeDown, refresh])

  // 소리: 브라우저는 사용자의 첫 클릭·키 입력 뒤에만 재생을 허용한다.
  useEffect(() => {
    const unlock = () => {
      try {
        audioRef.current ??= new AudioContext()
        void audioRef.current.resume().catch(() => undefined)
      } catch {
        // Web Audio를 쓸 수 없는 브라우저에서는 소리 없이 동작한다.
      }
      removeListeners()
    }
    const removeListeners = () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      removeListeners()
      void audioRef.current?.close().catch(() => undefined)
      audioRef.current = null
    }
  }, [])

  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current
    soundOnRef.current = next
    setSoundOn(next)
    try {
      window.localStorage.setItem(soundStorageKey(adminId), next ? 'on' : 'off')
    } catch {
      // 저장하지 못하면 이번 화면에서만 적용된다.
    }
  }, [adminId])

  const refreshNow = useCallback(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AdminAlertContextValue>(
    () => ({ summary, loadFailed, realtimeDown, soundOn, toggleSound, refresh: refreshNow, openLink }),
    [summary, loadFailed, realtimeDown, soundOn, toggleSound, refreshNow, openLink]
  )

  return <AdminAlertContext.Provider value={value}>{children}</AdminAlertContext.Provider>
}

export function useAdminAlerts() {
  return useContext(AdminAlertContext)
}
